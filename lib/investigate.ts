import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cacheGet, cacheSet, emit, finishRun, getRun, getTrip, id, listCalls, saveCall, saveResult } from './store';
import { dateForDay, daysUntil, now } from './dates';
import type { Alternative, Dossier, Evidence, Item, Run, RunResult, Trip, SearchParams } from './domain';
import { emptyResult, kinds } from './domain';
import { searchPro } from './search/yuanbao';
import { verifyEvidence } from './evidence';
import { corroboratesClaim } from './announcements';
import { extractAdvisories, extractFacts, extractWeatherFacts, hasRiskWords, supportedDossierFacts } from './facts';
import { hazardWindowDays, judgeSafety, riskKey } from './risk';
import { judgeItem, judgeConnections, judgeWeather } from './judge';
import { rippleEffects, suggestions } from './impact';
import { AppError, errorMessage } from './errors';
import { redact, structured } from './llm';
import { mapLimit, Semaphore } from './concurrency';
import { searchName, selectVenueSources } from './source-selection';
import { searchAllowance } from './budget';
import { unresolvedTarget } from './itinerary';

const links = new Semaphore(8);
const models = new Semaphore(3);
function candidateDomain(pages: Evidence[], name: string) {
  const excluded = /(?:baidu|ctrip|bendibao|dianping|mafengwo|qunar|sohu|163|qq|sina|xiaohongshu|douyin|meituan)\./;
  const key = name.replace(/[（(].*?[）)]/g, '').replace(/博物馆|景区|公园/g, '');
  return pages.find(p => !excluded.test(p.site) && ((p.title.includes(key) && (/\.(?:gov|org)\.cn$/.test(p.site) || /官网|官方/.test(p.title))) || (pages.filter(other => other.site === p.site).length >= 2 && `${p.title} ${p.passage}`.includes(name))))?.site ?? null;
}
function venueId(key: string) { return createHash('sha256').update(key).digest('hex').slice(0, 24); }
export async function investigateVenue(runId: string, item: Item, city: string, dates: string[], cap = 5): Promise<Dossier> {
  const key = `${city}:${item.placeName}`, vid = venueId(key);
  const unresolved = unresolvedTarget(item);
  if (unresolved) return { venue: { id: vid, key, canonicalName: item.placeName, city, officialDomain: null, officialEvidenceId: null, investigationDates: dates }, facts: [], evidence: [], calls: [], searchedScope: [], limitations: [unresolved.message], createdAt: now() };
  const cacheKey = `dossier:v8:${key}:${[...dates].sort().join(',')}`;
  const cached = cacheGet<Dossier>(cacheKey);
  if (cached) {
    const d = structuredClone(cached), callMap = new Map<string, string>();
    d.facts = supportedDossierFacts(d);
    d.calls = d.calls.map(c => { const copy = { ...c, id: id(), cacheHit: true, cachedFrom: c.id, calledAt: now() }; callMap.set(c.id, copy.id); saveCall(runId, copy); emit(runId, 'search', copy); return copy; });
    for (const e of d.evidence) { e.searchCallId = callMap.get(e.searchCallId) ?? e.searchCallId; emit(runId, 'evidence', e); }
    for (const f of d.facts) emit(runId, 'fact', f);
    return d;
  }
  const dossier: Dossier = { venue: { id: vid, key, canonicalName: item.placeName, city, officialDomain: null, officialEvidenceId: null, investigationDates: dates }, facts: [], evidence: [], calls: [], searchedScope: [], limitations: [], createdAt: now() };
  const venueCalls = { used: 0 }, pages: Evidence[] = [];
  if (cap < 1) { dossier.limitations.push('本次搜索额度已分给其他地点，这一站未检索；可以单独重新检查。'); return dossier; }
  const search = async (params: SearchParams) => {
    dossier.searchedScope.push(`${params.query}${params.site ? ` · 站点 ${params.site}` : ''}${params.freshness ? ` · 时间范围 ${params.freshness}` : ''}`);
    try { const r = await searchPro(runId, vid, params, venueCalls); pages.push(...r.pages); return r.pages; }
    catch (error) { dossier.limitations.push(error instanceof AppError ? error.message : '该次搜索未完成。'); return []; }
  };
  const transport = item.kind === 'transport', mainName = searchName(item.placeName);
  const qname = redact(searchName(item.placeName, transport)), qcity = redact(city);
  const first = await search({ query: `${qcity} ${qname} ${item.kind === 'transport' ? '运营时间 首末班' : '开放时间 闭馆'}` });
  const domain = candidateDomain(first, mainName);
  const month = dates[0]?.slice(0, 7).replace('-', '年') + '月';
  // Follow-ups in order of value, cut to this stop's share of the budget.
  const followups: SearchParams[] = [
    { query: `${qcity} ${qname} ${item.kind === 'transport' ? '停运 运营调整' : '临时闭馆'} ${month}`, freshness: 'm2', industry: 'news' },
    ...(['museum', 'scenic', 'show'].includes(item.kind) ? [{ query: `${qcity} ${qname} 预约 提前 放票`, ...(domain ? { site: domain } : {}) }] : []),
    ...(domain ? [{ query: `${qname} 闭馆 公告`, site: domain, freshness: 'm3' }] : []),
  ].slice(0, Math.max(0, cap - 1));
  await Promise.all(followups.map(search));
  // Verify a bounded set of URLs, rather than opening every search hit.
  const selected = selectVenueSources(pages, item.placeName, city, domain, 8, transport);
  dossier.evidence = await mapLimit(selected, 4, e => links.run(() => verifyEvidence(e, mainName)));
  for (const e of dossier.evidence) emit(runId, 'evidence', e);
  try {
    const output = await models.run(() => extractFacts(vid, item.placeName, city, dates, dossier.evidence));
    dossier.venue.canonicalName = output.canonicalName; dossier.venue.officialDomain = output.officialDomain; dossier.venue.officialEvidenceId = output.officialEvidenceId;
    dossier.facts = output.facts; dossier.limitations.push(...output.ambiguities);
    const missingEntry = ['museum', 'scenic', 'show'].includes(item.kind) && !output.facts.some(f => f.kind === 'temp_hours' && f.payload.lastEntry || f.kind === 'hours' && f.payload.seasons.some(s => s.lastEntry));
    if ((!output.facts.some(f => f.tier <= 2 && f.linkStatus === 'ok') || missingEntry) && venueCalls.used < cap && getRun(runId).used < getRun(runId).limit) {
      const more = await search({ query: missingEntry ? `${qcity} ${qname} 营业时间 停止入园 停止售票` : `${qcity} ${qname} 官方 参观须知 开放时间` });
      const extras = selectVenueSources(more.filter(p => !dossier.evidence.some(e => e.url === p.url)), item.placeName, city, domain, 3, transport);
      if (extras.length) {
        const verified = await mapLimit(extras, 2, e => links.run(() => verifyEvidence(e, mainName)));
        dossier.evidence.push(...verified); for (const e of verified) emit(runId, 'evidence', e);
        const retry = await models.run(() => extractFacts(vid, item.placeName, city, dates, dossier.evidence));
        dossier.facts = retry.facts; dossier.venue.officialDomain = retry.officialDomain; dossier.venue.officialEvidenceId = retry.officialEvidenceId; dossier.limitations.push(...retry.ambiguities);
      }
    }
  } catch (error) { dossier.limitations.push(errorMessage(error)); }
  dossier.calls = listCalls(runId).filter(c => c.venueId === vid);
  dossier.limitations = [...new Set(dossier.limitations)];
  for (const fact of dossier.facts) emit(runId, 'fact', fact);
  if (dossier.facts.length) cacheSet(cacheKey, dossier);
  return dossier;
}
async function investigateWeather(runId: string, city: string, date: string): Promise<Dossier> {
  const key = `weather:${city}:${date}`, vid = venueId(key);
  const d: Dossier = { venue: { id: vid, key, canonicalName: `${city}天气`, city, officialDomain: null, officialEvidenceId: null, investigationDates: [date] }, evidence: [], facts: [], calls: [], searchedScope: [], limitations: [], createdAt: now() };
  if (daysUntil(date) < 0 || daysUntil(date) > 7) return d;
  const query = `${redact(city)} ${date} 天气 预报`;
  d.searchedScope.push(`${query} · 最近2天`);
  try {
    const response = await searchPro(runId, vid, { query, freshness: 'd2' }, { used: 0 });
    d.calls.push(response.call);
    d.evidence = await mapLimit(response.pages.slice(0, 3), 3, e => links.run(() => verifyEvidence(e, city)));
    for (const e of d.evidence) emit(runId, 'evidence', e);
    d.facts = await models.run(() => extractWeatherFacts(vid, city, date, d.evidence));
    for (const f of d.facts) emit(runId, 'fact', f);
  } catch (error) { d.limitations.push(errorMessage(error)); }
  return d;
}
/** Search a city's warnings, emergency responses and area-wide closures for the trip dates. */
async function searchRisk(runId: string, city: string, dates: string[]): Promise<Dossier> {
  const key = riskKey(city), vid = venueId(`${key}:${dates.join(',')}`);
  const d: Dossier = { venue: { id: vid, key, canonicalName: `${city}预警与区域公告`, city, officialDomain: null, officialEvidenceId: null, investigationDates: dates }, evidence: [], facts: [], calls: [], searchedScope: [], limitations: [], createdAt: now(), places: [] };
  const window = dates.filter(date => daysUntil(date) >= 0 && daysUntil(date) <= hazardWindowDays);
  if (!window.length) { d.limitations.push(`行程日期不在未来${hazardWindowDays}天内，预警和临时关闭公告要临近出发再查。`); return d; }
  const qcity = redact(city), md = (v: string) => `${Number(v.slice(5, 7))}月${Number(v.slice(8))}日`;
  const queries: SearchParams[] = [
    { query: `${qcity} 台风 暴雨 预警 ${md(window[0])}`, freshness: 'd7' },
    { query: `${qcity} 景区 临时关闭 停运 公告`, freshness: 'd7', industry: 'news' },
  ];
  const calls = { used: 0 }, pages: Evidence[] = [];
  await Promise.all(queries.map(async params => {
    d.searchedScope.push(`${params.query} · 最近7天`);
    try { pages.push(...(await searchPro(runId, vid, params, calls)).pages); }
    catch (error) { d.limitations.push(error instanceof AppError ? error.message : '预警搜索未完成。'); }
  }));
  const place = city.replace(/市$/, '');
  const candidates = [...new Map(pages.filter(hasRiskWords).map(p => [p.url, p])).values()]
    .sort((a, b) => Number(`${b.title}${b.passage}`.includes(place)) - Number(`${a.title}${a.passage}`.includes(place)));
  d.evidence = await mapLimit(candidates.slice(0, 6), 4, e => links.run(() => verifyEvidence(e, place)));
  for (const e of d.evidence) emit(runId, 'evidence', e);
  d.calls = listCalls(runId).filter(c => c.venueId === vid);
  return d;
}
/** Read the notices once per city, together with any found while checking venues and weather. */
async function readRisk(runId: string, trip: Trip, risk: Dossier, dossiers: Dossier[]) {
  const city = risk.venue.city, dates = risk.venue.investigationDates;
  if (!dates.some(date => daysUntil(date) >= 0 && daysUntil(date) <= hazardWindowDays)) return;
  const items = trip.items.filter(i => (i.city || trip.destinationCity) === city);
  const places = [...new Map(items.map(i => [i.placeName, { place: i.placeName, kind: i.kind, note: `${i.activity} ${i.sourceText}`.replace(/\s+/g, ' ').slice(0, 120) }])).values()];
  const notice = /台风|暴雨|暴雪|预警|应急响应|临时关闭|暂时关闭|暂停开放|停航|停运|封闭/;
  const recent = (e: Evidence) => !e.publishedAt || daysUntil(e.publishedAt) >= -30;
  const found = dossiers.filter(d => d !== risk && d.venue.city === city).flatMap(d => d.evidence)
    .filter(e => e.linkStatus !== 'broken' && recent(e) && notice.test(`${e.title} ${e.passage}`));
  const pool = [...new Map([...risk.evidence, ...found].map(e => [e.url, e])).values()]
    .sort((a, b) => a.tier - b.tier || Number(notice.test(b.title)) - Number(notice.test(a.title)) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 14);
  if (!pool.length) return;
  try {
    const out = await models.run(() => extractAdvisories(risk.venue.id, city, dates, places, pool));
    risk.facts = out.facts; risk.places = out.places; risk.limitations.push(...new Set(out.ambiguities));
    // Keep every cited page in this dossier so the report can open it.
    const cited = new Set(out.facts.map(f => f.evidenceId));
    risk.evidence = [...risk.evidence, ...pool.filter(e => cited.has(e.id) && !risk.evidence.some(x => x.id === e.id))];
    for (const f of risk.facts) emit(runId, 'fact', f);
  } catch (error) { risk.limitations.push(`预警和区域公告未能读取：${errorMessage(error)}`); }
}
async function mainInvestigation(run: Run, trip: Trip): Promise<RunResult> {
  const result = emptyResult();
  const groups = new Map<string, Item[]>();
  for (const item of trip.items) { const key = `${item.city || trip.destinationCity}:${item.placeName}`; groups.set(key, [...(groups.get(key) ?? []), item]); }
  const tasks = [...groups.values()].sort((a, b) => (a[0].kind === 'museum' ? -1 : 0) - (b[0].kind === 'museum' ? -1 : 0));
  emit(run.id, 'plan', { message: `调查 ${groups.size} 个地点的开放、入场和预约规则，同时查目的地的临时关闭公告，最后按你的日期与时段计算。`, venues: tasks.map(items => items[0].placeName), limit: run.limit });
  // Safety searches start first, so a long venue list cannot use up the budget before them.
  const cityDates = new Map<string, Set<string>>();
  for (const item of trip.items) { const city = item.city || trip.destinationCity; cityDates.set(city, (cityDates.get(city) ?? new Set()).add(dateForDay(trip.startDate, item.day))); }
  const risks = Promise.all([...cityDates].map(([city, dates]) => searchRisk(run.id, city, [...dates].sort())));
  const inWindow = (date: string) => daysUntil(date) >= 0 && daysUntil(date) <= 7;
  const reserved = [...cityDates.values()].filter(dates => [...dates].some(inWindow)).length * 2
    + new Set(trip.items.filter(i => (i.kind === 'scenic' || /户外|登山|游船|步行|日落/.test(i.activity)) && inWindow(dateForDay(trip.startDate, i.day))).map(i => `${i.city || trip.destinationCity}:${i.day}`)).size;
  const searchable = tasks.filter(t => !unresolvedTarget(t[0]));
  const allowance = searchAllowance(searchable.map(t => t[0]), run.limit - reserved);
  const caps = new Map(searchable.map((items, n) => [items, allowance[n]]));
  await mapLimit(tasks, 3, async items => {
    const item = items[0], city = item.city || trip.destinationCity;
    const dates = [...new Set(items.map(i => dateForDay(trip.startDate, i.day)))];
    const dossier = await investigateVenue(run.id, item, city, dates, caps.get(items));
    result.dossiers.push(dossier);
    for (const current of items) {
      const judgments = judgeItem(current, trip, dossier);
      result.judgments.push(...judgments); for (const judgment of judgments) emit(run.id, 'verdict', judgment);
    }
    saveResult(run.id, result);
  });
  const weatherGroups = new Map<string, { city: string; date: string; items: Item[] }>();
  for (const item of trip.items.filter(i => i.kind === 'scenic' || /户外|登山|游船|步行|日落/.test(i.activity))) {
    const city = item.city || trip.destinationCity, date = dateForDay(trip.startDate, item.day), key = `${city}:${date}`;
    const group = weatherGroups.get(key) ?? { city, date, items: [] }; group.items.push(item); weatherGroups.set(key, group);
  }
  await mapLimit([...weatherGroups.values()], 2, async group => {
    const dossier = await investigateWeather(run.id, group.city, group.date); result.dossiers.push(dossier);
    for (const item of group.items) { const judgment = judgeWeather(item, trip, dossier); result.judgments.push(judgment); emit(run.id, 'verdict', judgment); }
    saveResult(run.id, result);
  });
  for (const risk of await risks) {
    await readRisk(run.id, trip, risk, result.dossiers); result.dossiers.push(risk);
    for (const item of trip.items.filter(i => (i.city || trip.destinationCity) === risk.venue.city)) {
      const judgment = judgeSafety(item, trip, risk);
      if (judgment) { result.judgments.push(judgment); emit(run.id, 'verdict', judgment); }
    }
    saveResult(run.id, result);
  }
  for (const judgment of judgeConnections(trip,result.dossiers)) { result.judgments.push(judgment); emit(run.id,'verdict',judgment); }
  result.ripples = rippleEffects(trip, result.judgments); for (const ripple of result.ripples) emit(run.id, 'ripple', ripple);
  result.suggestions = suggestions(trip, result.dossiers, result.judgments); for (const suggestion of result.suggestions) emit(run.id, 'suggestion', suggestion);
  result.limitations = [...new Set(result.dossiers.flatMap(d => d.limitations))];
  return result;
}
export const announcementSchema = z.object({ title: z.string(), venueName: z.string(), city: z.string(), claims: z.array(z.object({ text: z.string(), quote: z.string().max(80), kind: z.enum(['closure', 'hours', 'reservation', 'other']) })).min(1).max(8) });
export async function readAnnouncement(text: string, images: { data: string; sourceIndex: number }[]) {
  return structured('extract', announcementSchema, '读取用户上传的公告，提取场馆、城市及公告明确说法，不判断真伪。quote必须逐字复制图片或文字，最多80字符。不输出个人信息。', [{ type: 'input_text', text: redact(text) || '请读取公告图片。' }, ...images.map(image => ({ type: 'input_image' as const, image_url: image.data, detail: 'high' as const }))], 4000);
}
async function investigateAnnouncement(run: Run, trip: Trip): Promise<RunResult> {
  const result = emptyResult(), announcement = announcementSchema.parse(run.input.announcement);
  const target = trip.items.find(i => i.placeName.includes(announcement.venueName) || announcement.venueName.includes(i.placeName));
  const item: Item = target ?? { ...trip.items[0], id: id(), placeName: announcement.venueName, city: announcement.city || trip.destinationCity, kind: 'museum' };
  const dossier = await investigateVenue(run.id, item, item.city || trip.destinationCity, [dateForDay(trip.startDate, item.day)]);
  result.dossiers.push(dossier);
  // A screenshot alone is never upgraded to a verified announcement.
  const corroborated = announcement.claims.every(c => dossier.facts.some(f => corroboratesClaim(c,f)));
  result.announcement = { title: announcement.title, claims: announcement.claims.map(c => c.text), verdict: corroborated ? 'confirmed' : 'unknown', explanation: corroborated ? '公告中的关键说法在独立检索到的官方或权威原文中得到逐字佐证。' : '已读取公告说法，但未找到足够的独立来源逐字佐证。截图中的“官方”标识不能单独证明真实性。', evidenceIds: corroborated ? dossier.facts.filter(f => f.tier <= 2 && f.linkStatus === 'ok').map(f => f.evidenceId) : dossier.evidence.map(e => e.id) };
  return result;
}
async function investigateAlternatives(run: Run, trip: Trip): Promise<RunResult> {
  const result = emptyResult(), target = trip.items.find(i => i.id === run.input.itemId);
  if (!target) throw new AppError('ITEM_NOT_FOUND', '找不到需要替代的行程项。', 404);
  const city = target.city || trip.destinationCity, vid = venueId(`alternatives:${city}:${target.placeName}`);
  emit(run.id, 'plan', { message: `寻找「${target.placeName}」的同城替代场馆，并独立核查。` });
  const response = await searchPro(run.id, vid, { query: `${redact(city)} ${target.kind === 'museum' ? '博物馆' : target.kind === 'show' ? '演出场馆' : '景点'} ${target.kind === 'museum' ? '参观' : '游览'} 开放` }, { used: 0 });
  const candidatesSchema = z.object({ candidates: z.array(z.object({ name: z.string(), city:z.string(),kind:z.enum(kinds), reason: z.string(), sourceIndex: z.number().int().min(0) })).max(2) });
  const candidates = await models.run(() => structured('fact', candidatesSchema, '从搜索资料中选择最多两个同城同类的真实替代场馆，不能选择原场馆，不要推断距离、可达性或可预约库存。sourceIndex必须是搜索结果索引。没有合适候选返回空数组。', [{ type: 'input_text', text: JSON.stringify({ city, original: target.placeName, kind: target.kind, sources: response.pages.map((p, index) => ({ index, title: p.title, text: p.passage, url: p.url })) }) }], 2000));
  const unique=[...new Map(candidates.candidates.map(c=>[c.name,c])).values()];
  await mapLimit(unique.filter(c => c.name !== target.placeName && c.city.replace(/市$/,'')===city.replace(/市$/,'') && c.kind===target.kind && response.pages[c.sourceIndex] && `${response.pages[c.sourceIndex].title} ${response.pages[c.sourceIndex].passage}`.includes(c.name)), 2, async candidate => {
    const item = { ...target, id: `alt-${id()}`, placeName: candidate.name, sourceText: candidate.name, claimedRules: [], dependsOn: [] };
    const dossier = await investigateVenue(run.id, item, city, [dateForDay(trip.startDate, item.day)]);
    const judgments = judgeItem(item, trip, dossier); for (const judgment of judgments) emit(run.id, 'verdict', judgment);
    const alternative: Alternative = { itemId: target.id, name: candidate.name, reason: candidate.reason, dossier, judgments };
    result.dossiers.push(dossier); result.alternatives.push(alternative);
  });
  if (!result.alternatives.length) result.limitations.push('未检索到能独立核查的同城候选场馆，未生成替代推荐。');
  return result;
}
export async function executeRun(run: Run) {
  let result = run.result ?? emptyResult();
  const heartbeat = setInterval(() => { try { emit(run.id, 'budget', { used: getRun(run.id).used, limit: run.limit, heartbeat: true }); } catch { /* Worker shutdown. */ } }, 20000);
  try {
    const trip = getTrip(run.tripId);
    if (trip.revision !== run.tripRevision) throw new AppError('TRIP_CHANGED', '行程在调查启动前发生修改，请重新检查。', 409);
    result = run.kind === 'announcement' ? await investigateAnnouncement(run, trip) : run.kind === 'alternatives' ? await investigateAlternatives(run, trip) : await mainInvestigation(run, trip);
    finishRun(run.id, result);
  } catch (error) { result = getRun(run.id).result ?? result; finishRun(run.id, result, errorMessage(error)); }
  finally { clearInterval(heartbeat); }
}
