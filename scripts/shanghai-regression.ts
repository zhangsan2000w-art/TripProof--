import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Draft, Item, Trip, TripState } from '../lib/domain';
import type { ExtractionJob } from '../lib/extraction-types';

// Real HTTP calls only. This case never changes the four featured demo reports.
const base = (process.argv.find(a => a.startsWith('--base='))?.slice(7) || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const output = resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'artifacts/shanghai');
mkdirSync(output, { recursive: true });
const cookies = new Map<string, string>();
const save = (name: string, value: unknown) => writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
async function response(path: string, init: RequestInit = {}) {
  const result = await fetch(base + path, { ...init, redirect: 'manual', headers: { Origin: base, Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...init.headers }, signal: AbortSignal.timeout(25_000) });
  for (const raw of result.headers.getSetCookie()) { const entry = raw.split(';')[0], i = entry.indexOf('='); cookies.set(entry.slice(0, i), entry.slice(i + 1)); }
  return result;
}
async function request<T>(path: string, body?: unknown) {
  const result = await response(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await result.json().catch(() => null);
  assert(json && result.ok, `${path}: HTTP ${result.status} ${json?.code || 'INVALID_RESPONSE'}`);
  return json as T;
}
const password = process.env.ACCESS_PASSWORD;
if (password) {
  const login = await response('/api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password, next: '/' }).toString() });
  assert.equal(login.status, 303, '访问密码登录失败');
  assert.equal(login.headers.get('location'), '/', '访问密码未通过');
}
await request('/api/extract');
const text = readFileSync(new URL('../tests/fixtures/shanghai-itinerary.md', import.meta.url), 'utf8');
const requestId = crypto.randomUUID(), started = Date.now();
const submitted = await request<{ job: ExtractionJob }>('/api/extract', { text, images: [], background: true, requestId });
const submitMs = Date.now() - started;
assert.equal(submitted.job.id, requestId); assert(submitMs < 20_000, '提交请求仍被长模型调用阻塞');
console.log(`后台任务已提交：${submitMs} ms`);
let draft: Draft | null = null;
while (Date.now() - started < 330_000) {
  const { job } = await request<{ job: ExtractionJob }>(`/api/extract/${requestId}`);
  assert.notEqual(job.status, 'failed', `读取失败：${job.code}`);
  if (job.status === 'completed') { draft = job.draft; break; }
  await new Promise(resolve => setTimeout(resolve, 1800));
}
assert(draft, '读取任务未在期限内完成'); save('extract.json', { submitMs, elapsedMs: Date.now() - started, draft });
assert.deepEqual(draft.days.map(d => d.dayIndex), [1, 2]);
const items: Item[] = [];
for (const day of draft.days) for (const { dependsOnPrevious, ...raw } of day.items) {
  const previous = items.at(-1);
  items.push({ ...raw, id: crypto.randomUUID(), day: day.dayIndex, dependsOn: dependsOnPrevious && previous?.day === day.dayIndex ? [previous.id] : [] });
}
for (const name of ['豫园', '城隍庙', '南京路步行街', '外滩', '陆家嘴', '武康路', '新天地']) assert(items.some(i => i.placeName === name), `缺少独立地点：${name}`);
for (const name of ['上海博物馆', '东方明珠', '上海中心', '南翔小笼']) assert(!items.some(i => i.placeName === name), `把推荐虚构为安排：${name}`);
assert(!items.some(i => i.kind === 'transport' && /轮渡/.test(i.placeName)), '把可选轮渡误作已选路线');
for (const name of ['豫园', '城隍庙']) assert.equal(items.find(i => i.placeName === name)!.start, null, '联合时段被复制为各处到达时间');
for (const [name, start, end] of [['南京路步行街', '13:00', '16:00'], ['外滩', '16:00', '19:00'], ['陆家嘴', '19:00', '21:00'], ['武康路', '09:00', '12:00'], ['新天地', '14:00', '18:00']]) {
  const found = items.find(i => i.placeName === name)!; assert.equal(found.start, start); assert.equal(found.end, end);
}
console.log(`读取通过：${items.length} 项；开始真实搜索`);
const { trip } = await request<{ trip: Trip }>('/api/trips', { title: '上海两日攻略回归验收', startDate: '', destinationCity: '上海', originCity: '', arriveDay1: null, leaveLastDay: null, mode: 'transit', guidePublishedAt: draft.guideMeta.publishedAt, items });
const { runId } = await request<{ runId: string }>(`/api/trips/${trip.id}/runs`, {});
const investigation = Date.now(); let state!: TripState, progress = '';
while (Date.now() - investigation < 900_000) {
  state = await request<TripState>(`/api/trips/${trip.id}`);
  const next = `${state.run?.status} · ${state.run?.used}次新增搜索 · ${state.result?.dossiers.length || 0}份地点资料`;
  if (next !== progress) { console.log(next); progress = next; }
  if(state.run?.status==='waiting_user'){
    const question=state.agent?.questions.find(q=>!q.answered);
    await request(`/api/trips/${trip.id}/messages`,{requestId:crypto.randomUUID(),revision:state.trip.revision,text:'本次暂不补充缺失的时间或商家，请保留相应未知项，完成其余核验并汇总报告。',...(question?{replyTo:question.id}:{})});
    await new Promise(resolve=>setTimeout(resolve,1000));continue;
  }
  if (state.run && !['queued', 'running'].includes(state.run.status)) break;
  await new Promise(resolve => setTimeout(resolve, 4000));
}
save('state.json', state);
assert.equal(state.run?.status, 'completed', state.run?.error || '调查超时');
assert(state.result); assert(state.run.used <= 40);
const { dossiers, judgments } = state.result;
for (const name of ['豫园', '城隍庙']) {
  const d = dossiers.find(d => d.venue.key === `上海:${name}`);
  assert(d && d.evidence.length && d.facts.some(f => f.venueMatch === 'exact' && f.quoteVerified), `独立地点缺少可核验来源：${name}`);
}
for (const d of dossiers) {
  assert(d.calls.length <= 5, `单地点超出预算：${d.venue.canonicalName}`);
  for (const c of d.calls) if (!c.errorCode) assert(c.requestId, '成功检索缺少 RequestId');
  if (d.venue.key.startsWith('weather:')) { assert.equal(d.calls.length, 1); for (const f of d.facts) if (f.kind === 'weather') assert(d.venue.investigationDates.includes(f.payload.date), '天气日期错配'); }
}
for (const i of items.filter(i => i.kind === 'restaurant')) {
  const d = dossiers.find(d => d.venue.key === `上海:${i.placeName}`);
  assert.equal(d?.calls.length, 0, '未选商家消耗了检索预算');
  assert(judgments.some(j => j.itemId === i.id && j.reasonCode === 'UNSPECIFIED_BUSINESS' && j.verdict === 'unknown'));
}
const facts = dossiers.flatMap(d => d.facts);
for (const j of judgments.filter(j => j.verdict === 'confirmed' && ['open_on_date', 'hours_fit', 'reservation_rule'].includes(j.type))) for (const id of j.factIds) {
  const fact = facts.find(f => f.id === id); assert(fact?.quoteVerified && fact.venueMatch === 'exact', '确认使用了不匹配或未核验的事实');
}
assert(judgments.filter(j => j.type === 'availability').every(j => j.verdict === 'unknown'), '确认了实时库存');
const cursor = state.events[Math.floor(state.events.length / 2)]?.id || 0;
const stream = await response(`/api/runs/${runId}/events`, { headers: { 'Last-Event-ID': String(cursor) } });
assert.equal(stream.status, 200); const replay = await stream.text();
assert([...replay.matchAll(/^id: (\d+)/gm)].every(m => Number(m[1]) > cursor), 'SSE重连回放了游标之前的事件');
const report = await response(`/r/${trip.shareId}`); assert.equal(report.status, 200); assert((await report.text()).includes('豫园'));
const refreshed = await request<TripState>(`/api/trips/${trip.id}`); assert.equal(refreshed.run?.id, runId); assert.equal(refreshed.run?.status, 'completed');
const summary = { checkedAt: new Date().toISOString(), submitMs, items: items.length, searches: state.run.used, calls: dossiers.flatMap(d => d.calls).length, cachedCalls: dossiers.flatMap(d => d.calls).filter(c => c.cacheHit).length, investigationMs: Date.parse(state.run.completedAt!) - Date.parse(state.run.startedAt!), report: `${base}/r/${trip.shareId}`, assertions: '提取、来源隔离、时段保留、预算、RequestId、库存未知、SSE续接、刷新和报告通过' };
save('summary.json', summary); console.log(JSON.stringify(summary, null, 2));
