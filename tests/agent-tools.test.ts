import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../db';
import { createTrip, createRun, getRun, finishRun, saveResult } from '../lib/store';
import { initialCheckpoint } from '../lib/agent';
import { evaluate, investigateTargets, readSources, dossierFor, findAlternatives, type ToolContext } from '../lib/agent-tools';
import { emptyResult, type Evidence } from '../lib/domain';
import { item, trip, hours } from './fixtures';
const calls=vi.hoisted(()=>({search:vi.fn(),extract:vi.fn(),verify:vi.fn(),choose:vi.fn()}));
vi.mock('../lib/search/yuanbao',()=>({searchPro:calls.search}));
vi.mock('../lib/facts',async original=>({...await original<typeof import('../lib/facts')>(),extractFacts:calls.extract}));
vi.mock('../lib/evidence',async original=>({...await original<typeof import('../lib/evidence')>(),verifyEvidence:calls.verify}));
vi.mock('../lib/llm',async original=>({...await original<typeof import('../lib/llm')>(),structured:calls.choose}));
const folder=mkdtempSync(join(tmpdir(),'tripproof-agent-tools-'));
beforeAll(()=>{process.env.DATABASE_PATH=join(folder,'tools.db');});
beforeEach(()=>{calls.search.mockReset();calls.extract.mockReset();calls.verify.mockReset();calls.choose.mockReset();calls.verify.mockImplementation(async(e:Evidence)=>({...e,linkStatus:'ok',pageSha256:e.content}));calls.extract.mockResolvedValue({canonicalName:'测试博物馆',officialDomain:null,facts:[],ambiguities:[]});});
afterAll(()=>{database().sqlite.close();delete(globalThis as {tripproofDB?:unknown}).tripproofDB;rmSync(folder,{recursive:true,force:true});});
function context(input=trip()){const t=createTrip(input,crypto.randomUUID()),run=createRun(t),result=emptyResult(),state=initialCheckpoint(run,t);const ctx:ToolContext={trip:t,run,state,result,persist:()=>saveResult(run.id,result)};return ctx;}
function page(id='new',content='测试博物馆每天09:00—17:00开放，16:00停止入馆'):Evidence{return {id,searchCallId:'c',url:'https://museum.gov.cn/visit',finalUrl:null,title:'测试博物馆参观须知',site:'museum.gov.cn',publishedAt:null,retrievedAt:new Date().toISOString(),passage:content,content,score:null,authorityLevel:1,tier:1,linkStatus:'ok',linkCheckedAt:null,pageSha256:null};}
it('成功解析的同一资料不重复读取，同 URL 内容变化后会重新读取',async()=>{const ctx=context(),d=dossierFor(ctx,ctx.trip.items[0]);ctx.state.sources[d.venue.key]=[page()];await readSources(ctx,['a']);await readSources(ctx,['a']);expect(calls.extract).toHaveBeenCalledTimes(1);ctx.state.sources[d.venue.key]=[page('changed','测试博物馆临时调整为10:00—16:00开放')];await readSources(ctx,['a']);expect(calls.extract).toHaveBeenCalledTimes(2);finishRun(ctx.run.id,ctx.result);});
it('新网页解析失败也不能保留已被替换的旧来源事实',async()=>{const ctx=context(),d=dossierFor(ctx,ctx.trip.items[0]),old=page('old'),f=hours();f.evidenceId=old.id;f.quote='每天09:00—17:00开放，16:00停止入馆';d.evidence=[old];d.facts=[f];ctx.state.sources[d.venue.key]=[page('new','测试博物馆今日关闭')];calls.extract.mockRejectedValue(new Error('读取失败'));await readSources(ctx,['a']);expect(d.facts).toHaveLength(0);expect(getRun(ctx.run.id).result?.judgments.some(j=>j.verdict==='confirmed')).toBe(false);finishRun(ctx.run.id,ctx.result);});
it('连续两轮没有新增有效证据后停止补查，不消耗第三次搜索',async()=>{const ctx=context();calls.search.mockResolvedValue({pages:[]});await investigateTargets(ctx,['a'],'hours',null);await investigateTargets(ctx,['a'],'identity',null);await investigateTargets(ctx,['a'],'closures',null);expect(calls.search).toHaveBeenCalledTimes(2);expect(ctx.state.checks[0].noProgress).toBe(2);expect(ctx.state.checks[0].stopReason).toContain('连续两轮');finishRun(ctx.run.id,ctx.result);});
it('弱链接资料和模型读取失败不能被计作新增有效证据',async()=>{const ctx=context();calls.search.mockResolvedValue({pages:[page()]});calls.extract.mockRejectedValue(new Error('读取失败'));await investigateTargets(ctx,['a'],'hours',null);expect(ctx.state.checks[0].noProgress).toBe(1);finishRun(ctx.run.id,ctx.result);});
it('首次规则及预约合并查询，近期公告仍单独使用新鲜度检索',async()=>{
  const ctx=context();calls.search.mockResolvedValue({pages:[]});await investigateTargets(ctx,['a'],'baseline',null);
  const queries=calls.search.mock.calls.map(call=>call[2]);expect(queries).toHaveLength(2);
  expect(queries[0].query).toContain('预约 放票');expect(queries[1].freshness).toBe('m2');finishRun(ctx.run.id,ctx.result);
});
it('其他并行检查重算时，不能把仍在检索或读原文的站点提前标成完成',()=>{const ctx=context(),d=dossierFor(ctx,ctx.trip.items[0]);d.searchedScope=['已发起但尚未完成的查询'];for(const status of ['searching','reading'] as const){ctx.state.checks[0].status=status;evaluate(ctx);expect(ctx.state.checks[0].status).toBe(status);}finishRun(ctx.run.id,ctx.result);});
it('景点的交通补查使用已选前后站路线，不把街区当作有末班的交通工具',async()=>{const ctx=context(trip([item({id:'p',placeName:'外滩'}),item({id:'a',seq:2,kind:'scenic',placeName:'武康路'})]));calls.search.mockResolvedValue({pages:[]});await investigateTargets(ctx,['a'],'transport',null);expect(calls.search.mock.calls[0][2].query).toContain('外滩 到 武康路 公共交通 路线 耗时参考');expect(calls.search.mock.calls[0][2].query).not.toContain('末班');finishRun(ctx.run.id,ctx.result);});
it('没有可用替代候选时也保留发现候选的检索日志，重算后不丢失',async()=>{const ctx=context(),call={id:'discovery',venueId:'find',query:'杭州 博物馆',params:{query:'杭州 博物馆'},requestId:'test-request',version:null,msg:null,errorCode:null,resultCount:0,latencyMs:12,calledAt:new Date().toISOString(),cacheHit:false,cachedFrom:null};calls.search.mockResolvedValue({pages:[],call});calls.choose.mockResolvedValue({candidates:[]});await findAlternatives(ctx,'a');expect(ctx.result.alternatives).toHaveLength(0);expect(ctx.result.dossiers.flatMap(d=>d.calls).map(c=>c.id)).toContain('discovery');evaluate(ctx);expect(getRun(ctx.run.id).result?.dossiers.flatMap(d=>d.calls).map(c=>c.id)).toContain('discovery');finishRun(ctx.run.id,ctx.result);});
it('首站先完成抓页并进入模型读取，然后其余站点在其读取期间并行',async()=>{
  const names=['测试博物馆','第二博物馆','第三博物馆'];
  const ctx=context(trip(names.map((placeName,index)=>item({id:String(index),seq:index+1,placeName}))));
  const order:string[]=[];let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  calls.search.mockImplementation(async(_run:string,_venue:string,params:{query:string})=>{
    const name=names.find(name=>params.query.includes(name))!;order.push(`search:${name}`);
    return {pages:[{...page(name),title:`${name}参观须知`,content:`${name}每天09:00—17:00开放`,passage:`${name}每天09:00—17:00开放`,url:`https://museum.gov.cn/${names.indexOf(name)}`} ]};
  });
  calls.verify.mockImplementation(async(e:Evidence)=>{order.push(`page:${e.id}`);return {...e,linkStatus:'ok',pageSha256:e.content};});
  calls.extract.mockImplementation(async(_id:string,name:string)=>{
    order.push(`model:${name}`);
    if(name===names[0])await hold;else release();
    return {canonicalName:name,officialDomain:null,officialEvidenceId:null,facts:[],ambiguities:[]};
  });
  await investigateTargets(ctx,['0','1','2'],'baseline',null);
  expect(order.indexOf(`page:${names[0]}`)).toBeLessThan(order.indexOf(`model:${names[0]}`));
  expect(order.indexOf(`model:${names[0]}`)).toBeLessThan(order.indexOf(`search:${names[1]}`));
  expect(calls.extract).toHaveBeenCalledTimes(3);finishRun(ctx.run.id,ctx.result);
});
