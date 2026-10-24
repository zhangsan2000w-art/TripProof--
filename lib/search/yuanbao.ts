import { createHash } from 'node:crypto';
import * as tencentcloud from 'tencentcloud-sdk-nodejs-wsa';
import { AppError } from '../errors';
import { cacheGet, cacheSet, emit, getRun, id, reserveSearch, saveCall } from '../store';
import { now } from '../dates';
import type { Evidence, SearchCall, SearchParams } from '../domain';
import { load } from 'cheerio';
import { assertRunning, runSignal, recordMetric } from '../run-control';
import { searchGate as gate, type SearchBudget } from './shared';
import { searchSetting } from './settings';
import { hasAvailableYuanbaoKey, markYuanbaoKeyFailure, nextYuanbaoKey, yuanbaoKeyFailure } from './yuanbao-keys';

type RawResponse = { Pages?: (string | Record<string, unknown>)[]; RequestId?: string; Version?: string; Msg?: string; Error?: { Code: string; Message?: string } };
type Cached = { call: SearchCall; pages: Evidence[] };
const text = (raw: unknown) => load(String(raw ?? '')).text().replace(/\s+/g, ' ').trim();
function publishedAt(value: unknown): string | null {
  const match = String(value ?? '').match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(date)) ? null : date;
}
export function normalizePage(raw: string | Record<string, unknown>, searchCallId: string): Evidence | null {
  try {
    const p: Record<string, unknown> = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const url = new URL(String(p.url ?? ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    const retrievedAt = now(), passage = text(p.passage).slice(0, 18000);
    return { id: id(), searchCallId, provider: 'yuanbao', url: url.toString(), finalUrl: null, title: text(p.title), site: url.hostname,
      publishedAt: publishedAt(p.date), retrievedAt, passage, content: text(p.content).slice(0, 26000),
      score: typeof p.score === 'number' ? p.score : null, authorityLevel: typeof p.authority_level === 'number' ? p.authority_level : null,
      tier: 4, linkStatus: 'broken', linkCheckedAt: null, pageSha256: null,
      searchOrigins: [{ provider: 'yuanbao', searchCallId, retrievedAt, passage }] };
  } catch { return null; }
}
export async function requestYuanbaoSearch(body: Record<string, unknown>, beforeRequest?: (sentBody: Record<string, unknown>) => void): Promise<RawResponse> {
  assertRunning();
  if (searchSetting('WSA_AUTH_MODE') === 'tencent') {
    const Client = tencentcloud.wsa.v20250508.Client;
    const client = new Client({ credential: { secretId: process.env.TENCENTCLOUD_SECRET_ID || '', secretKey: process.env.TENCENTCLOUD_SECRET_KEY || '' }, region: '', profile: { httpProfile: { endpoint: 'wsa.tencentcloudapi.com', reqTimeout: 8 } } });
    beforeRequest?.(body);
    return await client.SearchPro(body as { Query: string }) as RawResponse;
  }
  const credential = nextYuanbaoKey(), sentBody = { ...body };
  if (credential.tier === 'lite') { delete sentBody.Mode; delete sentBody.Cnt; delete sentBody.Industry; }
  const timeoutSignal = AbortSignal.timeout(8000), parentSignal = runSignal();
  // One adapter invocation sends at most one request; the caller reserves each attempt.
  beforeRequest?.(sentBody);
  const res = await fetch('https://api.wsa.cloud.tencent.com/SearchPro', { method: 'POST', headers: { Authorization: `Bearer ${credential.key}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(sentBody), signal: parentSignal ? AbortSignal.any([timeoutSignal,parentSignal]) : timeoutSignal });
  if (!res.ok) {
    markYuanbaoKeyFailure(credential, `SEARCH_HTTP_${res.status}`, res.headers.get('retry-after'));
    throw new AppError(`SEARCH_HTTP_${res.status}`, [401,403].includes(res.status) ? '元宝搜索鉴权失败，请核对服务 API Key 和权限。' : res.status === 402 ? '元宝搜索额度不足。' : '元宝搜索暂时无法访问。', 502);
  }
  const json = await res.json();
  const response: RawResponse = json.Response ?? json;
  if (response.Error) {
    markYuanbaoKeyFailure(credential, response.Error.Code, res.headers.get('retry-after'));
    if (response.Error.Code === 'InvalidParameter' && ('Mode' in sentBody || 'Cnt' in sentBody || 'Industry' in sentBody)) credential.tier = 'lite';
  } else if (response.Version) credential.tier = response.Version;
  return response;
}
export async function searchPro(runId: string, venueId: string, params: SearchParams, venueCalls: SearchBudget): Promise<Cached> {
  assertRunning();
  if (getRun(runId).status === 'cancelled') throw new AppError('RUN_CANCELLED','调查已停止。',409);
  const tencent = searchSetting('WSA_AUTH_MODE') === 'tencent';
  const tier = process.env.WSA_TIER || (tencent ? cacheGet<string>('search:tier') : null) || 'unknown';
  const body: Record<string, unknown> = { Query: params.query, ...(params.site ? { Site: params.site } : {}), ...(params.freshness ? { Freshness: params.freshness } : {}) };
  if (tier !== 'lite') { if (params.mode !== undefined) body.Mode = params.mode; if (params.cnt) body.Cnt = params.cnt; if (params.industry) body.Industry = params.industry; }
  const key = `search:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
  // Dynamic notices and weather are searched in this run; only regular rules reuse search results.
  const cached = !params.freshness && cacheGet<Cached>(key);
  if (cached) {
    const call: SearchCall = { ...cached.call, id: id(), venueId, provider: 'yuanbao', calledAt: now(), cacheHit: true, cachedFrom: cached.call.id };
    const pages = cached.pages.map(p => ({ ...p, id: id(), searchCallId: call.id, searchOrigins: p.searchOrigins?.map(origin => ({ ...origin, searchCallId: call.id })) }));
    saveCall(runId, call); emit(runId, 'search', call);
    return { call, pages };
  }
  let last: SearchCall | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (venueCalls.used >= Math.min(5, venueCalls.limit ?? 5)) throw new AppError('VENUE_BUDGET', '该场馆已达到五次搜索上限。');
    const queued=Date.now();await gate.enter();recordMetric('search_queue',Date.now()-queued,{venueId});
    const start = Date.now();
    const call: SearchCall = { id: id(), venueId, provider: 'yuanbao', query: params.query, params: { query: params.query, ...(params.site ? {site: params.site} : {}), ...(params.freshness ? {freshness: params.freshness} : {}), ...(body.Mode !== undefined ? {mode: Number(body.Mode)} : {}), ...(body.Cnt !== undefined ? {cnt: Number(body.Cnt)} : {}), ...(body.Industry ? {industry: String(body.Industry)} : {}) }, requestId: null, version: null, msg: null, errorCode: null, resultCount: 0, latencyMs: 0, calledAt: now(), cacheHit: false, cachedFrom: null };
    let reserved=false,phase='reserve';
    try {
      assertRunning();
      if (venueCalls.used >= Math.min(5, venueCalls.limit ?? 5)) throw new AppError('VENUE_BUDGET', '该场馆已达到五次搜索上限。');
      phase='request';
      let sentBody = body;
      const response = await requestYuanbaoSearch(body, actualBody => {
        sentBody = actualBody;
        reserveSearch(runId,venueId); reserved=true; venueCalls.used++;
        call.params = { query: params.query, ...(params.site ? {site: params.site} : {}), ...(params.freshness ? {freshness: params.freshness} : {}), ...(actualBody.Mode !== undefined ? {mode: Number(actualBody.Mode)} : {}), ...(actualBody.Cnt !== undefined ? {cnt: Number(actualBody.Cnt)} : {}), ...(actualBody.Industry ? {industry: String(actualBody.Industry)} : {}) };
      });
      assertRunning();
      phase='normalize';
      call.requestId = response.RequestId ?? null; call.version = response.Version ?? null; call.msg = response.Msg || null;
      if (response.Error) { call.errorCode = response.Error.Code; }
      const pages = response.Error || /hit black query|blacklist|黑名单/i.test(response.Msg || '') ? [] : (response.Pages ?? []).map(p => normalizePage(p, call.id)).filter((p): p is Evidence => !!p);
      call.resultCount = pages.length; call.latencyMs = Date.now() - start;
      recordMetric('search',call.latencyMs,{venueId,cacheHit:false});
      phase='persist';saveCall(runId, call); emit(runId, 'search', call); last = call;
      if (tencent && call.version) cacheSet('search:tier', call.version, 24 * 3600_000);
      if (!response.Error) { const result = { call, pages }; cacheSet(key, result); return result; }
      if (response.Error.Code === 'InvalidParameter' && ('Mode' in sentBody || 'Cnt' in sentBody || 'Industry' in sentBody) && attempt < 2) {
        if (tencent) { delete body.Mode; delete body.Cnt; delete body.Industry; cacheSet('search:tier', 'lite', 24 * 3600_000); }
        continue;
      }
      if (attempt < 2 && (tencent ? response.Error.Code === 'RequestLimitExceeded' : yuanbaoKeyFailure(response.Error.Code) && hasAvailableYuanbaoKey())) {
        if (tencent) await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 250 : 1000));
        continue;
      }
      throw new AppError(response.Error.Code, '搜索服务返回错误，相关检查保持尚无法确认。', 502);
    } catch (error) {
      const raw=error as {name?:unknown;code?:unknown;cause?:{code?:unknown}};
      const safe=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_ .-]{1,80}$/.test(v)?v:null;
      const name=safe(raw?.name),code=safe(raw?.code),cause=safe(raw?.cause?.code);
      const network=phase==='request'&&(name==='TimeoutError'||!!cause&&/^(?:ECONN|ENET|EHOST|EAI_|ETIMEDOUT|UND_ERR_)/.test(cause)||!!code&&/^(?:ECONN|ENET|EHOST|EAI_|ETIMEDOUT)/.test(code));
      if (reserved && (!last || last.id !== call.id)) {
        call.errorCode = runSignal()?.aborted?'RUN_CANCELLED':error instanceof AppError ? error.code : network?name==='TimeoutError'?'SEARCH_TIMEOUT':`SEARCH_NETWORK_${cause||code}`:'SEARCH_INTERNAL_ERROR'; call.latencyMs = Date.now() - start;
        call.msg=`stage=${phase}; type=${name||'unknown'}${cause||code?`; code=${cause||code}`:''}`;
        saveCall(runId, call); emit(runId, 'search', call);
      }
      if(!(error instanceof AppError)&&!runSignal()?.aborted)console.error('[SearchPro failure]',{phase,name,code,cause});
      assertRunning();
      const failover = !tencent && error instanceof AppError && yuanbaoKeyFailure(error.code) && hasAvailableYuanbaoKey();
      const transientHttp = error instanceof AppError && /^SEARCH_HTTP_(?:408|5\d\d)$/.test(error.code);
      if((network||failover||transientHttp)&&attempt<2&&venueCalls.used<Math.min(5,venueCalls.limit??5)){
        if (!failover) await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
        continue;
      }
      if(!(error instanceof AppError))throw new AppError(call.errorCode||'SEARCH_FAILED',network?'搜索连接暂时失败，已保存本次调用；未取得的证据保持未知。':'搜索处理未完成，已记录失败阶段；未取得的证据保持未知。',502);
      throw error;
    } finally { gate.leave(); }
  }
  throw new AppError(last?.errorCode ?? 'SEARCH_FAILED', `搜索未完成（已用 ${getRun(runId).used} 次）。`, 502);
}
