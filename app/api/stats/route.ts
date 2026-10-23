import { NextResponse } from 'next/server';
import { statistics } from '@/lib/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(statistics(), { headers: { 'Cache-Control': 'no-store' } }); }
