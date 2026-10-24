import type { SearchCall } from './domain';

export function searchLabel(calls: SearchCall[], legacy = 'SearchPro') {
  if (!calls.some(call => call.provider === 'deepseek')) return legacy;
  return calls.some(call => call.provider !== 'deepseek') ? 'SearchPro + DeepSeek Search' : 'DeepSeek Search';
}
