import { NextRequest } from 'next/server';
import { createRun, getTrip, quota } from '@/lib/store';
import { failure, jsonBody, respond, session } from '@/lib/http';
import { extractionInputSchema } from '@/lib/llm';
import { readAnnouncement } from '@/lib/investigate';
import { today } from '@/lib/dates';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, s = session(req), trip = getTrip(id, s.owner), input = extractionInputSchema.parse(await jsonBody(req, 32_000_000));
    quota(`extra:${s.owner}:${today()}`, Number(process.env.SESSION_DAILY_LIMIT ?? 10) * 2);
    const announcement = await readAnnouncement(input.text, input.images);
    const run = createRun(trip, 'announcement', { announcement }); return respond(req, { runId: run.id }, 202);
  } catch (error) { return failure(error); }
}
