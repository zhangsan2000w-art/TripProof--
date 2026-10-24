import type { Alternative, Dossier, Evidence, Fact, Item, Judgment, Suggestion, TripInput } from './domain';
import { dateForDay, inSeason, weekday, weekdayLabel } from './dates';
import { dayAdvisories, scopeName, type Advisory } from './risk';
import { unresolvedTarget, flexibleTransfer, openArea, planTimeLabel } from './itinerary';

export type PlanState = 'adjust' | 'fits' | 'partial' | 'reference' | 'alert' | 'needs_time' | 'verify' | 'pending';
export const planLabels: Record<PlanState, string> = { adjust: '需调整', fits: '时段符合', partial: '部分已核实', reference: '出行参考', alert:'留意预警', needs_time: '待补时间', verify: '待核实', pending: '尚未核验' };
export const planHints: Record<PlanState, string> = {
  adjust: '有依据的闭馆、区域关闭公告、预警期间不宜前往，或超出入场时段、抵离冲突。',
  fits: '当天开放、没有生效的预警或关闭公告，已填时段或全天开放符合已核实的规则；不代表已预约或一定有票。',
  needs_time: '营业规则已查到，补上你的到达时间才能判断来不来得及。',
  verify: '关键规则缺少可靠依据、来源说法不一致或无法访问。',
  pending: '还没有生成核验结果。',
  partial: '已经核实一部分关键规则，其余缺口在该站说明中列出。',
  reference: '步行或打车无需核对首末班；实际路况、候车和耗时以当天为准。',
  alert: '已有来源支持天气预警或应急响应；与营业时间是否查到分开展示，不代表已经公告关闭。',
};
export const isPlanConflict = (j: Judgment) => j.verdict === 'conflict' && j.type !== 'guide_claim' && j.type !== 'weather';
/** How strong the sources behind a rule are, in the words shown to visitors. */
export type Basis = 'official' | 'authority' | 'consensus' | 'reference';
export const tierLabels = ['', '官方来源', '权威来源', '平台参考', '普通网页'];
export const basisLabels: Record<Basis, string> = { official: '官方', authority: '权威来源', consensus: '多源一致', reference: '单一来源' };
export type RuleHighlight = { label: string; value: string; note?: string; verified: boolean; basis?: Basis; tone?: 'good' | 'bad' | 'warn' | 'muted' };
export const safetyLabels: Record<string, string> = { AREA_CLOSED: '已公告关闭', SERVICE_SUSPENDED: '已公告停运', HAZARD_EXPOSED: '不建议前往', HAZARD_ALERT: '预警期间', SERVICE_ALERT: '以停运公告为准', CLOSURE_REPORTED: '有关闭消息待证实', CONTEXT_PENDING:'公告仍在检查', CONTEXT_FAILED:'公告检查未完成' };
export type ItemInsight = {
  state: PlanState; message: string; rules: RuleHighlight[]; updates: Judgment[];
  conflicts: Judgment[]; citations: { evidence: Evidence; quote: string }[];
  hours: string | null; allDay: boolean; missingTime: boolean;
  plannedTime: string;
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
const modeLabels: Record<string, string> = { walk: '步行', taxi: '打车', drive: '自驾', bike: '骑行' };

/** Describe source facts separately from the fit of the user's schedule. */
export function itemInsight(item: Item, judgments: Judgment[], dossiers: Dossier[], date: string, items: Item[] = []): ItemInsight {
  const js = judgments.filter(j => j.itemId === item.id);
  const facts = dossiers.flatMap(d => d.facts);
  const venueFacts = dossiers.filter(d => js.some(j => j.venueId === d.venue.id)).flatMap(d => d.facts).filter(usable);
  const evidence = dossiers.flatMap(d => d.evidence);
  const unresolved = unresolvedTarget(item);
  const flexible = flexibleTransfer(item), area = openArea(item);
  const ruleBasis = basisOf;
  const place = !unresolved && item.kind !== 'transport' && item.kind !== 'hotel';
  const rules: RuleHighlight[] = [];
  const usedFacts: Fact[] = [];
  if (unresolved) rules.push({ label: '安排', value: item.kind === 'transport' ? '路线待选定' : '商家待选定', verified: false, note: unresolved.message });

  const safety = js.find(j => j.type === 'safety');
  const safetyFacts = safety ? facts.filter(f => safety.factIds.includes(f.id)) : [];
  if (safety) {
    rules.push({ label: '预警 / 公告', value: safetyLabels[safety.reasonCode] ?? '有预警', verified: safety.verdict === 'conflict', basis: basisOf(safetyFacts), tone: safety.verdict === 'conflict' ? 'bad' : 'warn',
      note: safetyFacts.find(f => f.kind === 'advisory') ? noticeName(safetyFacts.find(f => f.kind === 'advisory') as Advisory) : undefined });
    usedFacts.push(...safetyFacts);
  }
  const openCheck = js.find(j => j.type === 'open_on_date');
  if (openCheck && place) {
    const basis = ruleBasis(facts.filter(f => openCheck.factIds.includes(f.id)));
    if (openCheck.verdict === 'conflict') rules.push({ label: '当天', value: ['TEMP_CLOSED', 'CLOSED_UNTIL_NOTICE'].includes(openCheck.reasonCode) ? '临时关闭' : `${weekdayLabel(date)}闭馆`, verified: true, basis, tone: 'bad', note: openCheck.reasonCode === 'CLOSED_UNTIL_NOTICE' ? '未见恢复开放通知' : undefined });
    // An announced closure is already shown in its own tile; the day tile would only repeat it.
    else if (safety?.verdict === 'conflict') { /* see the notice tile */ }
    else if (openCheck.reasonCode === 'PUBLIC_AREA') rules.push({ label: '当天', value: '不闭园', verified: true, tone: 'good', note: '公共区域' });
    else if (openCheck.verdict === 'confirmed') rules.push({ label: '当天', value: '正常开放', verified: true, basis, tone: 'good', note: `${md(date.slice(5))} ${weekdayLabel(date)}` });
    else rules.push({ label: '当天', value: openCheck.reasonCode === 'OPEN_ENDED_CLOSURE' ? '恢复时间待确认' : '未确认', verified: false, tone: openCheck.reasonCode === 'OPEN_ENDED_CLOSURE' ? 'bad' : 'muted',
      note: openCheck.reasonCode === 'OPEN_ENDED_CLOSURE' ? '查到临时关闭报道' : openCheck.reasonCode === 'SOURCES_DISAGREE' ? '来源说法不一致' : '缺少适用的开放依据' });
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
    const basis = hoursVerified ? ruleBasis(hourFacts) : 'reference';
    rules.push({ label: '营业时间', value: allDay ? '全天开放' : hours, verified: hoursVerified, basis, note: range || (hoursVerified ? undefined : '只查到个别来源，待核实') });
    usedFacts.push(...hourFacts);
  } else if (hoursCheck?.reasonCode === 'PUBLIC_AREA') {
    rules.push({ label: '开放时间', value: '随时可去', verified: true, tone: 'good', note: '公共区域；店铺和其中的场馆按各自时间' });
  } else if (place) {
    const other = closedToday ? venueFacts.find(f => f.kind === 'hours' && f.payload.weekdays && !f.payload.weekdays.includes(weekday(date)) && f.payload.seasons.some(s => inSeason(date, s.from, s.to))) : undefined;
    const otherPeriod = other?.kind === 'hours' ? other.payload.seasons.find(s => inSeason(date, s.from, s.to)) : undefined;
    if (other?.kind === 'hours' && otherPeriod) {
      rules.push({ label: '营业时间', value: '当天不开放', verified: true, tone: 'bad', note: `${other.payload.weekdays!.map(d => weekdayNames[d]).join('、').replace(/^周二、周三、周四、周五、周六、周日$/, '周二至周日')} ${span(otherPeriod.open, otherPeriod.close)}` });
      usedFacts.push(other);
    } else if (windows.length > 1) {
      rules.push({ label: '营业时间', value: windows.slice(0, 3).join(' / '), verified: false, tone: 'muted', note: hoursCheck?.reasonCode==='HOURS_FIT_COMMON'?'各来源均覆盖你填的时段；具体开闭时间仍保留各自说法':'来源说法不一致，以当天公告为准' });
      if(hoursCheck?.reasonCode==='HOURS_FIT_COMMON')rules.push({label:'已核对时段',value:`${item.start}${item.end?`—${item.end}`:''}`,verified:true,basis:ruleBasis(hourFacts)});
      usedFacts.push(...hourFacts);
    }
    else rules.push({ label: '营业时间', value: '未查到', verified: false, tone: 'muted', note: '出发前向场馆确认' });
  }
  if (!area && !allDay && !closedToday && hours && ['museum', 'scenic', 'show'].includes(item.kind)) {
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
  const ticket = item.profile?.ticket ?? null, ticketClaim = ticket?.text ?? null;
  if (booking?.verdict === 'confirmed') {
    const bookingFacts = facts.filter(f => booking.factIds.includes(f.id) && f.kind === 'reservation');
    const f = bookingFacts[0];
    if (f?.kind === 'reservation') {
      rules.push({ label: '预约 / 购票', value: f.payload.required ? '需提前预约' : '无需预约', verified: true, basis: basisOf(bookingFacts), tone: f.payload.required ? undefined : 'good', note: f.payload.channel || (ticketClaim ? `攻略：门票${ticketClaim}` : undefined) });
      usedFacts.push(f);
    }
  } else if (['museum', 'scenic', 'show'].includes(item.kind) && (!area || booking || item.claimedRules.some(c=>c.kind==='reservation'))) {
    const reservations = venueFacts.filter((f): f is Fact & { kind: 'reservation' } => f.kind === 'reservation');
    const required = [...new Set(reservations.map(f => f.payload.required))];
    if (required.length === 1) rules.push({ label: '预约 / 购票', value: required[0] ? '可能需预约' : '可能无需预约', verified: false, basis: 'reference', note: `只查到个别来源${ticketClaim ? `；攻略：门票${ticketClaim}` : ''}` });
    else if (required.length > 1) rules.push({ label: '预约 / 购票', value: '说法不一致', verified: false, tone: 'muted', note: '部分来源要求预约，出发前确认' });
    else rules.push({ label: '预约 / 购票', value: ticket?.free ? '攻略称免费' : '未查到', verified: false, tone: 'muted', note: ticketClaim && !ticket?.free ? `攻略：门票${ticketClaim}` : '未查到预约要求' });
  }
  const service = js.find(j => j.type === 'service_hours');
  const serviceFact = facts.find(f => service?.factIds.includes(f.id) && f.kind === 'service_hours');
  if (serviceFact?.kind === 'service_hours') {
    rules.push({ label: '运营时间', value: `${serviceFact.payload.first || '首班待核实'}—${serviceFact.payload.last}${serviceFact.payload.lastDayOffset ? '（次日）' : ''}`, verified: service?.verdict !== 'unknown', basis: service?.verdict !== 'unknown' ? basisOf([serviceFact]) : 'reference', note: service?.reasonCode === 'SOURCES_DISAGREE' ? '来源说法不一致' : undefined });
    usedFacts.push(serviceFact);
  } else if (flexible) rules.push({ label: '出行方式', value: modeLabels[item.profile?.mode ?? 'walk'] ?? '自行出发', verified: false, tone: 'muted', note: '无需核对首末班；路况与候车以当天为准' });
  else if (item.kind === 'transport' && !unresolved) rules.push({ label: '运营时间', value: '未查到', verified: false, tone: 'muted', note: '以该线路运营方当天信息为准' });

  const updates = js.filter(j => j.type === 'guide_claim' && j.verdict === 'conflict');
  const staleClaims = updates.length ? [...new Set(item.claimedRules.filter(c => c.kind === 'hours').flatMap(c => {
    if (/全天|24\s*小时/.test(c.text)) return allDay ? [] : ['全天开放'];
    const times = [...c.text.matchAll(/(\d{1,2})[:：](\d{2})/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
    return times.length === 2 && !/旺季|淡季|夏季|冬季|节假日/.test(c.text) && hours && `${times[0]}—${times[1]}` !== hours ? [`${times[0]}—${times[1]}`] : [];
  }))] : [];
  // Safety comes first: an announced closure or warning outranks every opening rule.
  const conflicts = js.filter(isPlanConflict).sort((a, b) => Number(b.type === 'safety') - Number(a.type === 'safety'));
  const alert = safety?.verdict === 'unknown' ? safety : null;
  const missingTime = js.some(j=>j.reasonCode==='MISSING_TIME');
  const core = js.filter(j => ['open_on_date', 'hours_fit', 'service_hours', 'arrival_fit'].includes(j.type));
  const fits = core.length > 0 && core.every(j => j.verdict === 'confirmed');
  const hasVerified = core.some(j=>j.verdict==='confirmed'&&j.factIds.length>0);
  const state: PlanState = !js.length ? 'pending' : conflicts.length ? 'adjust' : alert ? alert.factIds.length?'alert':['CONTEXT_PENDING','CONTEXT_FAILED'].includes(alert.reasonCode)&&hasVerified?'partial':'verify' : flexible ? 'reference' : fits ? 'fits' : missingTime && (hoursVerified || serviceFact) ? 'needs_time' : hasVerified ? 'partial' : 'verify';
  const entry = rules.find(r => r.label === '停止入场' && /^\d/.test(r.value))?.value;
  // Under a warning the usual hours are context only, never the reason a stop is fine.
  const usual = hoursVerified && allDay ? '平时全天开放。' : hoursVerified && hours ? `平时 ${span(...hours.split('—') as [string, string])} 开放。` : '';
  // Older reports stored a technical closure sentence; say it the same way for every report.
  const closedText: Record<string, string> = { CLOSED_WEEKLY: '是每周闭馆日', CLOSED_AFTER_HOLIDAY: '是节假日后的顺延闭馆日', TEMP_CLOSED: '有临时闭馆公告' };
  const first = conflicts[0];
  const message = (first && first.type === 'open_on_date' && closedText[first.reasonCode] ? `${md(date.slice(5))}（${weekdayLabel(date)}）${closedText[first.reasonCode]}，这天去会扑空。` : first?.explanation) ?? (alert ? `${alert.explanation}${usual}` : null) ?? (
    unresolved ? unresolved.message :
    state === 'fits' ? (item.kind==='transport'?service?.explanation:openCheck?.reasonCode==='PUBLIC_AREA'?'公共区域，随时可以去；其中的场馆和店铺按各自时间。':item.kind==='restaurant'?`${item.start}${item.end?`—${item.end}`:''} 在查到的营业时段内；临时休息与座位情况出发前向商家确认。`:allDay ? '全天开放，任何时间都可以去。' : item.start ? '当天开放，你填的时段在开放时间内。' : '当天开放。') :
    state === 'reference' ? '按游览进度步行或打车，无需核对首末班；候车、路况和实际耗时以当天导航或现场为准。' :
    state === 'partial' ? `${hoursCheck?.verdict==='confirmed'?`计划时段符合 ${hours||'已查到的营业窗口'}`:openCheck?.verdict==='confirmed'?'当天常规开放规则已核实':'已核实部分规则'}；${openCheck?.verdict==='unknown'?'当天是否开放仍缺少依据':hoursCheck?.verdict==='unknown'?'营业时段仍需确认':'还有必要检查未完成'}。` :
    state === 'needs_time' && serviceFact?.kind === 'service_hours' && !hoursVerified ? `查到${serviceFact.payload.first ? `首班 ${serviceFact.payload.first}、` : ''}末班 ${serviceFact.payload.last}${serviceFact.payload.lastDayOffset ? '（次日）' : ''}；补上乘车时间就能核对赶不赶得上。` :
    state === 'needs_time' ? (openCheck?.verdict === 'confirmed' ? `当天开放${hours ? `，${span(...hours.split('—') as [string, string])}` : ''}${entry ? `，${entry} 前入场` : ''}。补上到达时间就能核对来不来得及。` : `营业时间已查到${hours ? `（${hours}）` : ''}，但当天是否开放还没确认。`) :
    state === 'pending' ? '还没有生成核验结果。' :
    openCheck?.reasonCode === 'OPEN_ENDED_CLOSURE' ? '查到临时关闭的报道，没说何时恢复，出发前务必确认。' :
    windows.length > 1 ? '各来源给出的开放时间不一致，出发前以景区当天公告为准。' :
    item.kind === 'transport' ? service?.explanation||'没查到这条线路可靠的运营时间，请向运营方确认。' :
    area ? '街区公共区域的开放依据还不完整；只核对漫步范围，不要求补售票或预约时间。' :
    hours ? '只查到个别网页的说法，出发前再向场馆确认。' : '没查到可靠的开放信息，出发前向场馆确认。');
  const citations = [...new Map(usedFacts.flatMap(f => {
    const e = evidence.find(e => e.id === f.evidenceId);
    return e ? [[e.url, { evidence: e, quote: f.quote }] as const] : [];
  })).values()].sort((a, b) => a.evidence.tier - b.evidence.tier);
  return { state, message: message||'已有结果见下方规则。', rules, updates, conflicts, citations, hours, allDay, missingTime, plannedTime:planTimeLabel(item,items), staleClaims };
}

export function itineraryInsights(trip: TripInput, judgments: Judgment[], dossiers: Dossier[]) {
  const items = trip.items.map(item => ({ item, insight: itemInsight(item, judgments, dossiers, dateForDay(trip.startDate, item.day), trip.items) }));
  const counts = { adjust: 0, fits: 0, partial: 0, reference: 0, alert:0, needs_time: 0, verify: 0, pending: 0 };
  for (const { insight } of items) counts[insight.state]++;
  return { items, counts, missingTimes: items.filter(i => i.insight.missingTime).length, updates: items.filter(i => i.insight.updates.length).length };
}

/** A notice in a few words, e.g. 台风黄色预警, 防台风Ⅲ级应急响应, 区域景区关闭. */
export function noticeName(a: Advisory) {
  const p = a.payload, level = p.level?.replace(/(?:预警|信号)$/, '') ?? '';
  if (p.type === 'warning') return `${p.hazard}${level}预警`;
  if (p.type === 'response') return `${p.hazard === '其他' ? '' : `防${p.hazard}`}${level}应急响应`;
  const scope = scopeName(a);
  if (p.type === 'closure') return `${scope}关闭`;
  if (p.type === 'suspension') return `${scope}${/航|船|渡/.test(scope) ? '停航' : '停运'}`;
  return `${scope}恢复开放`;
}
/** Weather for one trip day: the forecast, plus the warnings and area notices in force. */
export function dayWeather(judgments: Judgment[], dossiers: Dossier[], date: string) {
  const forecast = judgments.find(j => j.type === 'weather' && j.date === date && j.verdict !== 'unknown') ?? judgments.find(j => j.type === 'weather' && j.date === date && j.reasonCode === 'WEATHER_RISK') ?? judgments.find(j => j.type === 'weather' && j.date === date);
  const safety = judgments.filter(j => j.type === 'safety' && j.date === date);
  // The notice that rules out the most stops comes first.
  const reach = (id: string) => safety.reduce((n, j) => n + (j.factIds.includes(id) ? (j.verdict === 'conflict' ? 10 : 1) : 0), 0);
  const advisories = dayAdvisories(dossiers, date).map((a, n) => ({ a, n })).sort((x, y) => reach(y.a.id) - reach(x.a.id) || x.n - y.n).map(x => x.a);
  const evidence = dossiers.flatMap(d => d.evidence);
  const notices = advisories.map(a => ({ advisory: a, name: noticeName(a), evidence: evidence.find(e => e.id === a.evidenceId) ?? null }));
  const checked = dossiers.some(d => d.venue.key.startsWith('risk:') && d.venue.investigationDates.includes(date) && d.searchedScope.length > 0 && d.contextStatus!=='pending' && d.contextStatus!=='failed');
  const risk = forecast?.reasonCode === 'WEATHER_RISK' || notices.length > 0;
  return { forecast, notices, checked, risk, blocked: safety.filter(j => j.verdict === 'conflict').length, alerted: safety.filter(j => j.verdict === 'unknown'&&j.factIds.length>0).length };
}

export function alternativeInsight(trip: TripInput, alternative: Alternative) {
  const original = trip.items.find(i => i.id === alternative.itemId);
  if (!original) return null;
  const item: Item = { ...original, id: alternative.judgments[0]?.itemId || alternative.itemId, placeName: alternative.name, claimedRules: [], dependsOn: [] };
  return { item, insight: itemInsight(item, alternative.judgments, [alternative.dossier], dateForDay(trip.startDate, item.day)) };
}

const shortDate = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
export type TripVerdict = { tone: 'bad' | 'warn' | 'info' | 'good'; headline: string; detail: string };
/** When every needed change comes from warnings or closures, dropping stops one by one is not advice; moving the day is. */
export function safetyDriven(insights: ReturnType<typeof itineraryInsights>) {
  const adjust = insights.items.filter(i => i.insight.state === 'adjust');
  return adjust.length > 0 && adjust.every(i => i.insight.conflicts[0]?.type === 'safety');
}
export function usefulSuggestions(suggestions: Suggestion[], insights: ReturnType<typeof itineraryInsights>) {
  return safetyDriven(insights) ? suggestions.filter(s => s.ops.some(op => op.type === 'swap')) : suggestions;
}
/** One sentence for the whole trip. Safety comes first, then closures, then what is still unverified. */
export function tripVerdict(trip: TripInput, judgments: Judgment[], dossiers: Dossier[], insights = itineraryInsights(trip, judgments, dossiers)): TripVerdict {
  const { counts, items } = insights;
  const days = [...new Set(trip.items.map(i => i.day))].sort((a, b) => a - b);
  const risk = days.map(day => { const date = dateForDay(trip.startDate, day); return { day, date, ...dayWeather(judgments, dossiers, date) }; });
  const blockedDays = risk.filter(r => r.blocked);
  if (blockedDays.length) {
    const first = blockedDays[0], lead = first.notices[0]?.name;
    const places = items.filter(i => i.item.day === first.day && i.item.kind !== 'transport');
    const allOff = blockedDays.length === 1 && places.length > 0 && places.every(i => i.insight.state === 'adjust');
    const blocked = blockedDays.reduce((n, r) => n + r.blocked, 0);
    return { tone: 'bad', headline: `${blockedDays.map(r => shortDate(r.date)).join('、')}${lead ? `${lead}` : '有预警'}，${allOff ? '这天的景点都去不了' : `${blocked} 个地点不建议去`}`,
      detail: `${allOff ? '建议改期，或换成不受影响的室内安排。' : '把受影响的地点换到别的日子，或换成室内安排。'}${blockedDays.some(r => r.alerted) ? '交通以当天停运公告为准。' : ''}官方公告优先于平台上的营业时间。` };
  }
  if (counts.adjust) {
    const adjust = items.filter(i => i.insight.state === 'adjust'), names = [...new Set(adjust.map(i => i.item.placeName))];
    const weekly = adjust.every(i => i.insight.conflicts[0]?.reasonCode === 'CLOSED_WEEKLY');
    return { tone: 'bad', headline: `有 ${counts.adjust} 处安排需要调整`, detail: `${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等' : ''}${weekly ? '在你去的那天闭馆，去了会扑空。' : '的问题和改法见下方。'}` };
  }
  const alertDays = risk.filter(r => r.alerted);
  if (alertDays.length) return { tone: 'warn', headline: `${alertDays.map(r => shortDate(r.date)).join('、')}${alertDays[0].notices[0] ? `有${alertDays[0].notices[0].name}` : '有预警'}，${alertDays.reduce((n, r) => n + r.alerted, 0)} 处出发前再确认`, detail: '预警期间景区可能临时关闭、交通可能停运，出发当天再看一次官方公告。' };
  if (counts.verify) return { tone: 'info', headline: `${counts.verify} 处关键信息仍需确认`, detail: `${counts.fits?`${counts.fits} 处时段已核实。`:''}${counts.partial?`${counts.partial} 处已核实部分规则，缺口见各站说明。`:''}${counts.reference?`${counts.reference} 段步行或打车按当天情况安排。`:''}待核实表示缺少依据，不代表已发现冲突。` };
  if (counts.partial) return { tone: 'info', headline: `${counts.partial} 处已核实部分规则，尚有信息缺口`, detail: '已查到的规则与仍需确认的部分分别列在各站；缺少依据不表示安排有冲突。' };
  if (counts.needs_time) return { tone: 'info', headline: '规则都查到了，补上到达时间再核对一遍', detail: '营业时间和停止入场已核实；填上计划到达时间，就能判断来不来得及。' };
  return { tone: 'good', headline: '已填时段与查到的常规规则相符', detail: '打车、排队及实时营业以当天为准；需购票的地点仍须自行确认票务。' };
}
