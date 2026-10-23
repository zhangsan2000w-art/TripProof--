import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../db';
import { emptyResult, type Trip } from '../lib/domain';
import { exportFeaturedSamples, initializeSampleReports, parseSampleBundle, sampleManifestPath, type SampleBundle } from '../lib/sample-bundle';
import { sampleReports } from '../lib/samples';
import { claimRun, createTrip, getSharedTrip, getTrip, tripState } from '../lib/store';
import { item, trip } from './fixtures';

const previousDatabase = process.env.DATABASE_PATH;
let directory: string;
function setup() {
  directory = mkdtempSync(join(tmpdir(), 'tripproof-samples-'));
  process.env.DATABASE_PATH = join(directory, 'test.db');
  const at = '2026-10-23T08:00:00.000Z';
  const reports = ['hangzhou', 'linan', 'nanjing', 'dongtou'].map((name, index) => {
    const sampleTrip: Trip = { ...trip([item({ id: `${name}-stop` })], { title: name }), id: name, shareId: `share-${name}`, revision: 1, createdAt: at, updatedAt: at };
    const result = emptyResult();
    result.judgments.push({ id: `${name}-judgment`, itemId: sampleTrip.items[0].id, venueId: 'venue', type: 'availability', date: sampleTrip.startDate, verdict: 'unknown', reasonCode: 'LIVE_STOCK', explanation: '实时库存无法确认', factIds: [], overruledFactIds: [], evidenceIds: [], searchedScope: [], notes: [], judgedAt: at });
    return { case: name, trip: sampleTrip, run: { id: `${name}-run`, createdAt: at, updatedAt: at, startedAt: at, completedAt: at, firstVerdictAt: at, used: index, limit: 40, result } };
  });
  const bundle: SampleBundle = { version: 1, exportedAt: at, reports };
  const path = join(directory, 'bundle.json');
  writeFileSync(path, JSON.stringify(bundle));
  return { bundle, path };
}
afterEach(() => {
  database().sqlite.close(); delete (globalThis as { tripproofDB?: unknown }).tripproofDB;
  if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
  rmSync(directory, { recursive: true, force: true });
});

it('全新部署能展示四个已有报告，原日期保留且不会再次搜索', () => {
  const { bundle, path } = setup();
  expect(initializeSampleReports(path)).toEqual({ imported: 4, featured: 4 });
  expect(sampleReports().map(r => r.shareId)).toEqual(bundle.reports.map(r => r.trip.shareId));
  for (const report of bundle.reports) {
    const state = tripState(getSharedTrip(report.trip.shareId)!, { completedOnly: true });
    expect(state.result).toEqual(report.run.result);
    expect(state.run?.completedAt).toBe(report.run.completedAt);
    expect(state.trip.startDate).toBe(report.trip.startDate);
    expect(() => getTrip(state.trip.id, 'original-local-owner')).toThrow('权限');
  }
  expect(claimRun()).toBeNull();
});

it('重启幂等，清单丢失也能恢复，普通行程和用量不受影响', () => {
  const { path } = setup();
  const own = createTrip(trip(), 'existing-owner');
  database().sqlite.prepare('INSERT INTO usage VALUES (?,?)').run('search:2026-10-23', 9);
  initializeSampleReports(path);
  const before = database().sqlite.prepare('SELECT * FROM runs ORDER BY id').all();
  rmSync(sampleManifestPath());
  expect(initializeSampleReports(path)).toEqual({ imported: 0, featured: 4 });
  expect(database().sqlite.prepare('SELECT * FROM runs ORDER BY id').all()).toEqual(before);
  expect(database().sqlite.prepare('SELECT * FROM usage').all()).toEqual([{ key: 'search:2026-10-23', count: 9 }]);
  expect(getTrip(own.id, 'existing-owner')).toEqual(own);
  expect(sampleReports()).toHaveLength(4);
  expect(sampleReports().some(r => r.shareId === own.shareId)).toBe(false);
});

it('导出只包含精选报告，不含编辑权限、任务输入、账户或其他行程', () => {
  const { path } = setup(); initializeSampleReports(path);
  const own = createTrip(trip(), 'private-owner-value');
  database().sqlite.prepare('UPDATE runs SET input=?').run(JSON.stringify({ images: ['private-image-data'] }));
  const exported = exportFeaturedSamples(), serialized = JSON.stringify(exported);
  expect(exported.reports).toHaveLength(4);
  for (const value of ['private-owner-value', own.id, 'private-image-data', '"input"', '"owner"']) expect(serialized).not.toContain(value);
});

it('已有标识冲突时整体回滚，不覆盖原行程', () => {
  const { bundle, path } = setup(), own = createTrip(trip(), 'owner');
  bundle.reports[1].trip.shareId = own.shareId; writeFileSync(path, JSON.stringify(bundle));
  expect(() => initializeSampleReports(path)).toThrow('冲突');
  expect(getSharedTrip('share-hangzhou')).toBeNull();
  expect(getTrip(own.id, 'owner')).toEqual(own);
});

it('不完整报告和重复标识不能进入发布包', () => {
  const { bundle } = setup();
  expect(() => parseSampleBundle({ ...bundle, reports: [bundle.reports[0], bundle.reports[0]] })).toThrow('重复');
  expect(() => parseSampleBundle({ ...bundle, reports: [{ ...bundle.reports[0], run: { ...bundle.reports[0].run, completedAt: null } }] })).toThrow();
});

it('新导出的示例包替换旧精选；本地新跑的报告不被旧包覆盖', () => {
  const { bundle, path } = setup(); initializeSampleReports(path);
  const fresh = structuredClone(bundle.reports[0]);
  Object.assign(fresh.trip, { id: 'hangzhou-2', shareId: 'share-hangzhou-2' }); fresh.run.id = 'hangzhou-run-2';
  const later = join(directory, 'later.json');
  writeFileSync(later, JSON.stringify({ ...bundle, exportedAt: '2026-10-23T09:00:00.000Z', reports: [fresh, ...bundle.reports.slice(1)] }));
  initializeSampleReports(later);
  expect(sampleReports().map(r => r.shareId)).toContain('share-hangzhou-2');
  expect(sampleReports().map(r => r.shareId)).not.toContain('share-hangzhou');
  // A golden run rewrites the list without a stamp after the bundle was made.
  writeFileSync(sampleManifestPath(), JSON.stringify({ reports: bundle.reports.map(r => ({ case: r.case, shareId: r.trip.shareId })) }));
  initializeSampleReports(later);
  expect(sampleReports().map(r => r.shareId)).toContain('share-hangzhou');
  expect(sampleReports().map(r => r.shareId)).not.toContain('share-hangzhou-2');
});

it('清单中的失效链接会恢复为有完整结果的示例', () => {
  const { path } = setup(); initializeSampleReports(path);
  const manifest = JSON.parse(readFileSync(sampleManifestPath(), 'utf8'));
  manifest.reports[0].shareId = 'missing-share'; writeFileSync(sampleManifestPath(), JSON.stringify(manifest));
  initializeSampleReports(path);
  expect(sampleReports()).toHaveLength(4);
  expect(sampleReports().some(r => r.shareId === 'share-hangzhou')).toBe(true);
});
