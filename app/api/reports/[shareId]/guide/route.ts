import { NextRequest } from 'next/server';
import { getSharedTrip, guideSummary } from '@/lib/store';
import { failure, respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
export const runtime = 'nodejs';
/** The submitted guide's text and the numbers of its screenshots; anyone with the report link may read it. */
export async function GET(req: NextRequest, context: { params: Promise<{ shareId: string }> }) {
  try {
    const { shareId } = await context.params, trip = getSharedTrip(shareId);
    if (!trip) throw new AppError('NOT_FOUND', '报告不存在。', 404);
    return respond(req, { guide: guideSummary(trip.id) });
  } catch (error) { return failure(error); }
}
