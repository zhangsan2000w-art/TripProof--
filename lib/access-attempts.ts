import { createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { database } from '@/db';

const WINDOW = 15 * 60 * 1000;
type Attempt = { failures: number; expires_at: number };

export function accessClientKey(request: NextRequest, secret: string) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return createHmac('sha256', secret).update(ip.slice(0, 256)).digest('hex');
}

// Persist across web process restarts. The global cap also bounds guesses when
// the upstream IP header is unavailable or spoofed. No IP or password is stored.
export function accessRetryAfter(key: string, now = Date.now()) {
  const db = database().sqlite;
  const rows = [
    { row: db.prepare('SELECT failures, expires_at FROM access_attempts WHERE key=?').get(key) as Attempt | undefined, limit: 5 },
    { row: db.prepare('SELECT failures, expires_at FROM access_attempts WHERE key=?').get('global') as Attempt | undefined, limit: 50 },
  ];
  return Math.max(0, ...rows.map(({ row, limit }) => row && row.failures >= limit && row.expires_at > now ? Math.ceil((row.expires_at - now) / 1000) : 0));
}

export function recordAccessFailure(key: string, now = Date.now()) {
  const db = database().sqlite;
  db.transaction(() => {
    db.prepare('DELETE FROM access_attempts WHERE expires_at<=?').run(now);
    const increment = db.prepare('INSERT INTO access_attempts(key,failures,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1');
    increment.run(key, now + WINDOW);
    increment.run('global', now + WINDOW);
  })();
}

export function clearAccessFailures(key: string) {
  database().sqlite.prepare('DELETE FROM access_attempts WHERE key=?').run(key);
}
