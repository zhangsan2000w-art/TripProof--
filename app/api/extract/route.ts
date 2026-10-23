import { after, NextRequest } from 'next/server';
import { extractionInputSchema, extractItinerary } from '@/lib/llm';
import { failure, jsonBody, session, respondWithSession } from '@/lib/http';
import { quota } from '@/lib/store';
import { today } from '@/lib/dates';
import { beginExtractionJob, runExtractionJob } from '@/lib/extractions';
export const runtime = 'nodejs';
export const maxDuration = 300;
// Establish the owner before starting a job, even if the first POST response is lost.
export async function GET(req: NextRequest) {
  const s = session(req);
  return respondWithSession(req, s.value, { ready: true });
}
export async function POST(req: NextRequest) {
  try {
    const s = session(req), input = extractionInputSchema.parse(await jsonBody(req, 32_000_000));
    const limit = Number(process.env.SESSION_DAILY_LIMIT ?? 10) * 3;
    if (input.background) {
      const { job, created } = beginExtractionJob(s.owner, input.requestId || crypto.randomUUID(), limit);
      if (created) after(() => runExtractionJob(job.id, input.text, input.images));
      return respondWithSession(req, s.value, { job }, 202);
    }
    quota(`extract:${s.owner}:${today()}`, limit);
    const draft = await extractItinerary(input.text, input.images);
    return respondWithSession(req, s.value, { draft });
  } catch (error) { return failure(error); }
}
