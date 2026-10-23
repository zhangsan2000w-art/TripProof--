import { describe, it, expect } from 'vitest';
import { judgeItem, judgeWeather, resolveFacts } from '../lib/judge';
import { item, trip, fact, dossier, hours, closedMonday, openDays } from './fixtures';
import { addDays, holidayState, today, validDate, weekday } from '../lib/dates';
import type { CheckType, Fact } from '../lib/domain';

function check(facts: Fact[], type: CheckType, overrides: Parameters<typeof item>[0] = {}, startDate = '2026-10-26') {
  const i = item(overrides); return judgeItem(i, trip([i], { startDate }), dossier(facts)).find(j => j.type === type)!;
}
describe('日期和开放规则', () => {
  it('按上海时区计算星期，拒绝无效日期', () => { expect(weekday('2026-10-26')).toBe(1); expect(validDate('2026-02-30')).toBe(false); expect(holidayState('2026-10-05')).toBe('holiday'); });
  it('周一闭馆即冲突', () => expect(check([closedMonday()], 'open_on_date').verdict).toBe('conflict'));
  it('未发现公告不能证明开放', () => expect(check([], 'open_on_date').verdict).toBe('unknown'));
  it('不能从闭馆日反推其他日开放', () => expect(check([closedMonday()], 'open_on_date', {}, '2026-10-27').verdict).toBe('unknown'));
  it('节假日例外只取消该闭馆规则', () => expect(check([closedMonday(true)], 'open_on_date', {}, '2026-10-05').verdict).toBe('unknown'));
  it('未公布年份的例外不猜测', () => expect(check([closedMonday(true)], 'open_on_date', {}, '2027-01-04').reasonCode).toBe('HOLIDAY_SCHEDULE_NOT_PUBLISHED'));
  it('临时开放可覆盖相同维度的常规闭馆', () => expect(check([closedMonday(), fact({ kind: 'temp_open', payload: { from: '2026-10-26', to: '2026-10-26', note: '临时开放' } })], 'open_on_date').verdict).toBe('confirmed'));
  it('临时时间不能覆盖独立闭馆事实', () => expect(check([closedMonday(), fact({ kind: 'temp_hours', payload: { from: '2026-10-26', to: '2026-10-26', open: '09:00', close: '20:00', lastEntry: null } })], 'open_on_date').verdict).toBe('conflict'));
  it('未写恢复日期的关闭公告不能丢弃，也不能推断已恢复',()=>{const f=fact({kind:'temp_closure',payload:{from:'2026-10-21',to:null,scope:'whole',note:'台风防御'}});const j=check([openDays([1]),f],'open_on_date');expect(j.verdict).toBe('conflict');expect(j.reasonCode).toBe('CLOSED_UNTIL_NOTICE');expect(j.factIds).toContain(f.id);});
  it('局部关闭不能判整个场馆关闭', () => { const j = check([openDays([1]), fact({ kind: 'temp_closure', payload: { from: '2026-10-26', to: '2026-10-27', scope: 'partial', note: '二楼展厅' } })], 'open_on_date'); expect(j.verdict).toBe('confirmed'); expect(j.notes.join()).toContain('二楼'); });
  it('过期事实不能用于换日期确认', () => expect(check([fact({ kind: 'weekly_open', payload: { weekdays: [1], exceptStatutoryHolidays: false } }, { validTo: '2026-10-25' })], 'open_on_date').verdict).toBe('unknown'));
  it('明确规定的节后顺延闭馆由日历计算',()=>{const f=closedMonday(true);f.quote='周一闭馆，遇法定节假日正常开放，闭馆顺延至节后第一天。';expect(check([f,openDays()], 'open_on_date',{},'2026-10-08').reasonCode).toBe('CLOSED_AFTER_HOLIDAY');});
  it('同页季节例外覆盖同页全年基础时间',()=>{const regular=hours(),summer=fact({kind:'hours',payload:{weekdays:null,seasons:[{from:'06-01',to:'10-31',open:'09:00',close:'17:30',lastEntry:'16:30'}]}},{evidenceId:regular.evidenceId});expect(check([regular,summer],'hours_fit',{start:'16:29',end:null},'2026-10-27').verdict).toBe('confirmed');});
});
describe('时间边界', () => {
  it.each([['15:59','confirmed'], ['16:00','conflict'], ['16:01','conflict'], ['17:00','conflict'], ['08:59','conflict']])('入场 %s → %s', (start, expected) => expect(check([hours()], 'hours_fit', { start, end: null }).verdict).toBe(expected));
  it('允许恰好闭馆前结束', () => expect(check([hours()], 'hours_fit', { start: '15:00', end: '17:00' }).verdict).toBe('confirmed'));
  it('缺少到达时间保持空', () => expect(check([hours()], 'hours_fit', { start: null, end: null }).reasonCode).toBe('MISSING_TIME'));
  it('按季节切换，不沿用夏季时间', () => { const f = fact({ kind:'hours', payload: { weekdays: null, seasons: [{from:'04-01',to:'10-31',open:'08:00',close:'18:00',lastEntry:null},{from:'11-01',to:'03-31',open:'09:00',close:'17:00',lastEntry:null}] } }); expect(check([f], 'hours_fit', {start:'17:30',end:null}, '2026-10-31').verdict).toBe('confirmed'); expect(check([f], 'hours_fit', {start:'17:30',end:null}, '2026-11-01').verdict).toBe('conflict'); });
  it('24小时允许晚间参观', () => expect(check([hours('00:00','24:00',null)], 'hours_fit', {start:'23:30',end:null}).verdict).toBe('confirmed'));
  it('抵离时间由用户输入计算', () => {const i=item({start:'08:00',end:'10:00'}); expect(judgeItem(i,trip([i],{arriveDay1:'09:00'}),dossier([])).find(j=>j.type==='arrival_fit')?.reasonCode).toBe('BEFORE_ARRIVAL');});
  it('预约计算放票日期，但库存始终未知', () => { const fs=[fact({kind:'reservation',payload:{required:true,advanceDays:7,releaseTime:'09:00',channel:'官网',realName:true}})]; const js=judgeItem(item(),trip(),dossier(fs)); expect(js.find(j=>j.type==='reservation_rule')?.explanation).toContain('2026-10-19 09:00'); expect(js.find(j=>j.type==='availability')?.verdict).toBe('unknown'); });
  it('不能把有末班时间但无首班时间视为已核实运营窗口', () => { const f=fact({kind:'service_hours',payload:{entity:'公交9路',first:null,last:'18:00',lastDayOffset:0,note:''}}); expect(check([f],'service_hours',{kind:'transport',start:'00:30'}).verdict).toBe('unknown'); });
});
describe('来源冲突和未知', () => {
  it('同级同日相反说法保持未知', () => expect(check([closedMonday(),openDays([1])], 'open_on_date').reasonCode).toBe('SOURCES_DISAGREE'));
  it('采用较新同级来源并保留旧证据', () => { const a=closedMonday(), b=openDays([1]); b.publishedAt='2026-10-20'; const j=check([a,b],'open_on_date'); expect(j.verdict).toBe('confirmed'); expect(j.overruledFactIds).toContain(a.id); });
  it('错误分馆、坏链接、未经核实引文均不能确认', () => { for(const patch of [{venueMatch:'other_branch' as const},{linkStatus:'broken' as const},{quoteVerified:false}]) expect(check([fact({kind:'weekly_open',payload:{weekdays:[1],exceptStatutoryHolidays:false}},patch)],'open_on_date').verdict).toBe('unknown'); });
  it('需浏览器打开的证据保持未知', () => { const f=openDays([1]); f.linkStatus='browser_only'; expect(check([f],'open_on_date').reasonCode).toBe('LINK_REQUIRES_BROWSER'); });
  it('同域转载不是两份独立证据', () => { const fs=[openDays([1]),openDays([1])]; fs.forEach((f,n)=>{f.tier=3;f.domain=`sub${n}.ctrip.com`;}); expect(resolveFacts(fs,'2026-10-26',dossier(fs)).error).toBe('WEAK_EVIDENCE'); });
  it('不同平台一致规则可以交叉验证', () => { const fs=[openDays([1]),openDays([1])]; fs.forEach((f,n)=>{f.tier=3;f.domain=n?'qyer.com':'ctrip.com';}); expect(resolveFacts(fs,'2026-10-26',dossier(fs)).error).toBe(null); });
  it('天气日期不一致不能确认', () => { const date=today(), f=fact({kind:'weather',payload:{date:addDays(date,1),city:'杭州',summary:'晴',precipitationProb:null,warning:null}}); const i=item({kind:'scenic'}); expect(judgeWeather(i,trip([i],{startDate:date}),dossier([f])).verdict).toBe('unknown'); });
  it('降雨不能推断闭馆', () => { const date=today(),f=fact({kind:'weather',payload:{date,city:'杭州',summary:'小雨',precipitationProb:80,warning:null}}); const i=item({kind:'scenic'}); expect(judgeWeather(i,trip([i],{startDate:date}),dossier([f])).verdict).toBe('unknown'); });
});
