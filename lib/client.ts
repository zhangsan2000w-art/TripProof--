export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); this.name = 'ApiError'; }
  get retryable() { return this.status === 0 || this.status >= 500 || this.code === 'INVALID_RESPONSE'; }
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), cache: 'no-store', signal }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('暂时无法连接服务。原文与已保存的行程仍会保留，请重试。', 'NETWORK_ERROR', 0);
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') throw new ApiError(response.status === 504 ? '服务网关等待超时，请重试；已提交的读取任务可继续查询。' : '服务网关未返回有效结果，请重试。原文与已保存的行程仍会保留。', 'INVALID_RESPONSE', response.status);
  if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : '请求未完成，请稍后重试。', typeof data.code === 'string' ? data.code : 'REQUEST_FAILED', response.status);
  return data as T;
}
