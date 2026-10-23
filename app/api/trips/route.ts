import { NextRequest } from 'next/server';
import { validateTrip } from '@/lib/validate';
import { createTrip } from '@/lib/store';
import { failure, jsonBody, session, respondWithSession } from '@/lib/http';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try { const s = session(req); const input = validateTrip(await jsonBody(req)); return respondWithSession(req, s.value, { trip: createTrip(input, s.owner) }, 201); }
  catch (error) { return failure(error); }
}
