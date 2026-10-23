import { api, ApiError } from './client';
import { extractionDeadlineMs, type ExtractionJob } from './extraction-types';
import type { Draft } from './domain';

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

export async function waitForExtraction(id: string, signal: AbortSignal): Promise<Draft> {
  const deadline = Date.now() + extractionDeadlineMs + 30_000;
  let interrupted = 0;
  while (Date.now() < deadline) {
    let job: ExtractionJob;
    try {
      ({ job } = await api<{ job: ExtractionJob }>(`/api/extract/${encodeURIComponent(id)}`, undefined, AbortSignal.any([signal, AbortSignal.timeout(15_000)])));
      if (!job || job.id !== id || !['queued', 'running', 'completed', 'failed'].includes(job.status) || (job.status === 'completed' && !job.draft)) throw new ApiError('读取结果暂未返回，可以继续查询同一任务。', 'INVALID_RESPONSE', 502);
      interrupted = 0;
    }
    catch (error) {
      if (signal.aborted || (error instanceof ApiError && !error.retryable)) throw error;
      if (++interrupted >= 6) throw error instanceof ApiError ? error : new ApiError('暂时无法查询读取进度，可以继续读取同一任务。', 'NETWORK_ERROR', 0);
      await pause(2000, signal); continue;
    }
    if (job.status === 'completed' && job.draft) return job.draft;
    if (job.status === 'failed') throw new ApiError(job.error || '读取未完成，请重试。', job.code || 'EXTRACTION_FAILED', 422);
    await pause(1600, signal);
  }
  throw new ApiError('读取仍未完成，可以点击继续读取查询同一任务，无需重复提交。', 'POLL_TIMEOUT', 0);
}

/** Retries reuse the same job ID, so a lost response never starts a second model call. */
export async function submitExtraction(id: string, input: { text: string; images: { data: string; sourceIndex: number }[] }, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const { ready } = await api<{ ready: boolean }>('/api/extract', undefined, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      if (!ready) throw new ApiError('暂时无法准备读取任务，请重试。', 'INVALID_RESPONSE', 502);
      return await api<{ job: ExtractionJob }>('/api/extract', { ...input, background: true, requestId: id }, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    }
    catch (error) {
      if (signal.aborted || (error instanceof ApiError && !error.retryable) || attempt >= 2) throw error;
      await pause(1200, signal);
    }
  }
}
