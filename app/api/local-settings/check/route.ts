import { NextRequest, NextResponse } from 'next/server';
import { failure } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { deepseekSetting, requireLocalSettings } from '@/lib/search/settings';
import { deepseekBody, deepseekResponseSchema, deepseekSearchEndpoint, normalizeDeepSeekPage } from '@/lib/search/deepseek';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    requireLocalSettings(req, true);
    const key = deepseekSetting('DEEPSEEK_API_KEY')?.trim();
    if (!key) throw new AppError('DEEPSEEK_NOT_CONFIGURED', '请先保存 DeepSeek API Key。');
    const began = Date.now();
    const response = await fetch(deepseekSearchEndpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(deepseekBody({ query: '中国丝绸博物馆 官方 开放时间', cnt: 5 })), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new AppError(`DEEPSEEK_HTTP_${response.status}`, response.status === 402 ? 'DeepSeek 搜索余额不足。' : [401, 403].includes(response.status) ? 'DeepSeek 搜索鉴权失败，请核对 Key 和权限。' : 'DeepSeek 搜索暂时不可用。', 502);
    const parsed = deepseekResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new AppError('DEEPSEEK_RESPONSE', 'DeepSeek 返回结构异常，未获得有效检索结果。', 502);
    const pages = parsed.data.results.map(page => normalizeDeepSeekPage(page, 'connection-check')).filter(page => page !== null);
    return NextResponse.json({ resultCount: pages.length, bodyCount: pages.filter(page => page.content).length, latencyMs: Date.now() - began, requestId: response.headers.get('x-request-id') || response.headers.get('request-id') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
