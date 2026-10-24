import { NextRequest } from 'next/server';
import { getTrip, tripState } from '@/lib/store';
import { failure, respond, session } from '@/lib/http';
import { cachedReport } from '@/lib/report';
import { database } from '@/db';
export const runtime = 'nodejs';
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const after=Number(req.nextUrl.searchParams.get('after')??0);
    const { id } = await context.params, state = database().sqlite.transaction(()=>tripState(getTrip(id, session(req).owner),{afterEvent:Number.isSafeInteger(after)&&after>=0?after:0}))();
    if (state.result && !['queued', 'running'].includes(state.run?.status ?? '')) state.result = cachedReport(state.trip, state.result);
    return respond(req, state);
  } catch (error) { return failure(error); }
}
