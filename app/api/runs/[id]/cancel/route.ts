import { NextRequest } from 'next/server';
import { database } from '@/db';
import { emit, getRun, getTrip } from '@/lib/store';
import { failure, respond, sameOrigin, session } from '@/lib/http';
import { now } from '@/lib/dates';
export const runtime='nodejs';
export async function POST(req:NextRequest,context:{params:Promise<{id:string}>}){
  try{sameOrigin(req);const{id}=await context.params,run=getRun(id);getTrip(run.tripId,session(req).owner);
    const changed=database().sqlite.prepare("UPDATE runs SET status='cancelled',completed_at=?,updated_at=? WHERE id=? AND status IN ('queued','running','waiting_user')").run(now(),now(),id);
    if(changed.changes)emit(id,'cancelled',{message:'调查已停止，已有证据和实际调用记录已保留。'});
    return respond(req,{run:getRun(id)});
  }catch(error){return failure(error);}
}
