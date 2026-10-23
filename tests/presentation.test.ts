import { afterEach, expect, it, vi } from 'vitest';
import { alternativeInsight, itemInsight, itineraryInsights } from '../lib/presentation';
import { judgeItem } from '../lib/judge';
import { selectVenueSources } from '../lib/source-selection';
import { tomorrow } from '../lib/dates';
import { validateTrip } from '../lib/validate';
import type { Evidence, Judgment } from '../lib/domain';
import { dossier, fact, hours, item, openDays, trip } from './fixtures';

afterEach(() => vi.useRealTimers());
it('出发日期为空或缺失时按北京时间的明天，保留用户填入的日期与空到达时间', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T16:05:00Z'));
  expect(tomorrow()).toBe('2026-10-25');
  for (const startDate of [undefined, null, '']) expect(validateTrip({ ...trip([item({ start: null, end: null })]), startDate }).startDate).toBe('2026-10-25');
  const kept = validateTrip(trip([item({ start: null, end: null })]));
  expect(kept.startDate).toBe('2026-10-26'); expect(kept.items[0].start).toBeNull();
});
it('已查到营业规则但没填到达时间时展示待补时间，而不是把规则当成没搜到', () => {
  const i = item({ start: null, end: null }), d = dossier([hours('08:00','20:00','19:30')]), t = trip([i]);
  const js = judgeItem(i,t,d), view = itemInsight(i,js,[d],t.startDate);
  expect(view.state).toBe('needs_time');
  expect(view.rules).toEqual(expect.arrayContaining([expect.objectContaining({label:'营业时间',value:'08:00—20:00',verified:true}),expect.objectContaining({label:'停止入场',value:'19:30'})]));
});
it('攻略营业时间过时单独提示，不把没有计划时间的安排标红', () => {
  const i = item({ start:null,end:null,claimedRules:[{kind:'hours',text:'08:00—17:30'}] }), d = dossier([hours('08:00','20:00')]), t = trip([i]);
  const js=judgeItem(i,t,d), view=itemInsight(i,js,[d],t.startDate);
  expect(view.updates).toHaveLength(1); expect(view.conflicts).toHaveLength(0); expect(view.state).toBe('needs_time');
});
it('实时余票和天气未知不会覆盖已核实的逐站时段结论，统计按地点计算', () => {
  const i=item(),t=trip([i],{startDate:'2026-10-27'}),d=dossier([hours(),openDays()]);
  const js=judgeItem(i,t,d); expect(js.some(j=>j.type==='availability'&&j.verdict==='unknown')).toBe(true);
  expect(itemInsight(i,js,[d],t.startDate).state).toBe('fits');
  expect(itineraryInsights(t,js,[d]).counts).toMatchObject({fits:1,adjust:0,verify:0});
});
it('已证实的停止入场冲突必须标红；证据不足不会变成时段符合', () => {
  const i=item({start:'19:30',end:null}),t=trip([i]),d=dossier([hours('08:00','20:00','19:30')]);
  expect(itemInsight(i,judgeItem(i,t,d),[d],t.startDate).state).toBe('adjust');
  expect(itemInsight(i,judgeItem(i,t),[],t.startDate).state).toBe('verify');
});
it('单个平台的停止入场参考不能误判为已确认冲突，也不能把临近闭园的安排确认可行', () => {
  const i=item({start:'19:40',end:null}),t=trip([i]);
  const cutoff=hours('08:00','20:00','19:30');cutoff.tier=3;cutoff.domain='bendibao.com';
  const d=dossier([hours('08:00','20:00',null),cutoff]);
  expect(judgeItem(i,t,d).find(j=>j.type==='hours_fit')).toMatchObject({verdict:'unknown',reasonCode:'LAST_ENTRY_UNVERIFIED'});
});
it('同一平台重复规则优先引用标准页面，移动页面的日期字段不会挤掉标准来源', () => {
  const i=item({start:null,end:null}),t=trip([i]);
  const official=hours('08:00','20:00',null), mobile=hours('08:00','20:00','19:30'), desktop=hours('08:00','20:00','19:30');
  Object.assign(mobile,{tier:3,domain:'m.hz.bendibao.com',publishedAt:'2026-08-17'});
  Object.assign(desktop,{tier:3,domain:'hz.bendibao.com',publishedAt:null});
  const d=dossier([official,mobile,desktop]);
  d.evidence=[mobile,desktop].map(f=>({id:f.evidenceId,searchCallId:'c',url:`https://${f.domain}/tour`,finalUrl:null,title:'雷峰塔营业时间',site:f.domain,tier:3,publishedAt:f.publishedAt,retrievedAt:'',passage:f.quote,content:'',score:null,authorityLevel:null,linkStatus:'ok',linkCheckedAt:null,pageSha256:null}));
  const view=itemInsight(i,judgeItem(i,t,d),[d],t.startDate);
  expect(view.citations.map(c=>c.evidence.url)).toEqual(['https://hz.bendibao.com/tour']);
  expect(view.rules.find(r=>r.label==='停止入场')?.verified).toBe(false);
});
it('其他景点的官方新闻不能挤掉目标景点的营业资料，并控制同域重复来源', () => {
  const page=(id:string,title:string,site:string,tier:1|3):Evidence=>({id,searchCallId:'c',url:`https://${site}/${id}`,finalUrl:null,title,site,tier,publishedAt:null,retrievedAt:'',passage:title,content:'',score:null,authorityLevel:null,linkStatus:'ok',linkCheckedAt:null,pageSha256:null});
  const relevant=page('target','2026杭州雷峰塔营业时间与停止入园时间','hz.bendibao.com',3);
  const selected=selectVenueSources([page('noise','太子尖景区预约须知','wgly.hangzhou.gov.cn',1),relevant,page('one','雷峰塔开放时间','hz.bendibao.com',3),page('two','雷峰塔预约时间','hz.bendibao.com',3)],'雷峰塔','杭州',null);
  expect(selected[0]).toBe(relevant); expect(selected.some(e=>e.id==='noise')).toBe(false); expect(selected).toHaveLength(2);
});
it('替代场馆按其独立规则和所在日判定，不沿用原场馆的攻略差异', () => {
  const original=item({day:2,start:null,end:null,claimedRules:[{kind:'hours',text:'08:00—17:30'}]});
  const t=trip([original],{startDate:'2026-10-31'}), candidate=item({...original,id:'alternative',placeName:'替代场馆',claimedRules:[]});
  const d=dossier([fact({kind:'hours',payload:{seasons:[{from:'05-01',to:'10-31',open:'08:00',close:'20:00',lastEntry:'19:30'},{from:'11-01',to:'04-30',open:'08:00',close:'17:30',lastEntry:'17:00'}],weekdays:null}})],'替代场馆');
  const view=alternativeInsight(t,{itemId:original.id,name:candidate.placeName,reason:'独立核查',dossier:d,judgments:judgeItem(candidate,t,d)});
  expect(view?.item.claimedRules).toEqual([]); expect(view?.insight.hours).toBe('08:00—17:30'); expect(view?.insight.state).toBe('needs_time');
});
