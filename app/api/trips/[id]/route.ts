import { NextRequest } from 'next/server';
import { getTrip, tripState } from '@/lib/store';
import { failure, respond, session } from '@/lib/http';
import { recalculateReport } from '@/lib/report';
export const runtime = 'nodejs';
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, state = tripState(getTrip(id, session(req).owner));
    if (state.result && !['queued', 'running'].includes(state.run?.status ?? '')) state.result = recalculateReport(state.trip, state.result);
    return respond(req, state);
  } catch (error) { return failure(error); }
}
