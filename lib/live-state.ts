import { emptyResult, type Dossier, type Judgment, type RunEvent, type RunResult, type TripState } from './domain';
import type { AgentMessage, AgentProposal, AgentStep, AgentView } from './agent-types';

export function applyRunEvent(state: TripState, event: RunEvent): TripState {
  if (!state.run || state.run.id !== event.runId) return state;
  const next={...state,run:{...state.run,updatedAt:event.at}};
  const result=()=>next.result={...(next.result??emptyResult())};
  const agent=()=>next.agent={round:0,elapsedMs:0,checks:[],questions:[],steps:[],messages:[],proposals:[],contextDone:false,...next.agent};
  if(event.type==='budget') next.run.used=(event.data as {used:number}).used;
  else if(event.type==='dossier'){
    const d=event.data as Dossier,r=result();
    r.dossiers=[...r.dossiers.filter(old=>old.venue.id!==d.venue.id),d];
  }else if(event.type==='verdict'){
    const j=event.data as Judgment,r=result();
    r.judgments=[...r.judgments.filter(old=>old.itemId!==j.itemId||old.type!==j.type),j];
  }else if(event.type==='report_update') Object.assign(result(),event.data as Pick<RunResult,'ripples'|'suggestions'|'limitations'|'alternatives'|'announcement'>);
  else if(event.type==='agent_state') Object.assign(agent(),event.data as Omit<AgentView,'messages'|'proposals'>);
  else if(event.type==='agent_message'){
    const m=event.data as AgentMessage,a=agent();a.messages=[...a.messages.filter(old=>old.id!==m.id),m];
  }else if(event.type==='agent_step'){
    const s=event.data as AgentStep,a=agent();a.steps=[...a.steps.filter(old=>old.id!==s.id),s].slice(-24);
  }else if(event.type==='agent_proposal'){
    const {id,title}=event.data as AgentProposal,a=agent();a.proposals=[...a.proposals.filter(old=>old.id!==id),{id,title,at:event.at}].slice(-3);
  }else if(event.type==='waiting_user')next.run.status='waiting_user';
  else if(event.type==='cancelled')next.run.status='cancelled';
  else if(event.type==='done')next.run.status='completed';
  else if(event.type==='error')next.run.status='failed';
  if(next.run.status==='queued'&&['plan','agent_step','agent_state'].includes(event.type))next.run.status='running';
  return next;
}
