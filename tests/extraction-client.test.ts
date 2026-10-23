import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/client';
import { submitExtraction, waitForExtraction } from '../lib/extraction-client';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('网关返回 HTML 时显示可恢复的网关错误，保留 HTTP 状态，不泄露响应正文', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Gateway timeout: private detail</html>', { status: 504 })));
  await expect(api('/api/extract')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 504, message: expect.stringContaining('网关等待超时') });
});
it('有效 JSON 形式的限额和鉴权错误保持原意，不被误报为无效内容', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'RATE_LIMIT', error: '今日读取额度已用完。' }, { status: 429 })));
  await expect(api('/api/extract')).rejects.toMatchObject({ code: 'RATE_LIMIT', status: 429, message: '今日读取额度已用完。', retryable: false });
});
it('网关短暂失败后恢复查询同一任务，可在刷新后仅凭任务编号取回行程', async () => {
  vi.useFakeTimers();
  const draft = { guideMeta: { title: '上海', publishedAt: null }, days: [], recommendations: [], ambiguities: [] };
  const fetch = vi.fn().mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
    .mockResolvedValueOnce(Response.json({ job: { id: 'saved-job', status: 'running' } }))
    .mockResolvedValueOnce(Response.json({ job: { id: 'saved-job', status: 'completed', draft } }));
  vi.stubGlobal('fetch', fetch);
  const waiting = waitForExtraction('saved-job', new AbortController().signal);
  const done = expect(waiting).resolves.toEqual(draft);
  await vi.advanceTimersByTimeAsync(4000); await done;
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.every(([path, opts]) => path === '/api/extract/saved-job' && opts.method === 'GET')).toBe(true);
});
it('任务失败停止轮询并展示模型错误，不伪造校对结果', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ job: { id: 'failed', status: 'failed', code: 'MODEL_LIMIT', error: '模型限流，请稍后重试。' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(waitForExtraction('failed', new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_LIMIT', message: '模型限流，请稍后重试。' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('首次提交响应丢失时重试沿用编号，失败不会重复启动模型任务', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ready: true }))
    .mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
    .mockResolvedValueOnce(Response.json({ ready: true }))
    .mockResolvedValueOnce(Response.json({ job: { id: 'same-request', status: 'queued' } }, { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  const submitting = submitExtraction('same-request', { text: '上海两日游', images: [] }, new AbortController().signal);
  const done = expect(submitting).resolves.toMatchObject({ job: { id: 'same-request' } });
  await vi.advanceTimersByTimeAsync(1300); await done;
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(fetch.mock.calls.map(([, opts]) => opts.method)).toEqual(['GET', 'POST', 'GET', 'POST']);
  expect(fetch.mock.calls.filter(([, opts]) => opts.body).map(([, opts]) => JSON.parse(opts.body).requestId)).toEqual(['same-request', 'same-request']);
});
