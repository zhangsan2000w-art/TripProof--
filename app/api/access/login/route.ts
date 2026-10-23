import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, accessConfig, accessCookieOptions, createAccessToken, passwordMatches, privateResponse, safeAccessNext, validAccessOrigin } from '@/lib/access';
import { accessClientKey, accessRetryAfter, clearAccessFailures, recordAccessFailure } from '@/lib/access-attempts';

export const runtime = 'nodejs';

function back(next: string, error: string, retryAfter?: number) {
  const response = new NextResponse(null, { status: 303, headers: { Location: `/access?${new URLSearchParams({ next, error, ...(retryAfter ? { retry: String(retryAfter) } : {}) })}` } });
  if (retryAfter) response.headers.set('Retry-After', String(retryAfter));
  return privateResponse(response);
}

export async function POST(request: NextRequest) {
  if (!validAccessOrigin(request)) return privateResponse(NextResponse.json({ error: '请求来源无效。' }, { status: 403 }));
  const config = accessConfig();
  if (config.mode === 'invalid') return privateResponse(NextResponse.json({ error: '访问保护尚未配置完成，请联系部署者。' }, { status: 503 }));
  if (config.mode === 'off') return privateResponse(new NextResponse(null, { status: 303, headers: { Location: '/' } }));
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') return privateResponse(NextResponse.json({ error: '请通过访问密码表单提交。' }, { status: 415 }));
  const reader = request.body?.getReader();
  if (!reader) return back('/', 'invalid');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 4096) { await reader.cancel(); return privateResponse(NextResponse.json({ error: '提交内容过大。' }, { status: 413 })); }
    chunks.push(value);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const next = safeAccessNext(form.get('next')), key = accessClientKey(request, config.secret);
  const retryAfter = accessRetryAfter(key);
  if (retryAfter) return back(next, 'limited', retryAfter);
  if (!passwordMatches(form.get('password') || '', config)) { recordAccessFailure(key); return back(next, 'invalid'); }
  clearAccessFailures(key);
  const response = new NextResponse(null, { status: 303, headers: { Location: next } });
  response.cookies.set(ACCESS_COOKIE, createAccessToken(config), accessCookieOptions(request));
  return privateResponse(response);
}
