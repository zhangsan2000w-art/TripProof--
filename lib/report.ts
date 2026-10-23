import type { Dossier, RunResult, Trip } from './domain';
import { cachedLinkCheck, checkLink } from './evidence';
import { mapLimit } from './concurrency';
import { judgeItem, judgeTrip } from './judge';
import { rippleEffects, suggestions } from './impact';
import { supportedDossierFacts } from './facts';

export function recalculateReport(trip: Trip, stored: RunResult): RunResult {
  const result = structuredClone(stored);
  for (const dossier of [...result.dossiers, ...result.alternatives.map(a => a.dossier)]) dossier.facts = supportedDossierFacts(dossier);
  result.judgments = judgeTrip(trip, result.dossiers);
  result.ripples = rippleEffects(trip, result.judgments);
  result.suggestions = suggestions(trip, result.dossiers, result.judgments);
  for (const alternative of result.alternatives) {
    const target = trip.items.find(item => item.id === alternative.itemId);
    if (!target) { alternative.judgments = []; continue; }
    const item = { ...target, id: alternative.judgments[0]?.itemId ?? `alt-${target.id}`, placeName: alternative.name, sourceText: alternative.name, claimedRules: [], dependsOn: [] };
    alternative.judgments = judgeItem(item, trip, alternative.dossier);
  }
  if (result.announcement?.verdict === 'confirmed' && result.announcement.evidenceIds.some(id => !result.dossiers.some(d => d.facts.some(f => f.evidenceId === id && f.linkStatus === 'ok')))) {
    result.announcement.verdict = 'unknown';
    result.announcement.explanation = '部分原有佐证未通过当前的适用范围或来源核验，公告说法需再次向官方确认。';
  }
  return result;
}

/** Recheck every source represented in the report before recalculating it. */
export async function refreshReportLinks(trip: Trip, stored: RunResult, checker = checkLink): Promise<RunResult> {
  const result = structuredClone(stored);
  const dossiers: Dossier[] = [...result.dossiers, ...result.alternatives.map(a => a.dossier)];
  const urls = [...new Set(dossiers.flatMap(d => d.evidence.map(e => e.url)))];
  const checks = new Map(await mapLimit(urls, 8, async url => [url, await checker(url, true)] as const));
  for (const dossier of dossiers) {
    for (const evidence of dossier.evidence) {
      const checked = checks.get(evidence.url);
      if (checked) { evidence.linkStatus = checked.linkStatus; evidence.linkCheckedAt = checked.checkedAt; evidence.finalUrl = checked.finalUrl; }
    }
    for (const fact of dossier.facts) {
      const evidence = dossier.evidence.find(e => e.id === fact.evidenceId);
      // Orphaned facts cannot retain a successful link check.
      fact.linkStatus = evidence?.linkStatus ?? 'broken';
    }
  }
  const announcement = result.announcement;
  if (announcement?.verdict === 'confirmed') {
    const evidence = dossiers.flatMap(d => d.evidence);
    if (!announcement.evidenceIds.length || announcement.evidenceIds.some(id => evidence.find(e => e.id === id)?.linkStatus !== 'ok')) {
      announcement.verdict = 'unknown';
      announcement.explanation = '打印前重新核查时，公告的部分佐证来源无法访问；原有引文保留，公告说法需再次向官方确认。';
    }
  }
  return recalculateReport(trip, result);
}

/** Accept feedback for both the stored view and the link-rechecked print view. */
export async function reportFeedbackIds(trip:Trip,stored:RunResult):Promise<Set<string>> {
  const current=recalculateReport(trip,stored);
  const printed=await refreshReportLinks(trip,stored,async url=>{
    const cached=cachedLinkCheck(url);if(cached)return cached;
    const original=stored.dossiers.flatMap(d=>d.evidence).find(e=>e.url===url);
    return {linkStatus:original?.linkStatus??'broken',checkedAt:original?.linkCheckedAt??'',finalUrl:original?.finalUrl??url,text:'',sha256:original?.pageSha256??null};
  });
  return new Set([...stored.judgments,...current.judgments,...printed.judgments].map(j=>j.id));
}
