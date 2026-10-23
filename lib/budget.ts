import type { Item } from './domain';

/**
 * Share the run's search budget so every stop gets its rules search before any stop gets
 * follow-ups. Museums, shows and ticketed sights get the spare searches first.
 */
export function searchAllowance(items: Pick<Item, 'kind'>[], budget: number): number[] {
  const caps = items.map(() => 0);
  let left = Math.max(0, budget);
  const order = items.map((item, index) => ({ index, rank: item.kind === 'museum' || item.kind === 'show' ? 0 : item.kind === 'scenic' ? 1 : item.kind === 'transport' ? 2 : 3 })).sort((a, b) => a.rank - b.rank || a.index - b.index);
  const most = (kind: Item['kind']) => kind === 'museum' || kind === 'show' ? 5 : kind === 'scenic' || kind === 'transport' ? 4 : 2;
  for (let round = 0; left > 0; round++) {
    let given = 0;
    for (const { index } of order) if (left > 0 && caps[index] === round && caps[index] < most(items[index].kind)) { caps[index]++; left--; given++; }
    if (!given) break;
  }
  return caps;
}
