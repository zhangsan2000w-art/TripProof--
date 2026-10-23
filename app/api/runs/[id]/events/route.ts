import { NextRequest } from 'next/server';
import { getRun, getTrip, readEvents } from '@/lib/store';
import { failure, session } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, run = getRun(id); getTrip(run.tripId, session(req).owner);
    let after = Number(req.headers.get('last-event-id') || req.nextUrl.searchParams.get('after') || 0);
    if (!Number.isFinite(after) || after < 0) after = 0;
    const encoder = new TextEncoder(); let timer: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    const stream = new ReadableStream({
      start(controller) {
        const close = () => { if (closed) return; closed = true; clearInterval(timer); try { controller.close(); } catch { /* Client already disconnected. */ } };
        const tick = () => {
          if (closed) return;
          try {
            const events = readEvents(id, after);
            for (const event of events) { controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)); after = event.id; }
            if (['completed', 'failed', 'waiting_user', 'cancelled'].includes(getRun(id).status)) { close(); return; }
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch { close(); }
        };
        timer = setInterval(tick, 800); tick(); req.signal.addEventListener('abort', close, { once: true });
      }, cancel() { closed = true; clearInterval(timer); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' } });
  } catch (error) { return failure(error); }
}
