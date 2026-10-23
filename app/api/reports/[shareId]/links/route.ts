import { NextRequest } from 'next/server';
import { getSharedTrip, tripState, quota } from '@/lib/store';
import { failure, respond, sameOrigin, session } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { refreshReportLinks } from '@/lib/report';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(req: NextRequest, context: { params: Promise<{ shareId: string }> }) {
  try {
    sameOrigin(req); const { shareId } = await context.params, trip = getSharedTrip(shareId);
    if (!trip) throw new AppError('NOT_FOUND', '报告不存在。', 404);
    const state = tripState(trip, { completedOnly: true }); if (!state.result) throw new AppError('NOT_READY', '报告还未完成。', 409);
    quota(`print:${session(req).owner}:${new Date().toISOString().slice(0, 13)}`, 6);
    const result = await refreshReportLinks(trip, state.result);
    return respond(req, { result, searched: false });
  } catch (error) { return failure(error); }
}
