import { NextRequest } from 'next/server';
import { z } from 'zod';
import { dateString, opSchema } from '@/lib/domain';
import { getTrip, tripState, saveRecalculation } from '@/lib/store';
import { failure, jsonBody, respond, session } from '@/lib/http';
import { applyOperations, rippleEffects, suggestions } from '@/lib/impact';
import { judgeTrip } from '@/lib/judge';
import { validDate, now } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { recalculateReport } from '@/lib/report';
const schema = z.object({ startDate: dateString.optional(), ops: z.array(opSchema).max(10).default([]), apply: z.boolean().default(false), revision: z.number().int() });
export const runtime = 'nodejs';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, input = schema.parse(await jsonBody(req)), trip = getTrip(id, session(req).owner), state = tripState(trip);
    if (input.revision !== trip.revision) throw new AppError('STALE_REVISION', '行程已更新，请刷新后重试。', 409);
    if (state.run && ['queued', 'running'].includes(state.run.status)) throw new AppError('RUN_ACTIVE', '请等待当前调查结束再调整行程。', 409);
    if (!state.result) throw new AppError('NO_FACTS', '请先完成一次调查，再使用已存事实重算。');
    state.result = recalculateReport(trip, state.result);
    if (input.startDate && !validDate(input.startDate)) throw new AppError('INVALID_DATE', '请输入有效日期。');
    const changed = applyOperations(trip, input.ops); if (input.startDate) changed.startDate = input.startDate;
    const next = { ...trip, ...changed, updatedAt: now(), revision: trip.revision + 1 };
    const judgments = judgeTrip(next, state.result.dossiers);
    const result = { ...state.result, judgments, ripples: rippleEffects(next, judgments), suggestions: suggestions(next, state.result.dossiers, judgments), alternatives: [], announcement: null };
    if (input.apply) {
      saveRecalculation(next, result, trip.revision);
    }
    return respond(req, { trip: next, result, searched: false, applied: input.apply });
  } catch (error) { return failure(error); }
}
