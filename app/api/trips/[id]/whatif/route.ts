import { NextRequest } from 'next/server';
import { z } from 'zod';
import { dateString, opSchema } from '@/lib/domain';
import { getTrip, tripState, saveRecalculation } from '@/lib/store';
import { failure, jsonBody, respond, session } from '@/lib/http';
import { now } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { database } from '@/db';
import { emit } from '@/lib/store';
import { getProposal, resultFingerprint } from '@/lib/agent-store';
import { createProposal } from '@/lib/agent';
import { recalculateReport } from '@/lib/report';
const schema = z.object({ proposalId:z.string().optional(), startDate: dateString.optional(), ops: z.array(opSchema).max(10).default([]), apply: z.boolean().default(false), revision: z.number().int() });
export const runtime = 'nodejs';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, input = schema.parse(await jsonBody(req)), owner=session(req).owner;
    const response=database().sqlite.transaction(()=>{
      const trip=getTrip(id,owner),state=tripState(trip);
      if(input.revision!==trip.revision)throw new AppError('STALE_REVISION','行程已更新，请刷新后重试。',409);
      if(!state.result||!state.run)throw new AppError('NO_FACTS','请先完成一次调查，再使用已存事实重算。');
      if(['queued','running'].includes(state.run.status))throw new AppError('RUN_ACTIVE','调查仍在更新证据，请等待本轮完成或等待补充信息后再预览。',409);
      let proposal=input.proposalId?getProposal(id,input.proposalId):null;
      if(proposal&&(input.ops.length||input.startDate))throw new AppError('INVALID_OPERATION','已保存预览不能同时提交另一组修改。');
      if(!proposal&&input.apply){
        const rows=database().sqlite.prepare('SELECT payload FROM agent_proposals WHERE trip_id=? ORDER BY rowid DESC').all(id) as {payload:string}[];
        proposal=rows.map(r=>JSON.parse(r.payload)).find(p=>p.revision===trip.revision&&JSON.stringify(p.ops)===JSON.stringify(input.ops)&&p.startDate===input.startDate)??null;
        if(!proposal)throw new AppError('PREVIEW_REQUIRED','请先生成并查看修改预览。',409);
      }
      if(!proposal)proposal=createProposal({trip,run:state.run,result:state.result},'行程修改预览',input.ops,input.startDate,false);
      if(!proposal)throw new AppError('INVALID_OPERATION','未生成有效预览。');
      if(proposal.revision!==trip.revision||proposal.basisHash!==resultFingerprint(state.result))throw new AppError('STALE_PROPOSAL','行程或核验依据已变化，请重新生成预览。',409);
      if(input.apply){
        const recalculated=recalculateReport(proposal.trip,state.result);
        const readings=(result:typeof recalculated)=>JSON.stringify(result.judgments.map(({itemId,type,verdict,reasonCode,factIds,evidenceIds})=>({itemId,type,verdict,reasonCode,factIds,evidenceIds})));
        if(readings(recalculated)!==readings(proposal.result))throw new AppError('STALE_PROPOSAL','核验结果已随时间变化，请重新生成预览。',409);
        if(state.run.status==='waiting_user'){
          database().sqlite.prepare("UPDATE runs SET status='completed',completed_at=?,updated_at=?,input='{}' WHERE id=? AND status='waiting_user'").run(now(),now(),state.run.id);
          emit(state.run.id,'done',{message:'已选择修改预览，结束上一版调查。'});
        }
        saveRecalculation(proposal.trip,{...recalculated,alternatives:[],announcement:null},trip.revision);
      }
      return {proposalId:proposal.id,trip:proposal.trip,result:proposal.result,searched:false,applied:input.apply};
    }).immediate();
    return respond(req,response);
  } catch (error) { return failure(error); }
}
