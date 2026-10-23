import { AlertTriangle, Check, Clock3, CircleHelp, ArrowUpRight } from 'lucide-react';
import type { Dossier, Judgment, TripInput } from '@/lib/domain';
import { itineraryInsights, planHints, planLabels, type PlanState } from '@/lib/presentation';

export function PlanStatus({ state, busy = false }: { state: PlanState; busy?: boolean }) {
  const Icon = state === 'adjust' ? AlertTriangle : state === 'fits' ? Check : state === 'needs_time' ? Clock3 : CircleHelp;
  return <span className={`plan-status plan-${state}`}><Icon size={14}/>{busy ? '核验中' : planLabels[state]}</span>;
}
export function ItineraryOverview({ trip, judgments, dossiers, busy = false }: { trip: TripInput; judgments: Judgment[]; dossiers: Dossier[]; busy?: boolean }) {
  const { counts, missingTimes, updates, items } = itineraryInsights(trip, judgments, dossiers);
  const title = busy ? '正在核对你的行程…' : counts.adjust ? `${counts.adjust} 处安排需要调整` : counts.verify * 2 >= trip.items.length ? `${counts.verify} 个地点没查到可靠规则，出发前逐一确认` : counts.fits === trip.items.length ? '按查到的规则，这趟行程走得通' : counts.needs_time ? '规则已查到，补上到达时间再核对一遍' : `大部分安排已核实，${counts.verify} 处出发前再确认`;
  return <section className="itinerary-overview" aria-label="行程结论总览">
    <div className="overview-heading"><div><span className="section-eyebrow">行程结论</span><h2>{title}</h2></div><span className="overview-stops">{trip.items.length}<small>项安排</small></span></div>
    <div className="outcome-counts">{(['adjust', 'fits', 'needs_time', 'verify'] as const).map(state => <div className={`outcome-count plan-${state}`} key={state}><strong>{counts[state]}</strong><span>{planLabels[state]}</span></div>)}</div>
    <p className="overview-context">{missingTimes ? `${missingTimes} 项未填到达时间；全天开放的地点不受影响，其余补上时间才能判断是否来得及。` : '逐站核对营业时段，交通衔接仍需结合实际情况确认。'}{updates > 0 && ` ${updates} 处攻略信息已过时，已按现行规则核对，见对应地点的蓝色提示。`}</p>
    <details className="status-guide no-print"><summary>这几个状态怎么区分？</summary><dl>{(['adjust', 'fits', 'needs_time', 'verify'] as const).map(state => <div key={state}><dt>{planLabels[state]}</dt><dd>{planHints[state]}</dd></div>)}<div><dt>来源标签</dt><dd>官方：政府或场馆官网；权威来源：主流媒体或场馆自有网站；多源一致：至少两个独立平台说法相同；仅供参考：只查到个别来源。</dd></div></dl></details>
    {counts.adjust > 0 && <div className="priority-actions">{items.filter(i => i.insight.state === 'adjust').slice(0, 3).map(({ item, insight }) => <a key={item.id} href={`#stop-${item.id}`}><AlertTriangle size={16}/><span><strong>{item.placeName}</strong>{insight.conflicts[0].explanation}</span><ArrowUpRight size={15}/></a>)}</div>}
  </section>;
}
