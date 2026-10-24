import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { database } from '../db';
import { extractFacts, readingText } from '../lib/facts';
import { structured } from '../lib/llm';
import type { Evidence } from '../lib/domain';
const llm=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('../lib/llm',()=>({structured:llm.call}));
const folder=mkdtempSync(join(tmpdir(),'tripproof-fact-cache-'));
beforeAll(()=>{process.env.DATABASE_PATH=join(folder,'cache.db');});
beforeEach(()=>{database().sqlite.prepare("DELETE FROM cache WHERE key LIKE 'facts:%'").run();llm.call.mockReset();});
afterEach(()=>vi.unstubAllEnvs());
afterAll(()=>{database().sqlite.close();delete(globalThis as {tripproofDB?:unknown}).tripproofDB;rmSync(folder,{recursive:true,force:true});});
const quote='每天09:00—17:00开放，16:00停止入馆';
function evidence(id='original'):Evidence{return {id,searchCallId:'c',url:'https://example.gov.cn/visit',finalUrl:null,title:'测试馆参观须知',site:'example.gov.cn',publishedAt:'2026-10-01',retrievedAt:'2026-10-24T00:00:00Z',content:quote,passage:quote,score:null,authorityLevel:1,tier:2,linkStatus:'ok',linkCheckedAt:'2026-10-24T00:00:00Z',pageSha256:'hash-1'};}
function output(){return {canonicalName:'测试馆',city:'杭州',officialDomain:null,officialEvidenceId:null,officialIdentityQuote:null,ambiguities:[],facts:[{kind:'hours',evidenceId:'source-0',quote,venueMatch:'exact',validFrom:null,validTo:null,payload:{seasons:[{from:'01-01',to:'12-31',open:'09:00',close:'17:00',lastEntry:'16:00'}],weekdays:null}}]};}
it('同一网页规则跨日期复用解析，引用重新映射到当前调查',async()=>{llm.call.mockResolvedValue(output());const first=await extractFacts('v','测试馆','杭州',['2026-10-25'],[evidence('one')]);const second=await extractFacts('v','测试馆','杭州',['2026-10-26'],[evidence('two')]);expect(structured).toHaveBeenCalledTimes(1);expect(first.facts[0].evidenceId).toBe('one');expect(second.facts[0].evidenceId).toBe('two');expect(first.facts[0].id).not.toBe(second.facts[0].id);});
it('解析缓存不把旧链接的可用状态带到新调查',async()=>{llm.call.mockResolvedValue(output());await extractFacts('v','测试馆','杭州',['2026-10-25'],[evidence()]);const second=await extractFacts('v','测试馆','杭州',['2026-10-26'],[{...evidence('two'),linkStatus:'browser_only'}]);expect(structured).toHaveBeenCalledTimes(1);expect(second.facts[0].linkStatus).toBe('browser_only');});
it('完整网页哈希变化，即使选取片段相同也不能复用旧解析',async()=>{llm.call.mockResolvedValue(output());const body=quote+'甲'.repeat(15000),a={...evidence(),content:body},b={...a,pageSha256:'hash-2',content:body.slice(0,8000)+'乙'+body.slice(8001)};expect(readingText(a)).toBe(readingText(b));await extractFacts('v','测试馆','杭州',['2026-10-25'],[a]);await extractFacts('v','测试馆','杭州',['2026-10-25'],[b]);expect(structured).toHaveBeenCalledTimes(2);});
it('即使命中缓存也不能接受伪造引文或数字',async()=>{const raw=output();raw.facts[0].quote='每天00:00—24:00开放';llm.call.mockResolvedValue(raw);const first=await extractFacts('v','测试馆','杭州',[],[evidence()]);const second=await extractFacts('v','测试馆','杭州',[],[evidence('two')]);expect(first.facts).toHaveLength(0);expect(second.facts).toHaveLength(0);expect(structured).toHaveBeenCalledTimes(1);});
it('不同分馆的规则不能共用缓存',async()=>{llm.call.mockResolvedValue(output());await extractFacts('v','测试馆东馆','杭州',[],[evidence()]);await extractFacts('v2','测试馆西馆','杭州',[],[evidence()]);expect(structured).toHaveBeenCalledTimes(2);});
it('更换模型服务或接口后不能沿用同名模型的解析缓存',async()=>{
  llm.call.mockResolvedValue(output());vi.stubEnv('OPENAI_BASE_URL','https://one.invalid/v1');
  await extractFacts('v','测试馆','杭州',[],[evidence()]);
  vi.stubEnv('OPENAI_BASE_URL','https://two.invalid/v1');await extractFacts('v','测试馆','杭州',[],[evidence()]);
  vi.stubEnv('LLM_API_MODE','chat_completions');await extractFacts('v','测试馆','杭州',[],[evidence()]);
  expect(structured).toHaveBeenCalledTimes(3);
});
it('补查的证据包复用已经读过的页面，只把新增页交给模型',async()=>{
  llm.call.mockResolvedValueOnce(output());await extractFacts('v','测试馆','杭州',[],[evidence('old')]);
  const extra={...evidence('extra'),url:'https://example.gov.cn/visit-new',finalUrl:null,pageSha256:'new-page'};
  const fresh=output();fresh.facts[0].evidenceId='source-1';llm.call.mockResolvedValueOnce(fresh);
  const combined=await extractFacts('v','测试馆','杭州',[],[evidence('remapped'),extra]);
  const sent=JSON.parse(llm.call.mock.calls[1][3][0].text);
  expect(sent.evidence).toHaveLength(1);expect(sent.evidence[0].url).toBe(extra.url);
  expect(combined.facts.map(f=>f.evidenceId).sort()).toEqual(['extra','remapped']);
  await extractFacts('v','测试馆','杭州',[],[extra]);expect(structured).toHaveBeenCalledTimes(2);
});
it('不同城市的新增页解析不能借命中缓存的旧页混入正确城市',async()=>{
  llm.call.mockResolvedValueOnce(output());await extractFacts('v','测试馆','杭州',[],[evidence('old')]);
  const extra={...evidence('extra'),url:'https://example.gov.cn/another-city',pageSha256:'other-city'};
  const fresh={...output(),city:'苏州'};fresh.facts[0].evidenceId='source-0';llm.call.mockResolvedValueOnce(fresh);
  const result=await extractFacts('v','测试馆','杭州',[],[evidence('current'),extra]);
  expect(result.facts.map(f=>f.evidenceId)).toEqual(['current']);
});
