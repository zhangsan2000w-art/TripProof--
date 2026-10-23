import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getSharedTrip, tripState } from './store';
import { recalculateReport } from './report';
import { itineraryInsights } from './presentation';
import { dateForDay } from './dates';

export type SampleReport = { shareId: string; title: string; city: string; startDate: string; days: number; stops: number; counts: ReturnType<typeof itineraryInsights>['counts']; finding: string; tone: 'bad' | 'good' | 'muted' };
/** Share links are only valid for one database, so the list sits next to it. */
export const sampleListPath = () => resolve(dirname(resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || '.data/tripproof.db')), 'sample-reports.json');
function featured(): { case: string; shareId: string }[] {
  try { return (JSON.parse(readFileSync(sampleListPath(), 'utf8')) as { reports: { case: string; shareId: string }[] }).reports; } catch { return []; }
}
/** Golden-case reports chosen by `pnpm golden`; other trips are never listed publicly. */
export function sampleReports(): SampleReport[] {
  return featured().flatMap(({ shareId }) => {
    const trip = getSharedTrip(shareId);
    const state = trip && tripState(trip, { completedOnly: true });
    if (!trip || !state?.result) return [];
    const result = recalculateReport(trip, state.result), { counts, items } = itineraryInsights(trip, result.judgments, result.dossiers);
    const adjust = items.filter(i => i.insight.state === 'adjust'), mostlyUnknown = counts.verify * 2 >= trip.items.length;
    const finding = adjust.length ? `${[...new Set(adjust.map(i => i.item.placeName))].slice(0, 2).join('、')}${adjust.length > 2 ? ' 等' : ''}：${adjust[0].insight.conflicts[0]?.reasonCode === 'CLOSED_WEEKLY' ? '当天闭馆，去了会扑空' : '安排需要调整'}`
      : mostlyUnknown ? `${counts.verify} 处没查到可靠规则，报告如实标出“待核实”` : `${counts.fits} 处当天可直接前往，${counts.needs_time + counts.verify} 处还要补时间或确认`;
    return [{ shareId, title: trip.title, city: trip.destinationCity, startDate: trip.startDate, days: new Set(trip.items.map(i => i.day)).size, stops: trip.items.length, counts, finding, tone: adjust.length ? 'bad' as const : mostlyUnknown ? 'muted' as const : 'good' as const }];
  });
}
export const sampleEndDate = (s: SampleReport) => dateForDay(s.startDate, s.days);
