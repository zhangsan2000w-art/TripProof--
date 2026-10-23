import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { missingTimeNote, prepareDraft, unresolvedTarget } from '../lib/itinerary';
import { placeNames, searchName, selectVenueSources } from '../lib/source-selection';
import { judgeItem } from '../lib/judge';
import { itemInsight } from '../lib/presentation';
import type { Draft, Evidence } from '../lib/domain';
import { item, trip } from './fixtures';

it('保留含零宽字符的上海原文作为回归输入', () => {
  const text = readFileSync(new URL('./fixtures/shanghai-itinerary.md', import.meta.url), 'utf8');
  expect(text).toContain('\u200B'); expect(text).toContain('09:00-11:30 豫园&城隍庙'); expect(text).toContain('上海博物馆');
});
it('独立场馆分别核查，联合时段不变成两份虚构的到达时间，门票规则不串用', () => {
  const { id: _id, day: _day, dependsOn: _deps, ...raw } = item({ placeName: '豫园&城隍庙', city: '上海', kind: 'scenic', start: '09:00', end: '11:30', sourceText: '09:00-11:30 豫园&城隍庙，豫园需要买票，城隍庙及周边商城免费。', sourceImage: 9, claimedRules: [{ kind: 'other', text: '豫园需要买票，城隍庙及周边商城免费。' }] });
  const draft: Draft = { guideMeta: { title: null, publishedAt: null }, days: [{ dayIndex: 1, items: [{ ...raw, dependsOnPrevious: false }] }], recommendations: [{ name: '上海博物馆', note: '提前预约提醒', sourceImage: null }], ambiguities: [] };
  const result = prepareDraft(draft, []), items = result.days[0].items;
  expect(items.map(i => i.placeName)).toEqual(['豫园', '城隍庙']);
  expect(items.every(i => i.start === null && i.end === null && i.sourceImage === null && i.activity.includes('09:00—11:30') && i.claimedRules.length === 0)).toBe(true);
  expect(items.map(i => i.seq)).toEqual([1, 2]); expect(items[0].sourceText).toBe(raw.sourceText);
  expect(result.recommendations).toEqual(draft.recommendations); expect(draft.days[0].items).toHaveLength(1);
  expect(missingTimeNote(items[0])).toBe('原文是联合时段，本站时间未单列');
});
it('组合场馆拆开后超过可保存上限时给出可操作的提示，不把错误行程送到校对页', () => {
  const { id: _id, day: _day, dependsOn: _deps, ...raw } = item({ placeName: '豫园&城隍庙', kind: 'scenic' });
  const make = (count: number): Draft => ({ guideMeta: { title: null, publishedAt: null }, days: [{ dayIndex: 1, items: Array.from({ length: count }, () => ({ ...raw, dependsOnPrevious: false })) }], recommendations: [], ambiguities: Array.from({ length: 40 }, (_, i) => `提示${i}`) });
  expect(() => prepareDraft(make(21), [])).toThrow('每天最多40项');
  expect(prepareDraft(make(20), []).ambiguities).toHaveLength(40);
});
it('Citywalk和箭头是活动及路线格式，不能导致所有地点来源被过滤', () => {
  expect(searchName('武康路\u200bCitywalk')).toBe('武康路');
  expect(placeNames('外滩 → 陆家嘴轮渡', true)).toContain('外滩');
  expect(searchName('外滩 → 陆家嘴轮渡', true)).toBe('外滩 陆家嘴轮渡');
  const e: Evidence = { id: 'source', searchCallId: 'c', title: '武康路开放时间', passage: '武康路公共道路全天开放', content: '', url: 'https://example.com/wukang', finalUrl: null, site: 'example.com', retrievedAt: '', publishedAt: null, score: null, authorityLevel: null, tier: 3, linkStatus: 'ok', linkCheckedAt: null, pageSha256: null };
  expect(selectVenueSources([e], '武康路Citywalk', '上海', null)).toEqual([e]);
});
it('未指定商家的午餐保留为待选定，不伪装成没有搜到营业时间的场馆', () => {
  const i = item({ kind: 'restaurant', placeName: '安福路或武康路附近' }), t = trip([i]);
  const js = judgeItem(i, t);
  expect(js).toEqual([expect.objectContaining({ reasonCode: 'UNSPECIFIED_BUSINESS', verdict: 'unknown', factIds: [] })]);
  expect(itemInsight(i, js, [], t.startDate)).toMatchObject({ state: 'verify', message: expect.stringContaining('尚未选定餐厅'), rules: [expect.objectContaining({ value: '商家待选定' })] });
  expect(unresolvedTarget(item({ kind: 'restaurant', placeName: '南翔馒头店' }))).toBeNull();
});
it('可选交通方式不能被确认为某条线路的时刻；明确线路仍可正常调查', () => {
  const i = item({ kind: 'transport', placeName: '豫园 → 南京路步行街', sourceText: '之后步行或坐地铁前往南京路步行街。' });
  expect(judgeItem(i, trip([i]))).toEqual([expect.objectContaining({ reasonCode: 'UNSPECIFIED_ROUTE', verdict: 'unknown' })]);
  expect(unresolvedTarget(item({ kind: 'transport', placeName: '公交9路', sourceText: '从灵昆站乘9路公交到沙角站' }))).toBeNull();
});
