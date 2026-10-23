export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let cursor = 0;
  const results=await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; out[index] = await fn(items[index], index); }
  }));
  const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
  return out;
}
export class Semaphore {
  private active = 0; private queue: (() => void)[] = [];
  constructor(private limit: number, private stage = 'queue') {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const began=Date.now();
    if (this.active >= this.limit) await new Promise<void>(resolve => this.queue.push(resolve));
    else this.active++;
    try { recordMetric(this.stage,Date.now()-began);assertRunning();return await fn(); } finally { const next=this.queue.shift();if(next)next();else this.active--; }
  }
}
import { assertRunning, recordMetric } from './run-control';
