import type { Dossier, Exposure, Fact, Item, Judgment, PlaceRisk, TripInput } from './domain';
import { dateForDay, daysUntil, now, today } from './dates';

/**
 * Trip safety comes before opening hours. Area notices (weather warnings, emergency
 * responses, area-wide closures, transport suspensions) are read once per city and then
 * applied to each stop according to how exposed it is. Nothing here knows about any
 * particular city; coverage comes from the notice text and the stop list.
 */
export type Advisory = Fact & { kind: 'advisory' };
export const riskKey = (city: string) => `risk:${city}`;
export const isAdvisory = (f: Fact): f is Advisory => f.kind === 'advisory';
export const exposureLabels: Record<Exposure, string> = { coastal: '海边点位', mountain: '山地点位', water: '涉水点位', outdoor: '露天点位', indoor: '室内场所', transport: '交通' };
export const hazardWindowDays = 7;

/** Written level as a number: 蓝1 黄2 橙3 红4; emergency response Ⅳ1 … Ⅰ4. */
export function levelRank(level: string | null): number | null {
  if (!level) return null;
  const text = level.normalize('NFKC');
  if (/红/.test(text)) return 4;
  if (/橙/.test(text)) return 3;
  if (/黄/.test(text)) return 2;
  if (/蓝/.test(text)) return 1;
  const roman = text.match(/(IV|III|II|I|[一二三四1-4])\s*级/);
  return roman ? ({ I: 4, 一: 4, 1: 4, II: 3, 二: 3, 2: 3, III: 2, 三: 2, 3: 2, IV: 1, 四: 1, 4: 1 } as Record<string, number>)[roman[1]] ?? null : null;
}

/**
 * How far a warning reaches.
 * severe: every stop needs a fresh check, and exposed stops are off.
 * high: exposed stops are off, open-air stops and transport need a fresh check.
 * watch: exposed stops need a fresh check.
 */
export type Severity = 'severe' | 'high' | 'watch';
const severityRank: Record<Severity, number> = { watch: 1, high: 2, severe: 3 };
export function advisorySeverity(a: Advisory): Severity | null {
  const p = a.payload, rank = levelRank(p.level);
  if (p.type !== 'warning' && p.type !== 'response') return null;
  const response = p.type === 'response';
  switch (p.hazard) {
    case '台风': return (rank ?? 0) >= 3 ? 'severe' : response || (rank ?? 0) >= 2 ? 'high' : 'watch';
    case '暴雨': case '暴雪': return (rank ?? 0) >= 3 ? 'severe' : 'high';
    case '山洪地质灾害': return 'high';
    case '大风': return (rank ?? 0) >= 2 || response ? 'high' : 'watch';
    case '冰雹': case '雷电': return (rank ?? 0) >= 3 ? 'high' : 'watch';
    default: return (rank ?? 0) >= 4 ? 'high' : 'watch';
  }
}
/** Stops a hazard makes unsafe by default. */
function exposedTo(hazard: Advisory['payload']['hazard'], exposure: Exposure) {
  if (hazard === '暴雪') return exposure === 'mountain';
  if (hazard === '山洪地质灾害') return exposure === 'mountain' || exposure === 'water';
  return exposure === 'coastal' || exposure === 'mountain' || exposure === 'water';
}
const transportHazards = new Set(['台风', '暴雨', '暴雪', '大风']);

/** Whether a notice is in force on a date. Open-ended notices are assumed to last a few days. */
export function advisoryActive(a: Advisory, date: string): boolean {
  const p = a.payload;
  if (p.from > date) return false;
  if (p.to) return p.to >= date;
  const days = p.type === 'warning' ? 2 : p.type === 'response' ? 4 : p.type === 'suspension' ? 3 : 14;
  return daysUntil(date, p.from) <= days;
}
/** Notices older than a month are history, not a current risk. */
export const advisoryFresh = (a: Advisory, base = today()) => daysUntil(a.payload.from, base) >= -30;

const usable = (f: Fact) => f.quoteVerified && f.venueMatch === 'exact' && f.linkStatus !== 'broken';
const registrable = (domain: string) => domain.toLowerCase().split('.').slice(/(?:com|org|gov|net|edu)\.cn$/.test(domain) ? -3 : -2).join('.');
/** Official and authoritative notices count alone; anything else needs a second independent site. */
export function corroborated(a: Advisory, peers: Advisory[]) {
  if (a.tier <= 2) return true;
  const same = peers.filter(p => p.payload.type === a.payload.type && p.payload.hazard === a.payload.hazard);
  return new Set(same.map(p => registrable(p.domain))).size >= 2;
}

export function fallbackExposure(item: Pick<Item, 'kind'>): Exposure {
  return item.kind === 'transport' ? 'transport' : item.kind === 'scenic' || item.kind === 'other' ? 'outdoor' : 'indoor';
}
const stem = (area: string) => area.replace(/(?:特别行政区|自治州|自治县|地区|新区|省|市|区|县|镇|乡|街道)$/, '');
/** A city-wide warning reaches every stop in that city even when the reader skipped it. */
function areaCovers(a: Advisory, city: string) {
  if (a.payload.type !== 'warning' && a.payload.type !== 'response') return false;
  const area = stem(a.payload.area), place = stem(city);
  return area.length >= 2 && place.length >= 2 && (area === place || /^(?:全市|本市|市区)$/.test(a.payload.area));
}

/** The area and scope of a notice as one phrase, e.g. 洞头全部涉海景区景点. */
export function scopeName(a: Advisory) {
  const p = a.payload, area = stem(p.area);
  if (!p.scope) return p.named.length === 1 ? p.named[0] : `${p.area}的景区`;
  return p.scope.startsWith(area) || /^(?:全市|本市)/.test(p.scope) ? p.scope : `${area}${p.scope}`;
}
export type SafetyOutcome = { verdict: 'conflict' | 'unknown'; code: string; explanation: string; basis: Fact[]; notes: string[] };

/** Decide one stop's safety on its date from the city's confirmed notices. */
export function assessSafety(item: Item, date: string, city: string, risk: Dossier | undefined): SafetyOutcome | null {
  const diff = daysUntil(date);
  if (!risk || diff < 0 || diff > hazardWindowDays) return null;
  const place: PlaceRisk | undefined = risk.places?.find(p => p.place === item.placeName);
  const exposure = place?.exposure ?? fallbackExposure(item);
  const label = exposureLabels[exposure];
  const notices = risk.facts.filter(isAdvisory).filter(usable).filter(a => advisoryFresh(a) && advisoryActive(a, date));
  const cover = (a: Advisory) => place?.covers.find(c => c.factId === a.id) ?? (areaCovers(a, item.city || city) ? { factId: a.id, how: 'area' as const, reason: `${a.payload.area}范围内` } : undefined);
  const covering = notices.filter(a => cover(a));
  const reopened = covering.filter(a => a.payload.type === 'reopen');
  const lifted = (a: Advisory) => reopened.some(r => r.payload.from >= a.payload.from);
  const why = (a: Advisory) => cover(a)!;
  const source = (a: Advisory) => `${a.payload.from.slice(5).replace('-', '月').replace(/^0/, '')}日起${a.payload.to ? `至${Number(a.payload.to.slice(5, 7))}月${Number(a.payload.to.slice(8))}日` : ''}`;

  // 1. An announced closure or suspension that reaches this stop.
  const shut = covering.filter(a => (item.kind === 'transport' ? a.payload.type === 'suspension' : a.payload.type === 'closure' || (a.payload.type === 'suspension' && exposure === 'water')) && !lifted(a));
  if (shut.length) {
    const strong = shut.filter(a => corroborated(a, shut));
    const a = (strong.length ? strong : shut).sort((x, y) => x.tier - y.tier || Number(why(y).how === 'named') - Number(why(x).how === 'named'))[0];
    const c = why(a), what = item.kind === 'transport' ? '停运' : '关闭';
    const target = c.how === 'named' ? '公告点名了这里' : `${scopeName(a)}${what}，这里是${label}，在公告范围内`;
    if (strong.length) return { verdict: 'conflict', code: item.kind === 'transport' ? 'SERVICE_SUSPENDED' : 'AREA_CLOSED',
      explanation: `已公告${what}：${a.payload.hazard !== '其他' ? `受${a.payload.hazard}影响，` : ''}${target}。${source(a)}生效${a.payload.to ? '' : '，没查到恢复通知'}。`,
      basis: strong, notes: [c.how === 'named' ? '' : `公告没有逐一列出所有景点，按公告的地区和对象判断：${c.reason}`, '官方公告优先于平台显示的营业时间。'].filter(Boolean) };
    return { verdict: 'unknown', code: 'CLOSURE_REPORTED', explanation: `有网页提到${source(a)}${what}，但没有官方或权威来源证实；出发前向景区或当地文旅部门确认。`, basis: shut, notes: [] };
  }

  // 2. Warnings and emergency responses.
  const warnings = covering.filter(a => advisorySeverity(a));
  const strongWarnings = warnings.filter(a => corroborated(a, warnings));
  const strongest = (list: Advisory[]): Advisory | undefined => [...list].sort((a, b) => severityRank[advisorySeverity(b)!] - severityRank[advisorySeverity(a)!] || a.tier - b.tier)[0];
  const warningName = (p: Advisory['payload']) => p.type === 'response' ? `${p.hazard === '其他' ? '' : `防${p.hazard}`}${p.level ?? ''}应急响应` : `${p.hazard}${p.level ? p.level.replace(/(?:预警|信号)$/, '') : ''}预警`;
  const top = strongest(strongWarnings);
  if (top) {
    const severity = advisorySeverity(top)!, p = top.payload, name = warningName(p);
    const basis = strongWarnings.filter(a => a.payload.hazard === p.hazard);
    const offRoute = exposure !== 'transport' && exposedTo(p.hazard, exposure);
    if (offRoute && severity !== 'watch') return { verdict: 'conflict', code: 'HAZARD_EXPOSED', explanation: `${stem(p.area)}${name}期间，${label}默认不安全，不建议前往。`, basis, notes: [place?.exposureReason ? `点位类型：${place.exposureReason}` : '点位类型按地点名称判断。', '开放时间只说明平时几点开门，不能说明预警期间可以去。'] };
    if (exposure === 'transport' && (severity === 'severe' || (severity === 'high' && transportHazards.has(p.hazard)))) return { verdict: 'unknown', code: 'SERVICE_ALERT', explanation: `${stem(p.area)}${name}期间可能停运，以当天停运公告为准。`, basis, notes: ['公交、轨道、轮渡和打车都可能停运或受限；时刻表不能说明能正常出行。'] };
    if (offRoute || (exposure === 'outdoor' && severity !== 'watch') || severity === 'severe') return { verdict: 'unknown', code: 'HAZARD_ALERT', explanation: `${stem(p.area)}${name}期间可能临时闭园或限流，出发前查景区和当地官方公告。`, basis, notes: [] };
  }
  // Warnings only one secondary site repeats, and forecasts alone, do not change a stop.
  if(risk.contextStatus==='pending'||risk.contextStatus==='failed')return {verdict:'unknown',code:risk.contextStatus==='pending'?'CONTEXT_PENDING':'CONTEXT_FAILED',explanation:risk.contextStatus==='pending'?'天气预警和区域公告仍在检查；当前规则仅是已核实部分。':'预警或区域公告检查未能完成；已查到的常规开放规则不能据此确认最终可前往。',basis:[],notes:risk.limitations};
  return null;
}

export function judgeSafety(item: Item, trip: TripInput, risk: Dossier | undefined): Judgment | null {
  const date = dateForDay(trip.startDate, item.day), city = item.city || trip.destinationCity;
  const outcome = assessSafety(item, date, city, risk);
  if (!outcome) return null;
  return {
    id: `safety-${item.id}-${date}-${outcome.code}-${outcome.basis.map(f => f.id).sort().join('.')}`.slice(0, 160),
    itemId: item.id, venueId: risk!.venue.id, type: 'safety', date, verdict: outcome.verdict, reasonCode: outcome.code, explanation: outcome.explanation,
    factIds: outcome.basis.map(f => f.id), overruledFactIds: [], evidenceIds: [...new Set(outcome.basis.map(f => f.evidenceId))],
    searchedScope: risk!.searchedScope, notes: outcome.notes, judgedAt: now(),
  };
}

/** Confirmed notices in force on one trip day, strongest first. */
export function dayAdvisories(dossiers: Dossier[], date: string): Advisory[] {
  const notices = dossiers.filter(d => d.venue.key.startsWith('risk:')).flatMap(d => d.facts).filter(isAdvisory).filter(usable)
    .filter(a => advisoryFresh(a) && advisoryActive(a, date) && a.payload.type !== 'reopen');
  const weight = (a: Advisory) => a.payload.type === 'closure' || a.payload.type === 'suspension' ? 4 : severityRank[advisorySeverity(a) ?? 'watch'];
  const seen = new Set<string>();
  return notices.filter(a => corroborated(a, notices)).sort((a, b) => weight(b) - weight(a) || a.tier - b.tier)
    .filter(a => { const key = `${a.payload.type}:${a.payload.hazard}:${a.payload.level}:${a.payload.scope ?? a.payload.area}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
