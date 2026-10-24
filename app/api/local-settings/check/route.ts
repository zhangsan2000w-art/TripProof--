import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { failure, jsonBody } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { deepseekSetting, requireLocalSettings } from '@/lib/search/settings';
import { deepseekBody, deepseekResponseSchema, deepseekSearchEndpoint, normalizeDeepSeekPage } from '@/lib/search/deepseek';
import { normalizePage, requestYuanbaoSearch } from '@/lib/search/yuanbao';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    requireLocalSettings(req, true);
    const { provider } = z.object({ provider: z.enum(['deepseek', 'yuanbao']).default('deepseek') }).strict().parse(await jsonBody(req, 1024));
    if (provider === 'yuanbao') {
      const began = Date.now(), response = await requestYuanbaoSearch({ Query: '中国丝绸博物馆 官方 开放时间' });
      if (response?.Error) throw new AppError('YUANBAO_SEARCH_ERROR', '元宝搜索返回错误，请核对服务 API Key、权限和额度。', 502);
      if (!Array.isArray(response?.Pages)) throw new AppError('SEARCH_RESPONSE', '元宝搜索返回结构异常，未获得有效检索结果。', 502);
      if (/hit black query|blacklist|黑名单/i.test(response.Msg || '')) throw new AppError('SEARCH_QUERY_REJECTED', '元宝搜索未接受本次验证查询。', 502);
      const pages = response.Pages.map(page => normalizePage(page, 'connection-check')).filter(page => page !== null);
      return NextResponse.json({ resultCount: pages.length, bodyCount: pages.filter(page => page.content).length, latencyMs: Date.now() - began, requestId: response.RequestId || null }, { headers: { 'Cache-Control': 'no-store' } });
    }
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
