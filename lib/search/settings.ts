import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '../errors';

export const deepseekSettingsSchema = z.object({
  DEEPSEEK_API_KEY: z.string().trim().max(512).regex(/^[\x21-\x7e]*$/).optional(),
  DEEPSEEK_SEARCH_ENABLED: z.enum(['0', '1']).optional(),
}).strict();
type Settings = z.infer<typeof deepseekSettingsSchema>;
export const localSettingsEnabled = () => process.env.LOCAL_SETTINGS_ENABLED !== '0'
  && (process.env.LOCAL_SETTINGS_ENABLED === '1' || process.env.NODE_ENV !== 'production')
  && ['localhost', '127.0.0.1'].includes(process.env.HOSTNAME || '');
const settingsPath = () => resolve(dirname(resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || '.data/tripproof.db')), 'deepseek-settings.json');

function readSettings(): Settings {
  if (!localSettingsEnabled() || !existsSync(settingsPath())) return {};
  try { return deepseekSettingsSchema.parse(JSON.parse(readFileSync(settingsPath(), 'utf8'))); }
  catch { throw new AppError('LOCAL_SETTINGS_INVALID', '本机 DeepSeek 配置无法读取，请检查本机配置文件。', 503); }
}
// The web process and investigation worker read the same file on every request.
export function deepseekSetting(name: keyof Settings) {
  const values = readSettings();
  return Object.hasOwn(values, name) ? values[name] : process.env[name];
}
export function saveDeepseekSettings(input: unknown) {
  if (!localSettingsEnabled()) throw new AppError('NOT_FOUND', '此入口仅在本机测试模式开放。', 404);
  const values = { ...readSettings(), ...deepseekSettingsSchema.parse(input) }, target = settingsPath();
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 });
  renameSync(temporary, target);
}
export function requireLocalSettings(req: NextRequest, mutation = false) {
  const url = new URL(req.url), host = req.headers.get('host') || '';
  if (!localSettingsEnabled() || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host))
    throw new AppError('NOT_FOUND', '此入口仅在本机测试模式开放。', 404);
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('BAD_ORIGIN', '密钥操作只能从本机同源页面发起。', 403);
  if (mutation && req.headers.get('origin') !== `${url.protocol}//${host}`) throw new AppError('BAD_ORIGIN', '密钥操作只能从本机同源页面发起。', 403);
}
