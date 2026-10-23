import type { APIRequestContext } from '@playwright/test';

// Test clients must use the same entrance as a browser; never bypass production
// authentication via a special header or an exported signing secret.
export async function unlockTestClient(context: APIRequestContext, base: string) {
  const status = await context.get(`${base}/api/stats`);
  if (status.status() !== 401) { if (!status.ok()) throw new Error(`应用尚未就绪：HTTP ${status.status()}`); return; }
  const password = process.env.ACCESS_PASSWORD;
  if (!password) throw new Error('测试目标已启用入口密码，请在本地环境变量设置 ACCESS_PASSWORD。');
  const response = await context.post(`${base}/api/access/login`, { form: { password, next: '/' }, maxRedirects: 0 });
  if (response.status() !== 303 || response.headers().location !== '/') throw new Error('测试客户端无法解锁入口，请检查密码或稍后重试。');
}

export async function testAccessCookie(base: string) {
  const status = await fetch(`${base}/api/stats`);
  if (status.status !== 401) { if (!status.ok) throw new Error(`应用尚未就绪：HTTP ${status.status}`); return ''; }
  const password = process.env.ACCESS_PASSWORD;
  if (!password) throw new Error('测试目标已启用入口密码，请在本地环境变量设置 ACCESS_PASSWORD。');
  const response = await fetch(`${base}/api/access/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password, next: '/' }), redirect: 'manual' });
  if (response.status !== 303 || response.headers.get('location') !== '/') throw new Error('测试客户端无法解锁入口，请检查密码或稍后重试。');
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
