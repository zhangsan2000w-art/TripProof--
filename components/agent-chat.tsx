'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, LoaderCircle, MessageSquare, Send, Square } from 'lucide-react';
import type { AgentView } from '@/lib/agent-types';
import type { Dossier, Evidence, Run, RunEvent } from '@/lib/domain';
import { api } from '@/lib/client';
import { Button } from './ui/button';

const toolLabels={investigate:'搜索与核验',read_sources:'读取新增证据',evaluate:'规则复核',check_context:'天气与区域公告',preview_repair:'试算修复方案',find_alternatives:'独立核查替代场馆',ask_user:'补充关键信息',answer:'整理有依据的解释',finish:'汇总调查'};
const checkLabels:Record<string,string>={open_on_date:'当天是否开放',hours_fit:'游览时段',reservation_rule:'预约规则',service_hours:'交通运营',guide_claim:'攻略说法'};
const checkStates={pending:'待检查',searching:'检索中',reading:'核验原文',done:'已查',needs_input:'待补充'};
export function AgentChat({tripId,revision,agent,run,events,dossiers,onRefresh,onPreview}:{tripId:string;revision:number;agent:AgentView|null|undefined;run:Run|null;events:RunEvent[];dossiers:Dossier[];onRefresh:()=>Promise<void>;onPreview:(id:string,title:string)=>void}){
  const [text,setText]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
  const pending=useRef<{text:string;id:string}|null>(null),scroll=useRef<HTMLDivElement>(null);
  const busy=run?.status==='running'||run?.status==='queued';
  const question=(busy||run?.status==='waiting_user')?agent?.questions.find(q=>!q.answered):undefined;
  const messageMap=new Map((agent?.messages??[]).map(m=>[m.id,m]));
  for(const e of events)if(e.type==='agent_message'){const m=e.data as NonNullable<AgentView>['messages'][number];messageMap.set(m.id,m);}
  const chat=[...messageMap.values()].filter(m=>!question||m.questionId!==question.id||m.role==='user').sort((a,b)=>a.at.localeCompare(b.at));
  const evidence=new Map(dossiers.flatMap(d=>d.evidence).map(e=>[e.id,e]));
  const lastPlan=events.filter(e=>e.type==='plan').at(-1)?.data as {message?:string}|undefined;
  useEffect(()=>{const el=scroll.current;if(el)el.scrollTop=el.scrollHeight;},[chat.length,question?.id]);
  async function send(value=text){
    const clean=value.trim();if(!clean||sending)return;
    setSending(true);setError('');
    if(pending.current?.text!==clean)pending.current={text:clean,id:crypto.randomUUID()};
    try{await api(`/api/trips/${tripId}/messages`,{requestId:pending.current.id,revision,text:clean,...(question?{replyTo:question.id}:{})});setText('');pending.current=null;await onRefresh();}
    catch(error){setError((error as Error).message);}finally{setSending(false);}
  }
  async function cancel(){if(!run)return;setSending(true);setError('');try{await api(`/api/runs/${run.id}/cancel`,{});await onRefresh();}catch(error){setError((error as Error).message);}finally{setSending(false);}}
  return <section className="agent-chat card" aria-label="与行程 Agent 对话">
    <header className="agent-chat-head"><span className="agent-avatar"><MessageSquare size={18}/></span><div><h2>TripProof Agent</h2><p>{question?'等你补充信息':busy?'正在为这份攻略查证':'你的行程核验搭档'}</p></div>{(busy||run?.status==='waiting_user')&&<button className="icon-button" disabled={sending} onClick={cancel} aria-label="停止调查" title="停止调查，保留已有结果"><Square size={15}/></button>}</header>
    <div className="agent-messages" ref={scroll} role="log" aria-live="polite" aria-relevant="additions">
      <div className="agent-bubble assistant"><strong>把问题交给我，修改由你决定。</strong><p>我会核对攻略的开放、时段和预约规则，追查缺失依据。发现走不通的安排，会先给你看调整方案。</p></div>
      {chat.map(message=><article className={`agent-bubble ${message.role}`} key={message.id}><span className="agent-speaker">{message.role==='user'?'你':'TripProof'}</span><p>{message.text}</p><MessageCitations ids={message.evidenceIds} evidence={evidence}/></article>)}
      {busy&&<div className="agent-working" role="status"><LoaderCircle size={14} className="spin"/><span>{lastPlan?.message||'正在查看证据与待核验的问题…'}</span></div>}
      {run?.status==='cancelled'&&<p className="agent-notice">本轮已停止，已有证据保留。可以补充要求或重新检查。</p>}
      {question&&<div className="agent-question"><strong>待你补充</strong><p>{question.text}</p><button className="text-button" disabled={sending} onClick={()=>send('这次暂不补充这些信息，请保留相应未知项，完成其余核验并汇总报告。')}>暂不补充，保留未知</button></div>}
      {!!agent?.proposals.length&&<div className="agent-proposals"><h3>可预览的调整</h3>{agent.proposals.map(p=><button key={p.id} disabled={busy||sending} onClick={()=>onPreview(p.id,p.title)}><span>{p.title}</span><ArrowUpRight size={15}/></button>)}<small>先看修改前后及重新判定，再决定是否应用。</small></div>}
    </div>
    {!!agent?.steps.length&&<details className="agent-actions"><summary><ChevronDown size={13}/>已执行 {agent.steps.filter(s=>s.status==='completed').length} 项行动<span>查看过程</span></summary><ol>{agent.steps.slice(-8).map(s=><li key={s.id}>{s.status==='running'?<LoaderCircle size={12} className="spin"/>:s.status==='completed'?<Check size={12}/>:<span>!</span>}<span>{toolLabels[s.action.tool]}{s.status==='failed'?` · ${s.detail}`:''}</span><small>{s.status==='running'?'进行中':`${(s.elapsedMs/1000).toFixed(1)}秒`}</small></li>)}</ol></details>}
    {!!agent?.checks.length&&<details className="agent-actions agent-checks"><summary><ChevronDown size={13}/>逐站进度与证据缺口<span>按需展开</span></summary>{agent.checks.map(c=><details key={c.itemId}><summary>{c.place}<small>{checkStates[c.status]}</small></summary><p>待查：{c.missing.length?[...new Set(c.missing.map(m=>checkLabels[m.split(':')[0]]||'相关规则'))].join('、'):'暂无新增缺口'}</p>{c.nextAction&&<p>下一步：{c.nextAction}</p>}{c.stopReason&&<p>{c.stopReason}</p>}<p>已查范围：{c.searchedScope.length?c.searchedScope.join('；'):'尚未检索'}</p></details>)}</details>}
    {error&&<p className="agent-chat-error" role="alert">{error}</p>}
    <form className="agent-composer" onSubmit={e=>{e.preventDefault();void send();}}>
      <label className="sr-only" htmlFor="agent-message">补充要求或向 Agent 提问</label>
      <textarea id="agent-message" value={text} onChange={e=>setText(e.target.value)} maxLength={4000} rows={3} placeholder={question?'填写补充信息，也可以先保留未知…':'例如：雷峰塔改成下午四点到，帮我看看是否合适'} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
      <div><small>{busy?'可以继续补充，我会在当前步骤后处理':'Enter 发送 · Shift+Enter 换行'}</small><Button type="submit" size="sm" disabled={sending||!text.trim()}>{sending?<LoaderCircle size={14} className="spin"/>:<Send size={14}/>}发送</Button></div>
    </form>
  </section>;
}

function MessageCitations({ids,evidence}:{ids:string[];evidence:Map<string,Evidence>}) {
  const sources=[...new Map(ids.flatMap(id=>{const e=evidence.get(id);return e?[[e.finalUrl||e.url,e] as const]:[];})).values()].sort((a,b)=>a.tier-b.tier);
  if(!sources.length)return null;
  const link=(e:Evidence)=><a key={e.id} href={e.finalUrl||e.url} target="_blank" rel="noopener noreferrer">{e.title||e.site}<ArrowUpRight size={11}/></a>;
  return <div className="agent-citations">{sources.slice(0,2).map(link)}{sources.length>2&&<details><summary>其余 {sources.length-2} 个来源</summary>{sources.slice(2).map(link)}</details>}</div>;
}
