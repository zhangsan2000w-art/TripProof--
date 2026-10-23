import { factOutputSchema, extractedFactSchema, advisoryPayload, exposures, hazards, type Evidence, type Fact, type ExtractedFact, type VenueFact, type PlaceRisk, type Venue } from './domain';
import { z } from 'zod';
import { structured } from './llm';
import { id } from './store';
import { normalizeQuote, quoteMatches, sourceTier, registrableDomain, venueSiteDomains, siteLabel } from './evidence';
import { daysUntil, validDate, weekday } from './dates';
import { createHash } from 'node:crypto';

function mentionsTime(value: string, text: string) {
  if ((value === '00:00' || value === '24:00') && /全天开放|24\s*小[时時]|全天候/.test(text)) return true;
  const h = Number(value.slice(0, 2)), m = Number(value.slice(3));
  const normalized = text.normalize('NFKC').replace(/\s*:\s*/g, ':');
  const pm = h >= 12 ? `(?:下午|晚上|晚间)0?${h - 12}(?:[:点时]${m ? `0?${m}` : '(?:00)?'})` : '(?!)';
  return new RegExp(`(?:^|[^0-9])(?:0?${h}[:时点]0?${m}(?:分)?|0?${h}[时点]${m === 0 ? '(?:整)?' : `0?${m}分?`}|${pm})(?:[^0-9]|$)`).test(normalized);
}
// Weather summaries are compared without punctuation, spacing or unit symbols.
const bareText = (text: string) => normalizeQuote(text).replace(/[\p{P}\p{S}]/gu, '');
function mentionsEntry(value: string, text: string) {
  if (!mentionsTime(value, text)) return false;
  const normalized = text.normalize('NFKC').replace(/\s*:\s*/g, ':');
  const matches = [...normalized.matchAll(/(\d{1,2}:\d{2})\s*(?:后|起)?\s*(停止(?:售票(?:及|和|、)?(?:入园|入館|入馆|入场|入場)?)|停止(?:入园|入館|入馆|入场|入場|检票)|清场|闭园|闭馆)/g)]
    .filter(m => m[1].padStart(5, '0') === value);
  // Unlabelled table cells remain valid. Explicit ticketing-only, clearing,
  // and closing labels cannot stand in for a last admission time.
  return !matches.length || matches.some(m => /入园|入館|入馆|入场|入場|检票/.test(m[2]));
}
function mentionsDate(date: string, text: string, evidence: Evidence) {
  if (!validDate(date)) return false;
  const year = Number(date.slice(0,4)), month = Number(date.slice(5,7)), day = Number(date.slice(8));
  const normalized = normalizeQuote(text);
  if (new RegExp(`${year}(?:年|[-/.])0?${month}(?:月|[-/.])0?${day}(?:日|号)?`).test(normalized)) return true;
  // A month/day without a year is usable only within a source whose year is known.
  const sourceYear = evidence.publishedAt?.slice(0,4) || evidence.retrievedAt.slice(0,4);
  if (String(year) !== sourceYear || /20\d{2}(?:年|[-/.])/.test(normalized)) return false;
  return new RegExp(`(?:^|[^0-9])0?${month}(?:月|[-/.])0?${day}(?:日|号|[^0-9]|$)`).test(normalized);
}
const weekdayChars = ['[日天]', '一', '二', '三', '四', '五', '六'];
const dayWeekday = (date: string) => new RegExp(`(?:^|[^0-9])0?${Number(date.slice(8))}(?:日|号)\\s*\\(?\\s*(?:周|星期|礼拜)\\s*${weekdayChars[weekday(date)]}`);
/**
 * Forecast tables often give only the day and weekday, e.g. 24日(周六). Accept that when both
 * match the date and the source was published in the ten days before it.
 */
export function mentionsDayAndWeekday(date: string, text: string, evidence: Pick<Evidence, 'publishedAt'>) {
  if (!validDate(date) || !evidence.publishedAt) return false;
  const ahead = daysUntil(date, evidence.publishedAt.slice(0, 10));
  return ahead >= 0 && ahead <= 10 && dayWeekday(date).test(text.normalize('NFKC'));
}
/** The text around a verified quote, where a notice's dates, level and area are written. */
function quoteContext(quote: string, evidence: Pick<Evidence, 'passage' | 'content'>, radius = 220) {
  const q = normalizeQuote(quote);
  for (const text of [evidence.content, evidence.passage]) {
    const normalized = normalizeQuote(text), at = normalized.indexOf(q);
    if (at >= 0) return normalized.slice(Math.max(0, at - radius), at + q.length + radius);
  }
  return normalizeQuote(quote);
}
const areaStem = (area: string) => area.replace(/(?:特别行政区|自治州|自治县|地区|新区|省|市|区|县)$/, '');
function advisorySupported(fact: ExtractedFact & { kind: 'advisory' }, evidence: Evidence) {
  const p = fact.payload, context = quoteContext(fact.quote, evidence);
  if (!validDate(p.from) || (p.to && (!validDate(p.to) || p.to < p.from))) return false;
  if (!mentionsDate(p.from, context, evidence) && evidence.publishedAt !== p.from) return false;
  if (p.to && !mentionsDate(p.to, context, evidence)) return false;
  if (p.level && !context.includes(normalizeQuote(p.level).replace(/(?:预警|信号)$/, ''))) return false;
  if (p.scope && !context.includes(normalizeQuote(p.scope))) return false;
  const area = normalizeQuote(areaStem(p.area));
  if (!/^(?:全市|本市|市区|全省|全区)$/.test(p.area) && (area.length < 2 || !normalizeQuote(`${evidence.title} ${evidence.passage} ${context}`).includes(area))) return false;
  return true;
}
export function factSupported(fact: ExtractedFact, evidence: Evidence): boolean {
  if (fact.venueMatch !== 'exact' || evidence.linkStatus === 'broken' || !quoteMatches(fact.quote, evidence)) return false;
  if (fact.kind === 'advisory') return advisorySupported(fact, evidence);
  if ((fact.validFrom && !mentionsDate(fact.validFrom, `${evidence.passage} ${evidence.content}`, evidence)) || (fact.validTo && !mentionsDate(fact.validTo, `${evidence.passage} ${evidence.content}`, evidence)) || (fact.validFrom && fact.validTo && fact.validFrom > fact.validTo)) return false;
  const quote = fact.quote;
  // A permanent-looking rule can be qualified by a nearby expiry sentence.
  if (['weekly_open', 'weekly_closure', 'hours', 'reservation'].includes(fact.kind)) {
    const q = normalizeQuote(quote);
    for (const text of [evidence.content, evidence.passage]) {
      const normalized = normalizeQuote(text), at = normalized.indexOf(q);
      if (at < 0) continue;
      const context = normalized.slice(Math.max(0, at - 140), at + q.length + 100);
      const expiry = context.match(/(?:至|到)(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日(?:止|结束|結束|为止|為止)/);
      if (expiry && (!fact.validTo || fact.validTo.slice(5) !== `${expiry[2].padStart(2,'0')}-${expiry[3].padStart(2,'0')}` || (expiry[1] && !fact.validTo.startsWith(expiry[1])))) return false;
    }
  }
  if (fact.kind === 'weekly_closure' && /(?:上午|下午|晚间|晚間|局部|部分)[^，,。；;]{0,12}(?:闭馆|閉館|关闭|關閉)/.test(quote)) return false;
  // An opening rule cannot include a weekday its own quote says is closed.
  if (fact.kind === 'weekly_open' && fact.payload.weekdays.some(d => closedWeekdays(quote).includes(d))) return false;
  if (fact.kind === 'hours') return fact.payload.seasons.every(s => {
    const annual = s.from === '01-01' && s.to === '12-31';
    const mentionsMonthDay = (value:string) => new RegExp(`(?:^|[^0-9])0?${Number(value.slice(0,2))}(?:月|[-/.])0?${Number(value.slice(3))}(?:日|号|[^0-9]|$)`).test(normalizeQuote(quote));
    return validDate(`2000-${s.from}`) && validDate(`2000-${s.to}`) && (annual || (mentionsMonthDay(s.from) && mentionsMonthDay(s.to))) && mentionsTime(s.open, quote) && mentionsTime(s.close, quote) && (!s.lastEntry || mentionsEntry(s.lastEntry, quote));
  });
  if (fact.kind === 'temp_hours') return mentionsTime(fact.payload.open, quote) && mentionsTime(fact.payload.close, quote) && (!fact.payload.lastEntry || mentionsEntry(fact.payload.lastEntry, quote));
  if (fact.kind === 'reservation' && fact.payload.releaseTime && !mentionsTime(fact.payload.releaseTime, quote)) return false;
  if (fact.kind === 'reservation') {
    const p=fact.payload, q=normalizeQuote(quote);
    if (p.advanceDays !== null && !new RegExp(`(?:提前|未来|未來|预约|預約)[^0-9]{0,8}${p.advanceDays}(?:天|日)`).test(q) && !(p.advanceDays===7 && /提前一周|提前一週/.test(q))) return false;
    if (!p.required && !/免预约|免預約|无[需须]预约|無需預約|不(?:需要|需|用|必)?提前?预约|不需要.*预约|不需要.*預約|无需.*预约|取消(?:常态化|常態化)?(?:预约|預約)(?:准入制)?/.test(q)) return false;
    // There are no visitor eligibility fields; group benefits cannot be used
    // as the general visitor's reservation rule.
    if (!p.required && /\d{1,3}周岁|\d{1,3}周歲|老年|老人|未成年|儿童|兒童|军人|軍人|残疾|殘疾|优待|優待|下列.{0,8}人群|以下.{0,8}人员/.test(q)) return false;
    if (p.required && /团队|團隊|团体|團體/.test(q) && !/个人|個人|散客/.test(q)) return false;
  }
  if (fact.kind === 'transport_duration' && !new RegExp(`${fact.payload.durationMinutes}(?:分钟|分鐘|分)`).test(normalizeQuote(quote))) return false;
  if (fact.kind === 'service_hours' && (!mentionsTime(fact.payload.last, quote) || (fact.payload.first && !mentionsTime(fact.payload.first, quote)))) return false;
  if (['temp_closure', 'temp_open', 'temp_hours'].includes(fact.kind)) {
    const p = fact.payload as { from: string; to: string | null };
    if (!validDate(p.from) || (p.to && (!validDate(p.to) || p.from > p.to))) return false;
    if (!mentionsDate(p.from, quote, evidence) || (p.to && !mentionsDate(p.to, `${quote} ${evidence.passage}`, evidence))) return false;
  }
  if (fact.kind === 'weather' && (!(mentionsDate(fact.payload.date, quote, evidence) || mentionsDayAndWeekday(fact.payload.date, quote, evidence)) || !`${evidence.passage} ${evidence.content}`.includes(fact.payload.city.replace(/市$/, '')) || !bareText(fact.payload.summary) || !bareText(quote).includes(bareText(fact.payload.summary)) || (fact.payload.warning && !bareText(quote).includes(bareText(fact.payload.warning))))) return false;
  return true;
}
const weekdayNumbers: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
/** Weekdays a sentence says are closed all day, e.g. 逢周一闭馆, 每周一全天闭馆. */
export function closedWeekdays(text: string): number[] {
  return [...normalizeQuote(text).matchAll(/(?:周|星期|礼拜)([一二三四五六日天])(?:全天)?(?:闭馆|閉館|休馆|闭园|不开放|不對外開放|不对外开放)/g)].map(m => weekdayNumbers[m[1]]);
}
/** "全天开放" written as an opening rule is also the day's hours, so it can be weighed against other hours. */
export function allDayHours(base: ExtractedFact): VenueFact[] {
  if (base.kind !== 'weekly_open' || base.payload.weekdays.length !== 7 || !/全天开放|24\s*小[时時]|全天候/.test(base.quote) || /\d{1,2}\s*[:：]\s*\d{2}/.test(base.quote)) return [];
  return [{ ...base, kind: 'hours', payload: { seasons: [{ from: '01-01', to: '12-31', open: '00:00', close: '24:00', lastEntry: null }], weekdays: null } }];
}
/** Re-rank stored sources with the current tier rules, so saved reports benefit too. */
export function retierDossier(dossier: { facts: Fact[]; evidence: Evidence[]; venue: Venue }) {
  const names = [...new Set([dossier.venue.canonicalName, dossier.venue.key.split(':').slice(1).join(':')])];
  const sites = dossier.venue.officialDomain ? [] : [...new Set(names.flatMap(name => venueSiteDomains(dossier.evidence, name)))];
  for (const e of dossier.evidence) e.tier = sourceTier(new URL(e.finalUrl || e.url).hostname, e.authorityLevel, dossier.venue.officialDomain, sites, siteLabel(e));
  for (const f of dossier.facts) { const e = dossier.evidence.find(e => e.id === f.evidenceId); if (e) f.tier = e.tier; }
}
export function supportedDossierFacts(dossier: { facts: Fact[]; evidence: Evidence[]; venue?: Venue }): Fact[] {
  if (dossier.venue) retierDossier({ ...dossier, venue: dossier.venue });
  const facts = dossier.facts.filter(fact => {
    const evidence = dossier.evidence.find(e => e.id === fact.evidenceId);
    return evidence ? factSupported(fact, evidence) : false;
  });
  for (const base of [...facts]) {
    const source = dossier.evidence.find(e=>e.id===base.evidenceId)!;
    for (const extra of [...seasonalHours(base,source), ...allDayHours(base)]) {
      if (!facts.some(f=>f.evidenceId===extra.evidenceId&&f.kind===extra.kind&&JSON.stringify(f.payload)===JSON.stringify(extra.payload))) {
        facts.push({...base,...extra,id:createHash('sha256').update(`${base.id}:${JSON.stringify(extra.payload)}`).digest('hex').slice(0,24)} as Fact);
      }
    }
  }
  return facts;
}
/** Read an explicit seasonal extension that follows a complete annual rule. */
export function seasonalHours(base: ExtractedFact, evidence: Evidence): VenueFact[] {
  if (base.kind !== 'hours' || base.payload.seasons.length !== 1 || base.payload.seasons[0].from !== '01-01' || base.payload.seasons[0].to !== '12-31') return [];
  const out: VenueFact[] = [], opening = base.payload.seasons[0].open;
  for (const text of [evidence.content, evidence.passage]) {
    const body = text.normalize('NFKC'), baseAt = body.indexOf(base.quote.normalize('NFKC'));
    if (baseAt < 0) continue;
    const nearby = body.slice(baseAt, baseAt + base.quote.length + 180);
    const pattern = /(\d{1,2})月(\d{1,2})日(?:至|到|[-—–~～])(\d{1,2})月(\d{1,2})日[^。；;]{0,24}(?:延长|延長|调整|調整)开放至(\d{1,2}:\d{2})\s*\((\d{1,2}:\d{2})停止(?:入馆|入館|入场|入場)\)/g;
    for (const match of nearby.matchAll(pattern)) {
      const prefix = nearby.slice(0, match.index);
      const openingToken = new RegExp(`(?:^|[^0-9])(0?${Number(opening.slice(0,2))}:${opening.slice(3)})(?![0-9])`, 'g');
      const start = [...prefix.matchAll(openingToken)].at(-1);
      if (!start) continue;
      const at = start.index! + start[0].indexOf(start[1]);
      const quote = nearby.slice(at, match.index! + match[0].length);
      if ([...quote].length > 80) continue;
      const pad = (v:string) => v.padStart(2,'0'), time = (v:string) => v.split(':').map(pad).join(':');
      const fact: VenueFact = { ...base, quote, payload: { seasons: [{from:`${pad(match[1])}-${pad(match[2])}`,to:`${pad(match[3])}-${pad(match[4])}`,open:opening,close:time(match[5]),lastEntry:time(match[6])}], weekdays:base.payload.weekdays } };
      if (factSupported(fact,evidence) && !out.some(f=>JSON.stringify(f.payload)===JSON.stringify(fact.payload))) out.push(fact);
    }
  }
  return out;
}
export async function extractFacts(venueId: string, name: string, city: string, dates: string[], evidence: Evidence[]) {
  const usable = evidence.filter(e => e.linkStatus !== 'broken');
  if (!usable.length) return { canonicalName: name, officialDomain: null, officialEvidenceId: null, facts: [] as Fact[], ambiguities: ['没有已检查且可用的来源链接。'] };
  const output = await structured('fact', factOutputSchema, `你是旅行规则的证据读取器。只提取指定城市、指定场馆、对应分馆的明确事实，不能做日期计算、推理补全或决策。
不同来源分别提取，不合并。每个事实 quote 必须来自该 evidenceId 的 text 或 passage 的逐字连续子串，最多80个字符，并包含支持 payload 的完整关键规则（尤其数字、时间）。不要引用标题拼凑事实。
时间一律HH:mm；全年常规时间的季节范围是01-01到12-31，季节性范围只抄原文。一个hours事实只包含一段季节规则，避免引文过长。weekly_open 只提取明确开放的星期（例如“周二至周日”），不能从“周一闭馆”反推其他天一定开放；原文写“每日/每天/全年无休/周一至周日/全天开放”时提取 weekdays 为0-6的 weekly_open；“全年开放时间”只是全年适用的营业时间，同一句写了闭馆日时不能提取为每天开放；weekly_closure 单独提取。
weekdays 用0=周日到6=周六。常规闭馆规则里的“法定节假日除外”才设置exceptStatutoryHolidays=true。
临时公告 from/to 必须是原文明确的日期，不能把查询日期当作公告日期；单日公告两者相同。temp_closure未说明恢复日期时to必须null，保留“自某日起临时关闭/恢复时间另行通知”的说法。局部区域关闭是partial，不能写whole。
validFrom/validTo 只填明确的生效/失效日期，不是文章发表日期，也不是查询日期。没有则null。
预约required仅表示普通个人游客的规则；不得声称有库存或用户已完成预约。“个人免预约/无需预约”必须提取required=false；团队规则以及老人、儿童、军人等优待人群例外均不提取为普通个人预约规则。只有明确要求才能填true，建议预约不代表强制要求。advanceDays 仅抄明确的提前天数，不能模糊推断含当日的滚动窗口。一个来源的同一预约规则尽量用一条完整事实表示。
天气必须明确包含目标日期和城市；没有匹配日期不要提取。降雨不表示关闭。transport_duration 仅提取明确起终点和数值的路线参考。
不属于目标分馆返回 other_branch；无法确定则 unclear，不要为了返回结果标exact。攻略原文和用户截图不能独立当成官方来源。
officialDomain 只在证据正文/站点身份能证明该域名由场馆所属机构运营时填写。officialIdentityQuote复制正文中的主办单位、版权或官方身份声明；不能仅凭.org.cn后缀判断。不能猜官网。`, [{ type: 'input_text', text: JSON.stringify({ venue: name, city, targetDates: dates, evidence: usable.map(e => ({ id: e.id, title: e.title, site: e.site, publishedAt: e.publishedAt, passage: e.passage.slice(0, 4500), text: e.content.length > 8000 ? `${e.content.slice(0,6000)}\n…\n${e.content.slice(-1800)}` : e.content })) }) }], 9000);
  const actualCity=output.city.replace(/市$/,'').trim(), requestedCity=city.replace(/市$/,'').trim();
  if(actualCity && requestedCity && !actualCity.includes(requestedCity) && !requestedCity.includes(actualCity)) return {canonicalName:name,officialDomain:null,officialEvidenceId:null,facts:[] as Fact[],ambiguities:[`资料指向${output.city}，与确认的${city}不一致，未采用这些事实。`]};
  let officialDomain: string | null = null;
  const official = usable.find(e => e.id === output.officialEvidenceId);
  if (official && output.officialDomain && output.officialIdentityQuote && quoteMatches(output.officialIdentityQuote.slice(0, 80), official)) {
    const candidate = output.officialDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const domain = new URL(official.finalUrl || official.url).hostname;
    const statement = output.officialIdentityQuote;
    const institution = name.replace(/[（(].*?[）)]/g, '').replace(/博物馆|博物院|景区|公园|遗址|展示馆|美术馆/g, '');
    const ownedByVenue = statement.includes(name) || (institution.length >= 2 && statement.includes(institution));
    if ((domain === candidate || domain.endsWith(`.${candidate}`)) && ownedByVenue && /主办|版权|版权所有|官方|copyright|管理局|管理处/i.test(statement) && !['ctrip.com', 'baidu.com', 'bendibao.com', 'dianping.com'].some(x => candidate === x || candidate.endsWith(`.${x}`))) officialDomain = candidate;
  }
  // Some official sites put the copyright owner in their contact block rather
  // than a single footer sentence. Require matching institution and domain mail.
  if (!officialDomain) for (const source of usable.filter(e => e.linkStatus === 'ok')) {
    const domain = registrableDomain(new URL(source.finalUrl || source.url).hostname), footer = source.content.slice(-2000);
    const excluded = /(?:baidu|ctrip|bendibao|dianping|sohu|163|qq|sina|toutiao|mafengwo)\./.test(domain);
    if (!excluded && footer.includes(name) && /(?:版权|版權)所有|copyright|©/i.test(footer) && /地址|Address/i.test(footer) && footer.toLowerCase().includes(`@${domain}`)) {
      officialDomain = domain; output.officialEvidenceId = source.id; break;
    }
  }
  const sites = officialDomain ? [] : venueSiteDomains(usable, name);
  for (const e of evidence) e.tier = sourceTier(new URL(e.finalUrl || e.url).hostname, e.authorityLevel, officialDomain, sites, siteLabel(e));
  for (const fact of [...output.facts]) {
    const source = usable.find(e => e.id === fact.evidenceId);
    if (source) for (const extra of [...seasonalHours(fact, source), ...allDayHours(fact)]) {
      if (!output.facts.some(f => f.evidenceId === extra.evidenceId && f.kind === extra.kind && JSON.stringify(f.payload) === JSON.stringify(extra.payload))) output.facts.push(extra);
    }
  }
  const facts: Fact[] = [];
  for (const extracted of output.facts) {
    if (extracted.kind === 'hours' && /全天开放|24\s*小时|全天候/.test(extracted.quote)) {
      for (const season of extracted.payload.seasons) if (season.open === '00:00' && season.close === '00:00') season.close = '24:00';
    }
    const source = usable.find(e => e.id === extracted.evidenceId);
    if (!source || !factSupported(extracted, source)) {
      output.ambiguities.push(`一条${extracted.kind}说法未通过引文、数字或适用范围核验，未用于判定。`);
      continue;
    }
    facts.push({ ...extracted, id: id(), venueId, quoteVerified: true, tier: source.tier, domain: new URL(source.finalUrl || source.url).hostname, publishedAt: source.publishedAt, retrievedAt: source.retrievedAt, linkStatus: source.linkStatus });
  }
  return { canonicalName: output.canonicalName || name, officialDomain, officialEvidenceId: officialDomain ? output.officialEvidenceId : null, facts, ambiguities: output.ambiguities };
}
export async function extractWeatherFacts(venueId:string,city:string,date:string,evidence:Evidence[]):Promise<Fact[]> {
  const tokens=[date,`${Number(date.slice(5,7))}月${Number(date.slice(8))}日`,`${Number(date.slice(5,7))}/${Number(date.slice(8))}`,date.slice(5)];
  const whole=(e:Evidence)=>`${e.passage} ${e.content}`.normalize('NFKC');
  const usable=evidence.filter(e=>e.linkStatus!=='broken'&&(tokens.some(t=>whole(e).includes(t))||mentionsDayAndWeekday(date,whole(e),e)));
  if(!usable.length)return [];
  const schema=z.object({facts:z.array(extractedFactSchema.options.find(s=>s.shape.kind.value==='weather')!).max(3)});
  const output=await structured('fact',schema,'仅读取明确属于指定城市和日期的天气预报。原文只写日和星期（如“24日(周六)”）时，只有日和星期都与指定日期一致才算这一天。必须逐字复制含预报日期及天气内容的连续短引文（最多80字符），summary 只抄引文中的天气现象和气温，warning 只抄引文中的预警或台风说法，不得用查询日期替换原文日期，不根据今天/明天猜日期，不输出其它城市或日期。validFrom/validTo均null，没有匹配预报返回空数组。',[{type:'input_text',text:JSON.stringify({city,date,evidence:usable.map(e=>{const text=whole(e);const hits=[...tokens.map(t=>text.indexOf(t)),text.search(dayWeekday(date))].filter(n=>n>=0);const at=hits.length?Math.min(...hits):0;return {id:e.id,text:text.slice(Math.max(0,at-400),at+2200)};})})}],3000);
  return output.facts.filter(f=>f.kind==='weather'&&f.payload.date===date).flatMap(f=>{const e=usable.find(e=>e.id===f.evidenceId);return e&&factSupported(f,e)?[{...f,id:id(),venueId,quoteVerified:true,tier:e.tier,domain:new URL(e.finalUrl||e.url).hostname,publishedAt:e.publishedAt,retrievedAt:e.retrievedAt,linkStatus:e.linkStatus} as Fact]:[];});
}
const riskWords = /台风|暴雨|暴雪|大风|预警|应急响应|防汛|防台|关闭|闭园|闭馆|暂停开放|暂停营业|停航|停运|停驶|恢复开放|封闭/;
/** Up to three passages around notice wording, so long pages stay within the reading budget. */
function riskText(e: Evidence) {
  const whole = `${e.passage} ${e.content}`, windows: [number, number][] = [];
  for (const m of whole.matchAll(new RegExp(riskWords.source, 'g'))) {
    const at = m.index!; if (windows.some(([a, b]) => at >= a && at <= b)) continue;
    windows.push([Math.max(0, at - 300), at + 900]); if (windows.length >= 3) break;
  }
  return windows.length ? windows.map(([a, b]) => whole.slice(a, b)).join(' … ') : whole.slice(0, 1200);
}
export const hasRiskWords = (e: Pick<Evidence, 'title' | 'passage' | 'content'>) => riskWords.test(`${e.title} ${e.passage} ${e.content.slice(0, 20000)}`);
/**
 * Read area notices (warnings, emergency responses, area-wide closures, suspensions) and
 * decide which trip stops each covers. Every notice is checked against its source text;
 * coverage that the notice does not name is kept, but labelled as judged from its scope.
 */
export async function extractAdvisories(venueId: string, city: string, dates: string[], places: { place: string; kind: string; note: string }[], evidence: Evidence[]): Promise<{ facts: Fact[]; places: PlaceRisk[]; ambiguities: string[] }> {
  const usable = evidence.filter(e => e.linkStatus !== 'broken');
  const advisoryOut = z.object({ evidenceId: z.string(), quote: z.string().max(80), ...advisoryPayload.shape });
  const schema = z.object({
    advisories: z.array(advisoryOut).max(12),
    places: z.array(z.object({ place: z.string(), exposure: z.enum(exposures), exposureReason: z.string().max(60), covers: z.array(z.object({ advisory: z.number().int().min(0), how: z.enum(['named', 'scope', 'area']), reason: z.string().max(80) })).max(12) })).max(60),
  });
  const output = await structured('fact', schema, `你是出行安全公告读取器，为行程日期做风险前置检查。只读取资料明确写出、与目标城市（含其下属区县）及行程日期相关的：
- warning：气象台发布的预警信号（台风、暴雨、大风、暴雪、冰雹、雷电、大雾、高温、寒潮、山洪地质灾害等，蓝/黄/橙/红）；
- response：防汛防台、防台风等应急响应（Ⅳ/Ⅲ/Ⅱ/Ⅰ级）；
- closure：景区/景点/场馆关闭、暂停开放、封闭；reopen：恢复开放；
- suspension：航线、轮渡、公交、地铁、景区交通的停航停运。
普通天气预报、历史回顾、科普、其他城市的公告不要提取。hazard 从 ${hazards.join('、')} 中选，与天气无关的关闭选“其他”。
quote 必须是该 evidenceId 文本的逐字连续子串（最多80字），包含公告的核心说法（例如“…所有涉海景区景点临时关闭”“发布台风黄色预警”）。
level 只抄原文等级（如“黄色”“Ⅲ级”），没有写 null。area 抄原文的地区名（如某区、某市）；原文写“全市”时填发布机构所在城市名。scope 逐字抄原文的适用对象（如“所有涉海景区景点”“A级旅游景区”“客渡运航线”），没有写 null。named 列出原文逐一点名的景点或线路。
from 是原文明确的生效日期；原文没有日期时用该来源的 publishedAt。to 只填原文写明的结束或恢复日期，没有则 null。不要用查询日期代替。
places 对每个行程地点给出 exposure：coastal 海边、海岛、沙滩礁石、海堤、靠海渔村、跨海桥、码头、海上项目；mountain 登山、山顶观景、峡谷、悬崖栈道、索道；water 乘船游船、漂流、溪谷瀑布等涉水项目；outdoor 其他露天街区、公园、广场、古镇、寺庙园林；indoor 博物馆、展馆、室内场馆、餐厅、商场；transport 交通条目。exposureReason 用一句话说明依据。
covers 列出覆盖该地点的公告（advisory 为 advisories 数组下标）：named=公告原文点名了这个地点；scope=地点位于公告地区内并属于公告的适用对象（例如公告说某区所有涉海景区关闭，而该地点是该区的海边景点）；area=预警或应急响应的地区包含这个地点（海上、水上应急响应只覆盖涉海涉水地点）。地点不在公告地区或拿不准时不要列入。`,
    [{ type: 'input_text', text: JSON.stringify({ city, tripDates: dates, places, evidence: usable.map(e => ({ id: e.id, title: e.title, site: e.site, publishedAt: e.publishedAt, text: riskText(e) })) }) }], 6000);
  const ambiguities: string[] = [], facts: Fact[] = [], ids = new Map<number, Fact & { kind: 'advisory' }>();
  output.advisories.forEach((raw, index) => {
    const { evidenceId, quote, ...payload } = raw;
    const source = usable.find(e => e.id === evidenceId);
    const extracted = { evidenceId, quote, venueMatch: 'exact' as const, validFrom: null, validTo: null, kind: 'advisory' as const, payload };
    if (source && quoteMatches(quote, source)) {
      // A level or scope the page does not spell out is dropped rather than trusted.
      const context = quoteContext(quote, source);
      if (payload.level && !context.includes(normalizeQuote(payload.level).replace(/(?:预警|信号)$/, ''))) payload.level = null;
      if (payload.scope && !context.includes(normalizeQuote(payload.scope))) payload.scope = null;
    }
    if (!source || !factSupported(extracted, source)) { ambiguities.push('一条预警或关闭公告未通过原文、日期或地区核验，未用于判定。'); return; }
    const context = quoteContext(quote, source);
    extracted.payload.named = payload.named.filter(n => n.length >= 2 && context.includes(normalizeQuote(n)));
    const fact = { ...extracted, id: id(), venueId, quoteVerified: true, tier: source.tier, domain: new URL(source.finalUrl || source.url).hostname, publishedAt: source.publishedAt, retrievedAt: source.retrievedAt, linkStatus: source.linkStatus } as Fact & { kind: 'advisory' };
    facts.push(fact); ids.set(index, fact);
  });
  const mainName = (name: string) => name.replace(/[（(].*?[）)]/g, '').trim();
  const known = new Set(places.map(p => p.place));
  const risks: PlaceRisk[] = output.places.filter(p => known.has(p.place)).map(p => ({
    place: p.place, exposure: p.exposure, exposureReason: p.exposureReason,
    covers: p.covers.flatMap(c => {
      const fact = ids.get(c.advisory); if (!fact) return [];
      const source = usable.find(e => e.id === fact.evidenceId)!, context = quoteContext(fact.quote, source), name = mainName(p.place);
      const named = name.length >= 2 && (context.includes(normalizeQuote(name)) || fact.payload.named.some(n => n.includes(name) || name.includes(n)));
      return [{ factId: fact.id, how: c.how === 'named' && !named ? 'scope' as const : c.how, reason: c.reason }];
    }),
  }));
  return { facts, places: [...new Map(risks.map(r => [r.place, r])).values()], ambiguities };
}
