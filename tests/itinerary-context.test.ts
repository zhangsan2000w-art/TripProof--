import { expect, it } from 'vitest';
import { flexibleTransfer, openArea, transportWindow } from '../lib/itinerary';
import { judgeItem, judgeTrip } from '../lib/judge';
import { itemInsight, itineraryInsights } from '../lib/presentation';
import { dossier, fact, hours, item, profile, trip } from './fixtures';
import type { Evidence } from '../lib/domain';

const ferry = item({ id:'ferry', kind:'transport', placeName:'东金线', start:null, end:null, sourceText:'前往金陵东路渡口，乘东金线到东昌路渡口。' });
const parent = item({ id:'lujiazui', seq:2, kind:'scenic', placeName:'陆家嘴', start:'17:30', end:'19:30', sourceText:'17:30—19:30 陆家嘴\n前往金陵东路渡口，乘东金线到东昌路渡口。到浦东后沿滨江游览。' });
const service = () => fact({kind:'service_hours',payload:{entity:'东金线',first:'07:00',last:'22:00',lastDayOffset:0,note:'按公布的常规时间核对，具体班次以当天为准。'}});
it('交通原句和父活动时段同时出现时核对完整窗口，不虚构发船时间也不重复追问',()=>{
  const t=trip([ferry,parent]),d=dossier([service()],'东金线');
  expect(transportWindow(ferry,t.items)).toMatchObject({start:'17:30',end:'19:30'});
  const js=judgeItem(ferry,t,d),view=itemInsight(ferry,js,[d],t.startDate,t.items);
  expect(js.find(j=>j.type==='service_hours')).toMatchObject({verdict:'confirmed',reasonCode:'SERVICE_WINDOW_FIT'});
  expect(js.some(j=>j.reasonCode==='MISSING_TIME')).toBe(false);
  expect(view).toMatchObject({state:'fits',missingTime:false,plannedTime:'17:30—19:30 内转场'});
  expect(view.message).not.toContain('当天开放');expect(ferry.start).toBeNull();
  expect(judgeTrip(t,[d]).filter(j=>j.type==='connection_fit')).toHaveLength(0);
});
it('窗口只有部分覆盖运营时间时保留未知，窗口完全错开才判冲突',()=>{
  const f=service();if(f.kind!=='service_hours')throw new Error();f.payload.last='18:00';
  expect(judgeItem(ferry,trip([ferry,parent]),dossier([f])).find(j=>j.type==='service_hours')).toMatchObject({verdict:'unknown',reasonCode:'SERVICE_WINDOW_PARTIAL'});
  f.payload.last='16:00';
  expect(judgeItem(ferry,trip([ferry,parent]),dossier([f])).find(j=>j.type==='service_hours')?.verdict).toBe('conflict');
});
it('模型活动说明或邻站恰有时间不足以继承窗口，修改独立出发时间后采用用户时间',()=>{
  expect(transportWindow({...ferry,activity:'属于17:30—19:30时段',sourceText:'乘另一条航线'},[ferry,parent])).toBeNull();
  const explicit={...ferry,start:'23:00'};
  expect(judgeItem(explicit,trip([explicit,parent]),dossier([service()])).find(j=>j.type==='service_hours')).toMatchObject({verdict:'conflict',reasonCode:'OUTSIDE_SERVICE_HOURS'});
});
it('读取为打车的安排不查班次、不问精确时刻、不提示12306',()=>{
  const taxi=item({kind:'transport',placeName:'陆家嘴至外滩',start:null,end:null,sourceText:'返回外滩。晚间建议打车返回，避免受轮渡班次影响。',profile:profile({mode:'taxi'})}),t=trip([taxi]);
  expect(flexibleTransfer(taxi)).toBe(true);
  const js=judgeItem(taxi,t),view=itemInsight(taxi,js,[],t.startDate);
  expect(js.some(j=>j.type==='service_hours'||j.reasonCode==='MISSING_TIME')).toBe(false);
  expect(view).toMatchObject({state:'reference',missingTime:false});
  expect(JSON.stringify({js,view})).not.toContain('12306');
  expect(itineraryInsights(t,js,[]).counts).toMatchObject({reference:1,verify:0,needs_time:0});
  // The mode comes from the guide reader, not from words in the text.
  expect(flexibleTransfer({...taxi,profile:profile({mode:'ferry'})})).toBe(false);
  expect(flexibleTransfer({...taxi,profile:undefined})).toBe(false);
});
it('街区漫步按读取到的性质处理：不闭园、随时可去，不展示停止入场和预约缺失',()=>{
  const i=item({placeName:'城隍庙',kind:'scenic',start:null,end:null,sourceText:'12:00—13:30 城隍庙\n饭后逛城隍庙商圈。',activity:'逛商圈',profile:profile({openArea:true})});
  expect(openArea(i)).toBe(true);
  // The same name read as entering the temple is a venue with its own rules.
  expect(openArea({...i,profile:profile({openArea:false})})).toBe(false);
  expect(openArea({...i,profile:undefined})).toBe(false);
  const js=judgeItem(i,trip([i])),view=itemInsight(i,js,[],trip().startDate);
  expect(js.some(j=>j.type==='reservation_rule')).toBe(false);
  expect(js.find(j=>j.type==='open_on_date')).toMatchObject({verdict:'confirmed',reasonCode:'PUBLIC_AREA'});
  expect(view.state).toBe('fits');
  expect(view.rules.some(r=>r.label==='预约 / 购票'||r.label==='停止入场')).toBe(false);
});
it('街区查到明确的关闭公告时仍按公告判定',()=>{
  const i=item({placeName:'某老街',kind:'scenic',start:null,end:null,profile:profile({openArea:true})});
  const closure=fact({kind:'temp_closure',payload:{from:'2026-10-20',to:'2026-10-30',scope:'whole',note:'封闭施工'}},{tier:2});
  expect(judgeItem(i,trip([i]),dossier([closure],'某老街')).find(j=>j.type==='open_on_date')).toMatchObject({verdict:'conflict',reasonCode:'TEMP_CLOSED'});
});

function listing(url='https://map.qq.com/poi/123',address='豫园商城和丰楼豫园食集3楼'):Evidence{
  const content=`玉兰厢·上海老味道·名厨工匠馆 地址：${address}，营业时间每天11:00—21:00。`;
  return {id:'poi',searchCallId:'c',url,finalUrl:null,title:'玉兰厢·上海老味道·名厨工匠馆',passage:content,content,site:new URL(url).hostname,publishedAt:null,retrievedAt:new Date().toISOString(),tier:3,score:null,authorityLevel:null,linkStatus:'ok',linkCheckedAt:null,pageSha256:null};
}
const restaurant=()=>item({kind:'restaurant',placeName:'玉兰厢·上海老味道',start:'11:00',end:'12:00',sourceText:'11:00—12:00 午餐：玉兰厢·上海老味道\n位于豫园商城和丰楼3楼，可从7号门进入。'});
it('只有一个商户页写明营业时间、又没有相反说法时可以核对，标为单一来源',()=>{
  for(const url of ['https://map.qq.com/poi/123','https://you.ctrip.com/food/shanghai2/123.html']){
    const i=restaurant(),e=listing(url),f=hours('11:00','21:00',null);Object.assign(f,{quote:'营业时间每天11:00—21:00',evidenceId:e.id,domain:e.site,tier:3});
    const d=dossier([f],i.placeName);d.evidence=[e];d.venue.officialDomain=null;
    const js=judgeItem(i,trip([i]),d),view=itemInsight(i,js,[d],trip().startDate);
    expect(js.find(j=>j.type==='hours_fit')?.verdict).toBe('confirmed');
    expect(view.state).toBe('fits');expect(view.rules.find(r=>r.label==='营业时间')).toMatchObject({basis:'reference',verified:true});
    expect(view.message).toContain('临时休息');
  }
});
it('失效链接或相互矛盾的营业时间仍不能确认',()=>{
  const i=restaurant();
  {
    const e={...listing(),linkStatus:'broken' as const},f=hours('11:00','21:00',null);Object.assign(f,{quote:'营业时间每天11:00—21:00',evidenceId:e.id,domain:e.site,tier:3,linkStatus:'broken'});
    const d=dossier([f]);d.evidence=[e];
    expect(judgeItem(i,trip([i]),d).some(j=>j.verdict==='confirmed')).toBe(false);
  }
  const e=listing(),other={...listing('https://you.ctrip.com/food/shanghai2/123.html'),id:'other',passage:'营业时间每天12:00—21:00',content:'营业时间每天12:00—21:00'};
  const f=hours('11:00','21:00',null),g=hours('12:00','21:00',null);
  Object.assign(f,{evidenceId:e.id,quote:'营业时间每天11:00—21:00',domain:e.site,tier:3});Object.assign(g,{evidenceId:other.id,quote:'营业时间每天12:00—21:00',domain:other.site,tier:3});
  const d=dossier([f,g]);d.evidence=[e,other];expect(judgeItem(i,trip([i]),d).find(j=>j.type==='hours_fit')).toMatchObject({verdict:'unknown',reasonCode:'SOURCES_DISAGREE'});
});
it('午晚市是独立营业段，来源结束时间略有不同但全部覆盖所选午餐时段时可以核对通过',()=>{
  const i=restaurant();i.placeName='米泰 Mi Thai';i.start='12:00';i.end='13:30';i.sourceText='午餐米泰 Mi Thai，位于安福路195号2楼。';
  const e={...listing('https://you.ctrip.com/food/shanghai2/123.html'),title:'米泰MiThai',passage:'米泰MiThai 安福路195号2楼 营业时间全年11:30—15:00,17:30—22:00',content:'米泰MiThai 安福路195号2楼 营业时间全年11:30—15:00,17:30—22:00'};
  const other={...e,id:'other',site:'baike.baidu.com',url:'https://baike.baidu.com/item/MiThai',passage:'每日营业时间11:30—14:30',content:'每日营业时间11:30—14:30'};
  const fs=[hours('11:30','15:00',null),hours('17:30','22:00',null),hours('11:30','14:30',null)];
  fs.forEach((f,n)=>Object.assign(f,{evidenceId:n===2?other.id:e.id,domain:n===2?other.site:e.site,tier:3,quote:n===2?'每日营业时间11:30—14:30':'营业时间全年11:30—15:00,17:30—22:00'}));
  const d=dossier(fs);d.evidence=[e,other];
  const t=trip([i]),js=judgeItem(i,t,d),view=itemInsight(i,js,[d],t.startDate);
  expect(js.find(j=>j.type==='hours_fit')).toMatchObject({verdict:'confirmed',reasonCode:'HOURS_FIT_COMMON'});
  expect(view.citations).toHaveLength(2);expect(view.rules.find(r=>r.label==='已核对时段')).toMatchObject({value:'12:00—13:30',verified:true});
  for(const plan of [{start:'14:45',end:'15:00'},{start:'16:00',end:'17:00'}])expect(judgeItem({...i,...plan},t,d).find(j=>j.type==='hours_fit')?.verdict).not.toBe('confirmed');
});
