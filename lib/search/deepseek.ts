import { createHash } from 'node:crypto';
import dayjs from 'dayjs';
import { load } from 'cheerio';
import { z } from 'zod';
import { AppError } from '../errors';
import { now, today } from '../dates';
import type { Evidence, SearchCall, SearchParams } from '../domain';
import { cacheGet, cacheSet, emit, getRun, id, reserveSearch, saveCall } from '../store';
import { assertRunning, runSignal, recordMetric } from '../run-control';
import { searchGate, type SearchBudget, type SearchResult } from './shared';
import { deepseekSetting } from './settings';

export const deepseekSearchEndpoint = 'https://api.deepseek.com/v1/tools/search';
export const deepseekResponseSchema = z.object({ results: z.array(z.unknown()), error: z.unknown().optional(), Error: z.unknown().optional() })
  .refine(value => value.error == null && value.Error == null);
const pageSchema = z.object({ url: z.string(), title: z.string().nullish(), snippet: z.string().nullish(), summary: z.string().nullish(), content: z.string().nullish(), date: z.string().nullish(), rerank_score: z.number().nullish(), authority: z.number().nullish() });
const plain = (raw: string | null | undefined) => load(raw || '').text().replace(/\s+/g, ' ').trim();
export function normalizeDeepSeekPage(raw: unknown, searchCallId: string): Evidence | null {
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success) return null;
  try {
    const page = parsed.data, url = new URL(page.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    const passage = [plain(page.snippet), plain(page.summary)].filter(Boolean).join('\n').slice(0, 18000), retrievedAt = now();
    return { id: id(), searchCallId, provider: 'deepseek', url: url.toString(), finalUrl: null, title: plain(page.title), site: url.hostname,
      publishedAt: page.date && !Number.isNaN(Date.parse(page.date)) ? page.date.slice(0, 10) : null, retrievedAt, passage, content: plain(page.content).slice(0, 26000),
      // DeepSeek authority and rerank_score do not use SearchPro's scales.
      score: null, authorityLevel: null, providerScore: page.rerank_score ?? null, providerAuthority: page.authority ?? null,
      tier: 4, linkStatus: 'broken', linkCheckedAt: null, pageSha256: null,
      searchOrigins: [{ provider: 'deepseek', searchCallId, retrievedAt, passage }] };
  } catch { return null; }
}
export function deepseekBody(params: SearchParams) {
  const operators: string[] = [];
  if (params.site) {
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(params.site)) throw new AppError('INVALID_SITE', '检索站点格式无效。');
    operators.push(`site:${params.site}`);
  }
  if (params.freshness) {
    const match = params.freshness.match(/^([dwmy])(\d{1,3})$/);
    if (!match) throw new AppError('INVALID_FRESHNESS', '检索时间范围无法转换为 DeepSeek 日期条件。');
    const units = { d: 'day', w: 'week', m: 'month', y: 'year' } as const;
    operators.push(`after:${dayjs(today()).subtract(Number(match[2]), units[match[1] as keyof typeof units]).format('YYYY-MM-DD')}`);
  }
  const suffix = operators.length ? ` ${operators.join(' ')}` : '';
  if (!params.query.trim() || [...suffix].length >= 128) throw new AppError('INVALID_QUERY', '检索词为空或筛选条件过长。');
  return { query: [...params.query.trim()].slice(0, 128 - [...suffix].length).join('') + suffix, count: Math.max(1, Math.min(50, params.cnt ?? 10)), need_content: true, ori_question: [...params.query].slice(0, 128).join('') };
}
export async function searchDeepSeek(runId: string, venueId: string, params: SearchParams, budget: SearchBudget): Promise<SearchResult> {
  assertRunning();
  if (getRun(runId).status === 'cancelled') throw new AppError('RUN_CANCELLED', '调查已停止。', 409);
  const apiKey = deepseekSetting('DEEPSEEK_API_KEY')?.trim();
  if (!apiKey) throw new AppError('DEEPSEEK_NOT_CONFIGURED', '尚未配置 DeepSeek 搜索密钥。', 503);
  const body = deepseekBody(params), key = `search:deepseek:v1:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
  const cached = !params.freshness && cacheGet<SearchResult>(key);
  if (cached) {
    const call: SearchCall = { ...cached.call, id: id(), venueId, calledAt: now(), cacheHit: true, cachedFrom: cached.call.id };
    const pages = cached.pages.map(page => ({ ...page, id: id(), searchCallId: call.id, searchOrigins: page.searchOrigins?.map(origin => ({ ...origin, searchCallId: call.id })) }));
    saveCall(runId, call); emit(runId, 'search', call);
    return { call, pages };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (budget.used >= Math.min(5, budget.limit ?? 5)) throw new AppError('VENUE_BUDGET', '该地点的实际检索请求已达上限。');
    const queued = Date.now(); await searchGate.enter(); recordMetric('search_queue', Date.now() - queued, { venueId, provider: 'deepseek' });
    const started = Date.now();
    const call: SearchCall = { id: id(), venueId, provider: 'deepseek', query: params.query, params, sentQuery: body.query, requestId: null, version: 'tools/search', msg: null, errorCode: null, resultCount: 0, latencyMs: 0, calledAt: now(), cacheHit: false, cachedFrom: null };
    let retry = false, reserved = false;
    try {
      assertRunning();
      if (budget.used >= Math.min(5, budget.limit ?? 5)) throw new AppError('VENUE_BUDGET', '该地点的实际检索请求已达上限。');
      reserveSearch(runId, venueId); reserved = true; budget.used++;
      const timeoutSignal = AbortSignal.timeout(12000), parentSignal = runSignal();
      const response = await fetch(deepseekSearchEndpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: parentSignal ? AbortSignal.any([timeoutSignal, parentSignal]) : timeoutSignal });
      assertRunning();
      call.requestId = response.headers.get('x-request-id') || response.headers.get('request-id');
      if (!response.ok) {
        retry = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new AppError(`DEEPSEEK_HTTP_${response.status}`, response.status === 402 ? 'DeepSeek 搜索余额不足。' : [401, 403].includes(response.status) ? 'DeepSeek 搜索鉴权失败，请核对 API Key 和权限。' : 'DeepSeek 搜索暂时不可用。', 502);
      }
      const parsed = deepseekResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new AppError('DEEPSEEK_RESPONSE', 'DeepSeek 搜索返回结构异常，未将错误响应当作证据。', 502);
      const pages = parsed.data.results.map(page => normalizeDeepSeekPage(page, call.id)).filter((page): page is Evidence => page !== null);
      call.resultCount = pages.length; call.latencyMs = Date.now() - started;
      assertRunning(); recordMetric('search', call.latencyMs, { venueId, provider: 'deepseek', cacheHit: false });
      saveCall(runId, call); emit(runId, 'search', call);
      const result = { call, pages }; cacheSet(key, result); return result;
    } catch (error) {
      if (reserved) {
        call.errorCode = error instanceof AppError ? error.code : 'DEEPSEEK_NETWORK'; call.latencyMs = Date.now() - started;
        saveCall(runId, call); emit(runId, 'search', call);
      }
      assertRunning();
      if (!(retry && attempt === 0)) throw error;
    } finally { searchGate.leave(); }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new AppError('DEEPSEEK_FAILED', 'DeepSeek 搜索未完成。', 502);
}
