import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/local-settings/route';
import { POST as check } from '../app/api/local-settings/check/route';
import { deepseekSetting } from '../lib/search/settings';
import { searchProviders } from '../lib/search/config';

const folder = mkdtempSync(join(tmpdir(), 'tripproof-local-deepseek-'));
const file = join(folder, 'deepseek-settings.json'), url = 'http://127.0.0.1:4317/api/local-settings';
const request = (body?: unknown, headers: Record<string, string> = {}) => new NextRequest(url, { method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:4317', ...(body === undefined ? {} : { 'Content-Type': 'application/json', origin: 'http://127.0.0.1:4317' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.stubEnv('DATABASE_PATH', join(folder, 'test.db')); vi.stubEnv('LOCAL_SETTINGS_ENABLED', '1'); vi.stubEnv('HOSTNAME', '127.0.0.1');
  vi.stubEnv('DEEPSEEK_API_KEY', 'environment-key'); vi.stubEnv('DEEPSEEK_SEARCH_ENABLED', '1'); vi.stubEnv('WSA_AUTH_MODE', 'api-key'); vi.stubEnv('WSA_API_KEY', 'original-yuanbao-key');
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
  expect(JSON.parse(text)).toEqual({ configured: true, enabled: true, yuanbao: true });
  expect((await GET(request())).headers.get('Cache-Control')).toBe('no-store');
  expect(process.env.WSA_API_KEY).toBe('original-yuanbao-key'); expect(process.env.DEEPSEEK_API_KEY).toBe('environment-key');
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
it.each([{ OPENAI_BASE_URL: 'https://evil.example' }, { WSA_API_KEY: 'replacement' }, { DEEPSEEK_API_KEY: 'key\ninjected' }])('拒绝其他配置及控制字符 %j', async input => {
  expect((await POST(request(input))).status).toBe(400);
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
