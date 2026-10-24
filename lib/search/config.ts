import { deepseekSetting, searchSetting, yuanbaoApiKeys } from './settings';

export function searchProviders() {
  return {
    yuanbao: searchSetting('WSA_SEARCH_ENABLED') !== '0' && (searchSetting('WSA_AUTH_MODE') === 'tencent'
      ? Boolean(process.env.TENCENTCLOUD_SECRET_ID && process.env.TENCENTCLOUD_SECRET_KEY)
      : yuanbaoApiKeys().length > 0),
    deepseek: Boolean(deepseekSetting('DEEPSEEK_API_KEY')?.trim()) && deepseekSetting('DEEPSEEK_SEARCH_ENABLED') !== '0',
  };
}
export const providerCount = () => Math.max(1, Object.values(searchProviders()).filter(Boolean).length);
export const searchCacheSuffix = () => searchProviders().deepseek ? `:sources-v1:${searchProviders().yuanbao ? 'yuanbao+' : ''}deepseek` : '';
