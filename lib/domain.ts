import { z } from 'zod';

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const timeString = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const closingTime = z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/);
export const kinds = ['museum', 'scenic', 'show', 'restaurant', 'transport', 'hotel', 'other'] as const;
export const claimSchema = z.object({ kind: z.enum(['hours', 'reservation', 'transport', 'other']), text: z.string().max(500) });
export const extractedItemSchema = z.object({
  seq: z.number().int().positive(), start: timeString.nullable(), end: timeString.nullable(),
  placeName: z.string().min(1).max(120), city: z.string().nullable(), kind: z.enum(kinds),
  activity: z.string().max(300), sourceText: z.string().min(1).max(1500), sourceImage: z.number().int().min(1).nullable(),
  confidence: z.number().min(0).max(1), dependsOnPrevious: z.boolean(),
  claimedRules: z.array(claimSchema),
});
export const draftSchema = z.object({
  guideMeta: z.object({ title: z.string().nullable(), publishedAt: dateString.nullable() }),
  days: z.array(z.object({ dayIndex: z.number().int().min(1).max(30), items: z.array(extractedItemSchema).max(40) })).max(30),
  recommendations: z.array(z.object({ name: z.string(), note: z.string(), sourceImage: z.number().int().nullable() })).max(40),
  ambiguities: z.array(z.string()).max(40),
});
export type Draft = z.infer<typeof draftSchema>;
export const itemSchema = extractedItemSchema.omit({ dependsOnPrevious: true }).extend({
  id: z.string().min(1).max(80), day: z.number().int().min(1).max(30), dependsOn: z.array(z.string()).max(40),
});
export type Item = z.infer<typeof itemSchema>;
export const tripInputSchema = z.object({
  title: z.string().min(1).max(160), startDate: dateString,
  originCity: z.string().max(60), destinationCity: z.string().min(1).max(60),
  arriveDay1: timeString.nullable(), leaveLastDay: timeString.nullable(),
  mode: z.enum(['transit', 'drive']), guidePublishedAt: dateString.nullable(),
  items: z.array(itemSchema).min(1).max(50),
});
export type TripInput = z.infer<typeof tripInputSchema>;
export type Trip = TripInput & { id: string; shareId: string; createdAt: string; updatedAt: string; revision: number };

const period = z.object({ from: z.string().regex(/^\d{2}-\d{2}$/), to: z.string().regex(/^\d{2}-\d{2}$/), open: timeString, close: closingTime, lastEntry: timeString.nullable() });
const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);
const factBase = { evidenceId: z.string(), quote: z.string().min(1).max(80), venueMatch: z.enum(['exact', 'other_branch', 'unclear']), validFrom: dateString.nullable(), validTo: dateString.nullable() };
export const extractedFactSchema = z.discriminatedUnion('kind', [
  z.object({ ...factBase, kind: z.literal('weekly_open'), payload: z.object({ weekdays, exceptStatutoryHolidays: z.boolean() }) }),
  z.object({ ...factBase, kind: z.literal('weekly_closure'), payload: z.object({ closedWeekdays: weekdays, exceptStatutoryHolidays: z.boolean() }) }),
  z.object({ ...factBase, kind: z.literal('hours'), payload: z.object({ seasons: z.array(period).min(1).max(6), weekdays: weekdays.nullable() }) }),
  z.object({ ...factBase, kind: z.literal('temp_closure'), payload: z.object({ from: dateString, to: dateString.nullable(), scope: z.enum(['whole', 'partial']), note: z.string() }) }),
  z.object({ ...factBase, kind: z.literal('temp_open'), payload: z.object({ from: dateString, to: dateString, note: z.string() }) }),
  z.object({ ...factBase, kind: z.literal('temp_hours'), payload: z.object({ from: dateString, to: dateString, open: timeString, close: closingTime, lastEntry: timeString.nullable() }) }),
  z.object({ ...factBase, kind: z.literal('reservation'), payload: z.object({ required: z.boolean(), advanceDays: z.number().int().min(0).max(365).nullable(), releaseTime: timeString.nullable(), channel: z.string().nullable(), realName: z.boolean().nullable() }) }),
  z.object({ ...factBase, kind: z.literal('service_hours'), payload: z.object({ entity: z.string(), first: timeString.nullable(), last: timeString, lastDayOffset: z.number().int().min(0).max(1), note: z.string() }) }),
  z.object({ ...factBase, kind: z.literal('transport_duration'), payload: z.object({ from: z.string(), to: z.string(), mode: z.string(), durationMinutes: z.number().positive().max(3000), isMinimum: z.boolean() }) }),
  z.object({ ...factBase, kind: z.literal('weather'), payload: z.object({ date: dateString, city: z.string(), summary: z.string(), precipitationProb: z.number().min(0).max(100).nullable(), warning: z.string().nullable() }) }),
]);
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export const factOutputSchema = z.object({
  canonicalName: z.string(), city: z.string(),
  officialDomain: z.string().nullable(), officialEvidenceId: z.string().nullable(),
  officialIdentityQuote: z.string().nullable(),
  facts: z.array(extractedFactSchema).max(36), ambiguities: z.array(z.string()).max(15),
});
export type Fact = ExtractedFact & { id: string; venueId: string; quoteVerified: boolean; tier: 1 | 2 | 3 | 4; domain: string; publishedAt: string | null; retrievedAt: string; linkStatus: LinkStatus };
export type LinkStatus = 'ok' | 'browser_only' | 'broken';
export type Evidence = {
  id: string; searchCallId: string; url: string; finalUrl: string | null; title: string; site: string;
  publishedAt: string | null; retrievedAt: string; passage: string; content: string;
  score: number | null; authorityLevel: number | null; tier: 1 | 2 | 3 | 4;
  linkStatus: LinkStatus; linkCheckedAt: string | null; pageSha256: string | null;
};
export type SearchParams = { query: string; site?: string; freshness?: string; mode?: number; cnt?: number; industry?: string };
export type SearchCall = {
  id: string; venueId: string; query: string; params: SearchParams; requestId: string | null;
  version: string | null; msg: string | null; errorCode: string | null; resultCount: number;
  latencyMs: number; calledAt: string; cacheHit: boolean; cachedFrom: string | null;
};
export const checkTypes = ['open_on_date', 'hours_fit', 'reservation_rule', 'availability', 'arrival_fit', 'service_hours', 'weather', 'guide_claim', 'connection_fit'] as const;
export type CheckType = typeof checkTypes[number];
export type Verdict = 'confirmed' | 'conflict' | 'unknown';
export type Judgment = {
  id: string; itemId: string; venueId: string; type: CheckType; date: string; verdict: Verdict;
  reasonCode: string; explanation: string; factIds: string[]; overruledFactIds: string[];
  evidenceIds: string[]; searchedScope: string[]; notes: string[]; judgedAt: string;
  ruleStatus?: 'verified' | 'reference' | 'unresolved';
};
export type Venue = { id: string; key: string; canonicalName: string; city: string; officialDomain: string | null; officialEvidenceId: string | null; investigationDates: string[] };
export type Dossier = { venue: Venue; facts: Fact[]; evidence: Evidence[]; calls: SearchCall[]; searchedScope: string[]; limitations: string[]; createdAt: string };
export type Ripple = { itemId: string; causeItemId: string; reason: string; kind: 'EXPLICIT' | 'SAME_VENUE' | 'TIMING_CHAIN' | 'LEG_ORIGIN_CHANGED' };
export const opSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shift'), itemId: z.string(), start: timeString, end: timeString.nullable() }),
  z.object({ type: z.literal('swap'), itemId: z.string(), otherItemId: z.string() }),
  z.object({ type: z.literal('drop'), itemId: z.string() }),
]);
export type Operation = z.infer<typeof opSchema>;
export type Suggestion = { id: string; title: string; ops: Operation[]; cost: number; conflictsBefore: number; conflictsAfter: number; unknownsAfter: number; judgments: Judgment[]; itemsAfter: Item[]; warning: string | null };
export type RunResult = { dossiers: Dossier[]; judgments: Judgment[]; ripples: Ripple[]; suggestions: Suggestion[]; alternatives: Alternative[]; announcement: AnnouncementResult | null; limitations: string[] };
export type Alternative = { itemId: string; name: string; reason: string; dossier: Dossier; judgments: Judgment[] };
export type AnnouncementResult = { title: string; claims: string[]; verdict: Verdict; explanation: string; evidenceIds: string[] };
export type RunKind = 'investigation' | 'announcement' | 'alternatives';
export type Run = { id: string; tripId: string; kind: RunKind; status: 'queued' | 'running' | 'completed' | 'failed'; createdAt: string; updatedAt: string; startedAt: string | null; completedAt: string | null; firstVerdictAt: string | null; used: number; limit: number; input: Record<string, unknown>; result: RunResult | null; error: string | null; tripRevision: number };
export type EventType = 'plan' | 'search' | 'evidence' | 'fact' | 'verdict' | 'ripple' | 'suggestion' | 'budget' | 'done' | 'error';
export type RunEvent = { id: number; runId: string; type: EventType; data: unknown; at: string };
export type TripState = { trip: Trip; run: Run | null; runs: Pick<Run, 'id' | 'kind' | 'status' | 'createdAt' | 'tripRevision'>[]; result: RunResult | null; events: RunEvent[] };
export const emptyResult = (): RunResult => ({ dossiers: [], judgments: [], ripples: [], suggestions: [], alternatives: [], announcement: null, limitations: [] });
