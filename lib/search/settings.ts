import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '../errors';

const apiKey = z.string().trim().max(512).regex(/^[\x21-\x7e]*$/).optional();
export function parseYuanbaoApiKeys(value: string): string[] {
  const keys = [...new Set(value.split(/[\r\n,]+/).map(key => key.trim()).filter(Boolean))];
  if (value.length > 16384 || keys.length > 32 || keys.some(key => !/^[\x21-\x7e]{1,512}$/.test(key)))
    throw new AppError('SEARCH_KEYS_INVALID', '元宝密钥格式无效；最多 32 个 Key，请用逗号或换行分隔。', 503);
  return keys;
}
const apiKeys = z.string().trim().max(16384).refine(value => {
  try { parseYuanbaoApiKeys(value); return true; } catch { return false; }
}, '最多 32 个 Key，请用逗号或换行分隔，每个 Key 不含空格或控制字符。').optional();
export const deepseekSettingsSchema = z.object({
  DEEPSEEK_API_KEY: apiKey,
  DEEPSEEK_SEARCH_ENABLED: z.enum(['0', '1']).optional(),
  WSA_API_KEY: apiKey,
  WSA_API_KEYS: apiKeys,
  WSA_AUTH_MODE: z.literal('api-key').optional(),
  WSA_SEARCH_ENABLED: z.enum(['0', '1']).optional(),
}).strict().refine(value => !(Object.hasOwn(value, 'WSA_API_KEY') && Object.hasOwn(value, 'WSA_API_KEYS')), '请只提交单 Key 或多 Key 配置中的一种。');
type Settings = z.infer<typeof deepseekSettingsSchema>;
export const localSettingsEnabled = () => process.env.LOCAL_SETTINGS_ENABLED !== '0'
  && (process.env.LOCAL_SETTINGS_ENABLED === '1' || process.env.NODE_ENV !== 'production')
  && ['localhost', '127.0.0.1'].includes(process.env.HOSTNAME || '');
const settingsPath = () => resolve(dirname(resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || '.data/tripproof.db')), 'deepseek-settings.json');

function readSettings(): Settings {
  if (!localSettingsEnabled() || !existsSync(settingsPath())) return {};
  try { return deepseekSettingsSchema.parse(JSON.parse(readFileSync(settingsPath(), 'utf8'))); }
  catch { throw new AppError('LOCAL_SETTINGS_INVALID', '本机搜索配置无法读取，请检查本机配置文件。', 503); }
}
// The web process and investigation worker read the same file on every request.
export function searchSetting(name: keyof Settings) {
  const values = readSettings();
  return Object.hasOwn(values, name) ? values[name] : process.env[name];
}
export const deepseekSetting = searchSetting;
export function yuanbaoApiKeys() {
  const values = readSettings();
  // An explicit local removal must not revive either environment credential.
  const value = Object.hasOwn(values, 'WSA_API_KEYS') ? values.WSA_API_KEYS
    : Object.hasOwn(values, 'WSA_API_KEY') ? values.WSA_API_KEY
    : process.env.WSA_API_KEYS?.trim() || process.env.WSA_API_KEY;
  return parseYuanbaoApiKeys(value || '');
}
export function saveSearchSettings(input: unknown) {
  if (!localSettingsEnabled()) throw new AppError('NOT_FOUND', '此入口仅在本机测试模式开放。', 404);
  const parsed = deepseekSettingsSchema.parse(input);
  // A local service key must not accidentally use legacy SecretId/SecretKey auth.
  if (Object.hasOwn(parsed, 'WSA_API_KEY') || Object.hasOwn(parsed, 'WSA_API_KEYS')) parsed.WSA_AUTH_MODE = 'api-key';
  const values = { ...readSettings(), ...parsed }, target = settingsPath();
  if (Object.hasOwn(parsed, 'WSA_API_KEYS')) delete values.WSA_API_KEY;
  if (Object.hasOwn(parsed, 'WSA_API_KEY')) delete values.WSA_API_KEYS;
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 });
  renameSync(temporary, target);
}
export const saveDeepseekSettings = saveSearchSettings;
export function requireLocalSettings(req: NextRequest, mutation = false) {
  const url = new URL(req.url), host = req.headers.get('host') || '';
  if (!localSettingsEnabled() || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host))
    throw new AppError('NOT_FOUND', '此入口仅在本机测试模式开放。', 404);
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('BAD_ORIGIN', '密钥操作只能从本机同源页面发起。', 403);
  if (mutation && req.headers.get('origin') !== `${url.protocol}//${host}`) throw new AppError('BAD_ORIGIN', '密钥操作只能从本机同源页面发起。', 403);
}
