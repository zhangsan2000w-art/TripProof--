import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { and, desc, eq, gt, asc } from 'drizzle-orm';
import { database } from '@/db';
import * as s from '@/db/schema';
import type { Trip, TripInput, Run, RunKind, RunResult, EventType, TripState, Guide, GuideSummary } from './domain';
import { emptyResult } from './domain';
import { now, today } from './dates';
import { AppError } from './errors';
import { agentView } from './agent-store';

export const id = () => randomUUID();
export const token = () => randomBytes(24).toString('base64url');
export const ownerHash = (session: string) => createHash('sha256').update(session).digest('hex');
export function createTrip(input: TripInput, owner: string, guide: Guide | null = null): Trip {
  const trip: Trip = { ...input, id: id(), shareId: token(), createdAt: now(), updatedAt: now(), revision: 1 };
  const { db } = database();
  db.transaction(tx => {
    tx.insert(s.trips).values({ id: trip.id, shareId: trip.shareId, owner, body: trip, updatedAt: trip.updatedAt }).run();
    for (const item of trip.items) tx.insert(s.items).values({ id: `${trip.id}:${item.id}`, tripId: trip.id, payload: item }).run();
    if (guide) saveGuide(trip.id, guide);
  });
  return trip;
}

/** Keep the submitted guide beside the trip; images are stored as bytes, served one at a time. */
export function saveGuide(tripId: string, guide: Guide) {
  const { sqlite } = database();
  sqlite.prepare('INSERT INTO guides (trip_id, text) VALUES (?, ?) ON CONFLICT(trip_id) DO UPDATE SET text = excluded.text').run(tripId, guide.text);
  sqlite.prepare('DELETE FROM guide_images WHERE trip_id = ?').run(tripId);
  const insert = sqlite.prepare('INSERT INTO guide_images (trip_id, idx, mime, data) VALUES (?, ?, ?, ?)');
  for (const image of guide.images) {
    const [, mime, data] = image.data.match(/^data:(image\/[a-z]+);base64,(.*)$/)!;
    insert.run(tripId, image.sourceIndex, mime, Buffer.from(data, 'base64'));
  }
}
export function guideSummary(tripId: string): GuideSummary | null {
  const { sqlite } = database();
  const row = sqlite.prepare('SELECT text FROM guides WHERE trip_id = ?').get(tripId) as { text: string } | undefined;
  if (!row) return null;
  const images = (sqlite.prepare('SELECT idx FROM guide_images WHERE trip_id = ? ORDER BY idx').all(tripId) as { idx: number }[]).map(r => r.idx);
  return { text: row.text, images };
}
export function guideImage(tripId: string, index: number) {
  const row = database().sqlite.prepare('SELECT mime, data FROM guide_images WHERE trip_id = ? AND idx = ?').get(tripId, index) as { mime: string; data: Buffer } | undefined;
  return row ?? null;
}
export function exportGuide(tripId: string): Guide | null {
  const summary = guideSummary(tripId);
  if (!summary) return null;
  return { text: summary.text, images: summary.images.map(n => { const image = guideImage(tripId, n)!; return { sourceIndex: n, data: `data:${image.mime};base64,${image.data.toString('base64')}` }; }) };
}
export function getTrip(tripId: string, owner?: string) {
  const row = database().db.select().from(s.trips).where(eq(s.trips.id, tripId)).get();
  if (!row || (owner !== undefined && row.owner !== owner)) throw new AppError('NOT_FOUND', '行程不存在，或当前浏览器没有访问权限。', 404);
  return row.body;
}
export function getSharedTrip(shareId: string) { return database().db.select().from(s.trips).where(eq(s.trips.shareId, shareId)).get()?.body ?? null; }
export function updateTrip(trip: Trip) {
  const { db } = database();
  db.transaction(tx => {
    tx.update(s.trips).set({ body: trip, updatedAt: now() }).where(eq(s.trips.id, trip.id)).run();
    tx.delete(s.items).where(eq(s.items.tripId, trip.id)).run();
    for (const item of trip.items) tx.insert(s.items).values({ id: `${trip.id}:${item.id}`, tripId: trip.id, payload: item }).run();
  });
}
export function getRun(runId: string): Run {
  const run = database().db.select().from(s.runs).where(eq(s.runs.id, runId)).get();
  if (!run) throw new AppError('NOT_FOUND', '调查任务不存在。', 404);
  return run;
}
export function createRun(trip: Trip, kind: RunKind = 'investigation', input: Record<string, unknown> = {}, status: Run['status'] = 'queued'): Run {
  const { db, sqlite } = database();
  return sqlite.transaction(() => {
    const active = db.select().from(s.runs).where(and(eq(s.runs.tripId, trip.id), eq(s.runs.status, 'running'))).get()
      ?? db.select().from(s.runs).where(and(eq(s.runs.tripId, trip.id), eq(s.runs.status, 'queued'))).get()
      ?? db.select().from(s.runs).where(and(eq(s.runs.tripId, trip.id), eq(s.runs.status, 'waiting_user'))).get();
    if (active) throw new AppError('RUN_ACTIVE', '这份行程正在调查，请等待当前任务结束。', 409);
    const run: Run = { id: id(), tripId: trip.id, kind, status, createdAt: now(), updatedAt: now(), startedAt: null, completedAt: null, firstVerdictAt: null, used: 0, limit: 40, input, result: emptyResult(), error: null, tripRevision: trip.revision };
    db.insert(s.runs).values(run).run();
    return run;
  })();
}
export function saveRecalculation(trip: Trip, result: RunResult, previousRevision: number) {
  database().sqlite.transaction(() => {
    if (getTrip(trip.id).revision !== previousRevision) throw new AppError('STALE_REVISION', '行程已更新，请刷新后重试。', 409);
    // Completed calculations must never enter the worker's search queue.
    const run = createRun(trip, 'investigation', {}, 'completed');
    updateTrip(trip);
    for (const judgment of result.judgments) emit(run.id, 'verdict', judgment);
    finishRun(run.id, result);
  }).immediate();
}
export function claimRun(): Run | null {
  const { db, sqlite } = database();
  return sqlite.transaction(() => {
    const run = db.select().from(s.runs).where(eq(s.runs.status, 'queued')).orderBy(asc(s.runs.createdAt)).get();
    if (!run) return null;
    db.update(s.runs).set({ status: 'running', startedAt: run.startedAt ?? now(), updatedAt: now() }).where(and(eq(s.runs.id, run.id), eq(s.runs.status, 'queued'))).run();
    return getRun(run.id);
  })();
}
export function emit(runId: string, type: EventType, data: unknown) {
  const { db } = database();
  db.insert(s.events).values({ runId, type, data, at: now() }).run();
  const judgment=type==='verdict'?data as import('./domain').Judgment:null;
  const run=getRun(runId);
  const meaningful=judgment&&!run.firstVerdictAt&&['open_on_date','hours_fit','reservation_rule','service_hours','guide_claim'].includes(judgment.type)
    &&getTrip(run.tripId).items.some(i=>i.id===judgment.itemId)
    &&run.result?.dossiers.some(d=>d.facts.some(f=>judgment.factIds.includes(f.id)&&f.quoteVerified&&f.venueMatch==='exact'&&f.linkStatus==='ok'
      &&d.evidence.some(e=>e.id===f.evidenceId&&e.linkStatus==='ok'&&judgment.evidenceIds.includes(e.id))));
  db.update(s.runs).set({ updatedAt: now(), ...(meaningful ? { firstVerdictAt: now() } : {}) }).where(eq(s.runs.id, runId)).run();
}
export function readEvents(runId: string, after = 0) { return database().db.select().from(s.events).where(and(eq(s.events.runId, runId), gt(s.events.id, after))).orderBy(asc(s.events.id)).all(); }
export function saveResult(runId: string, result: RunResult) {
  const { db } = database();
  db.transaction(tx => {
    tx.update(s.runs).set({ result, updatedAt: now() }).where(eq(s.runs.id, runId)).run();
    const groups = [
      [s.venues, result.dossiers.map(d => d.venue)], [s.evidence, result.dossiers.flatMap(d => d.evidence)],
      [s.facts, result.dossiers.flatMap(d => d.facts)], [s.judgments, result.judgments], [s.suggestions, result.suggestions],
    ] as const;
    for (const [table, rows] of groups) for (const row of rows) tx.insert(table).values({ id: row.id, runId, payload: row }).onConflictDoUpdate({ target: [table.runId, table.id], set: { payload: row } }).run();
  });
}
export function finishRun(runId: string, result: RunResult, error: string | null = null) {
  if (getRun(runId).status === 'cancelled') return;
  saveResult(runId, result);
  database().db.update(s.runs).set({ status: error ? 'failed' : 'completed', completedAt: now(), updatedAt: now(), error, input: {} }).where(eq(s.runs.id, runId)).run();
  emit(runId, error ? 'error' : 'done', { message: error ?? '调查完成', used: getRun(runId).used });
}
export function recoverInterruptedRuns() {
  const { db } = database();
  const cutoff = new Date(Date.now() - 180_000).toISOString();
  for (const run of db.select().from(s.runs).where(eq(s.runs.status, 'running')).all()) {
    if (run.updatedAt < cutoff) {
      const resumable = database().sqlite.prepare('SELECT run_id FROM agent_checkpoints WHERE run_id=?').get(run.id);
      if (resumable) db.update(s.runs).set({status:'queued',updatedAt:now()}).where(eq(s.runs.id,run.id)).run();
      else finishRun(run.id, run.result ?? emptyResult(), '调查进程曾中断，已有证据已保留，可以重新检查。');
    }
  }
}
export function tripState(trip: Trip, options: { completedOnly?: boolean } = {}): TripState {
  const rows = database().db.select().from(s.runs).where(eq(s.runs.tripId, trip.id)).orderBy(desc(s.runs.createdAt)).all();
  const available = rows.filter(r => !options.completedOnly || r.status === 'completed');
  const run = available.find(r => r.tripRevision === trip.revision) ?? null;
  const base = available.find(r => r.tripRevision === trip.revision && r.kind === 'investigation' && r.result) ?? null;
  let result = base?.result ?? null;
  if (result) {
    result = structuredClone(result);
    for (const extra of available.filter(r => r.tripRevision === trip.revision && r.kind !== 'investigation' && r.result).reverse()) {
      if (extra.result?.announcement) result.announcement = extra.result.announcement;
      if (extra.result?.alternatives.length) result.alternatives = extra.result.alternatives;
      for (const dossier of extra.result?.dossiers ?? []) {
        const current=result.dossiers.find(d=>d.venue.id===dossier.venue.id);
        if(!current)result.dossiers.push(dossier);
        else {
          for(const key of ['facts','evidence','calls'] as const) (current[key] as {id:string}[])=[...new Map([...current[key],...dossier[key]].map(row=>[row.id,row])).values()];
          current.searchedScope=[...new Set([...current.searchedScope,...dossier.searchedScope])];
          current.limitations=[...new Set([...current.limitations,...dossier.limitations])];
          current.venue.investigationDates=[...new Set([...current.venue.investigationDates,...dossier.venue.investigationDates])];
        }
      }
    }
  }
  return { trip, run, result, runs: rows.map(({ id, kind, status, createdAt, tripRevision }) => ({ id, kind, status, createdAt, tripRevision })), events: run ? readEvents(run.id) : [], ...(!options.completedOnly ? {agent:agentView(trip.id,run?.id ?? null)} : {}) };
}
export function cacheGet<T>(key: string): T | null {
  const row = database().db.select().from(s.cache).where(eq(s.cache.key, key)).get();
  return row && row.expiresAt > Date.now() ? row.payload as T : null;
}
export function cacheSet(key: string, payload: unknown, ttl = 6 * 3600_000) { database().db.insert(s.cache).values({ key, payload, expiresAt: Date.now() + ttl }).onConflictDoUpdate({ target: s.cache.key, set: { payload, expiresAt: Date.now() + ttl } }).run(); }
export function quota(key: string, limit: number) {
  const { sqlite } = database();
  sqlite.transaction(() => {
    const n = sqlite.prepare('SELECT count FROM usage WHERE key=?').get(key) as { count: number } | undefined;
    if ((n?.count ?? 0) >= limit) throw new AppError('RATE_LIMIT', '本次使用额度已达上限，请稍后再试。', 429);
    sqlite.prepare('INSERT INTO usage(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key);
  })();
}
export function reserveSearch(runId: string, venueId?: string) {
  const { sqlite } = database();
  sqlite.transaction(() => {
    const run = getRun(runId);
    if (run.status === 'cancelled') throw new AppError('RUN_CANCELLED', '调查已停止。', 409);
    if (venueId) {
      const used = (sqlite.prepare('SELECT count FROM venue_usage WHERE run_id=? AND venue_id=?').get(runId,venueId) as {count:number}|undefined)?.count ?? 0;
      if (used >= 5) throw new AppError('VENUE_BUDGET','该场馆已达到五次搜索上限。',429);
    }
    const dailyKey = `search:${today()}`;
    const daily = (sqlite.prepare('SELECT count FROM usage WHERE key=?').get(dailyKey) as { count: number } | undefined)?.count ?? 0;
    const total = (sqlite.prepare("SELECT SUM(count) AS n FROM usage WHERE key LIKE 'search:%'").get() as { n: number | null }).n ?? 0;
    if (run.used >= run.limit || daily >= Number(process.env.SEARCH_DAILY_LIMIT ?? 1000) || total >= Number(process.env.SEARCH_TOTAL_LIMIT ?? 6000)) throw new AppError('BUDGET_EXHAUSTED', '搜索预算已用完，未完成的检查保持尚无法确认。', 429);
    sqlite.prepare('UPDATE runs SET used=used+1,updated_at=? WHERE id=?').run(now(), runId);
    if (venueId) sqlite.prepare('INSERT INTO venue_usage(run_id,venue_id,count) VALUES(?,?,1) ON CONFLICT(run_id,venue_id) DO UPDATE SET count=count+1').run(runId,venueId);
    sqlite.prepare('INSERT INTO usage(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1').run(dailyKey);
  })();
  emit(runId, 'budget', { used: getRun(runId).used, limit: getRun(runId).limit });
}
export function saveCall(runId: string, call: { id: string }) { database().db.insert(s.searchCalls).values({ id: call.id, runId, payload: call }).onConflictDoUpdate({ target: [s.searchCalls.runId, s.searchCalls.id], set: { payload: call } }).run(); }
export function listCalls(runId: string) { return database().db.select().from(s.searchCalls).where(eq(s.searchCalls.runId, runId)).all().map(row => row.payload as import('./domain').SearchCall); }
export function vote(judgmentId: string, session: string, value: number) { database().db.insert(s.feedback).values({ judgmentId, session, vote: value, at: now() }).onConflictDoUpdate({ target: [s.feedback.judgmentId, s.feedback.session], set: { vote: value, at: now() } }).run(); }
export function statistics() {
  const { sqlite } = database();
  return {
    trips: (sqlite.prepare("SELECT count(DISTINCT trip_id) AS n FROM runs WHERE kind='investigation' AND status='completed'").get() as { n: number }).n,
    conflicts: (sqlite.prepare("SELECT count(*) AS n FROM judgments WHERE json_extract(payload,'$.verdict')='conflict'").get() as { n: number }).n,
    positive: (sqlite.prepare('SELECT count(*) AS n FROM feedback WHERE vote=1').get() as { n: number }).n,
    votes: (sqlite.prepare('SELECT count(*) AS n FROM feedback').get() as { n: number }).n,
  };
}
