import type { Alternative, Dossier, Evidence, Fact, Item, Judgment, TripInput } from './domain';
import { dateForDay, inSeason, weekday, weekdayLabel } from './dates';

export type PlanState = 'adjust' | 'fits' | 'needs_time' | 'verify' | 'pending';
export const planLabels: Record<PlanState, string> = { adjust: '需调整', fits: '可前往', needs_time: '待补时间', verify: '待核实', pending: '尚未核验' };
export const planHints: Record<PlanState, string> = {
  adjust: '有依据的闭馆、超出入场时段、抵离或衔接冲突。',
  fits: '当天开放，已填时段或全天开放符合已核实的规则；不代表已预约或一定有票。',
  needs_time: '营业规则已查到，补上你的到达时间才能判断来不来得及。',
  verify: '关键规则缺少可靠依据、来源说法不一致或无法访问。',
  pending: '还没有生成核验结果。',
};
export const isPlanConflict = (j: Judgment) => j.verdict === 'conflict' && j.type !== 'guide_claim' && j.type !== 'weather';
/** How strong the sources behind a rule are, in the words shown to visitors. */
export type Basis = 'official' | 'authority' | 'consensus' | 'reference';
export const basisLabels: Record<Basis, string> = { official: '官方', authority: '权威来源', consensus: '多源一致', reference: '仅供参考' };
export type RuleHighlight = { label: string; value: string; note?: string; verified: boolean; basis?: Basis; tone?: 'good' | 'bad' | 'muted' };
export type ItemInsight = {
  state: PlanState; message: string; rules: RuleHighlight[]; updates: Judgment[];
  conflicts: Judgment[]; citations: { evidence: Evidence; quote: string }[];
  hours: string | null; allDay: boolean; missingTime: boolean;
  /** The guide's opening-hour claims that no longer match, normalised for display. */
  staleClaims: string[];
};
function period(f: Fact, date: string) {
  if ((f.validFrom && f.validFrom > date) || (f.validTo && f.validTo < date)) return null;
  if (f.kind === 'hours' && (!f.payload.weekdays || f.payload.weekdays.includes(weekday(date)))) return f.payload.seasons.find(s => inSeason(date, s.from, s.to)) ?? null;
  if (f.kind === 'temp_hours' && f.payload.from <= date && f.payload.to >= date) return f.payload;
  return null;
}
const usable = (f: Fact) => f.quoteVerified && f.venueMatch === 'exact' && f.linkStatus !== 'broken';
// Mirrors lib/evidence.ts; that module is server-only.
const registrableDomain = (domain: string) => domain.toLowerCase().split('.').slice(/(?:com|org|gov|net|edu)\.cn$/.test(domain) ? -3 : -2).join('.');
function independent(facts: Fact[]) { return new Set(facts.map(f => registrableDomain(f.domain))).size; }
export function basisOf(facts: Fact[]): Basis | undefined {
  if (!facts.length) return undefined;
  const tier = Math.min(...facts.map(f => f.tier));
  return tier === 1 ? 'official' : tier === 2 ? 'authority' : independent(facts) >= 2 ? 'consensus' : 'reference';
}
const span = (open: string, close: string) => open === '00:00' && ['24:00', '23:59'].includes(close) ? '全天开放' : `${open}—${close}`;
const md = (v: string) => `${Number(v.slice(0, 2))}月${Number(v.slice(3))}日`;
const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Describe source facts separately from the fit of the user's schedule. */
export function itemInsight(item: Item, judgments: Judgment[], dossiers: Dossier[], date: string): ItemInsight {
  const js = judgments.filter(j => j.itemId === item.id);
  const facts = dossiers.flatMap(d => d.facts);
  const venueFacts = dossiers.filter(d => js.some(j => j.venueId === d.venue.id)).flatMap(d => d.facts).filter(usable);
  const evidence = dossiers.flatMap(d => d.evidence);
  const place = item.kind !== 'transport' && item.kind !== 'hotel';
  const rules: RuleHighlight[] = [];
  const usedFacts: Fact[] = [];

  const openCheck = js.find(j => j.type === 'open_on_date');
  if (openCheck && place) {
    const basis = basisOf(facts.filter(f => openCheck.factIds.includes(f.id)));
    if (openCheck.verdict === 'conflict') rules.push({ label: '当天', value: openCheck.reasonCode === 'TEMP_CLOSED' ? '临时关闭' : `${weekdayLabel(date)}闭馆`, verified: true, basis, tone: 'bad' });
    else if (openCheck.verdict === 'confirmed') rules.push({ label: '当天', value: '正常开放', verified: true, basis, tone: 'good', note: `${md(date.slice(5))} ${weekdayLabel(date)}` });
    else rules.push({ label: '当天', value: openCheck.reasonCode === 'OPEN_ENDED_CLOSURE' ? '恢复时间待确认' : '未确认', verified: false, tone: openCheck.reasonCode === 'OPEN_ENDED_CLOSURE' ? 'bad' : 'muted',
      note: openCheck.reasonCode === 'OPEN_ENDED_CLOSURE' ? '查到临时关闭报道' : openCheck.reasonCode === 'SOURCES_DISAGREE' ? '来源说法不一致' : '未查到闭馆规则' });
  }

  const hoursCheck = js.find(j => j.type === 'hours_fit');
  const hourFacts = facts.filter(f => hoursCheck?.factIds.includes(f.id) && usable(f) && period(f, date));
  const windows = [...new Set(hourFacts.map(f => { const p = period(f, date)!; return span(p.open, p.close); }))];
  const hoursVerified = hoursCheck?.verdict === 'confirmed' || hoursCheck?.verdict === 'conflict' || hoursCheck?.ruleStatus === 'verified';
  const hours = windows.length === 1 ? (() => { const p = period(hourFacts[0], date)!; return `${p.open}—${p.close}`; })() : null;
  const allDay = windows.length === 1 && windows[0] === '全天开放';
  const season = hourFacts[0] && period(hourFacts[0], date);
  const range = season && 'from' in season && 'to' in season && season.from.length === 5 && !(season.from === '01-01' && season.to === '12-31') ? `${md(season.from)}—${md(season.to)}适用` : '';
  const closedToday = openCheck?.verdict === 'conflict';
  if (hours) {
    const basis = hoursVerified ? basisOf(hourFacts) : 'reference';
    rules.push({ label: '营业时间', value: allDay ? '全天开放' : hours, verified: hoursVerified, basis, note: range || (hoursVerified ? undefined : '只查到个别来源，待核实') });
    usedFacts.push(...hourFacts);
  } else if (place) {
    const other = closedToday ? venueFacts.find(f => f.kind === 'hours' && f.payload.weekdays && !f.payload.weekdays.includes(weekday(date)) && f.payload.seasons.some(s => inSeason(date, s.from, s.to))) : undefined;
    const otherPeriod = other?.kind === 'hours' ? other.payload.seasons.find(s => inSeason(date, s.from, s.to)) : undefined;
    if (other?.kind === 'hours' && otherPeriod) {
      rules.push({ label: '营业时间', value: '当天不开放', verified: true, tone: 'bad', note: `${other.payload.weekdays!.map(d => weekdayNames[d]).join('、').replace(/^周二、周三、周四、周五、周六、周日$/, '周二至周日')} ${span(otherPeriod.open, otherPeriod.close)}` });
      usedFacts.push(other);
    } else if (windows.length > 1) rules.push({ label: '营业时间', value: windows.slice(0, 3).join(' / '), verified: false, tone: 'muted', note: '来源说法不一致，以景区当天公告为准' });
    else rules.push({ label: '营业时间', value: '未查到', verified: false, tone: 'muted', note: '出发前向场馆确认' });
  }
  if (!allDay && !closedToday && hours && ['museum', 'scenic', 'show'].includes(item.kind)) {
    const entries = hourFacts.filter(f => period(f, date)?.lastEntry);
    if (entries.length) {
      const values = [...new Set(entries.map(f => period(f, date)!.lastEntry!))];
      const backed = values.length === 1 && hoursVerified && (Math.min(...entries.map(f => f.tier)) <= 2 || independent(entries) >= 2);
      rules.push({ label: '停止入场', value: values.length === 1 ? values[0] : values.join(' / '), verified: backed, basis: backed ? basisOf(entries) : 'reference', note: backed ? undefined : values.length > 1 ? '来源说法不一致' : '只查到个别来源，待核实' });
    } else {
      // A supplemental platform source may add a useful reference, but it must
      // remain visibly separate from a verified official opening rule.
      const references = venueFacts.filter(f => f.linkStatus === 'ok' && period(f, date)?.lastEntry && `${period(f, date)!.open}—${period(f, date)!.close}` === hours)
        .sort((a,b) => {
          const sameSite = a.domain.replace(/^(?:www\.|m\.)/, '') === b.domain.replace(/^(?:www\.|m\.)/, '');
          const canonical = sameSite ? Number(a.domain.startsWith('m.')) - Number(b.domain.startsWith('m.')) : 0;
          return a.tier-b.tier || canonical || (b.publishedAt || '').localeCompare(a.publishedAt || '');
        });
      const values = [...new Set(references.map(f => period(f, date)!.lastEntry!))];
      if (values.length === 1) {
        rules.push({ label: '停止入场', value: values[0], verified: false, basis: 'reference', note: '补充来源参考，待官方确认' });
        usedFacts.push(references[0]);
      } else rules.push({ label: '停止入场', value: values.length > 1 ? '来源说法不一致' : '未写明', verified: false, tone: 'muted', note: values.length > 1 ? undefined : '一般需在闭园前预留时间' });
    }
  }

  const booking = js.find(j => j.type === 'reservation_rule');
  const ticketClaim = item.claimedRules.find(c => c.kind === 'other' && /门票|免费|元|r\b/i.test(c.text))?.text.replace(/^门票[:：]\s*/, '').replace(/(\d+)\s*r\b/i, '$1元');
  if (booking?.verdict === 'confirmed') {
    const bookingFacts = facts.filter(f => booking.factIds.includes(f.id) && f.kind === 'reservation');
    const f = bookingFacts[0];
    if (f?.kind === 'reservation') {
      rules.push({ label: '预约 / 购票', value: f.payload.required ? '需提前预约' : '无需预约', verified: true, basis: basisOf(bookingFacts), tone: f.payload.required ? undefined : 'good', note: f.payload.channel || (ticketClaim ? `攻略：门票${ticketClaim}` : undefined) });
      usedFacts.push(f);
    }
  } else if (['museum', 'scenic', 'show'].includes(item.kind)) {
    const reservations = venueFacts.filter((f): f is Fact & { kind: 'reservation' } => f.kind === 'reservation');
    const required = [...new Set(reservations.map(f => f.payload.required))];
    if (required.length === 1) rules.push({ label: '预约 / 购票', value: required[0] ? '可能需预约' : '可能无需预约', verified: false, basis: 'reference', note: `只查到个别来源${ticketClaim ? `；攻略：门票${ticketClaim}` : ''}` });
    else if (required.length > 1) rules.push({ label: '预约 / 购票', value: '说法不一致', verified: false, tone: 'muted', note: '部分来源要求预约，出发前确认' });
    else rules.push({ label: '预约 / 购票', value: ticketClaim && /免费/.test(ticketClaim) ? '攻略称免费' : '未查到', verified: false, tone: 'muted', note: ticketClaim && !/免费/.test(ticketClaim) ? `攻略：门票${ticketClaim}` : '未查到预约要求' });
  }
  const service = js.find(j => j.type === 'service_hours');
  const serviceFact = facts.find(f => service?.factIds.includes(f.id) && f.kind === 'service_hours');
  if (serviceFact?.kind === 'service_hours') {
    rules.push({ label: '运营时间', value: `${serviceFact.payload.first || '首班待核实'}—${serviceFact.payload.last}${serviceFact.payload.lastDayOffset ? '（次日）' : ''}`, verified: service?.verdict !== 'unknown', basis: service?.verdict !== 'unknown' ? basisOf([serviceFact]) : 'reference', note: service?.reasonCode === 'SOURCES_DISAGREE' ? '来源说法不一致' : undefined });
    usedFacts.push(serviceFact);
  } else if (item.kind === 'transport') rules.push({ label: '运营时间', value: '未查到', verified: false, tone: 'muted', note: '以承运方、12306 或地图实时信息为准' });

  const updates = js.filter(j => j.type === 'guide_claim' && j.verdict === 'conflict');
  const staleClaims = updates.length ? [...new Set(item.claimedRules.filter(c => c.kind === 'hours').flatMap(c => {
    if (/全天|24\s*小时/.test(c.text)) return allDay ? [] : ['全天开放'];
    const times = [...c.text.matchAll(/(\d{1,2})[:：](\d{2})/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
    return times.length === 2 && !/旺季|淡季|夏季|冬季|节假日/.test(c.text) && hours && `${times[0]}—${times[1]}` !== hours ? [`${times[0]}—${times[1]}`] : [];
  }))] : [];
  const conflicts = js.filter(isPlanConflict);
  const missingTime = !item.start;
  const core = js.filter(j => ['open_on_date', 'hours_fit', 'service_hours', 'arrival_fit'].includes(j.type));
  const fits = core.length > 0 && core.every(j => j.verdict === 'confirmed');
  const state: PlanState = !js.length ? 'pending' : conflicts.length ? 'adjust' : fits ? 'fits' : missingTime && (hoursVerified || serviceFact) ? 'needs_time' : 'verify';
  const entry = rules.find(r => r.label === '停止入场' && /^\d/.test(r.value))?.value;
  const message = conflicts[0]?.explanation ?? (
    state === 'fits' ? (allDay ? '全天开放，当天任何时间都可以去。' : '当天开放，你填的时段在开放时间内。') :
    state === 'needs_time' && serviceFact?.kind === 'service_hours' && !hoursVerified ? `查到${serviceFact.payload.first ? `首班 ${serviceFact.payload.first}、` : ''}末班 ${serviceFact.payload.last}${serviceFact.payload.lastDayOffset ? '（次日）' : ''}；补上乘车时间就能核对赶不赶得上。` :
    state === 'needs_time' ? (openCheck?.verdict === 'confirmed' ? `当天开放${hours ? `，${span(...hours.split('—') as [string, string])}` : ''}${entry ? `，${entry} 前入场` : ''}。补上到达时间就能核对来不来得及。` : `营业时间已查到${hours ? `（${hours}）` : ''}，但当天是否开放还没确认。`) :
    state === 'pending' ? '还没有生成核验结果。' :
    openCheck?.reasonCode === 'OPEN_ENDED_CLOSURE' ? '查到临时关闭的报道，没说何时恢复，出发前务必确认。' :
    windows.length > 1 ? '各来源给出的开放时间不一致，出发前以景区当天公告为准。' :
    item.kind === 'transport' ? '没查到可靠的班次时间，出发前用 12306、承运方或地图确认。' :
    hours ? '只查到个别网页的说法，出发前再向场馆确认。' : '没查到可靠的开放信息，出发前向场馆确认。');
  const citations = [...new Map(usedFacts.flatMap(f => {
    const e = evidence.find(e => e.id === f.evidenceId);
    return e ? [[e.url, { evidence: e, quote: f.quote }] as const] : [];
  })).values()].sort((a, b) => a.evidence.tier - b.evidence.tier);
  return { state, message, rules, updates, conflicts, citations, hours, allDay, missingTime, staleClaims };
}

export function itineraryInsights(trip: TripInput, judgments: Judgment[], dossiers: Dossier[]) {
  const items = trip.items.map(item => ({ item, insight: itemInsight(item, judgments, dossiers, dateForDay(trip.startDate, item.day)) }));
  const counts = { adjust: 0, fits: 0, needs_time: 0, verify: 0, pending: 0 };
  for (const { insight } of items) counts[insight.state]++;
  return { items, counts, missingTimes: trip.items.filter(i => !i.start).length, updates: items.filter(i => i.insight.updates.length).length };
}

/** Weather for one trip day: the forecast judgment and any storm headlines found while searching. */
export function dayWeather(judgments: Judgment[], dossiers: Dossier[], date: string) {
  const forecast = judgments.find(j => j.type === 'weather' && j.date === date && j.verdict !== 'unknown') ?? judgments.find(j => j.type === 'weather' && j.date === date && j.reasonCode === 'WEATHER_RISK') ?? judgments.find(j => j.type === 'weather' && j.date === date);
  const pages = dossiers.filter(d => d.venue.key.startsWith('weather:') && d.venue.key.endsWith(date)).flatMap(d => d.evidence);
  const alerts = [...new Map(pages.filter(e => e.linkStatus !== 'broken' && /台风|暴雨|大暴雨|预警|大风|强降雨|雷暴/.test(e.title)).map(e => [e.title, e])).values()].slice(0, 2);
  const risk = forecast?.reasonCode === 'WEATHER_RISK' || alerts.length > 0;
  return { forecast, alerts, risk };
}

export function alternativeInsight(trip: TripInput, alternative: Alternative) {
  const original = trip.items.find(i => i.id === alternative.itemId);
  if (!original) return null;
  const item: Item = { ...original, id: alternative.judgments[0]?.itemId || alternative.itemId, placeName: alternative.name, claimedRules: [], dependsOn: [] };
  return { item, insight: itemInsight(item, alternative.judgments, [alternative.dossier], dateForDay(trip.startDate, item.day)) };
}
