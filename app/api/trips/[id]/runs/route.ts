import { NextRequest } from 'next/server';
import { createRun, getTrip, quota } from '@/lib/store';
import { failure, respond, sameOrigin, session } from '@/lib/http';
import { configuration } from '@/lib/llm';
import { AppError } from '@/lib/errors';
import { today } from '@/lib/dates';
export const runtime = 'nodejs';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req); const { id } = await context.params, s = session(req), trip = getTrip(id, s.owner);
    const config = configuration();
    if (!config.llm || !config.search) throw new AppError('NOT_CONFIGURED', '请先配置服务端 GPT 与元宝搜索密钥。', 503);
    quota(`run:${s.owner}:${today()}`, Number(process.env.SESSION_DAILY_LIMIT ?? 10));
    const run = createRun(trip); return respond(req, { runId: run.id, run }, 202);
  } catch (error) { return failure(error); }
}
