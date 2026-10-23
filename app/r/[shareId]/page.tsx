import { notFound } from 'next/navigation';
import { getSharedTrip, tripState } from '@/lib/store';
import { ReportView } from '@/components/report-view';
import { recalculateReport } from '@/lib/report';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'TripProof · 行程调查报告', robots: { index: false, follow: false } };
export default async function Report({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params, trip = getSharedTrip(shareId); if (!trip) notFound();
  const state = tripState(trip, { completedOnly: true });
  return <ReportView trip={trip} initialResult={state.result ? recalculateReport(trip, state.result) : null} checkedAt={state.run?.completedAt ?? state.run?.createdAt ?? null} updating={state.runs.some(r => r.tripRevision === trip.revision && ['queued','running'].includes(r.status))}/>;
}
