export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; out[index] = await fn(items[index], index); }
  }));
  return out;
}
export class Semaphore {
  private active = 0; private queue: (() => void)[] = [];
  constructor(private limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.queue.push(resolve));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }
}
