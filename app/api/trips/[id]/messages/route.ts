import { NextRequest } from 'next/server';
import { database } from '@/db';
import { agentView, addMessage, checkpoint, messageByRequest, saveCheckpoint } from '@/lib/agent-store';
import { messageInputSchema } from '@/lib/agent-types';
import { createRun, emit, getTrip, quota, saveResult, tripState } from '@/lib/store';
import { failure, jsonBody, respond, session } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { redact } from '@/lib/llm';
import { now, today } from '@/lib/dates';
export const runtime='nodejs';
export async function GET(req:NextRequest,context:{params:Promise<{id:string}>}){
  try{const{id}=await context.params,trip=getTrip(id,session(req).owner),state=tripState(trip);return respond(req,{agent:agentView(id,state.run?.id??null)});}catch(error){return failure(error);}
}
export async function POST(req:NextRequest,context:{params:Promise<{id:string}>}){
  try{
    const{id}=await context.params,s=session(req),trip=getTrip(id,s.owner),input=messageInputSchema.parse(await jsonBody(req));
    const text=redact(input.text);
    const response=database().sqlite.transaction(()=>{
      const old=messageByRequest(id,input.requestId);
      if(old){if(old.text!==text||old.questionId!==input.replyTo||(old.revision!==undefined&&old.revision!==input.revision))throw new AppError('REQUEST_CONFLICT','这个请求编号已用于另一条消息。',409);return {messageId:old.id,runId:old.runId};}
      if(input.revision!==trip.revision||getTrip(id,s.owner).revision!==trip.revision)throw new AppError('STALE_REVISION','行程已更新，请刷新后再补充。',409);
      const state=tripState(trip);let run=state.run&&['queued','running','waiting_user'].includes(state.run.status)?state.run:null;
      if(run&&run.kind!=='investigation')throw new AppError('RUN_ACTIVE','公告或替代场馆查询正在进行，请稍后补充。',409);
      if(input.replyTo&&(!run||!checkpoint(run.id)?.questions.some(q=>q.id===input.replyTo&&!q.answered)))throw new AppError('QUESTION_EXPIRED','这个问题已处理，请刷新后继续对话。',409);
      quota(`message:${s.owner}:${today()}`,Number(process.env.SESSION_MESSAGE_LIMIT??60));
      if(!run){run=createRun(trip,'investigation',{conversation:true,message:text});if(state.result)saveResult(run.id,state.result);}
      const message=addMessage({tripId:id,runId:run.id,role:'user',text,evidenceIds:[],requestId:input.requestId,revision:input.revision,...(input.replyTo?{questionId:input.replyTo}:{})});
      emit(run.id,'agent_message',message);
      if(run.status==='waiting_user'){
        const saved=checkpoint(run.id);
        if(saved){for(const q of saved.questions)if(!input.replyTo||q.id===input.replyTo)q.answered=true;saved.pending=[];saved.stopped=false;saveCheckpoint(saved);}
        database().sqlite.prepare("UPDATE runs SET status='queued',updated_at=? WHERE id=? AND status='waiting_user'").run(now(),run.id);
      }
      return {messageId:message.id,runId:run.id};
    }).immediate();
    return respond(req,response,202);
  }catch(error){return failure(error);}
}
