import type { Evidence } from './domain';
import { readableText } from './itinerary';

/**
 * Names as guides write them ("洞头小洱海（中屿等到你）", "公交9路：灵昆站—沙角站") rarely
 * appear verbatim on web pages. The main name comes first, then any alias in brackets,
 * then the parts of a route.
 */
export function placeNames(name: string, transport = false): string[] {
  const full = readableText(name).replace(/city\s*walk/gi, '').replace(/\s+/g, '');
  const main = full.replace(/[（(][^）)]*[）)]/g, '');
  const aliases = [...full.matchAll(/[（(]([^）)]+)[）)]/g)].map(m => m[1]).filter(a => [...a].length >= 3 && !/轨道交通|打车|步行|地铁|公交/.test(a));
  const parts = transport ? main.split(/[／/—\-：:→➡]+/).filter(p => [...p].length >= 2) : [];
  return [...new Set([main || full, ...aliases, ...parts].filter(Boolean))];
}
/** The query form of a place name: brackets and route punctuation become spaces. */
export function searchName(name: string, transport = false) {
  return transport ? readableText(name).replace(/[（()）]/g, ' ').replace(/[／/—：:→➡]+/g, ' ').replace(/\s+/g, ' ').trim() : placeNames(name)[0];
}
/** Relevance comes before source prestige; unrelated official pages add noise. */
export function selectVenueSources(pages: Evidence[], name: string, city: string, officialDomain: string | null, limit = 8, transport = false): Evidence[] {
  const mixedProviders = pages.some(page => page.provider === 'deepseek');
  const names = placeNames(name, transport);
  const cores = names.map(n => n.replace(new RegExp(`^${city.replace(/市$/, '')}市?`), '').replace(/景区$|公园$|风景区$/, '') || n).filter(c => c.length >= 2);
  const matches = (text: string) => names.some(n => text.includes(n)) || cores.some(c => text.includes(c));
  const score = (e: Evidence) => {
    const title = e.title.replace(/\s+/g, ''), body = `${e.passage} ${e.content}`.replace(/\s+/g, '');
    const titleMatch = matches(title);
    const bodyMatch = matches(body);
    const rule = /开放时间|营业时间|停止入|停止售|参观须知|预约|首末班|运营时间|闭馆|关闭|临时调整/.test(`${title} ${body}`);
    return (titleMatch ? 100 : bodyMatch ? 70 : -100) + (rule ? 25 : 0) + (officialDomain && e.site === officialDomain ? 8 : 0) + (5 - e.tier) * 3 + (mixedProviders ? 0 : Math.min(1, e.score ?? 0));
  };
  const unique = [...new Map(pages.map(p => [p.url, p])).values()].sort((a, b) => score(b) - score(a));
  const selected: Evidence[] = [], domains = new Map<string, number>();
  for (const page of unique) {
    if (score(page) < 0) continue;
    const domain = page.site.split('.').slice(/\.(?:com|gov|org)\.cn$/.test(page.site) ? -3 : -2).join('.');
    if ((domains.get(domain) ?? 0) >= 2) continue;
    domains.set(domain, (domains.get(domain) ?? 0) + 1); selected.push(page);
    if (selected.length >= limit) break;
  }
  return selected;
}
