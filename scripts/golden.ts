import { readFile, mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { goldenCases } from '../data/golden-cases';
import { sampleListPath } from '../lib/samples';
import type { Draft, Item, Trip, TripState } from '../lib/domain';
import { normalizeQuote, quoteMatches } from '../lib/evidence';
import { summary } from '../lib/summary';
import { testAccessCookie } from './test-access';
import { caseGuide } from './case-guide';

const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const accessCookie = await testAccessCookie(base);
const selected = process.argv.find(s => s.startsWith('--case='))?.slice(7);
const extractionOnly = process.argv.includes('--extract-only');
const outputDir = process.argv.find(s=>s.startsWith('--out='))?.slice(6) || 'artifacts/golden';
await mkdir(outputDir, { recursive: true });
await mkdir('.data/golden', { recursive: true });
const reports: Record<string, unknown>[] = [];
let failures = 0;
for (const spec of goldenCases.filter(c => !selected || c.id === selected)) {
  const started = Date.now(); let cookie = '';
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [accessCookie, cookie].filter(Boolean).join('; '), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const json = await response.json(); if (!response.ok) throw new Error(`${path}: ${json.code || response.status}: ${json.error}`);
    return json;
  }
  try {
    console.log(`[golden:${spec.id}] extracting ${spec.images.length} images${spec.text ? ' + text' : ''}`);
    const images = await Promise.all(spec.images.map(async (name, n) => ({ data: 'data:image/jpeg;base64,' + (await sharp(`cases/${name}`).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString('base64'), sourceIndex: n + 1 })));
    const text = spec.text ? await readFile(`cases/${spec.text}`, 'utf8') : '';
    const digest = createHash('sha256').update(JSON.stringify({ images, text, version: 3 })).digest('hex').slice(0, 16);
    const cachedFile = `.data/golden/${spec.id}-${digest}.json`;
    let draft: Draft;
    if (process.argv.includes('--reuse-extraction')) draft = JSON.parse(await readFile(cachedFile, 'utf8'));
    else { draft = (await request<{ draft: Draft }>('/api/extract', { text, images })).draft; await writeFile(cachedFile, JSON.stringify(draft, null, 2)); }
    let extractionMs = Date.now() - started;
    const extractionReused = process.argv.includes('--reuse-extraction');
    if (extractionReused) {
      try { const original = JSON.parse(await readFile(`${outputDir}/${spec.id}-extraction.json`, 'utf8')); extractionMs = original.extractionMs; }
      catch { try { extractionMs = JSON.parse(await readFile(`${outputDir}/${spec.id}.json`, 'utf8')).extractionMs; } catch { /* Original timing not retained. */ } }
    }
    const items: Item[] = [];
    for (const day of draft.days) for (const raw of day.items) { const { dependsOnPrevious, ...item } = raw; const prev = items.at(-1); items.push({ ...item, id: crypto.randomUUID(), day: day.dayIndex, dependsOn: dependsOnPrevious && prev?.day === day.dayIndex ? [prev.id] : [] }); }
    const hits = spec.expected.filter(e => items.some(i => i.day === e.day && e.names.some(n => i.placeName.includes(n)))).length;
    const recall = hits / spec.expected.length;
    // A planned time must be written in the stop's own text; the reader never works one out.
    const written = (time: string, text: string) => [time, time.replace(/^0/, '')].some(t => text.normalize('NFKC').replace(/：/g, ':').includes(t));
    const inventedTime = items.some(i => [i.start, i.end].some(t => t !== null && !written(t, i.sourceText)));
    const recommendationsAsItems = items.filter(i => spec.forbidden.some(n => i.placeName.includes(n)));
    for (const day of new Set(spec.expected.map(e => e.day))) {
      const indices = spec.expected.filter(e => e.day === day).map(e => items.findIndex(i => i.day === day && e.names.some(n => i.placeName.includes(n)))).filter(n => n >= 0);
      if (indices.some((n,index) => index > 0 && n < indices[index-1])) throw new Error(`Route order mismatch on day ${day}`);
    }
    if (spec.id === 'linan' && (!draft.ambiguities.some(a => /依锦城|衣锦城/.test(a)) || !JSON.stringify(draft).includes('汽车'))) throw new Error('Missing Linan name/station ambiguity');
    if (spec.id === 'dongtou' && (!items.some(i=>i.kind==='transport'&&/S1|S2/.test(i.sourceText)) || !items.some(i=>i.kind==='transport'&&/9路/.test(i.sourceText)) || !items.some(i=>i.kind==='transport'&&/当天返回/.test(i.sourceText)))) throw new Error('Missing explicit Dongtou approach/return transport');
    if (recall < .9 || inventedTime || recommendationsAsItems.length) throw new Error(`Extraction mismatch: recall=${recall}, inventedTime=${inventedTime}, recommendationItems=${recommendationsAsItems.map(i => i.placeName)}`);
    console.log(`[golden:${spec.id}] extraction ${items.length} items, recall ${Math.round(recall * 100)}%, ${Math.round(extractionMs/1000)}s`);
    if (extractionOnly) { await writeFile(`${outputDir}/${spec.id}-extraction.json`, JSON.stringify({ case: spec.id, recall, extractionMs, draft }, null, 2)); continue; }
    const guide = await caseGuide(spec.images, spec.text);
    const { trip } = await request<{ trip: Trip }>('/api/trips', { title: spec.name, startDate: spec.startDate, originCity: '', destinationCity: spec.city, arriveDay1: null, leaveLastDay: null, mode: 'transit', guidePublishedAt: draft.guideMeta.publishedAt, items, guide });
    const { runId } = await request<{ runId: string }>(`/api/trips/${trip.id}/runs`, {});
    const investigationStarted = Date.now(); let state: TripState;
    do {
      await new Promise(resolve => setTimeout(resolve, 2000));
      state = await request<TripState>(`/api/trips/${trip.id}`);
      if(state.run?.status==='waiting_user'){
        const question=state.agent?.questions.find(q=>!q.answered);
        await request(`/api/trips/${trip.id}/messages`,{requestId:crypto.randomUUID(),revision:state.trip.revision,text:'本次验收暂不补充未给出的时间或商家，请保留相应未知项，完成其余核验并汇总报告。',...(question?{replyTo:question.id}:{})});
      }
      if (Date.now() - investigationStarted > 600000) throw new Error('Investigation timed out after 10 minutes.');
    } while (state.run?.status === 'queued' || state.run?.status === 'running' || state.run?.status === 'waiting_user');
    if (state.run?.status !== 'completed' || !state.result) throw new Error(`Run failed: ${state.run?.error}`);
    const result = state.result, facts = result.dossiers.flatMap(d => d.facts), evidence = result.dossiers.flatMap(d => d.evidence), calls = result.dossiers.flatMap(d => d.calls);
    const violations: string[] = [];
    for (const fact of facts) { const e = evidence.find(e => e.id === fact.evidenceId); if (!e || !fact.quoteVerified || !quoteMatches(fact.quote, e) || fact.venueMatch !== 'exact') violations.push(`Unverified fact ${fact.id}`); }
    for (const judgment of result.judgments) {
      if (['availability'].includes(judgment.type) && judgment.verdict !== 'unknown') violations.push(`Realtime falsely confirmed: ${judgment.id}`);
      if (judgment.verdict === 'confirmed' || judgment.verdict === 'conflict') {
        const basis = facts.filter(f => judgment.factIds.includes(f.id));
        // Plan arithmetic and public areas (read from the guide, no closing rule found) need no source.
        const computedFromPlan = judgment.type === 'arrival_fit' || (judgment.type === 'connection_fit' && judgment.reasonCode === 'PLAN_TIME_OVERLAP') || (judgment.reasonCode === 'PUBLIC_AREA' && judgment.verdict === 'confirmed');
        if (!computedFromPlan && (!basis.length || basis.some(f => f.linkStatus !== 'ok'))) violations.push(`Missing usable source: ${judgment.id}`);
      }
    }
    if (!calls.some(c => c.requestId && !c.errorCode)) violations.push('No real SearchPro RequestId');
    if (state.run.used > 40) violations.push('Search budget exceeded');
    if (!result.judgments.some(j => j.verdict !== 'unknown' || (['OPEN_ENDED_CLOSURE','SOURCES_DISAGREE'].includes(j.reasonCode) && facts.some(f=>j.factIds.includes(f.id)&&f.tier<=2&&f.linkStatus==='ok')))) violations.push('No actionable verified rule or source-supported uncertainty');
    if (violations.length) throw new Error(violations.join('; '));
    const shareURL = `${base}/r/${trip.shareId}`;
    const reportResponse = await fetch(shareURL, { headers: { Cookie: accessCookie } }); if (!reportResponse.ok) throw new Error('Public report failed to render.');
    const rendered = await reportResponse.text(); if (!rendered.includes('行程核对报告') || !rendered.includes('行程结论') || !rendered.includes(trip.title)) throw new Error('Report content missing');
    const report = { case: spec.id, name: spec.name, passed: true, tripId: trip.id, runId, shareURL, extractionMs, extractionReused, extractionRecall: recall, noInventedTimes: !inventedTime, inputItems: items.length, wallMs:Date.now()-investigationStarted, queueMs:state.run.startedAt?Date.parse(state.run.startedAt)-Date.parse(state.run.createdAt):null, investigationMs:state.run.startedAt&&state.run.completedAt?Date.parse(state.run.completedAt)-Date.parse(state.run.startedAt):null, firstVerdictMs: state.run.firstVerdictAt && state.run.startedAt ? Date.parse(state.run.firstVerdictAt) - Date.parse(state.run.startedAt) : null, used: state.run.used, cached: calls.filter(c => c.cacheHit).length, summary: summary(result.judgments), verifiedFacts: facts.length, checkedSources: evidence.filter(e => e.linkStatus === 'ok').length, violations };
    await writeFile(`${outputDir}/${spec.id}.json`, JSON.stringify({ ...report, draft, state }, null, 2));
    reports.push(report); console.log(`[golden:${spec.id}] PASS ${JSON.stringify(report)}`);
  } catch (error) { failures++; const report = { case: spec.id, passed: false, error: (error as Error).message, elapsedMs: Date.now() - started }; reports.push(report); await writeFile(`${outputDir}/${spec.id}-failure.json`, JSON.stringify(report, null, 2)); console.error(`[golden:${spec.id}] FAIL ${(error as Error).message}`); }
}
await writeFile(`${outputDir}/${selected ? `${selected}-` : ''}summary.json`, JSON.stringify({ testedAt: new Date().toISOString(), reports, failures }, null, 2));
// Feature only freshly passing golden reports on the home page; keep earlier ones for cases not rerun.
if (!extractionOnly && !process.argv.includes('--no-feature')) {
  const featured = JSON.parse(await readFile(sampleListPath(), 'utf8').catch(() => '{"reports":[]}')) as { note?: string; reports: { case: string; shareId: string }[] };
  for (const report of reports) if (report.passed && 'shareURL' in report && typeof report.shareURL === 'string') featured.reports = [...featured.reports.filter(r => r.case !== String(report.case)), { case: String(report.case), shareId: report.shareURL.split('/r/')[1] }];
  featured.reports.sort((a, b) => goldenCases.findIndex(c => c.id === a.case) - goldenCases.findIndex(c => c.id === b.case));
  await writeFile(sampleListPath(), `${JSON.stringify({ note: 'Reports featured on the home page. Written by pnpm golden; only these share links are shown.', reports: featured.reports }, null, 2)}\n`);
}
if (failures) process.exitCode = 1;
