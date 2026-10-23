import { database } from '@/db';
import { cacheGet, cacheSet, quota } from './store';
import { now, today } from './dates';
import { AppError, errorMessage } from './errors';
import { extractItinerary, type InputImage } from './llm';
import { extractionDeadlineMs, type ExtractionJob } from './extraction-types';

type StoredJob = ExtractionJob & { owner: string };
const key = (id: string) => `extract-job:${id}`;
const ttl = 30 * 60_000;
function publicJob({ owner: _owner, ...job }: StoredJob): ExtractionJob { return job; }

/** Only job state and the redacted draft are saved; input text and images stay in memory. */
export function beginExtractionJob(owner: string, requestId: string, limit: number) {
  return database().sqlite.transaction(() => {
    const existing = cacheGet<StoredJob>(key(requestId));
    if (existing) {
      if (existing.owner !== owner) throw new AppError('NOT_FOUND', '读取任务不存在，请重新读取攻略。', 404);
      return { job: publicJob(existing), created: false };
    }
    quota(`extract:${owner}:${today()}`, limit);
    database().sqlite.prepare("DELETE FROM cache WHERE key LIKE 'extract-job:%' AND expires_at <= ?").run(Date.now());
    const stored: StoredJob = { id: requestId, owner, status: 'queued', createdAt: now(), draft: null, error: null, code: null };
    cacheSet(key(requestId), stored, ttl);
    return { job: publicJob(stored), created: true };
  }).immediate();
}

export function extractionJob(owner: string, id: string): ExtractionJob {
  const stored = cacheGet<StoredJob>(key(id));
  if (!stored || stored.owner !== owner) throw new AppError('NOT_FOUND', '读取任务不存在或已过期，请重新读取攻略。', 404);
  if (['queued', 'running'].includes(stored.status) && Date.now() - Date.parse(stored.createdAt) > extractionDeadlineMs) {
    stored.status = 'failed'; stored.code = 'EXTRACTION_TIMEOUT';
    stored.error = '读取超时或服务曾重启，请重新读取攻略；浏览器中的原文仍可继续使用。';
    cacheSet(key(id), stored, ttl);
  }
  return publicJob(stored);
}

export async function runExtractionJob(id: string, text: string, images: InputImage[]) {
  const stored = cacheGet<StoredJob>(key(id));
  if (!stored || stored.status !== 'queued') return;
  stored.status = 'running'; cacheSet(key(id), stored, ttl);
  try {
    const draft = await extractItinerary(text, images);
    // A timed-out task must not later change its terminal state behind the user's back.
    if (cacheGet<StoredJob>(key(id))?.status !== 'running') return;
    stored.status = 'completed'; stored.draft = draft;
  } catch (error) {
    if (cacheGet<StoredJob>(key(id))?.status !== 'running') return;
    stored.status = 'failed'; stored.error = errorMessage(error);
    stored.code = error instanceof AppError ? error.code : 'EXTRACTION_FAILED';
  }
  cacheSet(key(id), stored, ttl);
}
