import { AsyncLocalStorage } from 'node:async_hooks';
type Control = { signal: AbortSignal; metric?: (stage: string, ms: number, detail?: Record<string, unknown>) => void };
const active = new AsyncLocalStorage<Control>();
export function withRunControl<T>(control: Control, fn: () => Promise<T>) { return active.run(control, fn); }
export function runSignal() { return active.getStore()?.signal; }
export function assertRunning() { runSignal()?.throwIfAborted(); }
export function recordMetric(stage: string, ms: number, detail?: Record<string, unknown>) { active.getStore()?.metric?.(stage, ms, detail); }
