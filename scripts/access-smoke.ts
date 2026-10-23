import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { testAccessCookie } from './test-access';

const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const result = { checkedAt: new Date().toISOString(), scope: '生产模式入口保护 + 已存 golden 报告；不调用外部搜索', lockedPages: [] as string[], lockedApis: [] as string[], goldenReports: [] as { case: string; locked: number; unlocked: number }[], passed: false };
for (const path of ['/', '/trips/private', '/r/-rp4oDwvjV1OVU0lqO016NbagrJD3bOS', '/r/file.pdf', '/_next/image?url=%2Fr%2Fprivate&w=640&q=75']) {
  const response = await fetch(base + path, { redirect: 'manual' });
  assert.equal(response.status, 307, path); assert.equal(new URL(response.headers.get('location')!, base).pathname, '/access'); result.lockedPages.push(path);
}
for (const [path, method] of [['/api/stats', 'GET'], ['/api/trips', 'POST'], ['/api/extract', 'POST'], ['/api/trips/t/runs', 'POST'], ['/api/runs/r/events', 'GET'], ['/api/reports/r/links', 'POST'], ['/api/trips/t/alternatives', 'POST'], ['/api/feedback', 'POST']]) {
  const response = await fetch(base + path, { method, redirect: 'manual', headers: { 'x-middleware-subrequest': 'proxy' } });
  assert.equal(response.status, 401, path); assert.equal((await response.json()).code, 'ACCESS_REQUIRED'); result.lockedApis.push(path);
}
assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true });
const bad = await fetch(base + '/api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: new URLSearchParams({ password: 'deliberately-wrong', next: '/' }), redirect: 'manual' });
assert.equal(bad.status, 303); assert.match(bad.headers.get('location')!, /error=invalid/); assert.equal(bad.headers.get('set-cookie'), null);
const cookie = await testAccessCookie(base); assert.ok(cookie);
const home = await fetch(base + '/', { headers: { Cookie: cookie } });
assert.equal(home.status, 200); assert.match(await home.text(), /锁定访问/); assert.match(home.headers.get('cache-control')!, /no-store/);
const samples = JSON.parse(await readFile('.data/sample-reports.json', 'utf8')) as { reports: { case: string; shareId: string }[] };
for (const spec of samples.reports) {
  const path = '/r/' + spec.shareId;
  assert.equal((await fetch(base + path, { redirect: 'manual' })).status, 307);
  const response = await fetch(base + path, { headers: { Cookie: cookie } });
  const html = await response.text(); assert.equal(response.status, 200); assert.match(html, /行程结论/); assert.match(html, /行程核对报告/);
  result.goldenReports.push({ case: spec.case, locked: 307, unlocked: 200 });
}
assert.equal(result.goldenReports.length, 4);
assert.equal((await fetch(base + '/api/stats', { headers: { Cookie: cookie } })).status, 200);
assert.equal((await fetch(base + '/api/stats', { headers: { Cookie: 'tp_access=forged' } })).status, 401);
const cross = await fetch(base + '/api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' }, body: new URLSearchParams({ password: 'irrelevant' }), redirect: 'manual' });
assert.equal(cross.status, 403);
const locked = await fetch(base + '/api/access/logout', { method: 'POST', headers: { Origin: base, Cookie: cookie }, redirect: 'manual' });
assert.equal(locked.status, 303); assert.match(locked.headers.get('set-cookie')!, /Max-Age=0/);
result.passed = true;
await mkdir('artifacts/access', { recursive: true }); await writeFile('artifacts/access/http.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
