import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, errorMessage } from './errors';
import { ownerHash, token } from './store';
import { privateCookieOptions } from './access';
export function session(req: NextRequest) {
  const existing = req.cookies.get('tp_session')?.value;
  const value = existing && /^[A-Za-z0-9_-]{32}$/.test(existing) ? existing : token();
  return { value, owner: ownerHash(value), fresh: value !== existing };
}
export function respond(req: NextRequest, data: unknown, status = 200) {
  const result = NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  const s = session(req);
  if (s.fresh) result.cookies.set('tp_session', s.value, { ...privateCookieOptions(req), maxAge: 60 * 60 * 24 * 90 });
  return result;
}
export function respondWithSession(req: NextRequest, value: string, data: unknown, status = 200) {
  const result = NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  result.cookies.set('tp_session', value, { ...privateCookieOptions(req), maxAge: 60 * 60 * 24 * 90 });
  return result;
}
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin) {
    let parsed:URL;try{parsed=new URL(origin);}catch{throw new AppError('BAD_ORIGIN','请求来源无效。',403);}
    if (!['http:','https:'].includes(parsed.protocol) || (parsed.host !== req.headers.get('host') && parsed.origin !== process.env.APP_URL)) throw new AppError('BAD_ORIGIN', '请求来源无效。', 403);
  }
}
export async function jsonBody(req: NextRequest, max = 1_000_000): Promise<unknown> {
  sameOrigin(req);
  if (Number(req.headers.get('content-length') || 0) > max) throw new AppError('BODY_TOO_LARGE', '内容过大，请减少图片数量或尺寸。', 413);
  const reader = req.body?.getReader(); if (!reader) throw new AppError('EMPTY_BODY', '请提交有效内容。');
  const buffers: Uint8Array[] = []; let size = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > max) { await reader.cancel(); throw new AppError('BODY_TOO_LARGE', '内容过大，请减少图片数量或尺寸。', 413); } buffers.push(chunk.value); }
  try { return JSON.parse(Buffer.concat(buffers).toString()); } catch { throw new AppError('INVALID_JSON', '提交内容不是有效 JSON。'); }
}
export function failure(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: '输入格式不正确，请检查日期、时间与必填项。', code: 'VALIDATION_ERROR', fields: error.issues.map(e => ({ path: e.path.join('.'), message: e.message })).slice(0, 10) }, { status: 400 });
  return NextResponse.json({ error: errorMessage(error), code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' }, { status: error instanceof AppError ? error.status : 500 });
}
