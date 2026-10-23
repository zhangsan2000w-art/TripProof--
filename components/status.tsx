import { Check, CircleHelp, AlertTriangle, LoaderCircle } from 'lucide-react';
import type { Verdict } from '@/lib/domain';
import { statusLabels } from '@/lib/utils';
export function Status({ verdict, busy = false, compact = false }: { verdict: Verdict; busy?: boolean; compact?: boolean }) {
  const Icon = busy ? LoaderCircle : verdict === 'confirmed' ? Check : verdict === 'conflict' ? AlertTriangle : CircleHelp;
  return <span className={`status status-${busy ? 'pending' : verdict}`}><Icon size={compact ? 13 : 14} className={busy ? 'spin' : ''}/>{busy ? '调查中' : statusLabels[verdict]}</span>;
}
export function itemVerdict(judgments: { verdict: Verdict }[]): Verdict { return judgments.some(j => j.verdict === 'conflict') ? 'conflict' : !judgments.length || judgments.some(j => j.verdict === 'unknown') ? 'unknown' : 'confirmed'; }
