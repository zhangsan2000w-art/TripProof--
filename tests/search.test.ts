import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchPro, normalizePage } from '../lib/search/yuanbao';
import { createTrip, createRun, finishRun, listCalls, reserveSearch } from '../lib/store';
import { database } from '../db';
import { emptyResult } from '../lib/domain';
import { trip } from './fixtures';
const folder=mkdtempSync(join(tmpdir(),'tripproof-search-'));
const response=(data:unknown)=>new Response(JSON.stringify({Response:data}),{headers:{'Content-Type':'application/json'}});
beforeAll(()=>{process.env.DATABASE_PATH=join(folder,'search.db');process.env.WSA_API_KEY='contract-test';process.env.WSA_TIER='standard';});
beforeEach(()=>vi.unstubAllGlobals());
afterAll(()=>{vi.unstubAllGlobals();database().sqlite.close();delete (globalThis as {tripproofDB?:unknown}).tripproofDB;rmSync(folder,{recursive:true,force:true});});
const run=()=>createRun(createTrip(trip(),'contract'));
it('解析字符串Pages，拒绝无效URL',()=>{expect(normalizePage(JSON.stringify({url:'https://www.gov.cn/rule',title:'<b>规则</b>',passage:'周一闭馆'}),'c')?.title).toBe('规则');expect(normalizePage({url:'javascript:alert(1)'},'c')).toBe(null);});
it('缓存保留原RequestId，不再调用提供方',async()=>{const fetch=vi.fn(async()=>response({RequestId:'real-provider-id',Version:'standard',Pages:[JSON.stringify({url:'https://example.com/rule',title:'条目',passage:'规则'})]}));vi.stubGlobal('fetch',fetch);const r=run();const a=await searchPro(r.id,'v',{query:'cache-contract'},{used:0}),b=await searchPro(r.id,'v',{query:'cache-contract'},{used:0});expect(fetch).toHaveBeenCalledTimes(1);expect(b.call.cacheHit).toBe(true);expect(b.call.requestId).toBe(a.call.requestId);expect(b.call.cachedFrom).toBe(a.call.id);finishRun(r.id,emptyResult());});
it('动态公告和天气即使同查询有缓存，也执行本轮检索',async()=>{const fetch=vi.fn(async()=>response({RequestId:crypto.randomUUID(),Pages:[]}));vi.stubGlobal('fetch',fetch);const r=run();const a=await searchPro(r.id,'v',{query:'dynamic-contract',freshness:'d2'},{used:0}),b=await searchPro(r.id,'v',{query:'dynamic-contract',freshness:'d2'},{used:0});expect(fetch).toHaveBeenCalledTimes(2);expect(a.call.cacheHit||b.call.cacheHit).toBe(false);expect(b.call.requestId).not.toBe(a.call.requestId);finishRun(r.id,emptyResult());});
it('HTTP200中的鉴权错误仍是失败，不能把结果当证据',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>response({RequestId:'err-id',Error:{Code:'AuthFailure',Message:'bad key'},Pages:[{url:'https://example.com'}]})));const r=run();await expect(searchPro(r.id,'v',{query:'auth-error'},{used:0})).rejects.toThrow();expect(listCalls(r.id)[0].errorCode).toBe('AuthFailure');finishRun(r.id,emptyResult());});
it('标准参数不支持时降级并记录实际发送参数',async()=>{const fetch=vi.fn().mockResolvedValueOnce(response({RequestId:'fallback-1',Error:{Code:'InvalidParameter'}})).mockResolvedValueOnce(response({RequestId:'fallback-2',Pages:[]}));vi.stubGlobal('fetch',fetch);const r=run();const result=await searchPro(r.id,'v',{query:'fallback',cnt:20,industry:'gov'},{used:0});expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('Cnt');expect(result.call.params.cnt).toBeUndefined();expect(listCalls(r.id)).toHaveLength(2);finishRun(r.id,emptyResult());});
it('预算和单场馆上限会在网络请求前阻止调用',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const r=run();for(let i=0;i<40;i++)reserveSearch(r.id);await expect(searchPro(r.id,'v',{query:'no-budget'},{used:0})).rejects.toThrow('预算');await expect(searchPro(r.id,'v',{query:'no-venue-budget'},{used:5})).rejects.toThrow('五次');expect(fetch).not.toHaveBeenCalled();finishRun(r.id,emptyResult());});
it('可恢复的连接失败有界重试且实际尝试全部计入预算，内部错误不伪装成网络错误',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
    const fetch=vi.fn().mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})).mockResolvedValueOnce(response({RequestId:'retry-success',Pages:[]}));
    vi.stubGlobal('fetch',fetch);const r=run();await searchPro(r.id,'retry-v',{query:'network-retry'},{used:0});
    expect(listCalls(r.id).map(c=>c.errorCode)).toEqual(['SEARCH_NETWORK_ECONNRESET',null]);expect(fetch).toHaveBeenCalledTimes(2);
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('implementation failure')));
    await expect(searchPro(r.id,'internal-v',{query:'internal-no-retry'},{used:0})).rejects.toThrow('失败阶段');
    expect(listCalls(r.id).find(c=>c.query==='internal-no-retry')).toMatchObject({errorCode:'SEARCH_INTERNAL_ERROR',msg:expect.stringContaining('stage=request')});expect(listCalls(r.id)).toHaveLength(3);finishRun(r.id,emptyResult());
  }finally{log.mockRestore();}
});
