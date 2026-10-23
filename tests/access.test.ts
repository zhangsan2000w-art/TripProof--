import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { database } from '../db';
import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessConfig, createAccessToken, safeAccessNext, validAccessToken } from '../lib/access';
import { accessRetryAfter, recordAccessFailure } from '../lib/access-attempts';
import { proxy } from '../proxy';
import { POST as login } from '../app/api/access/login/route';
import { POST as logout } from '../app/api/access/logout/route';
import { GET as health } from '../app/api/health/route';
import nextConfig from '../next.config';
import { respondWithSession } from '../lib/http';

const folder = mkdtempSync(join(tmpdir(), 'tripproof-access-'));
const config = { mode: 'on' as const, password: '1024', secret: 'test-only-secret-'.repeat(4) };
beforeAll(() => { process.env.DATABASE_PATH = join(folder, 'test.db'); });
afterEach(() => { vi.unstubAllEnvs(); database().sqlite.prepare('DELETE FROM access_attempts').run(); });
afterAll(() => { database().sqlite.close(); delete (globalThis as { tripproofDB?: unknown }).tripproofDB; rmSync(folder, { recursive: true, force: true }); });

function enable() {
  vi.stubEnv('ACCESS_REQUIRED', '1'); vi.stubEnv('ACCESS_PASSWORD', config.password); vi.stubEnv('ACCESS_SESSION_SECRET', config.secret); vi.stubEnv('APP_URL', 'http://localhost:3000');
}
function request(path: string, options: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {}) { return new NextRequest(`http://localhost:3000${path}`, options); }
function submit(password: string, next = '/', headers: Record<string, string> = {}) {
  return request('/api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost:3000', ...headers }, body: new URLSearchParams({ password, next }).toString() });
}

it('本地可关闭；要求保护时缺少密码或高熵签名密钥必须锁定', () => {
  vi.stubEnv('ACCESS_REQUIRED', '0'); vi.stubEnv('ACCESS_PASSWORD', ''); expect(accessConfig().mode).toBe('off');
  vi.stubEnv('ACCESS_REQUIRED', '1'); expect(accessConfig().mode).toBe('invalid');
  vi.stubEnv('ACCESS_PASSWORD', '1024'); vi.stubEnv('ACCESS_SESSION_SECRET', 'short'); expect(accessConfig().mode).toBe('invalid');
});
it('签名 Cookie 可验证，过期、未来、篡改、直接填密码均拒绝', () => {
  const now = Date.now(), value = createAccessToken(config, now);
  expect(validAccessToken(value, config, now)).toBe(true);
  expect(validAccessToken(value, config, now + ACCESS_MAX_AGE * 1000)).toBe(false);
  expect(validAccessToken(value, config, now - 1000)).toBe(false);
  expect(validAccessToken(`${value.slice(0, -1)}!`, config, now)).toBe(false);
  expect(validAccessToken('1024', config, now)).toBe(false);
  expect(validAccessToken(undefined, config)).toBe(false);
});
it('修改密码或签名密钥立即使旧 Cookie 失效', () => {
  const value = createAccessToken(config);
  expect(validAccessToken(value, { ...config, password: 'new password' })).toBe(false);
  expect(validAccessToken(value, { ...config, secret: 'another secret'.repeat(4) })).toBe(false);
});
it('回跳限于本站，拒绝外站、反斜杠、控制字符和登录循环', () => {
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/%5cevil.example', '/a%0d%0aLocation:evil', '/access', '/access?next=/access', '/api/access/logout', ['/', '//evil.example']]) expect(safeAccessNext(value)).toBe('/');
  expect(safeAccessNext('/r/report?day=1#stop')).toBe('/r/report?day=1#stop');
});
it.each(['/', '/trips/private', '/r/shared-report', '/r/report.pdf', '/_next/image?url=%2Fr%2Freport'])('未解锁页面 %s 返回密码入口，不泄露内容', path => {
  enable(); const response = proxy(request(path));
  expect(response.status).toBe(307); expect(new URL(response.headers.get('location')!).pathname).toBe('/access');
  expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
});
it.each(['/api/stats', '/api/trips', '/api/extract', '/api/trips/t/runs', '/api/runs/r/events', '/api/reports/r/links', '/api/trips/t/alternatives', '/api/feedback'])('未解锁接口 %s 返回 401', path => {
  enable(); expect(proxy(request(path)).status).toBe(401);
  expect(proxy(request(path, { method: 'POST', headers: { 'x-middleware-subrequest': 'proxy' } })).status).toBe(401);
});
it('强制保护配置不全时，页面保持入口锁定、接口和健康检查返回 503', async () => {
  enable(); vi.stubEnv('ACCESS_PASSWORD', '');
  expect(proxy(request('/r/report')).status).toBe(307); expect(proxy(request('/api/stats')).status).toBe(503);
  expect((await health()).status).toBe(503);
});
it('健康检查仅暴露最小存活状态，不公开配置', async () => {
  enable(); const response = await health(); expect(await response.json()).toEqual({ ok: true, sourceCommit: null });
});
it('正确密码登录、仅服务端 Cookie、回到原报告', async () => {
  enable(); const response = await login(submit('1024', '/r/report?day=2'));
  expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('/r/report?day=2');
  const value = response.cookies.get(ACCESS_COOKIE)?.value;
  expect(validAccessToken(value, config)).toBe(true);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly'); expect(response.headers.get('set-cookie')).toContain('SameSite=lax');
  expect(response.headers.get('set-cookie')).not.toContain('1024');
  expect(proxy(request('/api/stats', { headers: { Cookie: `${ACCESS_COOKIE}=${value}` } })).headers.get('x-middleware-next')).toBe('1');
});
it('反向代理 HTTPS 下 Cookie 标记 Secure，回跳仍用相对地址', async () => {
  enable(); vi.stubEnv('APP_URL', 'https://trip.example.com');
  const response = await login(submit('1024', '/', { Origin: 'https://trip.example.com' }));
  expect(response.headers.get('set-cookie')).toContain('Secure'); expect(response.headers.get('location')).toBe('/');
});
it('魔搭框架中的入口与行程 Cookie 均使用安全分区，锁定可清除同一分区的 Cookie', async () => {
  enable(); vi.stubEnv('APP_FRAME_MODE', 'modelscope'); vi.stubEnv('APP_URL', 'https://demo.ms.show');
  const response = await login(submit('1024', '/', { Origin: 'https://demo.ms.show' }));
  expect(response.status).toBe(303);
  const ownerResponse = respondWithSession(request('/api/trips'), 'test-owner-session', { ok: true });
  const locked = logout(request('/api/access/logout', { method: 'POST' }));
  for (const value of [response, ownerResponse, locked]) {
    expect(value.headers.get('set-cookie')).toContain('HttpOnly');
    expect(value.headers.get('set-cookie')).toContain('Secure');
    expect(value.headers.get('set-cookie')).toContain('SameSite=none');
    expect(value.headers.get('set-cookie')).toContain('Partitioned');
  }
  expect(locked.cookies.get(ACCESS_COOKIE)?.maxAge).toBe(0);
});
it('魔搭模式仍拒绝来自其他站点或父页面的登录请求', async () => {
  enable(); vi.stubEnv('APP_FRAME_MODE', 'modelscope'); vi.stubEnv('APP_URL', 'https://demo.ms.show');
  for (const origin of ['https://evil.example', 'https://www.modelscope.cn']) expect((await login(submit('1024', '/', { Origin: origin }))).status).toBe(403);
  expect((await login(submit('1024', '/', { Origin: 'https://demo.ms.show', 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
});
it.each(['', 'unknown', 'modelscope'])('嵌入配置 %s 只允许明确的魔搭父站，其余构建保持禁止嵌入', async mode => {
  vi.stubEnv('APP_FRAME_MODE', mode);
  const headers = Object.fromEntries((await nextConfig.headers!())[0].headers.map(({ key, value }) => [key, value]));
  if (mode === 'modelscope') {
    expect(headers['Content-Security-Policy']).toBe('frame-ancestors https://www.modelscope.cn https://modelscope.cn');
    expect(headers['X-Frame-Options']).toBeUndefined();
  } else {
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'");
  }
});
it('错误密码没有登录 Cookie，错误提示不带回明文密码', async () => {
  enable(); const response = await login(submit('wrong-password', '/r/report'));
  expect(response.headers.get('location')).toContain('error=invalid'); expect(response.headers.get('location')).not.toContain('wrong-password');
  expect(response.cookies.get(ACCESS_COOKIE)).toBeUndefined();
});
it('五次失败后限速，正确密码也需等窗口结束；限速有重试时间', async () => {
  enable(); for (let i = 0; i < 5; i++) await login(submit('wrong'));
  const response = await login(submit('1024'));
  expect(response.headers.get('location')).toContain('error=limited'); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(response.cookies.get(ACCESS_COOKIE)).toBeUndefined();
});
it('切换伪造 IP 也受总失败预算约束，过期后可以重试', () => {
  const now = Date.now(); for (let i = 0; i < 50; i++) recordAccessFailure(`different-ip-${i}`, now);
  expect(accessRetryAfter('fresh-ip', now)).toBe(900); expect(accessRetryAfter('fresh-ip', now + 900000)).toBe(0);
});
it('拒绝跨站登录和锁定请求；过大表单不能绕过大小限制', async () => {
  enable(); expect((await login(submit('1024', '/', { Origin: 'https://evil.example' }))).status).toBe(403);
  expect(logout(request('/api/access/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  expect((await login(submit('x'.repeat(5000)))).status).toBe(413);
});
it('锁定只删除入口 Cookie，不删除行程编辑权限', () => {
  enable(); const response = logout(request('/api/access/logout', { method: 'POST' }));
  expect(response.headers.get('location')).toBe('/access'); expect(response.cookies.get(ACCESS_COOKIE)?.maxAge).toBe(0);
  expect(response.cookies.get('tp_session')).toBeUndefined();
});
