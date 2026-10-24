import type { SearchCall, SearchParams, SearchProvider } from '../domain';
import { AppError, errorMessage } from '../errors';
import { searchProviders } from './config';
import { searchDeepSeek } from './deepseek';
import { searchPro } from './yuanbao';
import { mergeSearchPages, type SearchBudget } from './shared';
import { assertRunning } from '../run-control';
import { getRun } from '../store';

export async function searchSources(runId: string, venueId: string, params: SearchParams, budget: SearchBudget) {
  assertRunning();
  if (getRun(runId).status === 'cancelled') throw new AppError('RUN_CANCELLED', '调查已停止。', 409);
  const configured = searchProviders();
  if (!configured.deepseek) {
    const result = await searchPro(runId, venueId, params, budget);
    return { pages: result.pages, calls: [result.call], limitations: [] as string[] };
  }
  const remaining=Math.min(Math.min(5,budget.limit??5)-budget.used,getRun(runId).limit-getRun(runId).used);
  // Do not race two providers for the last slot: keep the existing primary search.
  const active = (['yuanbao', 'deepseek'] as const).filter(provider => configured[provider]&&!(remaining<=1&&configured.yuanbao&&provider==='deepseek'));
  const results = await Promise.allSettled(active.map(provider => provider === 'yuanbao' ? searchPro(runId, venueId, params, budget) : searchDeepSeek(runId, venueId, params, budget)));
  assertRunning();
  if (getRun(runId).status === 'cancelled') throw new AppError('RUN_CANCELLED', '调查已停止。', 409);
  const pages = [], calls: SearchCall[] = [], limitations: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') { pages.push(...result.value.pages); calls.push(result.value.call); }
    else limitations.push(`${providerLabel(active[index])}：${errorMessage(result.reason)}`);
  }
  if (!calls.length) throw new AppError('SEARCH_FAILED', limitations.join('；') || '搜索未完成。', 502);
  return { pages: mergeSearchPages(pages), calls, limitations };
}
function providerLabel(provider: SearchProvider) { return provider === 'deepseek' ? 'DeepSeek' : '元宝'; }
