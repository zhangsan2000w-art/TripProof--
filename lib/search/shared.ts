import type { Evidence, SearchCall } from '../domain';

export type SearchBudget = { used: number; limit?: number };
export type SearchResult = { call: SearchCall; pages: Evidence[] };

class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  private starts: number[] = [];
  async enter() {
    if (this.active >= 4) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    while (true) {
      const time = Date.now();
      this.starts = this.starts.filter(start => time - start < 1000);
      if (this.starts.length < 4) { this.starts.push(time); return; }
      await new Promise(resolve => setTimeout(resolve, 1000 - (time - this.starts[0]) + 10));
    }
  }
  leave() {
    const next = this.waiting.shift();
    if (next) next(); else this.active--;
  }
}
export const searchGate = new Gate();

function canonicalUrl(raw: string) {
  const url = new URL(raw); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:spm|share_source)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function mergeSearchPages(pages: Evidence[]): Evidence[] {
  const unique = new Map<string, Evidence>();
  const origins = (page: Evidence) => page.searchOrigins?.length ? page.searchOrigins : [{ provider: page.provider ?? 'yuanbao' as const, searchCallId: page.searchCallId, retrievedAt: page.retrievedAt, passage: page.passage }];
  for (const page of pages) {
    const key = canonicalUrl(page.url), previous = unique.get(key);
    if (!previous) { unique.set(key, page); continue; }
    const sources = [...new Map([...origins(previous), ...origins(page)].map(origin => [`${origin.provider}:${origin.searchCallId}:${origin.passage}`, origin])).values()];
    const primary = page.content.length > previous.content.length ? page : previous;
    unique.set(key, { ...primary, searchOrigins: sources, passage: [...new Set(sources.map(origin => origin.passage).filter(Boolean))].join('\n').slice(0, 36000) });
  }
  return [...unique.values()];
}
