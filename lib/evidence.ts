import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { cacheGet, cacheSet } from './store';
import { now } from './dates';
import type { Evidence, LinkStatus } from './domain';

const matchesDomain = (domain: string, parent: string) => domain === parent || domain.endsWith(`.${parent}`);
const authorityMedia = ['people.com.cn', 'peopleapp.com', 'xinhuanet.com', 'news.cn', 'xinhua.org', 'cctv.com', 'cnr.cn', 'chinanews.com.cn', 'chinanews.com', 'gmw.cn', 'thepaper.cn', 'chinadaily.com.cn', 'ce.cn', 'youth.cn', 'cyol.com',
  'zjol.com.cn', 'hangzhou.com.cn', 'cztv.com', '66wz.com', 'jschina.com.cn', 'xhby.net', 'yangtse.com', 'njdaily.cn', 'longhoo.net', 'cqnews.net', 'zjzwfw.gov.cn', 'nmc.cn', 'cma.cn', 'weather.com.cn'];
// Travel, ticketing and encyclopedia platforms: useful references that still need a second independent source.
const platforms = ['ctrip.com', 'trip.com', 'mafengwo.cn', 'qyer.com', 'dianping.com', 'meituan.com', 'amap.com', 'qunar.com', 'map.baidu.com', 'baike.baidu.com', 'baike.sogou.com', 'baike.so.com', 'bendibao.com', 'ly.com', 'fliggy.com', 'tuniu.com', 'damai.cn', 'maoyan.com'];
export function sourceTier(domain: string, authority: number | null, officialDomain?: string | null, venueSites: string[] = []): 1 | 2 | 3 | 4 {
  if ((officialDomain && matchesDomain(domain, officialDomain)) || domain.endsWith('.gov.cn') || matchesDomain(domain, '12306.cn')) return 1;
  if (venueSites.some(d => matchesDomain(domain, d)) || authorityMedia.some(d => matchesDomain(domain, d)) || (authority !== null && authority >= 4)) return 2;
  if (platforms.some(d => matchesDomain(domain, d))) return 3;
  return 4;
}
export function registrableDomain(domain: string) {
  const parts = domain.toLowerCase().split('.');
  const n = /(?:com|org|gov|net|edu)\.cn$/.test(domain) ? 3 : 2;
  return parts.slice(-n).join('.');
}
const genericSiteLabel = /百科|新浪|搜狐|网易|腾讯|头条|知乎|携程|去哪儿|马蜂窝|大众点评|美团|本地宝|旅游网|攻略|新闻|日报|晚报|政府|门户/;
/** The site label SearchPro prints after the title, e.g. "参观 南京博物院。…". */
export function siteLabel(evidence: Pick<Evidence, 'title' | 'passage'>) {
  const title = evidence.title.trim(), passage = evidence.passage.trim();
  if (!title || !passage.startsWith(title)) return null;
  const label = passage.slice(title.length).trim().split('。')[0]?.trim();
  return label && label.length <= 30 ? label : null;
}
/**
 * A site that the search index itself names after the venue is the venue's own
 * website. It ranks with authoritative sources but is not called official,
 * because the page does not prove which institution runs it.
 */
export function venueSiteDomains(evidence: Evidence[], venueName: string): string[] {
  const name = venueName.replace(/[（(].*?[）)]/g, '').replace(/\s+/g, '');
  if (name.length < 3) return [];
  const sites = new Set<string>();
  for (const e of evidence) {
    const label = siteLabel(e)?.replace(/\s+/g, '').replace(/官网$|官方网站$/, '');
    if (!label || genericSiteLabel.test(label) || label !== name) continue;
    const host = new URL(e.finalUrl || e.url).hostname;
    if (sourceTier(host, null) === 4) sites.add(registrableDomain(host));
  }
  return [...sites];
}
export function normalizeQuote(text: string) { return text.normalize('NFKC').replace(/\s+/g, '').replace(/[“”「」]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-'); }
export function quoteMatches(quote: string, evidence: Pick<Evidence, 'passage' | 'content'>) {
  const q = normalizeQuote(quote);
  return q.length >= 3 && [...quote].length <= 80 && [evidence.passage, evidence.content].some(text => normalizeQuote(text).includes(q));
}
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().split('%')[0];
  if (a.includes(':')) {
    if (a.startsWith('::ffff:')) {
      const suffix = a.slice(7);
      if (suffix.includes('.')) return isPrivateAddress(suffix);
      const groups = suffix.split(':');
      if (groups.length === 2) return isPrivateAddress(`${parseInt(groups[0],16) >> 8}.${parseInt(groups[0],16) & 255}.${parseInt(groups[1],16) >> 8}.${parseInt(groups[1],16) & 255}`);
    }
    return a === '::' || a === '::1' || /^(?:fc|fd|fe[89ab]|ff)/.test(a) || !a.startsWith('2');
  }
  const p = a.split('.').map(Number);
  return p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255) || p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && [0, 168].includes(p[1])) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 198 && [18, 19, 51].includes(p[1])) || (p[0] === 203 && p[1] === 0 && p[2] === 113);
}
async function safeTarget(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('URL_NOT_ALLOWED');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(?:localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('HOST_NOT_ALLOWED');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) throw new Error('ADDRESS_NOT_ALLOWED');
  return { url, address: addresses[0] };
}
function requestPage(url: URL, address: { address: string; family: number }, timeout: number): Promise<{ status: number; location?: string; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      headers: { 'User-Agent': process.env.USER_AGENT || 'TripProof/1.0', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1', 'Accept-Encoding': 'identity' },
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      const contentType = String(response.headers['content-type'] ?? '');
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 2_000_000) chunks.push(chunk); else req.destroy(new Error('PAGE_TOO_LARGE')); });
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        const encoding = /charset\s*=\s*(gbk|gb2312|gb18030)/i.test(contentType) ? 'gb18030' : 'utf-8';
        resolve({ status: response.statusCode ?? 0, location: response.headers.location, body: /(?:html|text|xml)/i.test(contentType) ? new TextDecoder(encoding).decode(raw) : '', contentType });
      });
      response.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('LINK_TIMEOUT')), timeout);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}
export type PageCheck = { linkStatus: LinkStatus; checkedAt: string; finalUrl: string; text: string; sha256: string | null };
export function cachedLinkCheck(url:string) { return cacheGet<PageCheck>(`page:${createHash('sha256').update(url).digest('hex')}`); }
export async function checkLink(url: string, force = false): Promise<PageCheck> {
  const key = `page:${createHash('sha256').update(url).digest('hex')}`;
  const cached = !force && cacheGet<PageCheck>(key);
  if (cached) return cached;
  const result: PageCheck = { linkStatus: 'broken', checkedAt: now(), finalUrl: url, text: '', sha256: null };
  const started = Date.now();
  try {
    let current = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const target = await safeTarget(current);
      const remaining = 6000 - (Date.now() - started);
      if (remaining <= 0) break;
      const page = await requestPage(target.url, target.address, remaining);
      result.finalUrl = current;
      if ([301, 302, 303, 307, 308].includes(page.status) && page.location) { current = new URL(page.location, current).toString(); continue; }
      result.linkStatus = page.status === 403 || page.status === 429 ? 'browser_only' : page.status >= 200 && page.status < 300 ? 'ok' : 'broken';
      if (page.body) {
        const $ = load(page.body); const title = $('title').text();
        if (/页面不存在|页面已删除|访问出错|404\s*(?:not found|错误)/i.test(title)) result.linkStatus = 'broken';
        $('script,style,noscript,svg,nav').remove();
        result.text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 100000);
        result.sha256 = createHash('sha256').update(result.text).digest('hex');
      }
      break;
    }
  } catch { /* A failed check never becomes a usable primary reference. */ }
  cacheSet(key, result, result.linkStatus === 'broken' ? 15 * 60_000 : 6 * 3600_000);
  return result;
}
export async function verifyEvidence(evidence: Evidence, venueName: string) {
  const checked = await checkLink(evidence.url);
  let content = checked.text;
  const position = content.indexOf(venueName.replace(/博物馆|景区/g, ''));
  if (position > 2500) content = content.slice(Math.max(0, position - 1000), position + 11000);
  else content = content.slice(0, 12000);
  if (checked.text.length > 14000) content += ` ${checked.text.slice(-1800)}`;
  return { ...evidence, finalUrl: checked.finalUrl, linkStatus: checked.linkStatus, linkCheckedAt: checked.checkedAt, pageSha256: checked.sha256,
    content: content || evidence.content, tier: sourceTier(new URL(checked.finalUrl).hostname, evidence.authorityLevel) } satisfies Evidence;
}
