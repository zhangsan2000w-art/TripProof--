import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../db';
import { beginExtractionJob, extractionJob, runExtractionJob } from '../lib/extractions';
import { extractItinerary } from '../lib/llm';
import { extractionDeadlineMs } from '../lib/extraction-types';
import { AppError } from '../lib/errors';
import type { Draft } from '../lib/domain';

vi.mock('../lib/llm', async importOriginal => ({ ...await importOriginal<typeof import('../lib/llm')>(), extractItinerary: vi.fn() }));
const folder = mkdtempSync(join(tmpdir(), 'tripproof-extractions-'));
const draft: Draft = { guideMeta: { title: '上海两日游', publishedAt: null }, days: [], recommendations: [], ambiguities: [] };
beforeAll(() => { process.env.DATABASE_PATH = join(folder, 'jobs.db'); });
afterAll(() => { vi.useRealTimers(); database().sqlite.close(); delete (globalThis as { tripproofDB?: unknown }).tripproofDB; rmSync(folder, { recursive: true, force: true }); });

it('丢失响应后的重复提交复用同一任务，不再消耗读取额度', () => {
  const id = crypto.randomUUID(), first = beginExtractionJob('repeat-owner', id, 1);
  expect(first.created).toBe(true);
  expect(beginExtractionJob('repeat-owner', id, 1)).toEqual({ job: first.job, created: false });
  expect(() => beginExtractionJob('repeat-owner', crypto.randomUUID(), 1)).toThrow('额度');
  expect(first.job).not.toHaveProperty('owner');
});
it('任务和结果仅允许原浏览器查询，不能通过相同请求编号复用他人任务', () => {
  const id = crypto.randomUUID(); beginExtractionJob('private-owner', id, 10);
  expect(() => extractionJob('another-owner', id)).toThrow('不存在');
  expect(() => beginExtractionJob('another-owner', id, 10)).toThrow('不存在');
});
it('提交后即可查询状态，慢模型不会占住响应；输入图片和文字不进入任务存储', async () => {
  const id = crypto.randomUUID(); beginExtractionJob('slow-owner', id, 10);
  let finish!: (value: Draft) => void;
  vi.mocked(extractItinerary).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const running = runExtractionJob(id, '仅存在内存的原文', [{ sourceIndex: 1, data: 'data:image/png;base64,cHJpdmF0ZQ==' }]);
  expect(extractionJob('slow-owner', id).status).toBe('running');
  const row = database().sqlite.prepare('SELECT payload FROM cache WHERE key = ?').get(`extract-job:${id}`) as { payload: string };
  expect(row.payload).not.toContain('仅存在内存'); expect(row.payload).not.toContain('cHJpdmF0ZQ');
  await runExtractionJob(id, '重复启动', []);
  expect(extractItinerary).toHaveBeenCalledTimes(1);
  finish(draft); await running;
  expect(extractionJob('slow-owner', id)).toMatchObject({ status: 'completed', draft });
});
it('模型失败作为可查询的终态保存，不产生空的成功行程', async () => {
  const id = crypto.randomUUID(); beginExtractionJob('failed-owner', id, 10);
  vi.mocked(extractItinerary).mockRejectedValueOnce(new AppError('MODEL_LIMIT', '模型服务暂时限流。', 503));
  await runExtractionJob(id, '上海攻略', []);
  expect(extractionJob('failed-owner', id)).toMatchObject({ status: 'failed', code: 'MODEL_LIMIT', error: '模型服务暂时限流。', draft: null });
});
it('中断或超时有明确终态，迟来的模型响应不能把失败覆盖为成功', async () => {
  vi.useFakeTimers();
  const id = crypto.randomUUID(); beginExtractionJob('timeout-owner', id, 10);
  let finish!: (value: Draft) => void;
  vi.mocked(extractItinerary).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const running = runExtractionJob(id, '上海攻略', []);
  vi.advanceTimersByTime(extractionDeadlineMs + 1);
  expect(extractionJob('timeout-owner', id)).toMatchObject({ status: 'failed', code: 'EXTRACTION_TIMEOUT' });
  finish(draft); await running;
  expect(extractionJob('timeout-owner', id).status).toBe('failed');
  vi.useRealTimers();
});
