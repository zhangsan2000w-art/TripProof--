import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../db';
import { AppError } from '../lib/errors';
import { emptyResult } from '../lib/domain';
import { createRun, createTrip, finishRun, getRun, listCalls, reserveSearch } from '../lib/store';
import { withRunControl } from '../lib/run-control';
import { searchProviders } from '../lib/search/config';
import { parseYuanbaoApiKeys, yuanbaoApiKeys } from '../lib/search/settings';
import { requestYuanbaoSearch, searchPro } from '../lib/search/yuanbao';
import { trip } from './fixtures';

const folder = mkdtempSync(join(tmpdir(), 'tripproof-key-pool-'));
const runs: string[] = [];
let keys: string[];
const run = () => { const value = createRun(createTrip(trip(), 'key-pool-test')); runs.push(value.id); return value; };
const response = (data: unknown = { RequestId: 'ok', Pages: [] }, status = 200, headers = {}) => new Response(JSON.stringify({ Response: data }), { status, headers });
const authorization = (options: RequestInit) => new Headers(options.headers).get('Authorization');
beforeAll(() => { process.env.DATABASE_PATH = join(folder, 'test.db'); });
beforeEach(() => {
  const unique = crypto.randomUUID(); keys = [`first-${unique}`, `second-${unique}`];
  vi.stubEnv('LOCAL_SETTINGS_ENABLED', '0'); vi.stubEnv('WSA_AUTH_MODE', 'api-key');
  vi.stubEnv('WSA_API_KEYS', keys.join(',')); vi.stubEnv('WSA_API_KEY', 'legacy-key'); vi.stubEnv('WSA_TIER', 'standard');
});
afterEach(() => {
  for (const id of runs.splice(0)) finishRun(id, emptyResult());
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
afterAll(() => { database().sqlite.close(); delete (globalThis as { tripproofDB?: unknown }).tripproofDB; rmSync(folder, { recursive: true, force: true }); });

it('解析逗号及换行列表、去重，优先多 Key，空列表兼容原单 Key', () => {
  expect(parseYuanbaoApiKeys(' a, b\r\nc\na, , ')).toEqual(['a', 'b', 'c']);
  expect(yuanbaoApiKeys()).toEqual(keys); expect(searchProviders().yuanbao).toBe(true);
  vi.stubEnv('WSA_API_KEYS', ''); expect(yuanbaoApiKeys()).toEqual(['legacy-key']);
  vi.stubEnv('WSA_API_KEY', ''); expect(searchProviders().yuanbao).toBe(false);
});
it.each(['a b', 'a\tb', 'a\u007fb', 'a'.repeat(513), Array.from({ length: 33 }, (_, i) => `key-${i}`).join(',')])('无效配置在网络请求之前失败，错误不包含 Key', async raw => {
  vi.stubEnv('WSA_API_KEYS', raw); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(requestYuanbaoSearch({ Query: 'invalid-config' })).rejects.toMatchObject({ code: 'SEARCH_KEYS_INVALID' });
  expect(fetch).not.toHaveBeenCalled();
});
it('实际请求按 A B A B 轮询，重复 Key 不会增加权重', async () => {
  vi.stubEnv('WSA_API_KEYS', `${keys[0]},${keys[1]}\n${keys[0]}`);
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => response()); vi.stubGlobal('fetch', fetch);
  for (let i = 0; i < 4; i++) await requestYuanbaoSearch({ Query: 'rotation' });
  expect(fetch.mock.calls.map(([, options]) => authorization(options))).toEqual([keys[0], keys[1], keys[0], keys[1]].map(key => `Bearer ${key}`));
});
it('缓存命中不轮换也不消耗预算，下一次真实请求使用下一个 Key', async () => {
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => response()); vi.stubGlobal('fetch', fetch);
  const value = run(); await searchPro(value.id, 'v', { query: 'pool-cache' }, { used: 0 });
  const cached = await searchPro(value.id, 'v', { query: 'pool-cache' }, { used: 0 });
  await searchPro(value.id, 'v', { query: 'after-pool-cache' }, { used: 0 });
  expect(cached.call.cacheHit).toBe(true); expect(getRun(value.id).used).toBe(2);
  expect(fetch.mock.calls.map(([, options]) => authorization(options))).toEqual(keys.map(key => `Bearer ${key}`));
});
it.each([401, 402, 403, 429])('HTTP %s 切换到可用 Key，每次实际尝试分别计费并记录，失败结果不缓存', async status => {
  const fetch = vi.fn(async (_url: string, options: RequestInit) => authorization(options) === `Bearer ${keys[0]}` ? response({}, status) : response()); vi.stubGlobal('fetch', fetch);
  const value = run(), budget = { used: 0 };
  const result = await searchPro(value.id, 'v', { query: `pool-http-${status}` }, budget);
  expect(result.call.requestId).toBe('ok'); expect(budget.used).toBe(2); expect(getRun(value.id).used).toBe(2);
  expect(listCalls(value.id).map(call => call.errorCode)).toEqual([`SEARCH_HTTP_${status}`, null]);
  await searchPro(value.id, 'v', { query: `pool-after-http-${status}` }, budget);
  expect(fetch.mock.calls.map(([, options]) => authorization(options))).toEqual([keys[0], keys[1], keys[1]].map(key => `Bearer ${key}`));
});
it.each(['AuthFailure.SecretIdNotFound', 'RequestLimitExceeded', 'ResourceInsufficient', 'LimitExceeded.Quota'])('HTTP 200 的 %s 也冷却、轮换并保留 RequestId', async code => {
  const fetch = vi.fn(async (_url: string, options: RequestInit) => authorization(options) === `Bearer ${keys[0]}`
    ? response({ RequestId: 'rejected', Error: { Code: code, Message: 'must-not-persist-key' }, Pages: [{ url: 'https://fake.example' }] }) : response()); vi.stubGlobal('fetch', fetch);
  const value = run(), result = await searchPro(value.id, 'v', { query: `pool-code-${code}` }, { used: 0 });
  expect(result.pages).toEqual([]); expect(listCalls(value.id).map(call => [call.requestId, call.errorCode])).toEqual([['rejected', code], ['ok', null]]);
  expect(JSON.stringify(listCalls(value.id))).not.toContain('must-not-persist-key');
});
it('全部 Key 失效后立即停止，后续请求不消耗预算、不写伪调用记录', async () => {
  const fetch = vi.fn(async () => response({}, 401)); vi.stubGlobal('fetch', fetch);
  const value = run(), budget = { used: 0 };
  await expect(searchPro(value.id, 'v', { query: 'all-keys-invalid' }, budget)).rejects.toMatchObject({ code: 'SEARCH_HTTP_401' });
  await expect(searchPro(value.id, 'v', { query: 'still-all-invalid' }, budget)).rejects.toMatchObject({ code: 'SEARCH_KEYS_UNAVAILABLE' });
  expect(fetch).toHaveBeenCalledTimes(2); expect(budget.used).toBe(2); expect(getRun(value.id).used).toBe(2); expect(listCalls(value.id)).toHaveLength(2);
});
it('遵守 Retry-After，冷却到期的 Key 自动重新参与轮询', async () => {
  const clock = vi.spyOn(Date, 'now'), time = Date.now(); clock.mockReturnValue(time);
  const fetch = vi.fn().mockResolvedValueOnce(response({}, 429, { 'Retry-After': '2' })).mockImplementation(async () => response()); vi.stubGlobal('fetch', fetch);
  await expect(requestYuanbaoSearch({ Query: 'cooldown' })).rejects.toMatchObject({ code: 'SEARCH_HTTP_429' });
  await requestYuanbaoSearch({ Query: 'next' }); clock.mockReturnValue(time + 2001); await requestYuanbaoSearch({ Query: 'recovered' });
  expect(fetch.mock.calls.map(([, options]) => authorization(options))).toEqual([keys[0], keys[1], keys[0]].map(key => `Bearer ${key}`));
});
it('更换配置后新 Key 立即生效，不继承旧 Key 的冷却', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({}, 401)).mockImplementation(async () => response()); vi.stubGlobal('fetch', fetch);
  await expect(requestYuanbaoSearch({ Query: 'old' })).rejects.toThrow();
  vi.stubEnv('WSA_API_KEYS', 'replacement-a,replacement-b'); await requestYuanbaoSearch({ Query: 'new' });
  expect(authorization(fetch.mock.calls[1][1])).toBe('Bearer replacement-a');
});
it('不同 Key 的 lite 套餐降级互不影响，调用记录与实际参数一致', async () => {
  let liteFailed = false;
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    if (authorization(options) === `Bearer ${keys[0]}` && !liteFailed) { liteFailed = true; return response({ Error: { Code: 'InvalidParameter' } }); }
    return response({ RequestId: 'ok', Version: authorization(options) === `Bearer ${keys[0]}` ? 'lite' : 'standard', Pages: [] });
  }); vi.stubGlobal('fetch', fetch);
  const value = run(); await searchPro(value.id, 'v', { query: 'mixed-tier', cnt: 20, industry: 'gov' }, { used: 0 });
  const result = await searchPro(value.id, 'v', { query: 'mixed-tier-lite', cnt: 20, industry: 'gov' }, { used: 0 });
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toHaveProperty('Cnt', 20);
  expect(JSON.parse(String(fetch.mock.calls[2][1].body))).not.toHaveProperty('Cnt'); expect(result.call.params.cnt).toBeUndefined();
});
it('轮换重试仍受场馆和全局搜索预算限制', async () => {
  const fetch = vi.fn(async () => response({}, 401)); vi.stubGlobal('fetch', fetch);
  const value = run();
  for (let i = 0; i < 39; i++) reserveSearch(value.id);
  await expect(searchPro(value.id, 'v', { query: 'last-slot' }, { used: 0 })).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
  expect(fetch).toHaveBeenCalledTimes(1); expect(getRun(value.id).used).toBe(40); expect(listCalls(value.id)).toHaveLength(1);
  fetch.mockClear();
  await expect(searchPro(run().id, 'v', { query: 'venue-slot' }, { used: 4, limit: 5 })).rejects.toMatchObject({ code: 'SEARCH_HTTP_401' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('多个 Key 不提高并发上限，并发请求也依次轮换', async () => {
  let active = 0, peak = 0;
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return response();
  }); vi.stubGlobal('fetch', fetch);
  const value = run();
  await Promise.all(Array.from({ length: 8 }, (_, index) => searchPro(value.id, `venue-${index}`, { query: `parallel-pool-${index}` }, { used: 0 })));
  expect(peak).toBeLessThanOrEqual(4); expect(getRun(value.id).used).toBe(8);
  expect(fetch.mock.calls.map(([, options]) => authorization(options))).toEqual(Array.from({ length: 8 }, (_, index) => `Bearer ${keys[index % 2]}`));
});
it('取消后不选择下一 Key，不继续重试', async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async () => { controller.abort(new AppError('RUN_CANCELLED', '调查已停止。', 409)); return response({}, 401); }); vi.stubGlobal('fetch', fetch);
  const value = run();
  await expect(withRunControl({ signal: controller.signal }, () => searchPro(value.id, 'v', { query: 'cancel-pool' }, { used: 0 }))).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
  expect(fetch).toHaveBeenCalledTimes(1); expect(getRun(value.id).used).toBe(1);
});
