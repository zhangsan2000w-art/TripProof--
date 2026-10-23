import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { database } from '@/db';
import * as tables from '@/db/schema';
import { tripInputSchema, type RunResult } from './domain';
import { getSharedTrip, tripState } from './store';
import { sampleManifestPath } from './sample-manifest';
export { sampleManifestPath } from './sample-manifest';

const reference = z.object({ case: z.string().min(1), shareId: z.string().min(1) });
const manifestSchema = z.object({ bundleExportedAt: z.string().optional(), reports: z.array(reference) });
const tripSchema = tripInputSchema.extend({
  id: z.string().min(1), shareId: z.string().min(1), revision: z.number().int().positive(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
const resultSchema = z.object({
  dossiers: z.array(z.object({ venue: z.object({ id: z.string() }).passthrough(), facts: z.array(z.object({ id: z.string() }).passthrough()), evidence: z.array(z.object({ id: z.string() }).passthrough()), calls: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough()),
  judgments: z.array(z.object({ id: z.string() }).passthrough()), ripples: z.array(z.unknown()), suggestions: z.array(z.object({ id: z.string() }).passthrough()),
  alternatives: z.array(z.unknown()), announcement: z.unknown().nullable(), limitations: z.array(z.string()),
}).transform(value => value as unknown as RunResult);
const bundleSchema = z.object({
  version: z.literal(1), exportedAt: z.iso.datetime(),
  reports: z.array(z.object({
    case: z.string().min(1), trip: tripSchema,
    run: z.object({
      id: z.string().min(1), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
      startedAt: z.iso.datetime().nullable(), completedAt: z.iso.datetime(), firstVerdictAt: z.iso.datetime().nullable(),
      used: z.number().int().nonnegative(), limit: z.number().int().nonnegative(), result: resultSchema,
    }),
  })).min(1),
}).superRefine((bundle, ctx) => {
  for (const field of ['case', 'trip', 'share', 'run'] as const) {
    const values = bundle.reports.map(r => field === 'case' ? r.case : field === 'trip' ? r.trip.id : field === 'share' ? r.trip.shareId : r.run.id);
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: `示例包中存在重复的 ${field}` });
  }
});
export type SampleBundle = z.infer<typeof bundleSchema>;
export const parseSampleBundle = (value: unknown) => bundleSchema.parse(value);

/** Export only the explicitly featured, completed snapshots. Never export owners, inputs, caches or uploads. */
export function exportFeaturedSamples(): SampleBundle {
  const featured = manifestSchema.parse(JSON.parse(readFileSync(sampleManifestPath(), 'utf8')));
  return parseSampleBundle({
    version: 1, exportedAt: new Date().toISOString(),
    reports: featured.reports.map(({ case: name, shareId }) => {
      const trip = getSharedTrip(shareId), state = trip && tripState(trip, { completedOnly: true });
      // Merged extension results do not change the provenance or completion time of the base investigation.
      const run = trip && database().db.select().from(tables.runs).where(eq(tables.runs.tripId, trip.id)).all()
        .filter(r => r.tripRevision === trip.revision && r.kind === 'investigation' && r.status === 'completed' && r.result)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!trip || !state?.result || !run?.completedAt || !state.result.judgments.length) throw new Error(`示例 ${name} 缺少已完成的报告，请先完成 golden 验收。`);
      const { id, createdAt, updatedAt, startedAt, completedAt, firstVerdictAt, used, limit } = run;
      return { case: name, trip, run: { id, createdAt, updatedAt, startedAt, completedAt, firstVerdictAt, used, limit, result: state.result } };
    }),
  });
}

/** Run once before web/worker startup; retries restore missing data without replacing existing trips. */
export function initializeSampleReports(path = 'data/sample-reports.json') {
  if (!existsSync(path)) return { imported: 0, featured: 0 };
  const bundle = parseSampleBundle(JSON.parse(readFileSync(path, 'utf8')));
  const { db, sqlite } = database();
  const imported = sqlite.transaction(() => {
    let count = 0;
    for (const { trip, run } of bundle.reports) {
      const existingTrip = db.select().from(tables.trips).where(eq(tables.trips.id, trip.id)).get();
      const existingShare = getSharedTrip(trip.shareId);
      if ((existingTrip && existingTrip.shareId !== trip.shareId) || (existingShare && existingShare.id !== trip.id)) throw new Error('示例标识与已有行程冲突，已取消导入。');
      if (!existingTrip) {
        // A new unguessable owner makes these imported reports read-only even to the original local session.
        db.insert(tables.trips).values({ id: trip.id, shareId: trip.shareId, owner: randomBytes(32).toString('hex'), body: trip, updatedAt: trip.updatedAt }).run();
        for (const item of trip.items) db.insert(tables.items).values({ id: `${trip.id}:${item.id}`, tripId: trip.id, payload: item }).run();
        count++;
      }
      const existingRun = db.select().from(tables.runs).where(eq(tables.runs.id, run.id)).get();
      if (existingRun && (existingRun.tripId !== trip.id || existingRun.kind !== 'investigation' || existingRun.status !== 'completed' || existingRun.tripRevision !== trip.revision)) throw new Error('示例调查与已有任务冲突，已取消导入。');
      if (existingRun) continue;
      // Preserve actual search times and RequestIds; completed snapshots never enter the search queue.
      db.insert(tables.runs).values({ ...run, tripId: trip.id, kind: 'investigation', status: 'completed', tripRevision: trip.revision, input: {}, error: null }).run();
      const result = run.result;
      const groups = [
        [tables.venues, result.dossiers.map(d => d.venue)], [tables.evidence, result.dossiers.flatMap(d => d.evidence)],
        [tables.facts, result.dossiers.flatMap(d => d.facts)], [tables.searchCalls, result.dossiers.flatMap(d => d.calls)],
        [tables.judgments, result.judgments], [tables.suggestions, result.suggestions],
      ] as const;
      for (const [table, rows] of groups) for (const row of rows) db.insert(table).values({ id: row.id, runId: run.id, payload: row }).onConflictDoNothing().run();
    }
    return count;
  }).immediate();
  const manifestPath = sampleManifestPath();
  let selected: z.infer<typeof reference>[] = [], appliedAt: string | null = null;
  if (existsSync(manifestPath)) {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    // Golden runs write the list without a stamp; then the file time says how recent the picks are.
    selected = manifest.reports; appliedAt = manifest.bundleExportedAt ?? statSync(manifestPath).mtime.toISOString();
  }
  // A newer bundle is a deliberate release of new demo reports, so it replaces older picks for its cases.
  const newer = !appliedAt || bundle.exportedAt > appliedAt;
  for (const report of bundle.reports) {
    const current = selected.find(r => r.case === report.case), trip = current && getSharedTrip(current.shareId);
    if (!newer && trip && tripState(trip, { completedOnly: true }).result) continue;
    selected = selected.filter(r => r.case !== report.case);
    selected.push({ case: report.case, shareId: report.trip.shareId });
  }
  const stamp = !appliedAt || bundle.exportedAt > appliedAt ? bundle.exportedAt : appliedAt;
  const content = `${JSON.stringify({ note: 'Explicitly featured real reports; original investigation dates are preserved.', bundleExportedAt: stamp, reports: selected }, null, 2)}\n`;
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== content) {
    const temporary = `${manifestPath}.${process.pid}.tmp`;
    writeFileSync(temporary, content); renameSync(temporary, manifestPath);
  }
  return { imported, featured: selected.length };
}
