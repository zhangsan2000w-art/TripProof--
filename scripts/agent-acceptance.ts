import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Draft, Item, Trip, TripState } from '../lib/domain';
import type { ExtractionJob } from '../lib/extraction-types';
import { quoteMatches } from '../lib/evidence';
import { testAccessCookie } from './test-access';

// Run against an isolated, initially empty DATABASE_PATH for a cold/warm pair.
// This script uses HTTP only; browser layout and interaction are checked separately.
const base = (process.env.APP_URL || 'http://127.0.0.1:3016').replace(/\/$/, '');
const output = process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'artifacts/agent-six-stops';
const date = process.argv.find(a => a.startsWith('--date='))?.slice(7) || '2026-10-27';
const access = await testAccessCookie(base);
let owner = '';
await mkdir(output, { recursive: true });
async function response(path: string, body?: unknown, cookie = owner) {
  const r = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, Cookie: [access, cookie].filter(Boolean).join('; '), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000) });
  if (cookie === owner) { const set = r.headers.getSetCookie().find(c => c.startsWith('tp_session=')); if (set) owner = set.split(';')[0]; }
  return r;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await response(path, body), data = await r.json();
  assert(r.ok, `${path}: ${r.status} ${data.code || ''}`); return data;
}
const text = '杭州一日行程\n09:00—10:00 中国丝绸博物馆\n10:30—11:30 雷峰塔\n12:00—12:30 西湖\n13:00—13:30 河坊街\n14:00—14:30 断桥残雪\n15:00—16:00 灵隐寺';
const names = ['中国丝绸博物馆', '雷峰塔', '西湖', '河坊街', '断桥残雪', '灵隐寺'];
const reports: Record<string, unknown>[] = [];
let last!: TripState;
for (const mode of ['cold', 'warm']) {
  await request('/api/extract');
  const began = Date.now(), requestId = crypto.randomUUID();
  await request('/api/extract', { text, images: [], background: true, requestId });
  let draft: Draft | null = null;
  while (Date.now() - began < 330_000) {
    const { job } = await request<{ job: ExtractionJob }>(`/api/extract/${requestId}`);
    assert.notEqual(job.status, 'failed', `提取失败：${job.code}`);
    if (job.status === 'completed') { draft = job.draft; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(draft, '提取超时'); const extractionMs = Date.now() - began;
  const items: Item[] = [];
  for (const day of draft.days) for (const { dependsOnPrevious, ...raw } of day.items) {
    const prev = items.at(-1); items.push({ ...raw, id: crypto.randomUUID(), day: day.dayIndex, dependsOn: dependsOnPrevious && prev ? [prev.id] : [] });
  }
  assert.equal(items.length, 6); for (const name of names) assert(items.some(i => i.placeName.includes(name)));
  assert(items.every(i => i.start && i.end), '没有保留明确时段');
  const { trip } = await request<{ trip: Trip }>('/api/trips', { title: `六站 Agent 性能验收 · ${mode}`, startDate: date, destinationCity: '杭州', originCity: '', arriveDay1: null, leaveLastDay: null, mode: 'transit', guidePublishedAt: null, items });
  const { runId } = await request<{ runId: string }>(`/api/trips/${trip.id}/runs`, {});
  const started = Date.now(); let state!: TripState;
  do {
    state = await request<TripState>(`/api/trips/${trip.id}`);
    if (state.run?.status === 'waiting_user') {
      const q = state.agent?.questions.find(q => !q.answered);
      await request(`/api/trips/${trip.id}/messages`, { requestId: crypto.randomUUID(), revision: state.trip.revision, text: '其余信息暂不补充，保留未知并完成核验。', ...(q ? { replyTo: q.id } : {}) });
    }
    assert(Date.now() - started < 900_000, '调查超时');
    if (state.run && !['queued', 'running', 'waiting_user'].includes(state.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  } while (true);
  assert.equal(state.run?.status, 'completed', state.run?.error || '调查未完成'); assert(state.result && state.run);
  const facts = state.result.dossiers.flatMap(d => d.facts), evidence = state.result.dossiers.flatMap(d => d.evidence), calls = state.result.dossiers.flatMap(d => d.calls);
  for (const f of facts) assert(f.quoteVerified && f.venueMatch === 'exact' && evidence.some(e => e.id === f.evidenceId && quoteMatches(f.quote, e)), `无效事实 ${f.id}`);
  assert(state.result.judgments.filter(j => j.type === 'availability').every(j => j.verdict === 'unknown'));
  assert(state.run.used <= 40); assert(state.run.firstVerdictAt, '没有有依据的有效结果');
  for (const d of state.result.dossiers) assert(d.calls.filter(c => !c.cacheHit).length <= 5, `场馆预算超限 ${d.venue.key}`);
  assert(calls.some(c => c.requestId && !c.errorCode));
  const cursor = state.events[Math.floor(state.events.length / 2)]?.id || 0;
  const stream = await response(`/api/runs/${runId}/events?after=${cursor}`), replay = await stream.text();
  assert.equal(stream.status, 200); assert([...replay.matchAll(/^id: (\d+)/gm)].every(m => Number(m[1]) > cursor));
  const report = { mode, tripId: trip.id, runId, extractionMs, queueMs: Date.parse(state.run.startedAt!) - Date.parse(state.run.createdAt), firstVerdictMs: Date.parse(state.run.firstVerdictAt) - Date.parse(state.run.startedAt!), activeMs: state.agent?.elapsedMs, investigationWallMs: Date.parse(state.run.completedAt!) - Date.parse(state.run.startedAt!), searches: state.run.used, cachedCalls: calls.filter(c => c.cacheHit).length, verifiedFacts: facts.length, phases: state.events.filter(e => e.type === 'agent_progress').map(e => e.data), report: `${base}/r/${trip.shareId}` };
  reports.push(report); last = state;
  await writeFile(`${output}/${mode}.json`, JSON.stringify({ ...report, draft, state }, null, 2));
  console.log(JSON.stringify({ ...report, phases: undefined }));
}
// Exercise real HTTP contracts without another search: append and cancel a queued
// local-only explanation. Unit tests separately exercise interrupted tool recovery.
const path = `/api/trips/${last.trip.id}/messages`, input = { requestId: crypto.randomUUID(), revision: last.trip.revision, text: '私有对话验收标记：只用已有事实解释雷峰塔依据，不要联网。' };
const first = await request<{ messageId: string; runId: string }>(path, input), repeated = await request(path, input);
assert.deepEqual(repeated, first);
assert.equal((await response(path, { ...input, text: '另一条内容' })).status, 409);
assert.equal((await response(path, undefined, 'unrelated-owner=1')).status, 404);
assert.equal((await response(`/api/runs/${first.runId}/cancel`, {}, 'unrelated-owner=1')).status, 404);
await request(`/api/runs/${first.runId}/cancel`, {}); await request(`/api/runs/${first.runId}/cancel`, {});
const cancelled = await request<TripState>(`/api/trips/${last.trip.id}`); assert.equal(cancelled.run?.status, 'cancelled'); assert.equal(cancelled.run.used, 0); assert(cancelled.result?.dossiers.length);
const publicResponse = await response(`/r/${last.trip.shareId}`), html = await publicResponse.text();
assert.equal(publicResponse.status, 200); assert(!html.includes('私有对话验收标记'));
await writeFile(`${output}/summary.json`, JSON.stringify({ testedAt: new Date().toISOString(), reports, contracts: 'UUID幂等、冲突UUID、跨owner拒绝、取消幂等、证据保留、公开报告不含私聊、SSE游标续接通过' }, null, 2));
console.log('Agent HTTP contracts PASS');
