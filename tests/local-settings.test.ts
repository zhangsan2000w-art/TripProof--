import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/local-settings/route';
import { POST as check } from '../app/api/local-settings/check/route';
import { deepseekSetting, yuanbaoApiKeys } from '../lib/search/settings';
import { searchProviders } from '../lib/search/config';
import { requestYuanbaoSearch } from '../lib/search/yuanbao';

const folder = mkdtempSync(join(tmpdir(), 'tripproof-local-deepseek-'));
let environmentYuanbaoKey = '';
const file = join(folder, 'deepseek-settings.json'), url = 'http://127.0.0.1:4317/api/local-settings';
const request = (body?: unknown, headers: Record<string, string> = {}) => new NextRequest(url, { method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:4317', ...(body === undefined ? {} : { 'Content-Type': 'application/json', origin: 'http://127.0.0.1:4317' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  environmentYuanbaoKey = `original-yuanbao-key-${crypto.randomUUID()}`;
  vi.stubEnv('DATABASE_PATH', join(folder, 'test.db')); vi.stubEnv('LOCAL_SETTINGS_ENABLED', '1'); vi.stubEnv('HOSTNAME', '127.0.0.1');
  vi.stubEnv('DEEPSEEK_API_KEY', 'environment-key'); vi.stubEnv('DEEPSEEK_SEARCH_ENABLED', '1'); vi.stubEnv('WSA_AUTH_MODE', 'api-key'); vi.stubEnv('WSA_API_KEY', environmentYuanbaoKey); vi.stubEnv('WSA_API_KEYS', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(file, { force: true }); });
afterAll(() => { rmSync(folder, { recursive: true, force: true }); });

it('显式关闭或监听非本机地址时不开放设置', async () => {
  vi.stubEnv('LOCAL_SETTINGS_ENABLED', '0'); expect((await GET(request())).status).toBe(404);
  vi.stubEnv('LOCAL_SETTINGS_ENABLED', '1'); vi.stubEnv('HOSTNAME', '0.0.0.0'); expect((await POST(request({ DEEPSEEK_API_KEY: 'test' }))).status).toBe(404);
});
it.each<Record<string, string>>([{ origin: '' }, { origin: 'invalid' }, { origin: 'https://evil.example' }, { origin: 'https://127.0.0.1:4317' }, { 'sec-fetch-site': 'cross-site' }])('拒绝异常或跨源写入 %j', async headers => {
  expect((await POST(request({ DEEPSEEK_API_KEY: 'test' }, headers))).status).toBe(403);
});
it('拒绝非本机 Host 和跨站状态读取', async () => {
  expect((await GET(request(undefined, { host: 'evil.example' }))).status).toBe(404);
  expect((await GET(request(undefined, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
});
it('只返回状态，不泄露 Key 或片段；保存不改变原有元宝配置', async () => {
  const response = await POST(request({ DEEPSEEK_API_KEY: 'local-secret-for-contract', DEEPSEEK_SEARCH_ENABLED: '1' }));
  expect(response.status).toBe(200); const text = await response.text(); expect(text).not.toContain('secret'); expect(text).not.toContain('API_KEY');
  expect(JSON.parse(text)).toEqual({ configured: true, enabled: true, yuanbao: true, yuanbaoConfigured: true, yuanbaoKeyCount: 1, yuanbaoEnabled: true, yuanbaoAuthMode: 'api-key' });
  expect((await GET(request())).headers.get('Cache-Control')).toBe('no-store');
  expect(process.env.WSA_API_KEY).toBe(environmentYuanbaoKey); expect(process.env.DEEPSEEK_API_KEY).toBe('environment-key');
  expect(deepseekSetting('DEEPSEEK_API_KEY')).toBe('local-secret-for-contract');
});
it('空提交保留 Key；同进程和新读取可以看到已保存的启用状态', async () => {
  await POST(request({ DEEPSEEK_API_KEY: 'new-local-key' })); await POST(request({ DEEPSEEK_SEARCH_ENABLED: '0' }));
  expect(deepseekSetting('DEEPSEEK_API_KEY')).toBe('new-local-key'); expect(searchProviders()).toEqual({ deepseek: false, yuanbao: true });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ DEEPSEEK_API_KEY: 'new-local-key', DEEPSEEK_SEARCH_ENABLED: '0' });
});
it('移除 Key 不会意外回退到环境变量的旧 Key', async () => {
  const response = await POST(request({ DEEPSEEK_API_KEY: '' })); expect(await response.json()).toMatchObject({ configured: false });
  expect(deepseekSetting('DEEPSEEK_API_KEY')).toBe(''); expect(searchProviders().deepseek).toBe(false);
});
it.each([{ OPENAI_BASE_URL: 'https://evil.example' }, { WSA_AUTH_MODE: 'tencent' }, { WSA_API_KEY: 'key\ninjected' }, { DEEPSEEK_API_KEY: 'key\ninjected' }])('拒绝其他配置及控制字符 %j', async input => {
  expect((await POST(request(input))).status).toBe(400);
});
it('保存元宝服务 Key 后实际请求使用本机值，不改变 DeepSeek 或环境变量，也不回显密钥', async () => {
  const response = await POST(request({ WSA_API_KEY: 'local-yuanbao-secret', WSA_SEARCH_ENABLED: '1' }));
  const text = await response.text(); expect(response.status).toBe(200); expect(text).not.toContain('secret'); expect(text).not.toContain('API_KEY');
  expect(JSON.parse(text)).toMatchObject({ yuanbao: true, yuanbaoConfigured: true, yuanbaoAuthMode: 'api-key' });
  expect(deepseekSetting('DEEPSEEK_API_KEY')).toBe('environment-key'); expect(process.env.WSA_API_KEY).toBe(environmentYuanbaoKey);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ Response: { Pages: [], RequestId: 'service-request' } }))); vi.stubGlobal('fetch', fetch);
  await requestYuanbaoSearch({ Query: 'rules' });
  expect(fetch.mock.calls).toHaveLength(1);
  const [url, options] = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
  expect(url).toBe('https://api.wsa.cloud.tencent.com/SearchPro');
  expect(new Headers(options.headers).get('Authorization')).toBe('Bearer local-yuanbao-secret');
});
it('两路密钥独立保存；元宝启停和删除不回退旧 Key', async () => {
  await POST(request({ WSA_API_KEY: 'yuanbao-local' })); await POST(request({ DEEPSEEK_API_KEY: 'deepseek-local' }));
  await POST(request({ WSA_SEARCH_ENABLED: '0' }));
  expect(searchProviders()).toEqual({ yuanbao: false, deepseek: true });
  expect(await (await GET(request())).json()).toMatchObject({ yuanbaoConfigured: true, yuanbaoEnabled: false });
  await POST(request({ WSA_SEARCH_ENABLED: '1' })); expect(searchProviders().yuanbao).toBe(true);
  await POST(request({ WSA_API_KEY: '' })); expect(searchProviders().yuanbao).toBe(false);
  expect(deepseekSetting('WSA_API_KEY')).toBe(''); expect(deepseekSetting('DEEPSEEK_API_KEY')).toBe('deepseek-local');
  await expect(requestYuanbaoSearch({ Query: 'rules' })).rejects.toMatchObject({ code: 'SEARCH_NOT_CONFIGURED' });
});
it('多 Key 可保存换行、逗号和重复项，只返回去重后的数量', async () => {
  const response = await POST(request({ WSA_API_KEYS: 'pool-local-a, pool-local-b\npool-local-a' }));
  expect(response.status).toBe(200); const text = await response.text();
  expect(JSON.parse(text)).toMatchObject({ yuanbaoKeyCount: 2, yuanbaoConfigured: true, yuanbaoAuthMode: 'api-key' });
  expect(text).not.toContain('pool-local'); expect(yuanbaoApiKeys()).toEqual(['pool-local-a', 'pool-local-b']);
  await POST(request({ WSA_SEARCH_ENABLED: '0' })); expect(yuanbaoApiKeys()).toHaveLength(2); expect(searchProviders().yuanbao).toBe(false);
});
it('本机单 Key 和多 Key 互相替换，显式移除后不回退任一环境密钥', async () => {
  vi.stubEnv('WSA_API_KEYS', 'environment-pool-a,environment-pool-b');
  await POST(request({ WSA_API_KEY: 'single-local' })); expect(yuanbaoApiKeys()).toEqual(['single-local']);
  await POST(request({ WSA_API_KEYS: 'pool-local-a,pool-local-b' })); expect(yuanbaoApiKeys()).toEqual(['pool-local-a', 'pool-local-b']);
  expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('WSA_API_KEY');
  await POST(request({ WSA_API_KEY: 'another-single' })); expect(yuanbaoApiKeys()).toEqual(['another-single']);
  expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('WSA_API_KEYS');
  await POST(request({ WSA_API_KEYS: '' })); expect(yuanbaoApiKeys()).toEqual([]); expect(searchProviders().yuanbao).toBe(false);
});
it.each([{ WSA_API_KEYS: 'valid\ninvalid key' }, { WSA_API_KEYS: 'valid,invalid\tkey' }, { WSA_API_KEYS: Array.from({ length: 33 }, (_, i) => `key-${i}`).join(',') }, { WSA_API_KEY: 'single', WSA_API_KEYS: 'pool' }])('拒绝无效或有歧义的多 Key 配置', async input => {
  const response = await POST(request(input)); expect(response.status).toBe(400); expect(await response.text()).not.toContain('invalid key');
  expect(yuanbaoApiKeys()).toEqual([environmentYuanbaoKey]);
});
it('无本机覆盖时保留旧云鉴权；填服务 Key 后使用 API 鉴权，移除也不退回旧云密钥', async () => {
  vi.stubEnv('WSA_AUTH_MODE', 'tencent'); vi.stubEnv('TENCENTCLOUD_SECRET_ID', 'legacy-id'); vi.stubEnv('TENCENTCLOUD_SECRET_KEY', 'legacy-secret');
  expect(await (await GET(request())).json()).toMatchObject({ yuanbao: true, yuanbaoAuthMode: 'tencent' });
  await POST(request({ WSA_API_KEY: 'service-key' })); expect(deepseekSetting('WSA_AUTH_MODE')).toBe('api-key');
  expect(await (await GET(request())).json()).toMatchObject({ yuanbaoAuthMode: 'api-key' });
  await POST(request({ WSA_API_KEY: '' })); expect(searchProviders().yuanbao).toBe(false);
});
it('元宝验证使用同一鉴权适配器，返回解析后的条数而非原始响应', async () => {
  await POST(request({ WSA_API_KEY: 'probe-yuanbao' }));
  const fetch = vi.fn(async () => new Response(JSON.stringify({ Response: { Pages: [{ url: 'https://example.com/rule', title: '规则', content: '原文' }, { url: 'javascript:alert(1)' }], RequestId: 'yuanbao-probe' } }))); vi.stubGlobal('fetch', fetch);
  const response = await check(request({ provider: 'yuanbao' })); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ resultCount: 1, bodyCount: 1, requestId: 'yuanbao-probe' });
  const [, options] = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
  expect(new Headers(options.headers).get('Authorization')).toBe('Bearer probe-yuanbao');
});
it.each([401, 403, 500])('元宝验证 HTTP %s 不报告为成功', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
  const response = await check(request({ provider: 'yuanbao' })); expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ code: `SEARCH_HTTP_${status}` });
});
it.each([{ Error: { Code: 'AuthFailure', Message: 'sensitive-upstream-error' } }, {}, { Pages: [], Msg: 'hit black query' }])('元宝错误响应与异常结构不报告成功 %j', async raw => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ Response: raw }))));
  const response = await check(request({ provider: 'yuanbao' })); expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('sensitive-upstream-error');
});
it('元宝空结果明确返回零；未知提供方不发网络请求', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ Pages: [] }))); vi.stubGlobal('fetch', fetch);
  expect(await (await check(request({ provider: 'yuanbao' }))).json()).toMatchObject({ resultCount: 0, bodyCount: 0 });
  fetch.mockClear(); expect((await check(request({ provider: 'unknown' }))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
});
it('验证接口使用已保存的 Key，并返回真实解析出的结果数', async () => {
  await POST(request({ DEEPSEEK_API_KEY: 'probe-local-key' }));
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ results: [{ url: 'https://example.com/rule', title: '开放规则', content: '开放时间' }, { url: 'javascript:alert(1)' }] }), { headers: { 'x-request-id': 'probe-id' } })); vi.stubGlobal('fetch', fetch);
  const response = await check(request({})); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ resultCount: 1, bodyCount: 1, requestId: 'probe-id' });
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer probe-local-key');
});
it.each([401, 402, 403, 500])('验证接口保留 HTTP %s 错误，不报告为成功', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
  const response = await check(request({})); expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ code: `DEEPSEEK_HTTP_${status}` });
});
it('返回空结果时明确报告 0 条，返回异常结构时报错', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [] }))));
  expect(await (await check(request({}))).json()).toMatchObject({ resultCount: 0, bodyCount: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [], error: 'failed' }))));
  expect((await check(request({}))).status).toBe(502);
});
