import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'tp_access';
export const ACCESS_MAX_AGE = 7 * 24 * 60 * 60;
export type AccessConfig = { mode: 'off' } | { mode: 'invalid' } | { mode: 'on'; password: string; secret: string };

// Read at request time: deployment credentials are injected after the image is built.
export function accessConfig(): AccessConfig {
  const password = process.env.ACCESS_PASSWORD || '';
  if (!password && process.env.ACCESS_REQUIRED !== '1') return { mode: 'off' };
  const secret = process.env.ACCESS_SESSION_SECRET || '';
  if (!password || secret.length < 32) return { mode: 'invalid' };
  return { mode: 'on', password, secret };
}

export function passwordMatches(input: string, config: Extract<AccessConfig, { mode: 'on' }>) {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(input), hash(config.password));
}

function signature(body: string, config: Extract<AccessConfig, { mode: 'on' }>) {
  // An independent random secret prevents the four-digit entry password from being
  // guessed offline from a cookie. Changing either setting invalidates all cookies.
  return createHmac('sha256', config.secret).update(JSON.stringify([config.password, body])).digest('base64url');
}

export function createAccessToken(config: Extract<AccessConfig, { mode: 'on' }>, now = Date.now()) {
  const body = `v1.${Math.floor(now / 1000)}.${randomBytes(24).toString('base64url')}`;
  return `${body}.${signature(body, config)}`;
}

export function validAccessToken(token: string | undefined, config: AccessConfig, now = Date.now()) {
  if (config.mode === 'off') return true;
  if (config.mode !== 'on' || !token || token.length > 256) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d{10,12}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{32}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) return false;
  const age = Math.floor(now / 1000) - Number(parts[1]);
  if (age < 0 || age >= ACCESS_MAX_AGE) return false;
  const expected = signature(parts.slice(0, 3).join('.'), config);
  return timingSafeEqual(Buffer.from(parts[3]), Buffer.from(expected));
}

export function safeAccessNext(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || /[\\\x00-\x20]|%5c|%0[ad]/i.test(value)) return '/';
  try {
    const url = new URL(value, 'http://tripproof.invalid');
    if (url.origin !== 'http://tripproof.invalid' || /^\/(?:access|api\/access)(?:\/|$)/.test(url.pathname)) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

export function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}

export function accessCookieOptions(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' || process.env.APP_URL?.startsWith('https://') === true || request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: ACCESS_MAX_AGE };
}

export function validAccessOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && (parsed.origin === process.env.APP_URL || parsed.origin === new URL(request.url).origin || parsed.host === request.headers.get('host'));
  } catch { return false; }
}
