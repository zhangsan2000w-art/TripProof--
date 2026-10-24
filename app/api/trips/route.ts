import { NextRequest } from 'next/server';
import { validateTrip } from '@/lib/validate';
import { createTrip } from '@/lib/store';
import { guideSchema } from '@/lib/domain';
import { failure, jsonBody, session, respondWithSession } from '@/lib/http';
import { redact } from '@/lib/llm';
import { withProfiles } from '@/lib/profiles';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const s = session(req), body = await jsonBody(req, 30_000_000);
    // The original guide is optional: the user may choose not to show it in the report.
    const { guide, ...rest } = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : { guide: undefined };
    // Stops added by hand, or from older drafts, get their nature read once here.
    const input = await withProfiles(validateTrip(rest)), parsed = guide === undefined || guide === null ? null : guideSchema.parse(guide);
    // Phone numbers, ID numbers and e-mail addresses are removed from the text, as for the trip itself.
    const saved = parsed && { ...parsed, text: redact(parsed.text) };
    return respondWithSession(req, s.value, { trip: createTrip(input, s.owner, saved) }, 201);
  } catch (error) { return failure(error); }
}
