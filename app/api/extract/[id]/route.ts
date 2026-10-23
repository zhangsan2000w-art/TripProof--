import { NextRequest } from 'next/server';
import { extractionJob } from '@/lib/extractions';
import { failure, respond, session } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return respond(req, { job: extractionJob(session(req).owner, id) });
  } catch (error) { return failure(error); }
}
