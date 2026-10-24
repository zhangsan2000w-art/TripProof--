import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../db';
import { createTrip, createRun, finishRun, emit, getRunProgress, listCalls, saveCall, saveResult } from '../lib/store';
import { initialCheckpoint } from '../lib/agent';
import { plannerInput } from '../lib/planner-input';
import { bufferedPersistence } from '../lib/persistence';
import { models, planners } from '../lib/investigate';
import { SearchGate } from '../lib/search/shared';
import { withRunControl } from '../lib/run-control';
import { judgeTrip } from '../lib/judge';
import { emptyResult, type TripState, type RunEvent } from '../lib/domain';
import { applyRunEvent } from '../lib/live-state';
import { trip, dossier, hours, item } from './fixtures';
const folder=mkdtempSync(join(tmpdir(),'tripproof-performance-'));
beforeAll(()=>{process.env.DATABASE_PATH=join(folder,'perf.db');});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
afterAll(()=>{database().sqlite.close();delete(globalThis as {tripproofDB?:unknown}).tripproofDB;rmSync(folder,{recursive:true,force:true});});

it('六个事实读取真正并发，planner 不占事实槽位',async()=>{
  let reads=0,release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  const tasks=Array.from({length:6},()=>models.run(async()=>{reads++;await hold;}));
  await Promise.resolve();expect(reads).toBe(6);
  await planners.run(async()=>{expect(reads).toBe(6);});
  release();await Promise.all(tasks);
});
it('中间写入合并，边界强制落盘，退出后没有迟到写入',()=>{
  vi.useFakeTimers();const write=vi.fn(),buffer=bufferedPersistence(write);
  for(let n=0;n<20;n++)buffer.request();expect(write).not.toHaveBeenCalled();
  vi.advanceTimersByTime(250);expect(write).toHaveBeenCalledTimes(1);
  buffer.request();buffer.request(true);expect(write).toHaveBeenCalledTimes(2);
  buffer.dispose();vi.advanceTimersByTime(1000);expect(write).toHaveBeenCalledTimes(2);
});
it('定时持久化失败不会成为未处理异常，下一边界会收到错误',()=>{
  vi.useFakeTimers();const buffer=bufferedPersistence(()=>{throw new Error('disk failure');});
  buffer.request();vi.advanceTimersByTime(250);expect(()=>buffer.flush()).toThrow('disk failure');buffer.dispose();
});
it('取消速率等待会归还搜索槽位，不阻塞后续任务',async()=>{
  vi.useFakeTimers();const gate=new SearchGate(1,1);await gate.enter();gate.leave();
  const control=new AbortController(),pending=withRunControl({signal:control.signal},()=>gate.enter());
  const rejected=expect(pending).rejects.toThrow('stop');control.abort(new Error('stop'));await rejected;
  await vi.advanceTimersByTimeAsync(1100);await gate.enter();gate.leave();
});
it('非判定事件及进度读取不解析整个 run 和 trip',()=>{
  const t=createTrip(trip(),'owner'),r=createRun(t),sqlite=database().sqlite;
  sqlite.prepare('UPDATE runs SET result=? WHERE id=?').run('not-json',r.id);
  sqlite.prepare('UPDATE trips SET body=? WHERE id=?').run('not-json',t.id);
  expect(()=>emit(r.id,'budget',{used:0})).not.toThrow();
  expect(getRunProgress(r.id).used).toBe(0);
  sqlite.prepare('UPDATE trips SET body=? WHERE id=?').run(JSON.stringify(t),t.id);
  saveResult(r.id,emptyResult());
  finishRun(r.id,emptyResult());
});
it('按场馆读取调用记录不解析其他场馆的 payload',()=>{
  const t=createTrip(trip(),'owner'),r=createRun(t);
  saveCall(r.id,{id:'one',venueId:'a',note:'only-a'} as never);saveCall(r.id,{id:'two',venueId:'b',note:'do-not-parse-b'} as never);
  const parse=vi.spyOn(JSON,'parse');expect(listCalls(r.id,'a').map(c=>c.id)).toEqual(['one']);
  expect(parse.mock.calls.some(([value])=>value.includes('do-not-parse-b'))).toBe(false);parse.mockRestore();finishRun(r.id,emptyResult());
});
it('相同实体不重写，删除事实后不会残留在首条判定依据中',()=>{
  const t=createTrip(trip(),'owner'),r=createRun(t),result={...emptyResult(),dossiers:[dossier([hours()])]};
  saveResult(r.id,result);const before=(database().sqlite.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
  saveResult(r.id,result);expect((database().sqlite.prepare('SELECT total_changes() AS n').get() as {n:number}).n-before).toBe(1);
  result.dossiers[0].facts=[];saveResult(r.id,result);
  expect(database().sqlite.prepare('SELECT id FROM facts WHERE run_id=?').all(r.id)).toHaveLength(0);finishRun(r.id,result);
});
it('planner 不接收事实正文，重复轮次只带新增判定解释',()=>{
  const t=createTrip(trip(),'owner'),r=createRun(t),f=hours();f.quote='private-long-fact-text';
  const ctx={trip:t,run:r,result:{...emptyResult(),dossiers:[dossier([f])]},state:initialCheckpoint(r,t),persist:()=>{}};
  ctx.result.judgments=judgeTrip(t,ctx.result.dossiers);
  const first=plannerInput(ctx);expect(JSON.stringify(first.input)).not.toContain('private-long-fact-text');expect(first.input).not.toHaveProperty('facts');
  expect(first.input.delta.updated.length).toBeGreaterThan(0);
  const next=plannerInput(ctx,first.snapshot);expect(next.input.delta.updated).toEqual([]);
  ctx.result.judgments[0].explanation+='changed';expect(plannerInput(ctx,next.snapshot).input.delta.updated).toHaveLength(1);finishRun(r.id,ctx.result);
});
it('SSE 可独立更新证据、判定、预算和 Agent，其他任务事件不污染当前行程',()=>{
  const t=createTrip(trip([item()]),'owner'),r=createRun(t);let state:TripState={trip:t,run:r,result:emptyResult(),events:[],runs:[]};
  const event=(type:RunEvent['type'],data:unknown,runId=r.id):RunEvent=>({id:1,runId,type,data,at:new Date().toISOString()});
  const d=dossier([hours()]);state=applyRunEvent(state,event('dossier',d));
  state=applyRunEvent(state,event('verdict',{itemId:'a',type:'hours_fit',verdict:'confirmed'}));
  state=applyRunEvent(state,event('budget',{used:3}));
  state=applyRunEvent(state,event('agent_state',{round:1,checks:[{itemId:'a',status:'done'}],contextDone:true}));
  expect(state.result?.dossiers).toEqual([d]);expect(state.result?.judgments[0].verdict).toBe('confirmed');expect(state.run?.used).toBe(3);expect(state.agent?.contextDone).toBe(true);
  expect(applyRunEvent(state,event('budget',{used:40},'other'))).toBe(state);
  state=applyRunEvent(state,event('done',{}));expect(state.run?.status).toBe('completed');finishRun(r.id,emptyResult());
});
