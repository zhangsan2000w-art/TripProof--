import { NextRequest, NextResponse } from 'next/server';
import { failure, jsonBody } from '@/lib/http';
import { searchProviders } from '@/lib/search/config';
import { deepseekSetting, searchSetting, requireLocalSettings, saveSearchSettings, yuanbaoApiKeys } from '@/lib/search/settings';

export const runtime = 'nodejs';
function status() {
  const yuanbaoAuthMode = searchSetting('WSA_AUTH_MODE') === 'tencent' ? 'tencent' : 'api-key';
  const yuanbaoKeyCount = yuanbaoAuthMode === 'tencent' ? 0 : yuanbaoApiKeys().length;
  const yuanbaoConfigured = yuanbaoAuthMode === 'tencent' ? Boolean(process.env.TENCENTCLOUD_SECRET_ID && process.env.TENCENTCLOUD_SECRET_KEY) : yuanbaoKeyCount > 0;
  return NextResponse.json({ configured: Boolean(deepseekSetting('DEEPSEEK_API_KEY')?.trim()), enabled: deepseekSetting('DEEPSEEK_SEARCH_ENABLED') !== '0', yuanbao: searchProviders().yuanbao, yuanbaoConfigured, yuanbaoKeyCount, yuanbaoEnabled: searchSetting('WSA_SEARCH_ENABLED') !== '0', yuanbaoAuthMode }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(req: NextRequest) {
  try { requireLocalSettings(req); return status(); } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try { requireLocalSettings(req, true); saveSearchSettings(await jsonBody(req, 20000)); return status(); }
  catch (error) { return failure(error); }
}
