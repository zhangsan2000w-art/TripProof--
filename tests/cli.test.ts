import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftToTrip, parseArgs, run, TripProofClient } from '../bin/tripproof.mjs';

const item = { seq: 1, start: '09:00', end: '10:00', placeName: '中国丝绸博物馆', city: '杭州', kind: 'museum', activity: '参观', sourceText: '09:00 中国丝绸博物馆', sourceImage: null, confidence: 1, claimedRules: [], profile: { openArea: false, undecided: false, mode: null, address: null, ticket: null } };
const draft = { guideMeta: { title: '杭州一日游', publishedAt: null }, days: [{ dayIndex: 1, items: [{ ...item, dependsOnPrevious: false }, { ...item, seq: 2, placeName: '雷峰塔', dependsOnPrevious: true }] }], recommendations: [], ambiguities: [] };

describe('TripProof CLI', () => {
  it('keeps option values with = and converts drafts without auto-submitting', () => {
    expect(parseArgs(['message', 'abc', '--text=a=b']).flags.text).toBe('a=b');
    const trip = draftToTrip({ job: { draft } }, { date: '2026-10-27', city: '杭州', title: undefined });
    expect(trip.items).toHaveLength(2);
    expect(trip.items[1].dependsOn).toEqual([trip.items[0].id]);
    expect(trip.items[0]).not.toHaveProperty('dependsOnPrevious');
    expect(trip.guidePublishedAt).toBeNull();
    expect(() => draftToTrip(draft, { date: '2026-02-30', city: '杭州', title: undefined })).toThrow('日期格式');
  });

  it('unlocks through the public login form, persists only cookies, and retries a private GET', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tripproof-cli-'));
    const sessionPath = join(dir, 'session.json');
    const requests: { path: string; cookie: string; method: string; body?: string }[] = [];
    const fakeFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname, cookie = String((init?.headers as Record<string, string>)?.Cookie || '');
      requests.push({ path, cookie, method: init?.method || 'GET', body: String(init?.body || '') });
      if (path === '/api/stats') return Response.json({ error: '未解锁' }, { status: 401 });
      if (path === '/api/access/login') return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': 'tp_access=access-token; Path=/; HttpOnly' } });
      if (path === '/api/trips/t1' && !cookie.includes('tp_access=access-token')) return Response.json({ error: '未解锁' }, { status: 401 });
      if (path === '/api/trips/t1') return Response.json({ trip: { id: 't1', revision: 1 }, run: null });
      throw new Error(path);
    };
    const client = new TripProofClient({ url: 'http://127.0.0.1:3000', sessionPath, password: 'private-secret', fetchImpl: fakeFetch });
    expect((await client.request('/api/trips/t1')).trip.id).toBe('t1');
    expect(requests.map(r => r.path)).toEqual(['/api/trips/t1', '/api/stats', '/api/access/login', '/api/trips/t1']);
    expect(requests[2].body).toContain('password=private-secret');
    const saved = await readFile(sessionPath, 'utf8');
    expect(saved).toContain('access-token');
    expect(saved).not.toContain('private-secret');
    expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
    const other = new TripProofClient({ url: 'http://localhost:3016', sessionPath, password: undefined, fetchImpl: fakeFetch });
    await other.load();
    expect(other.cookies).toEqual({});
  });

  it('creates only from reviewed input and carries owner cookie to mutations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tripproof-cli-'));
    const sessionPath = join(dir, 'session.json'), input = join(dir, 'trip.json');
    await writeFile(input, JSON.stringify(draftToTrip(draft, { date: '2026-10-27', city: '杭州', title: undefined })));
    const requests: { path: string; cookie: string; body?: string }[] = [];
    const fakeFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname, cookie = String((init?.headers as Record<string, string>)?.Cookie || '');
      requests.push({ path, cookie, body: String(init?.body || '') });
      if (path === '/api/extract') return Response.json({ ready: true }, { headers: { 'Set-Cookie': 'tp_session=owner-token; Path=/; HttpOnly' } });
      if (path === '/api/trips') return Response.json({ trip: { id: 'trip-1' } }, { status: 201 });
      throw new Error(path);
    };
    const created = await run(['--session', sessionPath, 'create', '--input', input], process.env, { fetchImpl: fakeFetch });
    expect(created.trip.id).toBe('trip-1');
    expect(requests.map(r => r.path)).toEqual(['/api/extract', '/api/trips']);
    expect(requests[1].cookie).toContain('tp_session=owner-token');
    expect(JSON.parse(requests[1].body!).items).toHaveLength(2);
  });

  it('accepts image-only extraction and preserves an explicit idempotency UUID', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tripproof-cli-'));
    const sessionPath = join(dir, 'session.json'), image = join(dir, 'guide.png');
    await writeFile(image, Buffer.from('89504e470d0a1a0a', 'hex'));
    let payload: Record<string, unknown> | null = null;
    const fakeFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/extract' && init?.method === 'GET') return Response.json({ ready: true }, { headers: { 'Set-Cookie': 'tp_session=owner-token; Path=/' } });
      if (path === '/api/extract') { payload = JSON.parse(String(init?.body)); return Response.json({ job: { id: 'fixed-id', status: 'queued' } }, { status: 202 }); }
      throw new Error(path);
    };
    const result = await run(['--session', sessionPath, 'extract', '--image', image, '--request-id', 'fixed-id'], process.env, { fetchImpl: fakeFetch });
    expect(result.job.id).toBe('fixed-id');
    expect(payload).toMatchObject({ text: '', background: true, requestId: 'fixed-id' });
    expect((payload as any).images[0].data).toMatch(/^data:image\/png;base64,/);
  });

  it('uses current revision for preview and applies only a saved proposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tripproof-cli-'));
    const sessionPath = join(dir, 'session.json');
    const requests: { path: string; body?: string }[] = [];
    const fakeFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      requests.push({ path, body: String(init?.body || '') });
      if (path === '/api/trips/t1') return Response.json({ trip: { revision: 7 } });
      if (path === '/api/trips/t1/whatif') return Response.json({ proposalId: 'p1', applied: JSON.parse(String(init?.body)).apply });
      throw new Error(path);
    };
    const preview = await run(['--session', sessionPath, 'preview', 't1', '--date', '2026-10-27'], process.env, { fetchImpl: fakeFetch });
    const applied = await run(['--session', sessionPath, 'apply', 't1', 'p1'], process.env, { fetchImpl: fakeFetch });
    expect(preview.applied).toBe(false);
    expect(applied.applied).toBe(true);
    expect(JSON.parse(requests[1].body!)).toEqual({ revision: 7, startDate: '2026-10-27', apply: false });
    expect(JSON.parse(requests[3].body!)).toEqual({ revision: 7, proposalId: 'p1', apply: true });
  });
});
