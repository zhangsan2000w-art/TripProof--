import { expect, it, vi } from 'vitest';
import { cachedReport, refreshReportLinks, reportFeedbackIds } from '../lib/report';
import * as rules from '../lib/judge';
import * as evidenceTools from '../lib/evidence';
import { emptyResult, type Evidence, type Trip } from '../lib/domain';
import { judgeItem } from '../lib/judge';
import { dossier, item, openDays, trip } from './fixtures';

it('打印时失效链接同时降级行程、替代场馆及公告，保留存档不被修改', async () => {
  const target = item(), candidate = item({ id: 'alt-a', placeName: '替代博物馆' });
  const t: Trip = { ...trip([target], { startDate: '2026-10-27' }), id: 'trip', shareId: 'share', createdAt: '', updatedAt: '', revision: 1 };
  const f = openDays(), d = dossier([f]); f.quote = '每周二至周日开放';
  d.evidence = [{ id: f.evidenceId, searchCallId: 'c', url: 'https://museum.gov.cn/rules', finalUrl: null, title: '开放规则', site: 'museum.gov.cn', publishedAt: null, retrievedAt: '', passage: f.quote, content: f.quote, score: null, authorityLevel: null, tier: 1, linkStatus: 'ok', linkCheckedAt: null, pageSha256: null } satisfies Evidence];
  const alt = dossier([f], candidate.placeName); alt.evidence = structuredClone(d.evidence);
  const stored = { ...emptyResult(), dossiers: [d], judgments: judgeItem(target,t,d), alternatives: [{itemId:target.id,name:candidate.placeName,reason:'同城',dossier:alt,judgments:judgeItem(candidate,t,alt)}], announcement:{title:'公告',claims:['开放'],verdict:'confirmed' as const,explanation:'已佐证',evidenceIds:[f.evidenceId]} };
  expect(stored.alternatives[0].judgments.some(j=>j.verdict==='confirmed')).toBe(true);
  const checker = vi.fn(async () => ({linkStatus:'broken' as const,checkedAt:new Date().toISOString(),finalUrl:d.evidence[0].url,text:'',sha256:null}));
  const refreshed=await refreshReportLinks(t,stored,checker);
  expect(checker).toHaveBeenCalledTimes(1);
  expect(refreshed.judgments.some(j=>j.verdict==='confirmed')).toBe(false);
  expect(refreshed.alternatives[0].judgments.some(j=>j.verdict==='confirmed')).toBe(false);
  expect(refreshed.announcement?.verdict).toBe('unknown');
  expect(stored.announcement.verdict).toBe('confirmed');
  expect(stored.dossiers[0].facts[0].linkStatus).toBe('ok');
});
it('未变化报告命中重算缓存，行程、证据变化及跨日都会失效，返回值互不污染',()=>{
  const t:Trip={...trip(),id:crypto.randomUUID(),shareId:'s',createdAt:'',updatedAt:'',revision:1},stored=emptyResult();
  const judge=vi.spyOn(rules,'judgeTrip');vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T01:00:00Z'));
  try{
    const first=cachedReport(t,stored);first.limitations.push('only-this-reader');
    expect(cachedReport(structuredClone(t),structuredClone(stored)).limitations).not.toContain('only-this-reader');expect(judge).toHaveBeenCalledTimes(1);
    cachedReport({...t,startDate:'2026-10-28'},stored);expect(judge).toHaveBeenCalledTimes(2);
    cachedReport({...t,startDate:'2026-10-28'},{...stored,limitations:['changed']});expect(judge).toHaveBeenCalledTimes(3);
    vi.setSystemTime(new Date('2026-10-25T01:00:00Z'));cachedReport({...t,startDate:'2026-10-28'},{...stored,limitations:['changed']});expect(judge).toHaveBeenCalledTimes(4);
  }finally{vi.useRealTimers();judge.mockRestore();}
});

it('链接重查后仍可反馈当前判定，同时拒绝不属于本报告的编号',async()=>{
  const t:Trip={...trip([item()],{startDate:'2026-10-27'}),id:'t',shareId:'s',createdAt:'',updatedAt:'',revision:1};
  const f=openDays();f.quote='每周二至周日开放';const d=dossier([f]);
  d.evidence=[{id:f.evidenceId,searchCallId:'c',url:'https://museum.gov.cn/test',finalUrl:null,title:'开放规则',site:'museum.gov.cn',publishedAt:null,retrievedAt:'',passage:f.quote,content:f.quote,score:null,authorityLevel:null,tier:1,linkStatus:'ok',linkCheckedAt:null,pageSha256:null}];
  const stored={...emptyResult(),dossiers:[d],judgments:judgeItem(t.items[0],t,d)};
  const checked={linkStatus:'broken' as const,checkedAt:new Date().toISOString(),finalUrl:d.evidence[0].url,text:'',sha256:null};
  const cache=vi.spyOn(evidenceTools,'cachedLinkCheck').mockReturnValue(checked);
  try{
    const printed=await refreshReportLinks(t,stored,async()=>checked),ids=await reportFeedbackIds(t,stored);
    expect(printed.judgments.find(j=>j.type==='open_on_date')?.id).not.toBe(stored.judgments.find(j=>j.type==='open_on_date')?.id);
    expect(printed.judgments.every(j=>ids.has(j.id))).toBe(true);
    expect(stored.judgments.every(j=>ids.has(j.id))).toBe(true);
    expect(ids.has('unrelated-report-judgment')).toBe(false);
  }finally{cache.mockRestore();}
});
