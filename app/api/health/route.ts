import { NextResponse } from 'next/server';
import { database } from '@/db';
import { accessConfig } from '@/lib/access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (accessConfig().mode === 'invalid') return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  database(); return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
