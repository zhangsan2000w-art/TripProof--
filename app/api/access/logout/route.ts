import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, accessCookieOptions, privateResponse, validAccessOrigin } from '@/lib/access';

export function POST(request: NextRequest) {
  if (!validAccessOrigin(request)) return privateResponse(NextResponse.json({ error: '请求来源无效。' }, { status: 403 }));
  const response = new NextResponse(null, { status: 303, headers: { Location: '/access' } });
  response.cookies.set(ACCESS_COOKIE, '', { ...accessCookieOptions(request), maxAge: 0 });
  // Keep the itinerary owner cookie: locking the entrance must not lose editing rights.
  return privateResponse(response);
}
