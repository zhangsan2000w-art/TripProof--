export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), cache: 'no-store' });
  const data = await response.json().catch(() => ({ error: '服务返回了无效内容，请稍后重试。' }));
  if (!response.ok) throw new Error(data.error || '请求未完成，请稍后重试。');
  return data;
}
