import { readFileSync } from 'node:fs';
import { getSharedTrip, tripState } from './store';
import { recalculateReport } from './report';
import { itineraryInsights, tripVerdict } from './presentation';
import { dateForDay } from './dates';
import { sampleManifestPath } from './sample-manifest';

export type SampleReport = { shareId: string; title: string; city: string; startDate: string; days: number; stops: number; counts: ReturnType<typeof itineraryInsights>['counts']; finding: string; tone: 'bad' | 'good' | 'muted' };
/** Share links are only valid for one database, so the list sits next to it. */
export const sampleListPath = sampleManifestPath;
function featured(): { case: string; shareId: string }[] {
  try { return (JSON.parse(readFileSync(sampleListPath(), 'utf8')) as { reports: { case: string; shareId: string }[] }).reports; } catch { return []; }
}
/** Golden-case reports chosen by `pnpm golden`; other trips are never listed publicly. */
export function sampleReports(): SampleReport[] {
  return featured().flatMap(({ shareId }) => {
    const trip = getSharedTrip(shareId);
    const state = trip && tripState(trip, { completedOnly: true });
    if (!trip || !state?.result) return [];
    const result = recalculateReport(trip, state.result), insights = itineraryInsights(trip, result.judgments, result.dossiers);
    const verdict = tripVerdict(trip, result.judgments, result.dossiers, insights);
    return [{ shareId, title: trip.title, city: trip.destinationCity, startDate: trip.startDate, days: new Set(trip.items.map(i => i.day)).size, stops: trip.items.length, counts: insights.counts, finding: verdict.headline, tone: verdict.tone === 'bad' ? 'bad' as const : verdict.tone === 'good' ? 'good' as const : 'muted' as const }];
  });
}
export const sampleEndDate = (s: SampleReport) => dateForDay(s.startDate, s.days);
