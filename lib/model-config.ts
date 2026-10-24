import { AppError } from './errors';

export type ModelRole = 'extract' | 'fact' | 'explain' | 'agent';

/** LLM credentials are independent of the optional DeepSeek Search credentials. */
export function modelConfiguration(role: ModelRole = 'extract') {
  const apiMode = process.env.LLM_API_MODE || 'responses';
  const chatFormat = process.env.LLM_CHAT_FORMAT || 'json_object';
  if (!['responses', 'chat_completions'].includes(apiMode) || !['json_object', 'json_schema'].includes(chatFormat))
    throw new AppError('LLM_CONFIG_INVALID', '模型接口配置无效，请检查 LLM_API_MODE 和 LLM_CHAT_FORMAT。', 503);
  return {
    apiMode: apiMode as 'responses' | 'chat_completions',
    chatFormat: chatFormat as 'json_object' | 'json_schema',
    model: process.env[`LLM_${role.toUpperCase()}_MODEL`]?.trim()
      || (role === 'agent' ? process.env.LLM_FACT_MODEL?.trim() : '') || 'gpt-6.1-sol',
    baseURL: process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') || '',
    apiKey: process.env.OPENAI_API_KEY?.trim() || '',
  };
}

export function modelCacheIdentity(role: ModelRole) {
  const { apiKey: _key, ...identity } = modelConfiguration(role);
  void _key;
  return identity;
}
