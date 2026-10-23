import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createRun, getTrip, quota } from '@/lib/store';
import { failure, jsonBody, respond, session } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { today } from '@/lib/dates';
export const runtime = 'nodejs';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, input = z.object({ itemId: z.string() }).parse(await jsonBody(req)), s = session(req), trip = getTrip(id, s.owner);
    if (!trip.items.some(i => i.id === input.itemId)) throw new AppError('ITEM_NOT_FOUND', '行程项不存在。', 404);
    quota(`extra:${s.owner}:${today()}`, Number(process.env.SESSION_DAILY_LIMIT ?? 10) * 2);
    const run = createRun(trip, 'alternatives', input); return respond(req, { runId: run.id }, 202);
  } catch (error) { return failure(error); }
}
