import { NextRequest, NextResponse } from 'next/server';
import { getSharedTrip, guideImage } from '@/lib/store';
import { failure } from '@/lib/http';
import { AppError } from '@/lib/errors';
export const runtime = 'nodejs';
/** One screenshot of the submitted guide, as the display copy saved with the trip. */
export async function GET(_req: NextRequest, context: { params: Promise<{ shareId: string; index: string }> }) {
  try {
    const { shareId, index } = await context.params, trip = getSharedTrip(shareId);
    const n = Number(index), image = trip && Number.isInteger(n) ? guideImage(trip.id, n) : null;
    if (!image) throw new AppError('NOT_FOUND', '图片不存在。', 404);
    return new NextResponse(new Uint8Array(image.data), { headers: { 'Content-Type': image.mime, 'Content-Length': String(image.data.length), 'Cache-Control': 'private, max-age=3600' } });
  } catch (error) { return failure(error); }
}
