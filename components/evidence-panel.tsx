'use client';
import { useState } from 'react';
import { ExternalLink, ThumbsUp, ThumbsDown, ChevronDown, Link2, FileSearch, AlertCircle, Clock3, Search } from 'lucide-react';
import type { Dossier, Evidence, Judgment, Item } from '@/lib/domain';
import { localTime, today } from '@/lib/dates';
import { basisLabels, itemInsight, tierLabels, type ItemInsight, type RuleHighlight } from '@/lib/presentation';
import { api } from '@/lib/client';
import { Status } from './status';

export { tierLabels };
export const checkLabels: Record<Judgment['type'], string> = { open_on_date: '当天是否开放', hours_fit: '开放与入场时段', reservation_rule: '预约规则', availability: '实时名额与库存', arrival_fit: '抵达与离开边界', service_hours: '交通运营时段', weather: '行程当天天气', safety: '预警与区域公告', guide_claim: '攻略信息是否过时', connection_fit: '与前一站的交通衔接' };

export function SourceCard({ evidence, quotes = [], overruled = false }: { evidence: Evidence; quotes?: string[]; overruled?: boolean }) {
  const href = evidence.finalUrl || evidence.url;
  return <article className={`source-card ${overruled ? 'source-overruled' : ''}`}>
    <div className="source-heading"><span className={`tier tier-${evidence.tier}`}>{tierLabels[evidence.tier]}</span>{overruled && <span className="overruled-label">未采纳</span>}<span className="source-domain">{evidence.site}</span></div>
    <a className="source-title" href={href} target="_blank" rel="noopener noreferrer">{evidence.title || evidence.site}<ExternalLink size={12}/></a>
    {quotes.map((q, i) => <blockquote key={i}>{q}</blockquote>)}
    <div className="source-meta"><span className={`link-state link-${evidence.linkStatus}`}><Link2 size={11}/>{evidence.linkStatus === 'ok' ? '链接已验证' : evidence.linkStatus === 'browser_only' ? '需在浏览器打开核实' : '链接检查未通过'}</span><span>发布 {evidence.publishedAt || '未注明'}</span><span>检索 {localTime(evidence.retrievedAt, true)}</span></div>
  </article>;
}
export function BasisTag({ rule }: { rule: RuleHighlight }) {
  if (!rule.basis) return null;
  return <span className={`basis basis-${rule.basis}`} title={rule.basis === 'consensus' ? '至少两个互相独立的来源说法一致' : rule.basis === 'reference' ? '只查到个别来源，出发前再确认' : undefined}>{basisLabels[rule.basis]}</span>;
}
export function RuleGrid({ rules, className = '' }: { rules: RuleHighlight[]; className?: string }) {
  return <dl className={`item-rule-grid ${className}`}>{rules.map(rule => <div className={`item-rule ${rule.verified ? 'rule-verified' : ''} ${rule.tone ? `rule-${rule.tone}` : ''}`} key={rule.label}>
    <dt>{rule.label}</dt><dd><strong>{rule.value}</strong><BasisTag rule={rule}/></dd>{rule.note && <small title={rule.note}>{rule.note}</small>}
  </div>)}</dl>;
}
/** The guide's claim next to the current rule, kept apart from schedule conflicts. */
export function GuideUpdate({ item, insight }: { item: Item; insight: ItemInsight }) {
  if (!insight.updates.length) return null;
  const claim = insight.staleClaims.join('、') || item.claimedRules.filter(c => c.kind === 'hours').map(c => c.text.replace(/^(?:开放|营业)(?:时间)?[:：]\s*/, '')).join('；');
  return <div className="rule-update"><span>攻略信息已过时</span><p>攻略写 <s>{claim}</s> → 现行 <b>{insight.hours ? insight.allDay ? '全天开放' : insight.hours : '规则见上方'}</b></p></div>;
}
export function KeySources({ insight }: { insight: ItemInsight }) {
  if (!insight.citations.length) return null;
  return <>
    <div className="key-sources"><span>依据</span>{insight.citations.slice(0, 3).map(({ evidence: e }) => <a key={e.url} href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer"><i className={`tier-dot tier-${e.tier}`}/>{e.title || e.site}<ExternalLink size={11}/></a>)}</div>
    <div className="print-evidence">{insight.citations.slice(0, 2).map(({ evidence: e, quote }) => <p key={e.url}><q>{quote}</q> {e.title} · {e.finalUrl || e.url}</p>)}</div>
  </>;
}
/** The per-check audit trail: each check, its sources and the searched scope. */
export function EvidenceAudit({ item, judgments, dossiers, tripId, shareId, label = '查看核验详情与来源' }: { item: Item; judgments: Judgment[]; dossiers: Dossier[]; tripId?: string; shareId?: string; label?: string }) {
  const [votes, setVotes] = useState<Record<string, number>>({}), [message, setMessage] = useState('');
  const evidence = dossiers.flatMap(d => d.evidence), facts = dossiers.flatMap(d => d.facts);
  const cited = new Set(judgments.flatMap(j => [...j.evidenceIds, ...facts.filter(f => [...j.factIds, ...j.overruledFactIds].includes(f.id)).map(f => f.evidenceId)]));
  const otherSources = [...new Map(dossiers.filter(d => judgments.some(j => j.venueId === d.venue.id) && !d.venue.key.startsWith('risk:')).flatMap(d => d.evidence).filter(e => !cited.has(e.id)).map(e => [e.url, e])).values()];
  const sources = [...new Map(evidence.filter(e => cited.has(e.id)).map(e => [e.url, e])).values()].sort((a, b) => a.tier - b.tier);
  async function vote(judgmentId: string, value: number) {
    try { await api('/api/feedback', { judgmentId, vote: value, ...(shareId ? { shareId } : { tripId }) }); setVotes(v => ({ ...v, [judgmentId]: value })); setMessage('已记录你的反馈'); }
    catch (error) { setMessage((error as Error).message); }
  }
  const order = ['safety', 'open_on_date', 'hours_fit', 'reservation_rule', 'service_hours', 'guide_claim', 'weather', 'arrival_fit', 'connection_fit', 'availability'];
  return <details className="evidence-audit" data-audit><summary><FileSearch size={14}/>{label}<span>{judgments.length} 项检查 · {sources.length} 个引用来源</span><ChevronDown size={14} className="chev"/></summary>
    <div className="audit-body">
      {[...judgments].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)).map(j => {
        const currentFacts = facts.filter(f => j.factIds.includes(f.id)), overruled = facts.filter(f => j.overruledFactIds.includes(f.id));
        const links = [...new Map([...new Set([...j.evidenceIds, ...currentFacts.map(f => f.evidenceId), ...overruled.map(f => f.evidenceId)])].flatMap(eid => { const e = evidence.find(e => e.id === eid); return e ? [[e.url, e] as const] : []; })).values()];
        return <details className="judgment" key={j.id}>
          <summary><span>{checkLabels[j.type]}</span><Status verdict={j.verdict} compact/><ChevronDown size={13} className="chev"/></summary>
          <div className="judgment-content"><p className="judgment-explanation">{j.explanation}</p>{j.notes.filter(Boolean).map((n, index) => <p className="judgment-note" key={index}><AlertCircle size={12}/>{n}</p>)}
            {links.length > 0 && <p className="inline-citations">{links.map(e => <a key={e.url} href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer">{e.title || e.site}<ExternalLink size={11}/></a>)}</p>}
            {!links.length && <p className="no-source">{j.type === 'arrival_fit' ? '依据：你填写的抵离与计划时间。' : j.reasonCode === 'REALTIME' ? '实时库存不能靠网页搜索证明，请到官方渠道查看。' : '这一项暂时没有能支持结论的来源。'}</p>}
            {j.searchedScope.length > 0 && <details className="search-scope"><summary><Search size={11}/>已检索范围（{j.searchedScope.length}）</summary><ul>{j.searchedScope.map((q, i) => <li key={i}>{q}</li>)}</ul></details>}
            {(tripId || shareId) && <div className="vote-buttons"><span>这条判定有帮助吗</span><button className={votes[j.id] === 1 ? 'voted' : ''} aria-label="这条判定有帮助" onClick={() => vote(j.id, 1)}><ThumbsUp size={13}/></button><button className={votes[j.id] === -1 ? 'voted' : ''} aria-label="这条判定没帮助" onClick={() => vote(j.id, -1)}><ThumbsDown size={13}/></button></div>}
          </div>
        </details>;
      })}
      {sources.length > 0 && <section className="deduplicated-sources"><h4>引用来源</h4>{sources.map(e => <SourceCard key={e.url} evidence={e} quotes={[...new Set(facts.filter(f => evidence.some(other => other.id === f.evidenceId && other.url === e.url) && judgments.some(j => j.factIds.includes(f.id) || j.overruledFactIds.includes(f.id))).map(f => f.quote))].slice(0, 3)}/>)}</section>}
      {otherSources.length > 0 && <details className="search-scope other-sources no-print"><summary>其他已检查但未采用的来源（{otherSources.length}）</summary><p className="no-source">搜索命中不代表证据足够；这些资料没有用来确认本项规则。</p>{otherSources.map(e => <SourceCard key={e.id} evidence={e}/>)}</details>}
      {message && <p className="feedback-message no-print" role="status">{message}</p>}
    </div>
  </details>;
}
/** Workspace side panel for the selected stop. */
export function EvidencePanel({ item, judgments, dossiers, tripId, shareId, onAlternative, onPlanTime, busy }: { item: Item; judgments: Judgment[]; dossiers: Dossier[]; tripId?: string; shareId?: string; onAlternative?: () => void; onPlanTime?: () => void; busy?: boolean }) {
  const insight = itemInsight(item, judgments, dossiers, judgments[0]?.date || today());
  return <div className="evidence-panel">
    <div className="panel-heading"><span className="kicker">地点详情</span><h2>{item.placeName}</h2><p>{item.start ? `计划 ${item.start}${item.end ? `—${item.end}` : ' 到达'}` : '攻略没写到达时间'}{item.activity ? ` · ${item.activity}` : ''}</p></div>
    {!judgments.length && <div className="empty-evidence"><FileSearch size={26}/><h3>{busy ? '正在为这一站查找证据' : '还没有检查结果'}</h3><p>规则和来源通过核验后，结论会显示在这里。</p></div>}
    {!!judgments.length && <>
      <p className={`stop-takeaway tone-${insight.state}`}>{insight.message}</p>
      <RuleGrid rules={insight.rules}/>
      {onPlanTime && <button className="plan-time-button no-print" onClick={onPlanTime} disabled={busy}><Clock3 size={14}/>{item.start ? '修改计划到达时间' : '补充计划到达时间'}</button>}
      <GuideUpdate item={item} insight={insight}/>
      <KeySources insight={insight}/>
      <EvidenceAudit item={item} judgments={judgments} dossiers={dossiers} tripId={tripId} shareId={shareId}/>
    </>}
    {onAlternative && <button className="alternative-button" onClick={onAlternative} disabled={busy}><FileSearch size={15}/>查找同城替代场馆</button>}
  </div>;
}
