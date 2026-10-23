import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../db';
import { createTrip, createRun, getRun, finishRun, saveResult, reserveSearch } from '../lib/store';
import { executeAgent, initialCheckpoint } from '../lib/agent';
import { checkpoint, messages, addMessage, saveCheckpoint, agentView } from '../lib/agent-store';
import type { AgentDecision } from '../lib/agent-types';
import { emptyResult } from '../lib/domain';
import { item, trip, dossier, hours, openDays, closedMonday } from './fixtures';
import type { ToolContext } from '../lib/agent-tools';
const mode=vi.hoisted(()=>({closed:false,investigations:0,alternatives:0,context:0}));
vi.mock('../lib/agent-tools',async importOriginal=>{
  const actual=await importOriginal<typeof import('../lib/agent-tools')>();
  return {...actual,
    checkContext:vi.fn(async(ctx:ToolContext)=>{mode.context++;ctx.state.contextDone=true;ctx.persist();}),
    investigateTargets:vi.fn(async(ctx:ToolContext,ids:string[])=>{
      mode.investigations++;const rules=[hours(),openDays(mode.closed?[0,2,3,4,5,6]:[0,1,2,3,4,5,6]),...(mode.closed?[closedMonday()]:[])];
      for(const f of rules){f.quote=f.kind==='hours'?'开放时间09:00—17:00，16:00停止入馆':f.kind==='weekly_closure'?'每周一闭馆':'每天开放';}
      const d=dossier(rules);d.searchedScope=['首次规则查询'];
      for(const f of rules)d.evidence.push({id:f.evidenceId,searchCallId:'real-fixture-call',url:`https://museum.gov.cn/${f.id}`,finalUrl:null,title:'官方参观须知',site:'museum.gov.cn',publishedAt:f.publishedAt,retrievedAt:f.retrievedAt,passage:f.quote,content:f.quote,score:null,authorityLevel:1,tier:1,linkStatus:'ok',linkCheckedAt:f.retrievedAt,pageSha256:f.id});
      ctx.result.dossiers=[d];for(const c of ctx.state.checks)if(ids.includes(c.itemId))c.status='done';actual.evaluate(ctx);
    }),
    findAlternatives:vi.fn(async(ctx:ToolContext,id:string)=>{mode.alternatives++;ctx.state.alternativesDone.push(id);ctx.persist();}),
  };
});
const folder=mkdtempSync(join(tmpdir(),'tripproof-loop-'));
beforeAll(()=>{process.env.DATABASE_PATH=join(folder,'loop.db');});
beforeEach(()=>{mode.closed=false;mode.investigations=0;mode.alternatives=0;mode.context=0;});
afterAll(()=>{database().sqlite.close();delete(globalThis as {tripproofDB?:unknown}).tripproofDB;rmSync(folder,{recursive:true,force:true});});
function running(conversation=false){const t=createTrip(trip(),crypto.randomUUID());const r=createRun(t,'investigation',conversation?{conversation:true}:{});database().sqlite.prepare("UPDATE runs SET status='running' WHERE id=?").run(r.id);return {t,r:getRun(r.id)};}
const decision=(actions:AgentDecision['actions']):AgentDecision=>({summary:'执行下一项查证',actions});
it('模型过早结束时，运行器仍会先调查明确地点',async()=>{const{t,r}=running();expect(await executeAgent(r,t,async()=>decision([{tool:'finish'}]))).toBe('completed');expect(mode.investigations).toBe(1);expect(mode.context).toBeGreaterThan(0);expect(checkpoint(r.id)?.checks[0].status).toBe('done');finishRun(r.id,getRun(r.id).result!);});
it.each([false,true])('工具观察反馈给下一轮决策，闭馆=%s 时采取不同后续行动',async closed=>{mode.closed=closed;const{t,r}=running();const observed:boolean[]=[];await executeAgent(r,t,async ctx=>{if(!ctx.result.dossiers.length)return decision([{tool:'investigate',itemIds:['a'],focus:'baseline',query:null}]);const conflict=ctx.result.judgments.some(j=>j.verdict==='conflict');observed.push(conflict);return decision(conflict?[{tool:'find_alternatives',itemId:'a',reason:'闭馆且无法通过当天时间调整解决'},{tool:'finish'}]:[{tool:'finish'}]);});expect(observed).toEqual([closed]);expect(mode.alternatives).toBe(closed?1:0);expect(checkpoint(r.id)?.round).toBe(2);finishRun(r.id,getRun(r.id).result!);});
it('追问等待释放执行，回答后同一任务生成预览且不自动改时间',async()=>{const{t,r}=running(true);const first=await executeAgent(r,t,async()=>decision([{tool:'ask_user',itemIds:['a'],question:'请给计划到达时间，也可以暂不补充。'},{tool:'finish'}]));expect(first).toBe('waiting');expect(getRun(r.id).status).toBe('waiting_user');const q=checkpoint(r.id)!.questions[0];reserveSearch(r.id,'fixture');addMessage({tripId:t.id,runId:r.id,role:'user',text:'11点到达',evidenceIds:[],questionId:q.id,requestId:crypto.randomUUID()});database().sqlite.prepare("UPDATE runs SET status='running' WHERE id=?").run(r.id);expect(await executeAgent(getRun(r.id),t,async()=>decision([{tool:'preview_repair',title:'核对11点到达',ops:[{type:'shift',itemId:'a',start:'11:00',end:null}],startDate:null},{tool:'finish'}]))).toBe('completed');expect(getRun(r.id).used).toBe(1);expect(checkpoint(r.id)?.questions[0].answered).toBe(true);expect(agentView(t.id,r.id)?.proposals).toHaveLength(1);expect(t.items[0].start).toBe('10:00');finishRun(r.id,getRun(r.id).result!);});
it('用户选择保留未知后，不因模型再次追问而陷入循环',async()=>{const{t,r}=running(true);addMessage({tripId:t.id,runId:r.id,role:'user',text:'暂不补充，保留未知并完成',evidenceIds:[],requestId:crypto.randomUUID()});await executeAgent(r,t,async()=>decision([{tool:'ask_user',itemIds:['a'],question:'几点到达？'},{tool:'finish'}]));expect(checkpoint(r.id)?.questions).toHaveLength(0);expect(checkpoint(r.id)?.deferQuestions).toBe(true);expect(getRun(r.id).result?.judgments.every(j=>j.verdict==='unknown')).toBe(true);finishRun(r.id,getRun(r.id).result!);});
it('恢复已有成功步骤不重搜，也不会重新获得搜索预算',async()=>{const{t,r}=running(true);const state=initialCheckpoint(r,t);state.contextDone=true;state.steps=[{id:'success',round:1,action:{tool:'investigate',itemIds:['a'],focus:'baseline',query:null},status:'completed',at:new Date().toISOString(),elapsedMs:20,detail:'已完成'}];state.round=1;saveCheckpoint(state);reserveSearch(r.id,'fixture');await executeAgent(r,t,async()=>decision([{tool:'investigate',itemIds:['a'],focus:'baseline',query:null},{tool:'finish'}]));expect(mode.investigations).toBe(0);expect(getRun(r.id).used).toBe(1);finishRun(r.id,getRun(r.id).result!);});
it('反复本地评估也最多十二轮，不会无限调用模型',async()=>{const{t,r}=running(true);let rounds=0;await executeAgent(r,t,async()=>{rounds++;return decision([{tool:'evaluate',itemIds:['a']}]);});expect(rounds).toBe(12);expect(checkpoint(r.id)?.round).toBe(12);expect(getRun(r.id).result?.limitations.some(x=>x.includes('十二轮'))).toBe(true);finishRun(r.id,getRun(r.id).result!);});
it('伪造回答引用不能变成对话中的事实',async()=>{const{t,r}=running(true);await executeAgent(r,t,async()=>decision([{tool:'answer',text:'明天已经预约成功',evidenceIds:['fake']},{tool:'finish'}]));expect(messages(t.id).every(m=>!m.text.includes('预约成功'))).toBe(true);expect(getRun(r.id).result?.limitations.some(x=>x.includes('来源'))).toBe(true);finishRun(r.id,getRun(r.id).result!);});
it('运行中补充的要求在下一步骤处理，不丢失消息或重复已完成工具',async()=>{const{t,r}=running(true);let rounds=0;await executeAgent(r,t,async ctx=>{rounds++;if(rounds===1){addMessage({tripId:t.id,runId:r.id,role:'user',text:'请先保留未知，不补充时间',evidenceIds:[],requestId:crypto.randomUUID()});return decision([{tool:'evaluate',itemIds:['a']}]);}expect(ctx.state.deferQuestions).toBe(true);return decision([{tool:'finish'}]);});expect(rounds).toBe(2);expect(checkpoint(r.id)?.processedMessages).toHaveLength(1);finishRun(r.id,getRun(r.id).result!);});
it('提出集中问题后自动释放等待，不继续消耗模型轮次重复提问',async()=>{const{t,r}=running(true);let calls=0;const status=await executeAgent(r,t,async()=>{calls++;return decision([{tool:'ask_user',itemIds:['a'],question:'计划几点到达？'}]);});expect(status).toBe('waiting');expect(calls).toBe(1);expect(checkpoint(r.id)?.round).toBe(1);finishRun(r.id,getRun(r.id).result!);});
