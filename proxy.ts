import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, accessConfig, privateResponse, validAccessToken } from '@/lib/access';

export function proxy(request: NextRequest) {
  const config = accessConfig();
  if (config.mode === 'off') return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (['/access', '/api/access/login', '/api/access/logout', '/api/health'].includes(pathname)) return privateResponse(NextResponse.next());
  if (validAccessToken(request.cookies.get(ACCESS_COOKIE)?.value, config)) return privateResponse(NextResponse.next());
  if (pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) {
    return privateResponse(NextResponse.json({ code: config.mode === 'invalid' ? 'ACCESS_NOT_CONFIGURED' : 'ACCESS_REQUIRED', error: config.mode === 'invalid' ? '访问保护尚未配置完成，请联系部署者。' : '请先输入访问密码。' }, { status: config.mode === 'invalid' ? 503 : 401 }));
  }
  // Next's Proxy adapter requires an absolute Location (route handlers can use
  // relative ones). Preserve the incoming host for localhost and deployed URLs.
  const login = request.nextUrl.clone();
  login.pathname = '/access'; login.search = '';
  login.searchParams.set('next', `${pathname}${search}`);
  if (request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https' || process.env.APP_URL?.startsWith('https://')) login.protocol = 'https:';
  return privateResponse(NextResponse.redirect(login));
}

export const config = { matcher: ['/((?!_next/static/|favicon.ico$|icon.svg$).*)'] };
