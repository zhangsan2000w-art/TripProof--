import { describe, expect, it } from 'vitest';
import type { Dossier, Evidence, Fact, PlaceRisk } from '../lib/domain';
import { addDays, today } from '../lib/dates';
import { assessSafety, dayAdvisories, levelRank, advisorySeverity, type Advisory } from '../lib/risk';
import { judgeItem, judgeTrip } from '../lib/judge';
import { itemInsight } from '../lib/presentation';
import { factSupported, mentionsDayAndWeekday } from '../lib/facts';
import { sourceTier } from '../lib/evidence';
import { item, trip, fact, hours, dossier } from './fixtures';

const start = addDays(today(), 1);
function notice(payload: Partial<Advisory['payload']>, overrides: Partial<Fact> = {}): Advisory {
  return fact({ kind: 'advisory', payload: { type: 'closure', hazard: '台风', level: null, area: '思明区', scope: null, named: [], from: today(), to: null, ...payload } } as Pick<Fact, 'kind' | 'payload'>, { tier: 2, domain: 'news.example.cn', ...overrides }) as Advisory;
}
function risk(city: string, facts: Fact[], places: PlaceRisk[]): Dossier {
  return { venue: { id: `risk-${city}`, key: `risk:${city}`, canonicalName: `${city}预警与区域公告`, city, officialDomain: null, officialEvidenceId: null, investigationDates: [start] }, facts, evidence: [], calls: [], searchedScope: ['q'], limitations: [], createdAt: new Date().toISOString(), places };
}
const place = (name: string, exposure: PlaceRisk['exposure'], covers: PlaceRisk['covers'] = []): PlaceRisk => ({ place: name, exposure, exposureReason: '测试', covers });

describe('预警与区域公告优先于营业时间', () => {
  it('区域公告按范围覆盖到未点名的海边景点', () => {
    const closure = notice({ scope: '所有涉海景区景点', area: '思明区' });
    const r = risk('厦门', [closure], [place('环岛路沙滩', 'coastal', [{ factId: closure.id, how: 'scope', reason: '思明区海边沙滩' }]), place('厦门市博物馆', 'indoor')]);
    const beach = item({ id: 'b', placeName: '环岛路沙滩', city: '厦门', kind: 'scenic', start: null, end: null });
    const museum = item({ id: 'm', placeName: '厦门市博物馆', city: '厦门', kind: 'museum', start: null, end: null });
    expect(assessSafety(beach, start, '厦门', r, undefined)).toMatchObject({ verdict: 'conflict', code: 'AREA_CLOSED' });
    expect(assessSafety(museum, start, '厦门', r, undefined)).toBeNull();
  });
  it('暴雨预警时山地点位不建议前往，露天街区待核实，室内不受影响', () => {
    const warning = notice({ type: 'warning', hazard: '暴雨', level: '黄色', area: '广州市' });
    const cover = [{ factId: warning.id, how: 'area' as const, reason: '广州市内' }];
    const r = risk('广州', [warning], [place('白云山', 'mountain', cover), place('北京路步行街', 'outdoor', cover), place('广东省博物馆', 'indoor', cover)]);
    const at = (name: string, kind: 'scenic' | 'museum') => assessSafety(item({ placeName: name, city: '广州', kind }), start, '广州', r, undefined);
    expect(at('白云山', 'scenic')).toMatchObject({ verdict: 'conflict', code: 'HAZARD_EXPOSED' });
    expect(at('北京路步行街', 'scenic')).toMatchObject({ verdict: 'unknown', code: 'HAZARD_ALERT' });
    expect(at('广东省博物馆', 'museum')).toBeNull();
  });
  it('台风红色预警时室内场馆也要先确认', () => {
    const warning = notice({ type: 'warning', hazard: '台风', level: '红色', area: '深圳市' });
    const r = risk('深圳', [warning], [place('深圳博物馆', 'indoor', [{ factId: warning.id, how: 'area', reason: '深圳市内' }])]);
    expect(assessSafety(item({ placeName: '深圳博物馆', city: '深圳' }), start, '深圳', r, undefined)).toMatchObject({ verdict: 'unknown', code: 'HAZARD_ALERT' });
  });
  it('预警当天交通以停运公告为准，停航公告覆盖时判停运', () => {
    const warning = notice({ type: 'response', hazard: '台风', level: 'Ⅲ级', area: '舟山市' });
    const ferry = notice({ type: 'suspension', hazard: '台风', area: '舟山市', scope: '客渡运航线' });
    const r = risk('舟山', [warning, ferry], [place('普陀山轮渡', 'transport', [{ factId: ferry.id, how: 'scope', reason: '客渡运航线' }]), place('定海公交1路', 'transport', [{ factId: warning.id, how: 'area', reason: '舟山市内' }])]);
    expect(assessSafety(item({ placeName: '普陀山轮渡', city: '舟山', kind: 'transport' }), start, '舟山', r, undefined)).toMatchObject({ verdict: 'conflict', code: 'SERVICE_SUSPENDED' });
    expect(assessSafety(item({ placeName: '定海公交1路', city: '舟山', kind: 'transport' }), start, '舟山', r, undefined)).toMatchObject({ verdict: 'unknown', code: 'SERVICE_ALERT' });
  });
  it('一个普通网页的关闭消息不能单独判关闭', () => {
    const closure = notice({ named: ['青城山'], area: '都江堰市' }, { tier: 4, domain: 'blog.example.com' });
    const r = risk('成都', [closure], [place('青城山', 'mountain', [{ factId: closure.id, how: 'named', reason: '原文点名' }])]);
    expect(assessSafety(item({ placeName: '青城山', city: '成都', kind: 'scenic' }), start, '成都', r, undefined)).toMatchObject({ verdict: 'unknown', code: 'CLOSURE_REPORTED' });
  });
  it('一个月以前的公告和已恢复开放的关闭不再生效', () => {
    const old = notice({ from: addDays(today(), -40), named: ['青城山'] });
    const closed = notice({ from: addDays(today(), -3), named: ['都江堰'] }), reopen = notice({ type: 'reopen', from: today(), named: ['都江堰'] });
    const r = risk('成都', [old, closed, reopen], [place('青城山', 'mountain', [{ factId: old.id, how: 'named', reason: '' }]), place('都江堰', 'water', [{ factId: closed.id, how: 'named', reason: '' }, { factId: reopen.id, how: 'named', reason: '' }])]);
    expect(assessSafety(item({ placeName: '青城山', city: '成都', kind: 'scenic' }), start, '成都', r, undefined)).toBeNull();
    expect(assessSafety(item({ placeName: '都江堰', city: '成都', kind: 'scenic' }), start, '成都', r, undefined)).toBeNull();
  });
  it('超过7天的行程不套用当前预警', () => {
    const warning = notice({ type: 'warning', hazard: '暴雨', level: '红色', area: '武汉市' });
    const r = risk('武汉', [warning], [place('东湖', 'water', [{ factId: warning.id, how: 'area', reason: '' }])]);
    expect(assessSafety(item({ placeName: '东湖', city: '武汉', kind: 'scenic' }), addDays(today(), 10), '武汉', r, undefined)).toBeNull();
  });
  it('没有预警但预报有暴雨时，露天行程待核实', () => {
    const forecast = fact({ kind: 'weather', payload: { date: start, city: '西安', summary: '暴雨转大雨', precipitationProb: null, warning: null } });
    const weather: Dossier = { ...dossier([forecast], '西安天气'), venue: { ...dossier([]).venue, key: `weather:西安:${start}` } };
    expect(assessSafety(item({ placeName: '大唐不夜城', city: '西安', kind: 'scenic' }), start, '西安', risk('西安', [], []), weather)).toMatchObject({ verdict: 'unknown', code: 'HAZARD_FORECAST' });
    expect(assessSafety(item({ placeName: '陕西历史博物馆', city: '西安', kind: 'museum' }), start, '西安', risk('西安', [], []), weather)).toBeNull();
  });
  it('全市预警即使没被逐站列出也覆盖本市地点', () => {
    const warning = notice({ type: 'warning', hazard: '台风', level: '橙色', area: '珠海市' });
    expect(assessSafety(item({ placeName: '情侣路', city: '珠海', kind: 'scenic' }), start, '珠海', risk('珠海', [warning], []), undefined)).toMatchObject({ verdict: 'unknown', code: 'HAZARD_ALERT' });
  });
  it('预警等级按原文读取', () => {
    expect([levelRank('蓝色'), levelRank('黄色预警'), levelRank('Ⅲ级'), levelRank('II级'), levelRank('一级'), levelRank(null)]).toEqual([1, 2, 2, 3, 4, null]);
    expect(advisorySeverity(notice({ type: 'warning', hazard: '台风', level: '蓝色' }))).toBe('watch');
    expect(advisorySeverity(notice({ type: 'warning', hazard: '台风', level: '黄色' }))).toBe('high');
    expect(advisorySeverity(notice({ type: 'response', hazard: '台风', level: 'Ⅳ级' }))).toBe('high');
    expect(advisorySeverity(notice({ type: 'warning', hazard: '暴雨', level: '橙色' }))).toBe('severe');
  });
});

describe('只有转载来源的预警', () => {
  const response = notice({ type: 'response', hazard: '台风', level: 'Ⅲ级', area: '福建省' }, { tier: 4, domain: 'feed.example.com' });
  const cover = [{ factId: response.id, how: 'area' as const, reason: '福建省内' }];
  const places = [place('鼓浪屿', 'coastal', cover), place('中山路', 'outdoor', cover), place('厦门市博物馆', 'indoor', cover)];
  const at = (r: Dossier, name: string, kind: 'scenic' | 'museum') => assessSafety(item({ placeName: name, city: '厦门', kind }), start, '厦门', r, undefined);
  it('不判不能去，但受影响的地点也不标可前往', () => {
    const r = risk('厦门', [response], places);
    expect(at(r, '鼓浪屿', 'scenic')).toMatchObject({ verdict: 'unknown', code: 'HAZARD_REPORTED' });
    expect(at(r, '中山路', 'scenic')).toMatchObject({ verdict: 'unknown', code: 'HAZARD_REPORTED' });
    expect(at(r, '厦门市博物馆', 'museum')).toBeNull();
  });
  it('第二个独立站点佐证后按预警处理', () => {
    const second = { ...response, id: 'second-response', domain: 'news.other.cn', evidenceId: 'e-other' } as Advisory;
    const r = risk('厦门', [response, second], places.map(p => ({ ...p, covers: [...p.covers, { factId: second.id, how: 'area' as const, reason: '' }] })));
    expect(at(r, '鼓浪屿', 'scenic')).toMatchObject({ verdict: 'conflict', code: 'HAZARD_EXPOSED' });
  });
  it('当天横幅保留这条报道并标明未证实', () => {
    const banner = dayAdvisories([risk('厦门', [response], places)], start);
    expect(banner).toHaveLength(1);
    expect(banner[0].confirmed).toBe(false);
  });
});

describe('预报表只写日和星期', () => {
  const source = { publishedAt: '2026-10-22' };
  it('日和星期都对上、来源是前几天发布的才算这一天', () => {
    expect(mentionsDayAndWeekday('2026-10-24', '24日(周六):阴有中阵雨,局部大雨', source)).toBe(true);
    expect(mentionsDayAndWeekday('2026-10-24', '24日（星期六） 阴有中阵雨', source)).toBe(true);
    expect(mentionsDayAndWeekday('2026-10-24', '24日(周日):阴有中阵雨', source)).toBe(false);
    expect(mentionsDayAndWeekday('2026-10-04', '24日(周六):阴有中阵雨', source)).toBe(false);
    expect(mentionsDayAndWeekday('2026-10-24', '24日(周六):阴有中阵雨', { publishedAt: '2026-09-01' })).toBe(false);
    expect(mentionsDayAndWeekday('2026-10-24', '24日(周六):阴有中阵雨', { publishedAt: null })).toBe(false);
  });
});

describe('报告状态：安全结论盖过营业时间', () => {
  const t = trip([item({ id: 'x', placeName: '鼓浪屿', city: '厦门', kind: 'scenic', start: null, end: null })], { startDate: start, destinationCity: '厦门' });
  const allDay = fact({ kind: 'hours', payload: { seasons: [{ from: '01-01', to: '12-31', open: '00:00', close: '24:00', lastEntry: null }], weekdays: null } }, { quote: '全天开放' });
  const venue = { ...dossier([allDay, { ...allDay, id: 'second', domain: 'other.example.cn', evidenceId: 'e2' } as Fact], '鼓浪屿'), venue: { ...dossier([]).venue, key: '厦门:鼓浪屿', canonicalName: '鼓浪屿' } };
  it('全天开放但已公告关闭时显示需调整', () => {
    const closure = notice({ named: ['鼓浪屿'] });
    const r = risk('厦门', [closure], [place('鼓浪屿', 'coastal', [{ factId: closure.id, how: 'named', reason: '原文点名' }])]);
    const judgments = judgeTrip(t, [venue, r]);
    const insight = itemInsight(t.items[0], judgments, [venue, r], start);
    expect(insight.state).toBe('adjust');
    expect(insight.message).toContain('已公告关闭');
  });
  it('有预警时不显示可前往', () => {
    const warning = notice({ type: 'warning', hazard: '台风', level: '蓝色', area: '厦门市' });
    const r = risk('厦门', [warning], [place('鼓浪屿', 'coastal', [{ factId: warning.id, how: 'area', reason: '' }])]);
    const judgments = judgeTrip(t, [venue, r]);
    expect(itemInsight(t.items[0], judgments, [venue, r], start).state).toBe('verify');
    expect(itemInsight(t.items[0], judgeTrip(t, [venue]), [venue], start).state).toBe('fits');
  });
});

describe('场馆临时关闭未写恢复日期', () => {
  const closure = (from: string) => fact({ kind: 'temp_closure', payload: { from, to: null, scope: 'whole', note: '' } }, { tier: 2 });
  it('近期官方公告且没查到恢复通知，按关闭处理', () => {
    const t = trip([item({ start: null, end: null })], { startDate: start });
    expect(judgeItem(t.items[0], t, dossier([hours(), closure(addDays(today(), -2))])).find(j => j.type === 'open_on_date')).toMatchObject({ verdict: 'conflict', reasonCode: 'CLOSED_UNTIL_NOTICE' });
  });
  it('很久以前的关闭只提示待确认', () => {
    const t = trip([item({ start: null, end: null })], { startDate: start });
    expect(judgeItem(t.items[0], t, dossier([hours(), closure(addDays(today(), -60))])).find(j => j.type === 'open_on_date')).toMatchObject({ verdict: 'unknown', reasonCode: 'OPEN_ENDED_CLOSURE' });
  });
});

describe('公告原文核验', () => {
  const evidence = (content: string): Evidence => ({ id: 'e', searchCallId: 's', url: 'https://news.example.cn/a', finalUrl: null, title: '景区关闭', site: 'news.example.cn', publishedAt: today(), retrievedAt: new Date().toISOString(), passage: content, content, score: null, authorityLevel: null, tier: 2, linkStatus: 'ok', linkCheckedAt: null, pageSha256: null });
  const md = `${Number(today().slice(5, 7))}月${Number(today().slice(8))}日`;
  const base = { evidenceId: 'e', venueMatch: 'exact' as const, validFrom: null, validTo: null, kind: 'advisory' as const };
  it('地区、等级和日期都要在原文里', () => {
    const text = `受台风影响，自${md}18时起，某某区所有涉海景区景点临时关闭。市气象台发布台风黄色预警。`;
    const ok = { ...base, quote: `自${md}18时起，某某区所有涉海景区景点临时关闭`, payload: { type: 'closure' as const, hazard: '台风' as const, level: null, area: '某某区', scope: '所有涉海景区景点', named: [], from: today(), to: null } };
    expect(factSupported(ok, evidence(text))).toBe(true);
    expect(factSupported({ ...ok, payload: { ...ok.payload, area: '另一区' } }, evidence(text))).toBe(false);
    expect(factSupported({ ...ok, payload: { ...ok.payload, level: '红色' } }, evidence(text))).toBe(false);
    expect(factSupported({ ...ok, payload: { ...ok.payload, from: addDays(today(), -5) } }, evidence(text))).toBe(false);
  });
});

describe('来源分级不按城市写名单', () => {
  it('各地官方媒体按站名识别，商业平台不算', () => {
    expect(sourceTier('www.cdrb.com.cn', null, null, [], '成都日报')).toBe(2);
    expect(sourceTier('www.xiancity.cn', null, null, [], '西安广播电视台')).toBe(2);
    expect(sourceTier('news.example.com', null, null, [], '某某旅游新闻网')).toBe(4);
    expect(sourceTier('you.ctrip.com', null, null, [], '携程攻略')).toBe(3);
    expect(sourceTier('www.scol.com.cn', null)).toBe(2);
    expect(sourceTier('www.66wz.com', null)).toBe(4);
  });
});

import { searchAllowance } from '../lib/budget';
import { allDayHours, closedWeekdays } from '../lib/facts';
import { resolveFacts } from '../lib/judge';
describe('搜索额度按地点分配', () => {
  it('15 个地点时每站至少一次，博物馆优先拿到额外额度', () => {
    const kinds = ['museum', 'scenic', 'scenic', 'scenic', 'scenic', 'museum', 'scenic', 'scenic', 'scenic', 'scenic', 'scenic', 'scenic', 'scenic', 'scenic', 'scenic'] as const;
    const caps = searchAllowance(kinds.map(kind => ({ kind })), 35);
    expect(caps.every(c => c >= 2)).toBe(true);
    expect(caps.reduce((a, b) => a + b, 0)).toBe(35);
    expect(caps[0]).toBeGreaterThanOrEqual(caps[1]);
  });
  it('额度不够时按顺序保证前面的地点，后面明确标出未检索', () => {
    const caps = searchAllowance(Array.from({ length: 50 }, () => ({ kind: 'scenic' as const })), 35);
    expect(caps.filter(c => c === 1).length).toBe(35);
    expect(caps.filter(c => c === 0).length).toBe(15);
  });
});
describe('开放规则不能和同一句的闭馆日矛盾', () => {
  it('“全年开放时间…周一闭馆”不是每天开放', () => {
    const t = trip([item({ start: null, end: null })], { startDate: '2026-10-26' });
    const f = fact({ kind: 'hours', payload: { seasons: [{ from: '01-01', to: '12-31', open: '09:00', close: '17:00', lastEntry: null }], weekdays: null } }, { quote: '全年开放时间 9:00-17:00(周一闭馆)' });
    const closed = fact({ kind: 'weekly_closure', payload: { closedWeekdays: [1], exceptStatutoryHolidays: false } }, { quote: '周一闭馆', evidenceId: f.evidenceId });
    expect(judgeItem(t.items[0], t, dossier([f, closed])).find(j => j.type === 'open_on_date')).toMatchObject({ verdict: 'conflict', reasonCode: 'CLOSED_WEEKLY' });
  });
  it('读出闭馆星期，并拒绝包含闭馆日的“每天开放”', () => {
    expect(closedWeekdays('剧院参观开放时间为10:00—16:30，逢周一闭馆')).toEqual([1]);
    expect(closedWeekdays('每周二至周日开放，星期一不开放')).toEqual([1]);
    const ev: Evidence = { id: 'e', searchCallId: 's', url: 'https://x.example.cn', finalUrl: null, title: 't', site: 'x.example.cn', publishedAt: null, retrievedAt: new Date().toISOString(), passage: '全年开放，周一闭馆', content: '全年开放，周一闭馆', score: null, authorityLevel: null, tier: 3, linkStatus: 'ok', linkCheckedAt: null, pageSha256: null };
    expect(factSupported({ evidenceId: 'e', quote: '全年开放，周一闭馆', venueMatch: 'exact', validFrom: null, validTo: null, kind: 'weekly_open', payload: { weekdays: [0, 1, 2, 3, 4, 5, 6], exceptStatutoryHolidays: false } }, ev)).toBe(false);
  });
  it('多个来源写“全天开放”时，不被一篇文章里的夜游时段带偏', () => {
    const open = (domain: string, quote: string) => fact({ kind: 'weekly_open', payload: { weekdays: [0, 1, 2, 3, 4, 5, 6], exceptStatutoryHolidays: false } }, { tier: 3, domain, quote });
    const derived = [open('guide-a.com', '开放时间：全年 全天开放'), open('guide-b.cn', '步行街全天开放')].flatMap(f => allDayHours(f).map(h => ({ ...f, ...h, id: `${f.id}-h` }) as Fact));
    const night = fact({ kind: 'hours', payload: { seasons: [{ from: '01-01', to: '12-31', open: '18:00', close: '22:00', lastEntry: null }], weekdays: null } }, { tier: 3, domain: 'guide-c.net' });
    const r = resolveFacts([...derived, night], '2026-10-25', dossier([...derived, night]));
    expect(r.error).toBeNull();
    expect(r.picked[0].kind === 'hours' && r.picked[0].payload.seasons[0].open).toBe('00:00');
    expect(allDayHours(open('d.example.com', '每天 9:00-18:00 全天开放'))).toEqual([]);
  });
});
