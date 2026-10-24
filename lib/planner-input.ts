import type { ToolContext } from './agent-tools';
import { getRunProgress } from './store';
import { messages } from './agent-store';
import { transportWindow, flexibleTransfer, placeContext } from './itinerary';

/** The planner chooses gaps/actions; original evidence stays in the fact reader. */
export function plannerInput(ctx: ToolContext, previous = new Map<string,string>()) {
  const judgments = ctx.result.judgments.map(({itemId,type,verdict,reasonCode,evidenceIds,ruleStatus})=>({itemId,type,verdict,reasonCode,evidenceIds,ruleStatus}));
  const snapshot = new Map(ctx.result.judgments.map(j=>[`${j.itemId}:${j.type}`,JSON.stringify([j.verdict,j.reasonCode,j.explanation,j.evidenceIds,j.ruleStatus])]));
  const changes = ctx.result.judgments.filter(j=>snapshot.get(`${j.itemId}:${j.type}`)!==previous.get(`${j.itemId}:${j.type}`))
    .map(({itemId,type,explanation})=>({itemId,type,explanation:explanation.slice(0,320)}));
  const input = {
    request:ctx.run.input.message??'核验这份已确认攻略，查清各站规则，遇到冲突主动尝试修复。',
    round:ctx.state.round,budget:{used:getRunProgress(ctx.run.id).used,limit:ctx.run.limit},contextDone:ctx.state.contextDone,
    trip:{startDate:ctx.trip.startDate,city:ctx.trip.destinationCity,items:ctx.trip.items.map(item=>{const{id,placeName,city,day,start,end,kind,activity}=item;return {id,placeName,city,day,start,end,kind,activity,window:transportWindow(item,ctx.trip.items),flexibleTransfer:flexibleTransfer(item),context:placeContext(item)};})},
    checks:ctx.state.checks.map(c=>({...c,searchedScope:c.searchedScope.slice(-3)})),questions:ctx.state.questions,
    chat:messages(ctx.trip.id).filter(m=>m.runId===ctx.run.id||m.role==='user').slice(-10).map(({role,text})=>({role,text})),
    judgments,delta:{updated:changes,removed:[...previous.keys()].filter(key=>!snapshot.has(key))},
    factSummary:ctx.result.dossiers.map(d=>({place:d.venue.canonicalName,kinds:[...new Set(d.facts.map(f=>f.kind))],verified:d.facts.filter(f=>f.quoteVerified&&f.linkStatus==='ok').length,evidenceIds:[...new Set(d.facts.filter(f=>f.quoteVerified).map(f=>f.evidenceId))].slice(0,8)})),
    suggestions:ctx.result.suggestions.slice(0,3).map(s=>({title:s.title,ops:s.ops,conflictsAfter:s.conflictsAfter})),
    alternatives:ctx.result.alternatives.map(a=>({itemId:a.itemId,name:a.name,venueId:a.dossier.venue.id,judgments:a.judgments.map(({type,verdict,reasonCode})=>({type,verdict,reasonCode}))})),
    recentActions:ctx.state.steps.slice(-6).map(s=>({action:s.action,status:s.status,detail:s.detail})),
  };
  return {input,snapshot};
}
