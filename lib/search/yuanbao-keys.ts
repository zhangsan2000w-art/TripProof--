import { createHash } from 'node:crypto';
import { AppError } from '../errors';
import { yuanbaoApiKeys } from './settings';

type Credential = { key: string; unavailableUntil: number; tier: string | null };
let signature = '', cursor = 0, credentials: Credential[] = [];
function pool() {
  const keys = yuanbaoApiKeys();
  const current = createHash('sha256').update(JSON.stringify(keys)).digest('hex');
  if (current !== signature) {
    signature = current; cursor = 0;
    credentials = keys.map(key => ({ key, unavailableUntil: 0, tier: null }));
  }
  return credentials;
}
// Select synchronously before awaiting the network so concurrent requests rotate too.
export function nextYuanbaoKey() {
  const keys = pool(), time = Date.now();
  if (!keys.length) throw new AppError('SEARCH_NOT_CONFIGURED', '尚未配置元宝搜索密钥。', 503);
  for (let offset = 0; offset < keys.length; offset++) {
    const index = (cursor + offset) % keys.length;
    if (keys[index].unavailableUntil <= time) {
      cursor = (index + 1) % keys.length;
      return keys[index];
    }
  }
  throw new AppError('SEARCH_KEYS_UNAVAILABLE', '元宝搜索 Key 暂时均不可用，请检查额度、权限或稍后重试。', 503);
}
export const hasAvailableYuanbaoKey = () => pool().some(key => key.unavailableUntil <= Date.now());
export function yuanbaoKeyFailure(code: string) {
  if (/^(?:SEARCH_HTTP_429|RequestLimitExceeded)(?:[.]|$)/i.test(code)) return 'rate';
  if (/^(?:SEARCH_HTTP_(?:401|402|403)|AuthFailure|UnauthorizedOperation)(?:[.]|$)/i.test(code)
    || /(?:Quota|ResourceInsufficient|InsufficientBalance|AccountArrears|LimitExceeded)/i.test(code)) return 'credential';
  return null;
}
export function markYuanbaoKeyFailure(credential: Credential, code: string, retryAfter: string | null = null) {
  const failure = yuanbaoKeyFailure(code);
  if (!failure) return;
  const retryMs = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000
    : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
  const duration = failure === 'credential' ? 15 * 60_000
    : Math.max(1000, Math.min(5 * 60_000, Number.isFinite(retryMs) && retryMs > 0 ? retryMs : 30_000));
  credential.unavailableUntil = Math.max(credential.unavailableUntil, Date.now() + duration);
}
