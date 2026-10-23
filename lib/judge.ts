import type { Dossier, Fact, Item, Judgment, CheckType, TripInput, Verdict } from './domain';
import { dateForDay, holidayState, inSeason, minutes, now, weekday, weekdayLabel, addDays, today, daysUntil } from './dates';
import { registrableDomain } from './evidence';
import { createHash } from 'node:crypto';
import { factSupported } from './facts';
import { judgeSafety, riskKey } from './risk';
import { unresolvedTarget, openArea, flexibleTransfer } from './itinerary';
function seasonLength(from: string, to: string) {
  const start = Date.parse(`2000-${from}`), end = Date.parse(`2000-${to}`);
  return ((end - start) / 86400000 + 366) % 366 + 1;
}

const dailyRule = /每日|每天|天天|全年无休|年中無休|全年开放(?!时间|時間)|全天开放|全天候|24\s*小[时時]|无闭馆日|不闭馆|周一至周日|周一到周日/;
// "全年开放时间 9:00-17:00（周一闭馆）" names a closing day, so it is not an every-day rule.
const daily = (quote: string) => dailyRule.test(quote) && !/闭馆|閉館|休馆|闭园|不开放|停止开放/.test(quote.replace(/无闭馆日|不闭馆/g, ''));
type Resolution = { picked: Fact[]; overruled: Fact[]; error: 'NO_EVIDENCE' | 'WEAK_EVIDENCE' | 'SOURCES_DISAGREE' | 'LINK_REQUIRES_BROWSER' | null };
function fingerprint(fact: Fact, date: string): string {
  if (fact.kind === 'temp_closure' || fact.kind === 'weekly_closure') return 'closed';
  if (fact.kind === 'temp_open' || fact.kind === 'weekly_open') return 'open';
  if (fact.kind === 'hours') { const s = fact.payload.seasons.find(s => inSeason(date, s.from, s.to)); return JSON.stringify(s && { open: s.open, close: s.close, lastEntry: s.lastEntry }); }
  if (fact.kind === 'temp_hours') return JSON.stringify({ open: fact.payload.open, close: fact.payload.close, lastEntry: fact.payload.lastEntry });
  if (fact.kind === 'reservation') return JSON.stringify({ required: fact.payload.required });
  return JSON.stringify(fact.payload);
}
/** Same reading of a rule, ignoring details (such as last entry) that some sources omit. */
function reading(fact: Fact, date: string): string {
  if (fact.kind === 'hours') { const s = fact.payload.seasons.find(s => inSeason(date, s.from, s.to)); return JSON.stringify(s && { open: s.open, close: s.close }); }
  if (fact.kind === 'temp_hours') return JSON.stringify({ open: fact.payload.open, close: fact.payload.close });
  return fingerprint(fact, date);
}
export function resolveFacts(pool: Fact[], date: string, dossier: Dossier): Resolution {
  const all = pool.filter(f => f.quoteVerified && f.venueMatch === 'exact' && f.linkStatus !== 'broken');
  if (!all.length) return { picked: [], overruled: [], error: 'NO_EVIDENCE' };
  const reachable = all.filter(f => f.linkStatus === 'ok').filter(f => {
    if (f.kind !== 'hours') return true;
    const period = f.payload.seasons.find(s => inSeason(date,s.from,s.to));
    if (!period) return false;
    return !all.some(other => other.kind === 'hours' && other.evidenceId === f.evidenceId && other.payload.seasons.some(s => inSeason(date,s.from,s.to) && seasonLength(s.from,s.to) < seasonLength(period.from,period.to)));
  });
  if (!reachable.length) return { picked: all, overruled: [], error: 'LINK_REQUIRES_BROWSER' };
  const independentCount = (facts: Fact[]) => {
    const domains = new Set<string>(), titles = new Set<string>(); let count = 0;
    for (const f of facts) {
      const domain = registrableDomain(f.domain);
      const title = dossier.evidence.find(e => e.id === f.evidenceId)?.title.replace(/\s+/g, '') || f.evidenceId;
      if (!domains.has(domain) && !titles.has(title)) { count++; domains.add(domain); titles.add(title); }
    }
    return count;
  };
  const reservationsDisagree = (facts: Fact[]) => {
    const reservations = facts.filter((f): f is Fact & {kind:'reservation'} => f.kind === 'reservation');
    return (['advanceDays', 'releaseTime'] as const).some(key => new Set(reservations.map(f => f.payload[key]).filter(v => v !== null)).size > 1);
  };
  const topTier = Math.min(...reachable.map(f => f.tier));
  if (topTier >= 3) {
    // Platform and web pages are dated by their crawl or edit, not by a rule change,
    // so they are weighed by independent agreement: two platforms or three ordinary sites.
    const readings = new Map<string, Fact[]>();
    for (const f of reachable) { const key = reading(f, date); readings.set(key, [...(readings.get(key) ?? []), f]); }
    const options = [...readings.values()].sort((a, b) => independentCount(b) - independentCount(a) || Math.min(...a.map(f => f.tier)) - Math.min(...b.map(f => f.tier)));
    if (options.length > 1 && independentCount(options[0]) === independentCount(options[1])) return { picked: reachable, overruled: all.filter(f => !reachable.includes(f)), error: 'SOURCES_DISAGREE' };
    const picked = [...options[0]].sort((a, b) => a.tier - b.tier || (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    if (reservationsDisagree(picked)) return { picked, overruled: all.filter(f => !picked.includes(f)), error: 'SOURCES_DISAGREE' };
    const strong = independentCount(picked) >= (picked[0].tier === 3 ? 2 : 3);
    return { picked, overruled: all.filter(f => !picked.includes(f)), error: strong ? null : 'WEAK_EVIDENCE' };
  }
  const ranked = reachable.filter(f => f.tier === topTier);
  const dated = ranked.filter(f => f.publishedAt);
  const newest = dated.length ? dated.map(f => f.publishedAt!).sort().at(-1) : null;
  const finalists = newest ? ranked.filter(f => f.publishedAt === newest) : ranked;
  const groups = new Map<string, Fact[]>();
  for (const f of finalists) { const key = fingerprint(f, date); groups.set(key, [...(groups.get(key) ?? []), f]); }
  const options = [...groups.values()].sort((a, b) => independentCount(b) - independentCount(a));
  if (options.length > 1 && independentCount(options[0]) === independentCount(options[1])) return { picked: finalists, overruled: all.filter(f => !finalists.includes(f)), error: 'SOURCES_DISAGREE' };
  // Older independent reports that agree still corroborate the latest rule.
  const chosen = fingerprint(options[0][0], date);
  const picked = ranked.filter(f => fingerprint(f, date) === chosen);
  if (reservationsDisagree(finalists)) return {picked:finalists,overruled:all.filter(f=>!finalists.includes(f)),error:'SOURCES_DISAGREE'};
  return { picked, overruled: all.filter(f => !picked.includes(f)), error: null };
}
function validOn(f: Fact, date: string) { return (!f.validFrom || f.validFrom <= date) && (!f.validTo || f.validTo >= date); }
function shiftedClosure(f: Fact, date: string) {
  if (f.kind !== 'weekly_closure' || !/闭馆(?:日)?顺延至节后第一天/.test(f.quote) || holidayState(date) === 'holiday' || holidayState(addDays(date,-1)) !== 'holiday') return false;
  for (let n=1;n<=14 && holidayState(addDays(date,-n)) === 'holiday';n++) if (f.payload.closedWeekdays.includes(weekday(addDays(date,-n)))) return true;
  return false;
}
function covers(f: Fact, date: string) { return 'from' in f.payload && 'to' in f.payload && typeof f.payload.from === 'string' && f.payload.from <= date && typeof f.payload.to === 'string' && f.payload.to >= date; }
const reasonText: Record<string, string> = {
  NO_EVIDENCE: '没有找到适用于该日期且通过核验的规则。', WEAK_EVIDENCE: '现有来源的证据强度不足，需要向官方渠道核实。',
  SOURCES_DISAGREE: '同等级来源对这项规则存在无法裁决的矛盾，双方证据已保留。',
  LINK_REQUIRES_BROWSER: '来源屏蔽了自动访问，需要在浏览器中打开核实，暂不作确认。',
  HOLIDAY_SCHEDULE_NOT_PUBLISHED: '该年份的节假日安排尚未收录，无法判断节假日例外。',
};

export function judgeItem(item: Item, trip: TripInput, dossier?: Dossier): Judgment[] {
  const date = dateForDay(trip.startDate, item.day), w = weekday(date), holiday = holidayState(date);
  const venueId = dossier?.venue.id ?? `unresolved:${item.id}`;
  const facts = (dossier?.facts ?? []).filter(f => {
    const evidence = dossier?.evidence.find(e => e.id === f.evidenceId);
    return f.quoteVerified && f.venueMatch === 'exact' && f.linkStatus !== 'broken' && validOn(f, date) && (!evidence || factSupported(f, evidence));
  });
  const judgments: Judgment[] = [];
  const make = (type: CheckType, verdict: Verdict, code: string, explanation: string, basis: Fact[] = [], overruled: Fact[] = [], notes: string[] = []) => {
    const judgment: Judgment = {
      id: createHash('sha256').update(`${item.id}:${type}:${date}:${verdict}:${code}:${basis.map(f => f.id).sort().join(',')}`).digest('hex').slice(0, 24),
      itemId: item.id, venueId, type, date, verdict, reasonCode: code, explanation, factIds: basis.map(f => f.id), overruledFactIds: overruled.map(f => f.id),
      evidenceIds: [...new Set([...basis, ...overruled].map(f => f.evidenceId))], searchedScope: dossier?.searchedScope ?? [], notes, judgedAt: now(),
    };
    judgments.push(judgment); return judgment;
  };
  const resolve = (pool: Fact[], type: CheckType) => {
    const r = dossier ? resolveFacts(pool, date, dossier) : { picked: [], overruled: [], error: 'NO_EVIDENCE' as const };
    if (r.error) { make(type, 'unknown', r.error, reasonText[r.error], r.picked, r.overruled); return null; }
    return r;
  };
  const unresolved = unresolvedTarget(item);
  if (unresolved) make(item.kind === 'transport' ? 'service_hours' : 'hours_fit', 'unknown', unresolved.code, unresolved.message);
  const visitable = !unresolved && ['museum', 'scenic', 'show', 'restaurant', 'other'].includes(item.kind);
  if (visitable) {
    const specific = facts.filter(f => (f.kind === 'temp_open' || (f.kind === 'temp_closure' && f.payload.scope === 'whole')) && covers(f, date));
    const openEnded = facts.filter(f=>f.kind==='temp_closure'&&f.payload.to===null&&f.payload.from<=date&&f.payload.scope==='whole');
    const shifted = facts.filter(f => shiftedClosure(f,date));
    const closed = facts.filter(f => f.kind === 'weekly_closure' && (f.payload.closedWeekdays.includes(w) || shifted.includes(f)));
    // Published hours for this date also say the place opens that day when they are
    // written per weekday or as daily, or when the same source lists its closing days
    // and this is not one of them. A source silent on closing days counts only for
    // non-museums, and only when no source mentions a weekly closure.
    const closureSources = new Set(facts.filter(f => f.kind === 'weekly_closure').map(f => f.evidenceId));
    const implied = facts.filter(f => f.kind === 'hours' && (!f.payload.weekdays || f.payload.weekdays.includes(w)) && f.payload.seasons.some(s => inSeason(date, s.from, s.to))
      && (f.payload.weekdays !== null || daily(f.quote) || (closureSources.has(f.evidenceId) ? !closed.some(c => c.evidenceId === f.evidenceId) : !closureSources.size && item.kind !== 'museum')))
      .map(f => ({ ...f, kind: 'weekly_open', payload: { weekdays: [0, 1, 2, 3, 4, 5, 6], exceptStatutoryHolidays: false } }) as Fact);
    const open = [...facts.filter(f => f.kind === 'weekly_open' && f.payload.weekdays.includes(w)), ...implied];
    const uncertainHoliday = [...closed, ...open].some(f => (f.kind === 'weekly_open' || f.kind === 'weekly_closure') && f.payload.exceptStatutoryHolidays && holiday === 'unpublished');
    const regular = [...closed, ...open].filter(f => !((f.kind === 'weekly_open' || f.kind === 'weekly_closure') && f.payload.exceptStatutoryHolidays && holiday === 'holiday'));
    const partial = facts.filter(f => f.kind === 'temp_closure' && f.payload.scope === 'partial' && covers(f, date));
    if(!specific.length && openEnded.length && !closed.length){
      const r=resolve(openEnded,'open_on_date');
      if (r) {
        // A recent closure "until further notice" with no reopening found is treated as closed;
        // an old one may well have ended quietly, so it stays unconfirmed.
        const since = r.picked.flatMap(f => f.kind === 'temp_closure' ? [f.payload.from] : []).sort().at(-1)!;
        const recent = daysUntil(date, since) <= 14 && daysUntil(since) >= -30;
        if (recent) make('open_on_date', 'conflict', 'CLOSED_UNTIL_NOTICE', `${Number(since.slice(5, 7))}月${Number(since.slice(8))}日起临时关闭，公告没写恢复日期，也没查到恢复开放的通知，按关闭处理；出发前可再查官方公告。`, r.picked, r.overruled);
        else make('open_on_date','unknown','OPEN_ENDED_CLOSURE',`找到已生效的临时关闭报道，但未明确恢复日期；不能确认 ${date} 已恢复开放，请联系官方渠道。`,r.picked,r.overruled);
      }
    }
    else if (!specific.length && uncertainHoliday) make('open_on_date', 'unknown', 'HOLIDAY_SCHEDULE_NOT_PUBLISHED', reasonText.HOLIDAY_SCHEDULE_NOT_PUBLISHED, [...closed, ...open]);
    else {
      const r = resolve(specific.length ? specific : shifted.length ? shifted : regular, 'open_on_date');
      if (r) {
        const closed = ['weekly_closure', 'temp_closure'].includes(r.picked[0].kind);
        const byHours = !closed && !specific.length && r.picked.every(f => implied.includes(f));
        make('open_on_date', closed ? 'conflict' : 'confirmed', closed ? r.picked[0].kind === 'temp_closure' ? 'TEMP_CLOSED' : shifted.length ? 'CLOSED_AFTER_HOLIDAY' : 'CLOSED_WEEKLY' : specific.length ? 'OPEN_BY_NOTICE' : byHours ? 'OPEN_BY_HOURS' : 'OPEN_BY_RULE',
          closed ? `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日（${weekdayLabel(date)}）${specific.length ? '有临时闭馆公告' : shifted.length ? '是节假日后的顺延闭馆日' : '是每周闭馆日'}，这天去会扑空。` : byHours ? `${date}（${weekdayLabel(date)}）适用已核实的开放时间，来源未提到这天闭园或闭馆。` : `${date}（${weekdayLabel(date)}）符合已核实的${specific.length ? '临时开放公告' : '常规开放规则'}。`,
          r.picked, r.overruled, [...(!specific.length ? [`未发现公告不等于不存在临时变更；已检索范围见调查日志。`] : []), ...partial.map(f => `局部区域关闭：${f.kind === 'temp_closure' ? f.payload.note : ''}，请核对是否涉及计划活动。`)]);
      }
    }
    const temporaryHours = facts.filter(f => f.kind === 'temp_hours' && covers(f, date));
    const regularHours = facts.filter(f => f.kind === 'hours' && (!f.payload.weekdays || f.payload.weekdays.includes(w)) && f.payload.seasons.some(s => inSeason(date, s.from, s.to)));
    if (!item.start) {
      const pool = temporaryHours.length ? temporaryHours : regularHours;
      const r = dossier ? resolveFacts(pool, date, dossier) : { picked: [], overruled: [], error: 'NO_EVIDENCE' as const };
      const f = r.picked[0], p = f?.kind === 'temp_hours' ? f.payload : f?.kind === 'hours' ? f.payload.seasons.find(s => inSeason(date, s.from, s.to)) : null;
      const known = !r.error && p;
      if (known && p.open === '00:00' && ['24:00', '23:59'].includes(p.close)) {
        make('hours_fit', 'confirmed', 'OPEN_ALL_DAY', '全天开放，任何到达时间都在开放时段内。', r.picked, r.overruled);
      } else {
      const j = make('hours_fit', 'unknown', 'MISSING_TIME', known ? `已核实营业时间 ${p.open}—${p.close}${p.lastEntry ? `，${p.lastEntry} 停止入场` : ''}；补充计划到达时间后，才能判断你的时段是否合适。` : '未填计划到达时间，暂不能判断时段是否合适；营业规则的核实情况见下方。', r.picked, r.overruled, r.error ? [reasonText[r.error]] : []);
      j.ruleStatus = known ? 'verified' : r.picked.length ? 'reference' : 'unresolved';
      }
    } else {
      const r = resolve(temporaryHours.length ? temporaryHours : regularHours, 'hours_fit');
      if (r) {
        const f = r.picked[0];
        const hours = f.kind === 'temp_hours' ? f.payload : f.kind === 'hours' ? f.payload.seasons.find(s => inSeason(date, s.from, s.to))! : null;
        if (hours) {
          const open = minutes(hours.open), rawClose = minutes(hours.close), overnight = rawClose < open;
          const close = rawClose + (overnight ? 1440 : 0);
          const start = minutes(item.start) + (overnight && minutes(item.start) < open ? 1440 : 0);
          const end = item.end ? minutes(item.end) + (overnight && minutes(item.end) < open ? 1440 : 0) : null;
          const entry = hours.lastEntry ? minutes(hours.lastEntry) + (overnight && minutes(hours.lastEntry) < open ? 1440 : 0) : null;
          const additionalEntry = entry === null ? facts.filter(other => {
            const p = other.kind === 'temp_hours' && covers(other, date) ? other.payload : other.kind === 'hours' && (!other.payload.weekdays || other.payload.weekdays.includes(w)) ? other.payload.seasons.find(s => inSeason(date, s.from, s.to)) : null;
            return p && p.open === hours.open && p.close === hours.close && p.lastEntry && minutes(item.start!) >= minutes(p.lastEntry);
          }) : [];
          if (start < open || start >= close || (end !== null && (end > close || end < start))) make('hours_fit', 'conflict', 'OUTSIDE_HOURS', `计划时段超出已核实的 ${hours.open}—${hours.close} 开放窗口。`, r.picked, r.overruled);
          else if (additionalEntry.length) {
            const cutoff = resolveFacts(additionalEntry, date, dossier!);
            if (!cutoff.error) make('hours_fit', 'conflict', 'AFTER_LAST_ENTRY', '计划到达时间已到或超过补充来源中核实的停止入场时间。', [...r.picked, ...cutoff.picked], cutoff.overruled);
            else make('hours_fit', 'unknown', 'LAST_ENTRY_UNVERIFIED', '计划接近闭园；补充资料提示已停止入场，但该截止时间尚未得到足够佐证，请先向景区确认。', [...r.picked, ...cutoff.picked], cutoff.overruled);
          }
          else if (entry !== null && start >= entry) make('hours_fit', 'conflict', 'AFTER_LAST_ENTRY', `计划 ${item.start} 到达，已到或超过 ${hours.lastEntry} 的停止入场时间。`, r.picked, r.overruled);
          else make('hours_fit', 'confirmed', close - start < 60 ? 'SHORT_VISIT' : 'HOURS_FIT', `计划 ${item.start}${item.end ? `—${item.end}` : ' 到达'}符合 ${hours.open}—${hours.close} 的开放窗口。`, r.picked, r.overruled, [...(close - start < 60 ? ['距离闭馆不足60分钟，请自行确认是否留有足够参观时间。'] : []), ...(!item.end ? ['未提供结束时间，本项仅核对入场时刻。'] : [])]);
        }
      }
    }
    if (item.claimedRules.some(c => c.kind === 'hours')) {
      const pool = temporaryHours.length ? temporaryHours : regularHours;
      const resolved = dossier ? resolveFacts(pool, date, dossier) : null;
      if (resolved && !resolved.error) {
        const f = resolved.picked[0];
        const p = f.kind === 'temp_hours' ? f.payload : f.kind === 'hours' ? f.payload.seasons.find(s => inSeason(date, s.from, s.to)) : null;
        const claims = item.claimedRules.filter(c => c.kind === 'hours');
        const mismatch = p && claims.some(c => {
          if (/全天|24\s*小时/.test(c.text)) return !(p.open === '00:00' && ['24:00', '23:59'].includes(p.close));
          const times = [...c.text.matchAll(/(\d{1,2})[:：](\d{2})/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
          return times.length === 2 && !/旺季|淡季|夏季|冬季|节假日/.test(c.text) && (times[0] !== p.open || times[1] !== p.close);
        });
        if (mismatch && p) make('guide_claim', 'conflict', 'GUIDE_RULE_CHANGED', `攻略声称的开放时间与适用于 ${date} 的 ${p.open}—${p.close} 规则不同。请按当前来源重新安排，未提供到达时间时仍无法判断实际入场。`, resolved.picked, resolved.overruled,
          [trip.guidePublishedAt ? `攻略标注发布于 ${trip.guidePublishedAt}；来源发布日期见证据卡。` : '攻略未标注发布日期，无法证明其时效。']);
      }
    }
  }
  if (['museum', 'scenic', 'show'].includes(item.kind) && (!openArea(item) || facts.some(f=>f.kind==='reservation') || item.claimedRules.some(c=>c.kind==='reservation'))) {
    const r = resolve(facts.filter(f => f.kind === 'reservation'), 'reservation_rule');
    if (r) {
      const f = r.picked[0];
      if (f.kind === 'reservation') {
        const relevant = r.picked.filter((f): f is Fact & {kind:'reservation'} => f.kind === 'reservation').sort((a,b)=>(b.publishedAt || '').localeCompare(a.publishedAt || ''));
        const p = { ...f.payload, advanceDays: relevant.find(f=>f.payload.advanceDays!==null)?.payload.advanceDays ?? null, releaseTime: relevant.find(f=>f.payload.releaseTime!==null)?.payload.releaseTime ?? null, channel: [...new Set(relevant.map(f=>f.payload.channel).filter(Boolean))].join(' / ') || null };
        const releaseDay = p.advanceDays !== null && p.releaseTime ? addDays(date, -p.advanceDays) : null;
        const release = releaseDay ? releaseDay < today() ? `；按原文提前天数计算，已于 ${releaseDay} ${p.releaseTime} 开始放票，尽快查看是否还有名额` : releaseDay === today() ? `；今天 ${p.releaseTime} 放票` : `；按原文提前天数计算，关注 ${releaseDay} ${p.releaseTime} 放票` : '';
        make('reservation_rule', 'confirmed', p.required ? 'RESERVATION_REQUIRED' : 'NO_RESERVATION_REQUIRED', p.required ? `需提前预约${release}${p.channel ? `，渠道：${p.channel}` : ''}。此结论不表示已有名额或已完成预约。` : '已核实的规则说明无需预约，实时运营变更仍以官方渠道为准。', r.picked, r.overruled);
      }
    }
    make('availability', 'unknown', 'REALTIME', `实时门票和预约库存无法通过网页搜索确认，请到${dossier?.venue.officialDomain ? `场馆官方渠道（${dossier.venue.officialDomain}）` : '场馆官方 App 或小程序'}核实。`);
  }
  if (item.kind === 'transport' && !unresolved) {
    const r = flexibleTransfer(item)?null:resolve(facts.filter(f => f.kind === 'service_hours'), 'service_hours');
    if (r) {
      const f = r.picked[0];
      if (f.kind === 'service_hours') {
        if (!item.start) make('service_hours', 'unknown', 'MISSING_TIME', `查到运营信息，但未提供计划乘车时间；末班参考 ${f.payload.last}${f.payload.lastDayOffset ? '（次日）' : ''}。`, r.picked, r.overruled);
        else {
          const first = f.payload.first ? minutes(f.payload.first) : 0;
          const start = minutes(item.start) + (f.payload.lastDayOffset && minutes(item.start) < first ? 1440 : 0);
          const last = minutes(f.payload.last) + f.payload.lastDayOffset * 1440;
          const fail = start > last || start < first;
          make('service_hours', fail ? 'conflict' : f.payload.first ? 'confirmed' : 'unknown', fail ? 'OUTSIDE_SERVICE_HOURS' : f.payload.first ? 'SERVICE_HOURS_FIT' : 'FIRST_SERVICE_UNKNOWN', `计划乘车时间 ${item.start}，检索到的运营窗口为 ${f.payload.first ?? '未注明首班'}—${f.payload.last}${f.payload.lastDayOffset ? '（次日）' : ''}。${f.payload.note}`, r.picked, r.overruled);
        }
      }
    }
    make('availability', 'unknown', 'REALTIME', '余票、实时晚点及路况无法由网页搜索确认，请到12306、承运方或地图渠道核实。');
    const duration = facts.filter(f => f.kind === 'transport_duration');
    if (duration.length) {
      const r = resolve(duration, 'hours_fit');
      if (r) {
        const f = r.picked[0];
        if (f.kind === 'transport_duration') make('hours_fit', 'unknown', 'TRAVEL_TIME_REFERENCE', `查到「${f.payload.from} → ${f.payload.to}」${f.payload.mode}约 ${f.payload.durationMinutes} 分钟的公开参考；这不是实时导航耗时，实际衔接仍需确认。`, r.picked, r.overruled);
      }
    }
  }
  const lastDay = Math.max(...trip.items.map(i => i.day));
  if ((item.day === 1 && trip.arriveDay1) || (item.day === lastDay && trip.leaveLastDay)) {
    if (!item.start) make('arrival_fit', 'unknown', 'MISSING_TIME', '缺少计划时间，无法核对抵达或离开边界。');
    else if (item.day === 1 && trip.arriveDay1 && minutes(item.start) < minutes(trip.arriveDay1)) make('arrival_fit', 'conflict', 'BEFORE_ARRIVAL', `计划 ${item.start} 开始，早于你填写的抵达时间 ${trip.arriveDay1}。`);
    else if (item.day === lastDay && trip.leaveLastDay && minutes(item.end ?? item.start) > minutes(trip.leaveLastDay)) make('arrival_fit', 'conflict', 'AFTER_DEPARTURE', `计划时段晚于你填写的离开时间 ${trip.leaveLastDay}。`);
    else make('arrival_fit', 'confirmed', 'ARRIVAL_FIT', '已填写的行程时刻符合你提供的抵达与离开边界；未包含交通耗时。');
  }
  return judgments;
}

export function judgeWeather(item: Item, trip: TripInput, dossier?: Dossier): Judgment {
  const date = dateForDay(trip.startDate, item.day), diff = daysUntil(date);
  const base: Judgment = { id: `weather-${item.id}-${date}`, itemId: item.id, venueId: dossier?.venue.id ?? 'weather', type: 'weather', date, verdict: 'unknown', reasonCode: 'NO_EVIDENCE', explanation: '未找到明确对应行程日期的可靠天气预报。', factIds: [], overruledFactIds: [], evidenceIds: [], searchedScope: dossier?.searchedScope ?? [], notes: [], judgedAt: now() };
  if (diff > 7) return { ...base, reasonCode: 'FORECAST_NOT_YET', explanation: '行程日期超出7天查询窗口，临近出发时再查询天气。' };
  if (diff < 0) return { ...base, reasonCode: 'PAST_DATE', explanation: '行程日期已经过去，本次不以当前预报代替历史天气。' };
  const pool = (dossier?.facts ?? []).filter(f => f.kind === 'weather' && f.payload.date === date && f.payload.city.replace(/市$/, '') === (item.city || trip.destinationCity).replace(/市$/, '') && f.retrievedAt.slice(0, 10) >= addDays(today(), -1));
  const forecasts = pool.filter((f): f is Fact & { kind: 'weather' } => f.kind === 'weather' && f.quoteVerified && f.venueMatch === 'exact' && f.linkStatus !== 'broken')
    .sort((a, b) => a.tier - b.tier || b.retrievedAt.localeCompare(a.retrievedAt));
  if (!dossier || !forecasts.length) return { ...base, explanation: '没查到明确写出这一天的天气预报，临近出发再看一次。' };
  // A forecast is worth showing even from one site; only agreement without rain confirms it.
  const resolved = resolveFacts(forecasts, date, dossier);
  const risky = (f: Fact & { kind: 'weather' }) => Boolean(f.payload.warning) || /雨|雪|雷|台风|大风/.test(f.payload.summary);
  const severe = forecasts.some(f => /暴雨|台风|暴雪|冰雹|(?:[89]|1[0-7])\s*级/.test(`${f.payload.summary} ${f.payload.warning ?? ''}`));
  const shown = [...new Map(forecasts.map(f => [f.payload.summary.replace(/[，。,.\s]/g, ''), f])).values()].slice(0, 2);
  const warnings = [...new Set(forecasts.map(f => f.payload.warning).filter(Boolean))];
  const risk = forecasts.some(risky);
  return { ...base, verdict: risk || resolved.error ? 'unknown' : 'confirmed', reasonCode: risk ? 'WEATHER_RISK' : resolved.error ?? 'FORECAST_FOUND',
    explanation: `${date} ${shown[0].payload.city}预报：${shown.map(f => f.payload.summary.replace(/[。.]$/, '')).join('；另一来源：')}${warnings.length ? `；${warnings.join('；')}` : ''}。${severe ? '可能发布预警，出发前查当地气象台预警和景区公告。' : risk ? '户外安排注意安全，预报可能变化。' : '预报可能变化，出发前再看一次。'}`,
    factIds: shown.map(f => f.id), evidenceIds: [...new Set(shown.map(f => f.evidenceId))], notes: ['本次查询后不进行定时监控。'] };
}
export function judgeTrip(trip: TripInput, dossiers: Dossier[]): Judgment[] {
  return [...trip.items.flatMap(item => {
    const city = item.city || trip.destinationCity;
    const dossier = dossiers.find(d => d.venue.key === `${city}:${item.placeName}`);
    const judgments = judgeItem(item, trip, dossier);
    const weather = dossiers.find(d => d.venue.key === `weather:${city}:${dateForDay(trip.startDate, item.day)}`);
    if (item.kind === 'scenic' || /户外|登山|游船|步行|日落/.test(item.activity)) judgments.push(judgeWeather(item, trip, weather));
    const safety = judgeSafety(item, trip, dossiers.find(d => d.venue.key === riskKey(city)));
    if (safety) judgments.push(safety);
    return judgments;
  }), ...judgeConnections(trip,dossiers)];
}
export function judgeConnections(trip:TripInput,dossiers:Dossier[]):Judgment[] {
  const ordered=[...trip.items].sort((a,b)=>a.day-b.day||a.seq-b.seq);
  return ordered.flatMap<Judgment>((item,index)=>{
    const previous=ordered[index-1];if(!previous||previous.day!==item.day||previous.placeName===item.placeName)return [];
    const date=dateForDay(trip.startDate,item.day);
    const refs=dossiers.flatMap(d=>d.facts).filter(f=>f.kind==='transport_duration'&&f.quoteVerified&&f.venueMatch==='exact'&&f.linkStatus==='ok'&&validOn(f,date)&&f.payload.from.includes(previous.placeName)&&f.payload.to.includes(item.placeName));
    const gap=previous.end&&item.start?minutes(item.start)-minutes(previous.end):null;
    // A negative same-day gap is already impossible from the user's own times;
    // no traffic estimate is needed to identify that contradiction. Overnight
    // activities remain unknown because these fields do not encode a day offset.
    if(gap!==null&&gap<0&&previous.start&&minutes(previous.end!)>=minutes(previous.start))return [{id:`connection-${previous.id}-${item.id}-${date}`,itemId:item.id,venueId:'connection',type:'connection_fit' as const,date,verdict:'conflict' as const,reasonCode:'PLAN_TIME_OVERLAP',explanation:`按当前路线先去「${previous.placeName}」（${previous.start}—${previous.end}），再去「${item.placeName}」（${item.start}到达），前后时间倒置或重叠；请调整时段或路线顺序。`,factIds:[],overruledFactIds:[],evidenceIds:[],searchedScope:[],notes:['此冲突仅依据你填写的计划时间计算，不依赖交通耗时。'],judgedAt:now()}];
    return [{id:`connection-${previous.id}-${item.id}-${date}`,itemId:item.id,venueId:'connection',type:'connection_fit' as const,date,verdict:'unknown' as const,reasonCode:refs.length?'TRAVEL_TIME_REFERENCE':'NO_TRAVEL_DURATION',explanation:`${previous.placeName} → ${item.placeName}：${gap===null?'缺少完整计划时段，无法计算衔接余量。':gap<0?'填写的前后时段存在重叠，需要调整。':`已填写的间隔为 ${gap} 分钟。`}${refs.length?'公开路线耗时仅为参考，不包含实时路况和候车。':'没有找到可可靠用于计算这段衔接的交通耗时。'}`,factIds:refs.map(f=>f.id),overruledFactIds:[],evidenceIds:[...new Set(refs.map(f=>f.evidenceId))],searchedScope:dossiers.filter(d=>d.facts.some(f=>refs.includes(f))).flatMap(d=>d.searchedScope),notes:['交通实时情况与实际可达性需在出发前自行确认。'],judgedAt:now()}];
  });
}
export function summary(judgments: Judgment[]) { return { confirmed: judgments.filter(j => j.verdict === 'confirmed').length, conflict: judgments.filter(j => j.verdict === 'conflict').length, unknown: judgments.filter(j => j.verdict === 'unknown').length, total: judgments.length }; }
