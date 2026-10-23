import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTrip, getSharedTrip, tripState, vote } from '@/lib/store';
import { failure, jsonBody, respondWithSession, session } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { reportFeedbackIds } from '@/lib/report';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const input = z.object({ judgmentId: z.string(), vote: z.union([z.literal(1), z.literal(-1)]), tripId: z.string().optional(), shareId: z.string().optional() }).parse(await jsonBody(req));
    const s = session(req), trip = input.shareId ? getSharedTrip(input.shareId) : input.tripId ? getTrip(input.tripId, s.owner) : null;
    const result=trip ? tripState(trip, { completedOnly: !!input.shareId }).result : null;
    if (!trip || !result || !(await reportFeedbackIds(trip,result)).has(input.judgmentId)) throw new AppError('NOT_FOUND', '判定记录不存在。', 404);
    vote(input.judgmentId, s.owner, input.vote); return respondWithSession(req, s.value, { ok: true });
  } catch (error) { return failure(error); }
}
