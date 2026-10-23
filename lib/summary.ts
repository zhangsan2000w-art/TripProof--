import type { Judgment } from './domain';
export function summary(judgments: Judgment[]) { return { confirmed: judgments.filter(j => j.verdict === 'confirmed').length, conflict: judgments.filter(j => j.verdict === 'conflict').length, unknown: judgments.filter(j => j.verdict === 'unknown').length, total: judgments.length }; }
