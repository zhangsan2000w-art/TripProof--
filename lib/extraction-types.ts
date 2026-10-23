import type { Draft } from './domain';

export const extractionDeadlineMs = 300_000;
export type ExtractionJob = {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string; draft: Draft | null; error: string | null; code: string | null;
};
