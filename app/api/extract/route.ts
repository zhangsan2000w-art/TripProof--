import { NextRequest } from 'next/server';
import { extractionInputSchema, extractItinerary } from '@/lib/llm';
import { failure, jsonBody, session, respondWithSession } from '@/lib/http';
import { quota } from '@/lib/store';
import { today } from '@/lib/dates';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(req: NextRequest) {
  try {
    const s = session(req), input = extractionInputSchema.parse(await jsonBody(req, 32_000_000));
    quota(`extract:${s.owner}:${today()}`, Number(process.env.SESSION_DAILY_LIMIT ?? 10) * 3);
    const draft = await extractItinerary(input.text, input.images);
    return respondWithSession(req, s.value, { draft });
  } catch (error) { return failure(error); }
}
