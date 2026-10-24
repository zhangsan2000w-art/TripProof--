import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../db';
import { emptyResult } from '../lib/domain';
import { createRun, createTrip, finishRun, getRun, getTrip, listCalls, reserveSearch, saveResult } from '../lib/store';
import { deepseekBody, normalizeDeepSeekPage, searchDeepSeek } from '../lib/search/deepseek';
import { searchSources } from '../lib/search';
import { searchCacheSuffix, searchProviders } from '../lib/search/config';
import { mergeSearchPages } from '../lib/search/shared';
import { selectVenueSources } from '../lib/source-selection';
import { configuration } from '../lib/llm';
import { sourceTier } from '../lib/evidence';
import { normalizePage } from '../lib/search/yuanbao';
import { trip } from './fixtures';
import { AppError } from '../lib/errors';
import { withRunControl } from '../lib/run-control';
import { initialCheckpoint } from '../lib/agent';
import { investigateTargets } from '../lib/agent-tools';

const folder = mkdtempSync(join(tmpdir(), 'tripproof-deepseek-'));
const runs: string[] = [];
const json = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const dsPage = (url = 'https://www.shanghaimuseum.net/rules') => ({ url, title: '上海博物馆开放时间', snippet: '每周一闭馆', content: '上海博物馆每周一闭馆。', authority: 4, rerank_score: 99 });
const ybPage = (url = 'https://www.shanghaimuseum.net/rules') => ({ url, title: '上海博物馆开放时间', passage: '周一闭馆', content: '上海博物馆参观规则。', authority_level: 2, score: 0.8 });
const run = () => { const value = createRun(createTrip(trip(), 'deepseek-test')); runs.push(value.id); return value; };
beforeAll(() => { process.env.DATABASE_PATH = join(folder, 'test.db'); });
beforeEach(() => {
  vi.stubEnv('WSA_AUTH_MODE', 'api-key'); vi.stubEnv('WSA_API_KEY', `yuanbao-test-${crypto.randomUUID()}`); vi.stubEnv('WSA_API_KEYS', ''); vi.stubEnv('WSA_TIER', 'standard');
  vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-test'); vi.stubEnv('DEEPSEEK_SEARCH_ENABLED', '1');
});
afterEach(() => {
  for (const id of runs.splice(0)) finishRun(id, emptyResult());
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
afterAll(() => { database().sqlite.close(); delete (globalThis as { tripproofDB?: unknown }).tripproofDB; rmSync(folder, { recursive: true, force: true }); });

it('Search API 请求转换站点和时间，按 Unicode 字符限制 query', () => {
  const body = deepseekBody({ query: '上海博物馆'.repeat(50), site: 'shanghaimuseum.net', freshness: 'd2', cnt: 90 });
  expect([...body.query]).toHaveLength(128); expect(body.query).toMatch(/ site:shanghaimuseum.net after:\d{4}-\d{2}-\d{2}$/);
  expect(body.count).toBe(50); expect(body.need_content).toBe(true); expect([...body.ori_question].length).toBeLessThanOrEqual(128);
});
it('拒绝空查询及无法安全转换的筛选条件', () => {
  expect(() => deepseekBody({ query: '  ' })).toThrow();
  expect(() => deepseekBody({ query: '规则', site: 'example.com another:query' })).toThrow();
  expect(() => deepseekBody({ query: '规则', freshness: 'recent' })).toThrow();
});
it('不将 DeepSeek 的分数和 authority 当作元宝的权威刻度', () => {
  const page = normalizeDeepSeekPage(dsPage(), 'call')!;
  expect(page.authorityLevel).toBeNull(); expect(page.score).toBeNull(); expect(page.providerAuthority).toBe(4); expect(page.providerScore).toBe(99);
  expect(sourceTier('unverified.example', page.authorityLevel)).toBe(4);
});
it('拒绝无效 URL、URL 中的凭据和异常页面结构', () => {
  for (const raw of [{ url: 'javascript:alert(1)' }, { url: 'https://user:password@example.com/' }, { url: 5 }, null]) expect(normalizeDeepSeekPage(raw, 'call')).toBeNull();
});
it('没有新增 Key 时原样发送元宝请求，不调用 DeepSeek', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', '');
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => json({ Response: { RequestId: 'original', Pages: [ybPage()] } })); vi.stubGlobal('fetch', fetch);
  const value = run(), result = await searchSources(value.id, 'venue', { query: 'original-path', site: 'example.com', freshness: 'm2', cnt: 20, industry: 'news' }, { used: 0 });
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('https://api.wsa.cloud.tencent.com/SearchPro');
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ Query: 'original-path', Site: 'example.com', Freshness: 'm2', Cnt: 20, Industry: 'news' });
  expect(result.calls[0].requestId).toBe('original'); expect(result.limitations).toEqual([]); expect(searchCacheSuffix()).toBe(''); expect(getRun(value.id).used).toBe(1);
});
it('显式关闭 DeepSeek 时即使已填 Key 仍保持原有流程', async () => {
  vi.stubEnv('DEEPSEEK_SEARCH_ENABLED', '0');
  const fetch = vi.fn(async () => json({ Pages: [] })); vi.stubGlobal('fetch', fetch);
  await searchSources(run().id, 'venue', { query: 'disabled' }, { used: 0 });
  expect(fetch).toHaveBeenCalledTimes(1); expect(searchProviders().deepseek).toBe(false); expect(searchCacheSuffix()).toBe('');
});
it('DeepSeek 关闭时元宝失败沿用原有错误，而非假装成功', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', ''); vi.stubGlobal('fetch', vi.fn(async () => json({ Error: { Code: 'UnauthorizedOperation' } })));
  await expect(searchSources(run().id, 'venue', { query: 'original-error' }, { used: 0 })).rejects.toMatchObject({ code: 'UnauthorizedOperation' });
});
it('两路并用保留不同信源，同一网页去重并保留两家来源', async () => {
  const fetch = vi.fn(async (url: string) => url.includes('deepseek')
    ? json({ results: [{ ...dsPage('https://www.shanghaimuseum.net/rules?utm_source=ds'), content: '更完整的上海博物馆正文。'.repeat(4) }, dsPage('https://www.gov.cn/rules')] }, 200, { 'x-request-id': 'ds-id' })
    : json({ RequestId: 'yb-id', Pages: [ybPage(), ybPage('https://news.cn/rules')] }));
  vi.stubGlobal('fetch', fetch);
  const value = run(), result = await searchSources(value.id, 'venue', { query: 'dual-merge' }, { used: 0 });
  expect(fetch).toHaveBeenCalledTimes(2); expect(result.pages).toHaveLength(3); expect(result.calls.map(call => call.provider)).toEqual(['yuanbao', 'deepseek']);
  const shared = result.pages.find(page => page.site === 'www.shanghaimuseum.net')!;
  expect(shared.searchOrigins?.map(origin => origin.provider)).toEqual(['yuanbao', 'deepseek']); expect(shared.content).toContain('更完整');
  expect(new Set(shared.searchOrigins?.map(origin => origin.searchCallId)).size).toBe(2); expect(getRun(value.id).used).toBe(2);
});
it('保留交通 URL 的起终点参数，不将不同线路误合并', () => {
  const a = normalizeDeepSeekPage(dsPage('https://example.com/route?from=A&to=B'), 'a')!, b = normalizeDeepSeekPage(dsPage('https://example.com/route?from=A&to=C'), 'b')!;
  expect(mergeSearchPages([a, b])).toHaveLength(2);
});
it('DeepSeek 鉴权失败不丢掉元宝结果，错误码有调用记录', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('deepseek') ? json({ error: 'invalid key' }, 401) : json({ Pages: [ybPage()] })));
  const value = run(), result = await searchSources(value.id, 'venue', { query: 'ds-fails' }, { used: 0 });
  expect(result.pages).toHaveLength(1); expect(result.pages[0].provider).toBe('yuanbao'); expect(result.limitations.join()).toContain('DeepSeek');
  expect(listCalls(value.id).find(call => call.provider === 'deepseek')?.errorCode).toBe('DEEPSEEK_HTTP_401');
});
it('元宝 HTTP200 错误仍是失败，但可使用 DeepSeek 的有效结果', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('deepseek') ? json({ results: [dsPage()] }) : json({ Error: { Code: 'UnauthorizedOperation' }, Pages: [ybPage('https://bad.example/')] })));
  const value = run(), result = await searchSources(value.id, 'venue', { query: 'yb-fails' }, { used: 0 });
  expect(result.pages).toHaveLength(1); expect(result.pages[0].provider).toBe('deepseek'); expect(result.limitations.join()).toContain('元宝');
  expect(listCalls(value.id).find(call => call.provider === 'yuanbao')?.errorCode).toBe('UnauthorizedOperation');
});
it('单配 DeepSeek 不发未配置的元宝请求，不改变原模型配置', async () => {
  vi.stubEnv('WSA_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', '');
  const fetch = vi.fn(async () => json({ results: [dsPage()] })); vi.stubGlobal('fetch', fetch);
  const result = await searchSources(run().id, 'venue', { query: 'ds-only' }, { used: 0 });
  expect(fetch).toHaveBeenCalledTimes(1); expect(result.calls[0].provider).toBe('deepseek'); expect(configuration().search).toBe(true); expect(configuration().llm).toBe(false);
});
it.each([401, 402, 403])('DeepSeek HTTP%s 不重试、不产生搜索证据', async status => {
  const fetch = vi.fn(async () => json({ error: 'not allowed' }, status)); vi.stubGlobal('fetch', fetch);
  const value = run(); await expect(searchDeepSeek(value.id, 'venue', { query: `http-${status}` }, { used: 0 })).rejects.toMatchObject({ code: `DEEPSEEK_HTTP_${status}` });
  expect(fetch).toHaveBeenCalledTimes(1); expect(listCalls(value.id)[0].resultCount).toBe(0);
});
it('瞬态重试也消耗真实请求预算并分别记录', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ results: [dsPage()] })); vi.stubGlobal('fetch', fetch);
  const value = run(), budget = { used: 0 }; const result = await searchDeepSeek(value.id, 'venue', { query: 'retry' }, budget);
  expect(result.pages).toHaveLength(1); expect(getRun(value.id).used).toBe(2); expect(budget.used).toBe(2); expect(listCalls(value.id)).toHaveLength(2);
});
it.each([{ error: 'bad response' }, { results: 'not an array' }, { error: { code: 'Unauthorized' }, results: [dsPage()] }])('异常结构或错误 envelope 不能当作成功结果 %j', async response => {
  vi.stubGlobal('fetch', vi.fn(async () => json(response)));
  const value = run(); await expect(searchDeepSeek(value.id, 'venue', { query: `invalid-${JSON.stringify(response)}` }, { used: 0 })).rejects.toMatchObject({ code: 'DEEPSEEK_RESPONSE' });
  expect(listCalls(value.id)[0].resultCount).toBe(0);
});
it('缓存与元宝分离，缓存命中不消耗预算并重映射溯源', async () => {
  const fetch = vi.fn(async (url: string) => url.includes('deepseek') ? json({ results: [dsPage()] }, 200, { 'x-request-id': 'cached-ds' }) : json({ RequestId: 'cached-yb', Pages: [ybPage()] })); vi.stubGlobal('fetch', fetch);
  const value = run(); const first = await searchSources(value.id, 'venue', { query: 'cache-isolated' }, { used: 0 }), second = await searchSources(value.id, 'venue2', { query: 'cache-isolated' }, { used: 0 });
  expect(fetch).toHaveBeenCalledTimes(2); expect(getRun(value.id).used).toBe(2); expect(second.calls.every(call => call.cacheHit)).toBe(true);
  expect(second.calls.find(call => call.provider === 'deepseek')?.requestId).toBe('cached-ds');
  expect(second.pages[0].searchOrigins?.every(origin => second.calls.some(call => call.id === origin.searchCallId))).toBe(true);
  expect(second.pages[0].id).not.toBe(first.pages[0].id);
});
it('两路共同遵守场馆上限，剩一次时优先保留原元宝请求', async () => {
  const fetch = vi.fn(async (_url: string) => json({ Pages: [ybPage()] })); vi.stubGlobal('fetch', fetch);
  const value = run(), budget = { used: 4, limit: 5 }, result = await searchSources(value.id, 'venue', { query: 'venue-limit' }, budget);
  expect(fetch).toHaveBeenCalledTimes(1); expect(String(fetch.mock.calls[0][0])).toContain('wsa.cloud.tencent.com');
  expect(budget.used).toBe(5); expect(result.pages).toHaveLength(1);
});
it('达到40次总预算后两路均不再发请求', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const value = run();
  for (let index = 0; index < 40; index++) reserveSearch(value.id);
  await expect(searchSources(value.id, 'venue', { query: 'run-budget' }, { used: 0 })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled(); expect(getRun(value.id).used).toBe(40);
});
it('两路都失败时报告真实失败而非虚构证据', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
  await expect(searchSources(run().id, 'venue', { query: 'both-fail' }, { used: 0 })).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
});
it('同一份旧报告仍用原有排序，混合信源不直接比较原始分数', () => {
  const yuanbao = normalizePage(ybPage('https://first.example/rule'), 'a')!, other = normalizePage({ ...ybPage('https://second.example/rule'), score: 0.9 }, 'b')!;
  expect(selectVenueSources([yuanbao, other], '上海博物馆', '上海', null)[0].id).toBe(other.id);
  const deepseek = normalizeDeepSeekPage({ ...dsPage('https://third.example/rule'), rerank_score: 9999999 }, 'c')!;
  expect(selectVenueSources([yuanbao, deepseek], '上海博物馆', '上海', null)[0].id).toBe(yuanbao.id);
});
it('动态天气和公告的双路查询不复用上一次搜索缓存', async () => {
  const fetch = vi.fn(async (url: string) => url.includes('deepseek') ? json({ results: [dsPage()] }) : json({ Pages: [ybPage()] })); vi.stubGlobal('fetch', fetch);
  const value = run(), params = { query: 'fresh-context', freshness: 'd2' };
  await searchSources(value.id, 'dynamic', params, { used: 0 });
  const second = await searchSources(value.id, 'dynamic', params, { used: 0 });
  expect(fetch).toHaveBeenCalledTimes(4); expect(second.calls.every(call => !call.cacheHit)).toBe(true); expect(getRun(value.id).used).toBe(4);
});
it('恢复 Agent 后即使内存计数归零也不能绕过持久化场馆预算', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const value = run();
  for (let index = 0; index < 5; index++) reserveSearch(value.id, 'resumed');
  await expect(searchDeepSeek(value.id, 'resumed', { query: 'persisted-budget' }, { used: 0 })).rejects.toMatchObject({ code: 'VENUE_BUDGET' });
  expect(fetch).not.toHaveBeenCalled(); expect(listCalls(value.id)).toHaveLength(0); expect(getRun(value.id).used).toBe(5);
});
it('已取消的任务即使缓存命中也不会继续检索', async () => {
  const fetch = vi.fn(async () => json({ results: [dsPage()] })); vi.stubGlobal('fetch', fetch);
  const value = run(), params = { query: 'cancelled-cache' };
  await searchDeepSeek(value.id, 'venue', params, { used: 0 });
  database().sqlite.prepare("UPDATE runs SET status='cancelled' WHERE id=?").run(value.id);
  await expect(searchSources(value.id, 'venue', params, { used: 0 })).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
  expect(fetch).toHaveBeenCalledTimes(1); expect(listCalls(value.id)).toHaveLength(1);
});
it('取消信号中断 DeepSeek 网络请求且不被包装为普通搜索失败', async () => {
  vi.stubEnv('WSA_API_KEY', ''); const controller = new AbortController();
  const fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    queueMicrotask(() => controller.abort(new AppError('RUN_CANCELLED', '调查已停止。', 409)));
  })); vi.stubGlobal('fetch', fetch);
  await expect(withRunControl({ signal: controller.signal }, () => searchSources(run().id, 'venue', { query: 'abort-network' }, { used: 0 }))).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
});
it('新版 Agent 的检索工具接入 DeepSeek 并保留调用来源', async () => {
  vi.stubEnv('WSA_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', '');
  const fetch = vi.fn(async () => json({ results: [dsPage()] })); vi.stubGlobal('fetch', fetch);
  const value = run(), current = getTrip(value.tripId), result = emptyResult(), state = initialCheckpoint(value, current);
  await investigateTargets({ run: value, trip: current, result, state, persist: () => saveResult(value.id, result) }, [current.items[0].id], 'hours', null);
  expect(fetch).toHaveBeenCalledTimes(1); expect(listCalls(value.id)[0].provider).toBe('deepseek');
  expect(result.dossiers[0].calls[0].provider).toBe('deepseek'); expect(state.sources[result.dossiers[0].venue.key][0].provider).toBe('deepseek');
});
