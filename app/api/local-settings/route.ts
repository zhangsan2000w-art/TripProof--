import { NextRequest, NextResponse } from 'next/server';
import { failure, jsonBody } from '@/lib/http';
import { searchProviders } from '@/lib/search/config';
import { deepseekSetting, requireLocalSettings, saveDeepseekSettings } from '@/lib/search/settings';

export const runtime = 'nodejs';
function status() {
  return NextResponse.json({ configured: Boolean(deepseekSetting('DEEPSEEK_API_KEY')?.trim()), enabled: deepseekSetting('DEEPSEEK_SEARCH_ENABLED') !== '0', yuanbao: searchProviders().yuanbao }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(req: NextRequest) {
  try { requireLocalSettings(req); return status(); } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try { requireLocalSettings(req, true); saveDeepseekSettings(await jsonBody(req, 2048)); return status(); }
  catch (error) { return failure(error); }
}
