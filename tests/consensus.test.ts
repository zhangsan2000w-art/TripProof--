import { describe, expect, it } from 'vitest';
import { judgeItem, resolveFacts } from '../lib/judge';
import { factSupported } from '../lib/facts';
import { venueSiteDomains, sourceTier } from '../lib/evidence';
import { placeNames, searchName, selectVenueSources } from '../lib/source-selection';
import { itemInsight } from '../lib/presentation';
import type { Evidence, Fact } from '../lib/domain';
import { closedMonday, dossier, fact, hours, item, trip } from './fixtures';

const on = (f: Fact, tier: 1 | 2 | 3 | 4, domain: string, patch: Partial<Fact> = {}) => Object.assign(f, { tier, domain, ...patch });
const page = (id: string, site: string, title: string, passage: string): Evidence => ({ id, searchCallId: 'c', url: `https://${site}/${id}`, finalUrl: null, title, site, publishedAt: null, retrievedAt: new Date().toISOString(), passage, content: passage, score: null, authorityLevel: null, tier: 4, linkStatus: 'ok', linkCheckedAt: null, pageSha256: null });
const check = (facts: Fact[], type: string, overrides: Parameters<typeof item>[0] = {}, startDate = '2026-10-24') => {
  const i = item({ kind: 'scenic', placeName: '西湖', start: null, end: null, ...overrides });
  return judgeItem(i, trip([i], { startDate }), dossier(facts, '西湖')).find(j => j.type === type)!;
};

describe('多个独立来源交叉验证', () => {
  it('两个平台都写全天开放：当天开放，不填时间也可前往', () => {
    const fs = [on(hours('00:00', '24:00', null), 3, 'baike.baidu.com', { quote: '开放时间 全天开放' }), on(hours('00:00', '24:00', null), 3, 'touch.go.qunar.com', { quote: '开放时间: 全天开放' })];
    const i = item({ kind: 'scenic', placeName: '西湖', start: null, end: null }), t = trip([i], { startDate: '2026-10-24' }), d = dossier(fs, '西湖');
    const js = judgeItem(i, t, d);
    expect(js.find(j => j.type === 'open_on_date')).toMatchObject({ verdict: 'confirmed', reasonCode: 'OPEN_BY_HOURS' });
    expect(js.find(j => j.type === 'hours_fit')).toMatchObject({ verdict: 'confirmed', reasonCode: 'OPEN_ALL_DAY' });
    const view = itemInsight(i, js, [d], t.startDate);
    expect(view.state).toBe('fits');
    expect(view.rules.find(r => r.label === '营业时间')).toMatchObject({ value: '全天开放', basis: 'consensus' });
    expect(view.rules.some(r => r.label === '停止入场')).toBe(false);
  });
  it('只有一个平台时保持待核实', () => expect(check([on(hours('00:00', '24:00', null), 3, 'baike.baidu.com', { quote: '全天开放' })], 'open_on_date').reasonCode).toBe('WEAK_EVIDENCE'));
  it('普通网页需要三个独立站点一致', () => {
    const two = ['a.com', 'b.com'].map(d => on(hours('08:00', '17:00', null), 4, d));
    expect(check(two, 'hours_fit').ruleStatus).toBe('reference');
    expect(check([...two, on(hours('08:00', '17:00', null), 4, 'c.com')], 'hours_fit').ruleStatus).toBe('verified');
  });
  it('平台来源按多数一致取值，而不是只信最新一篇', () => {
    const majority = ['m.hz.bendibao.com', 'tw.trip.com', 'news.qq.com'].map((d, n) => on(hours('06:30', '18:00', null), n === 2 ? 4 : 3, d, { publishedAt: '2026-05-01' }));
    const newest = on(hours('08:30', '17:00', null), 3, 'baike.sogou.com', { publishedAt: '2026-10-20' });
    const r = resolveFacts([...majority, newest], '2026-10-25', dossier([...majority, newest]));
    expect(r.error).toBeNull();
    expect(r.picked.every(f => f.kind === 'hours' && f.payload.seasons[0].open === '06:30')).toBe(true);
    expect(r.overruled).toContain(newest);
  });
  it('平台来源一比一说法不同时如实标为来源矛盾', () => {
    const fs = [on(hours('08:00', '17:00', null), 3, 'mafengwo.cn'), on(hours('07:30', '17:00', null), 3, 'qunar.com')];
    expect(resolveFacts(fs, '2026-10-24', dossier(fs)).error).toBe('SOURCES_DISAGREE');
  });
  it('政府网站、主流媒体与票务平台分级', () => {
    expect(sourceTier('westlake.hangzhou.gov.cn', null)).toBe(1);
    expect(sourceTier('www.thepaper.cn', null)).toBe(2);
    expect(sourceTier('piao.qunar.com', null)).toBe(3);
    expect(sourceTier('baike.baidu.com', null)).toBe(3);
    expect(sourceTier('kjdf.cn', null)).toBe(4);
  });
});

describe('从开放时间推断当天是否开放', () => {
  it('同一来源列出周一闭馆和开放时间：周二开放，周一冲突', () => {
    const evidenceId = 'official-page';
    const fs = [fact({ kind: 'hours', payload: { seasons: [{ from: '01-01', to: '12-31', open: '08:30', close: '17:00', lastEntry: null }], weekdays: null } }, { evidenceId }), closedMonday()];
    fs[1].evidenceId = evidenceId;
    expect(check(fs, 'open_on_date', { kind: 'museum' }, '2026-10-27')).toMatchObject({ verdict: 'confirmed', reasonCode: 'OPEN_BY_HOURS' });
    expect(check(fs, 'open_on_date', { kind: 'museum' }, '2026-10-26').verdict).toBe('conflict');
  });
  it('博物馆只有开放时间、没有闭馆日信息时不推断开放', () => expect(check([hours()], 'open_on_date', { kind: 'museum' }, '2026-10-26').verdict).toBe('unknown'));
  it('别的来源提到每周闭馆时，景点也不凭开放时间推断', () => {
    const blog = on(closedMonday(), 4, 'blog.example.com');
    expect(check([hours(), blog], 'open_on_date', {}, '2026-10-27').verdict).toBe('unknown');
  });
  it('写明“每日”的开放时间直接说明当天开放', () => expect(check([fact({ kind: 'hours', payload: { seasons: [{ from: '01-01', to: '12-31', open: '07:30', close: '17:30', lastEntry: '17:00' }], weekdays: null } }, { quote: '开放时间每日7:30-17:30（17:00停止入园）' }), closedMonday()], 'open_on_date', { kind: 'museum' }, '2026-10-27').verdict).toBe('confirmed'));
});

describe('来源读取细节', () => {
  it('天气摘要多出标点或温度符号仍能对上原文', () => {
    const e = page('w', 'www.thepaper.cn', '温州天气', '温州：10月24日（周六）： 阴有大到暴雨 20～24℃');
    e.publishedAt = '2026-10-22';
    const f = fact({ kind: 'weather', payload: { date: '2026-10-24', city: '温州', summary: '阴有大到暴雨，20～24℃。', precipitationProb: null, warning: null } }, { quote: '10月24日（周六）： 阴有大到暴雨 20～24℃', evidenceId: 'w' });
    expect(factSupported(f, e)).toBe(true);
    expect(factSupported({ ...f, payload: { ...f.payload, summary: '晴' } } as Fact, e)).toBe(false);
  });
  it('搜索结果把站点名标成场馆名时，按场馆网站计为权威来源', () => {
    const own = page('a', 'www.njmuseum.com', '参观', '参观 南京博物院。开放时间 周一全天闭馆');
    const baike = page('b', 'baike.baidu.com', '南京博物院', '南京博物院 百度百科。南京博物院位于');
    expect(venueSiteDomains([own, baike], '南京博物院')).toEqual(['njmuseum.com']);
    expect(sourceTier('www.njmuseum.com', null, null, ['njmuseum.com'])).toBe(2);
  });
  it('带括号别名和路线标点的地名拆成可搜索的名字', () => {
    expect(placeNames('洞头小洱海（中屿等到你）')).toEqual(['洞头小洱海', '中屿等到你']);
    expect(searchName('公交9路：灵昆站—沙角站', true)).toBe('公交9路 灵昆站 沙角站');
    const hit = page('x', 'www.66wz.com', '洞头小洱海游玩攻略', '洞头小洱海 开放时间 全天');
    expect(selectVenueSources([hit], '洞头小洱海（中屿等到你）', '温州', null)).toEqual([hit]);
  });
});
