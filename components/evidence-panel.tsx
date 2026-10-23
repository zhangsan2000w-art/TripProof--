'use client';
import { useState } from 'react';
import { ExternalLink, Quote, ThumbsUp, ThumbsDown, ChevronDown, Link2, FileSearch, AlertCircle } from 'lucide-react';
import type { Dossier, Evidence, Judgment, Item } from '@/lib/domain';
import { localTime, today } from '@/lib/dates';
import { basisLabels, itemInsight, type RuleHighlight } from '@/lib/presentation';
import { api } from '@/lib/client';
import { Status } from './status';

export const checkLabels: Record<Judgment['type'], string> = { open_on_date: '当天是否开放', hours_fit: '开放与入场时段', reservation_rule: '预约规则', availability: '实时名额与库存', arrival_fit: '抵达与离开边界', service_hours: '交通运营时段', weather: '行程当天天气', guide_claim: '攻略信息是否过时', connection_fit:'与前一站的交通衔接' };
export const tierLabels = ['', '官方来源', '权威来源', '平台参考', '普通网页'];
export function SourceCard({ evidence, quotes = [], overruled = false }: { evidence: Evidence; quotes?: string[]; overruled?: boolean }) {
  return <article className={`source-card ${overruled ? 'source-overruled' : ''}`}>
    <div className="source-heading"><span className={`source-tier tier-${evidence.tier}`}>{tierLabels[evidence.tier]}</span>{overruled && <span className="overruled-label">未采纳</span>}<a href={evidence.finalUrl || evidence.url} target="_blank" rel="noopener noreferrer" title="打开原始来源" aria-label={`打开来源：${evidence.title}`}><ExternalLink size={14}/></a></div>
    <a className="source-title" href={evidence.finalUrl || evidence.url} target="_blank" rel="noopener noreferrer">{evidence.title || evidence.site}</a>
    <p className="source-domain">{evidence.site}</p>
    {quotes.map((q, i) => <blockquote key={i}><Quote size={13}/><mark>{q}</mark></blockquote>)}
    <div className={`link-state link-${evidence.linkStatus}`}><Link2 size={12}/>{evidence.linkStatus === 'ok' ? '链接已验证' : evidence.linkStatus === 'browser_only' ? '需在浏览器核实' : '链接检查未通过'} · {localTime(evidence.linkCheckedAt, true)}</div>
    <div className="source-dates">发布：{evidence.publishedAt || '未注明'}<br/>检索：{localTime(evidence.retrievedAt)}</div>
  </article>;
}
export function BasisTag({ rule }: { rule: RuleHighlight }) {
  if (!rule.basis) return null;
  return <span className={`basis-tag basis-${rule.basis}`} title={rule.basis === 'consensus' ? '至少两个互相独立的平台说法一致' : rule.basis === 'reference' ? '只查到个别来源，出发前再确认' : undefined}>{basisLabels[rule.basis]}</span>;
}
export function RuleGrid({ rules, className = '' }: { rules: RuleHighlight[]; className?: string }) {
  return <dl className={`item-rule-grid ${className}`}>{rules.map(rule => <div className={`item-rule ${rule.verified ? 'rule-verified' : ''} ${rule.tone ? `rule-${rule.tone}` : ''}`} key={rule.label}>
    <dt>{rule.label}</dt><dd><strong>{rule.value}</strong><BasisTag rule={rule}/></dd>{rule.note && <small title={rule.note}>{rule.note}</small>}
  </div>)}</dl>;
}
/** The per-dimension audit trail: each check, its sources and the searched scope. */
export function EvidenceAudit({ item, judgments, dossiers, tripId, shareId, label = '查看核验详情与来源' }: { item: Item; judgments: Judgment[]; dossiers: Dossier[]; tripId?: string; shareId?: string; label?: string }) {
  const [votes, setVotes] = useState<Record<string, number>>({}), [message, setMessage] = useState('');
  const evidence = dossiers.flatMap(d => d.evidence), facts = dossiers.flatMap(d => d.facts);
  const cited = new Set(judgments.flatMap(j => [...j.evidenceIds, ...facts.filter(f => [...j.factIds, ...j.overruledFactIds].includes(f.id)).map(f => f.evidenceId)]));
  const otherSources = [...new Map(dossiers.filter(d => judgments.some(j => j.venueId === d.venue.id)).flatMap(d => d.evidence).filter(e => !cited.has(e.id)).map(e => [e.id, e])).values()];
  const sources = [...new Map(evidence.filter(e => cited.has(e.id)).map(e => [e.url, e])).values()].sort((a, b) => a.tier - b.tier);
  async function vote(judgmentId: string, value: number) {
    try { await api('/api/feedback', { judgmentId, vote: value, ...(shareId ? { shareId } : { tripId }) }); setVotes(v => ({ ...v, [judgmentId]: value })); setMessage('已记录你的反馈'); }
    catch (error) { setMessage((error as Error).message); }
  }
  return <details className="evidence-audit" data-audit><summary>{label} <span>{sources.length} 个引用来源</span><ChevronDown size={14}/></summary>
    <p className="audit-intro">以下按核验维度列出 {item.placeName} 的判断；同一来源在下方只展示一次。实时库存与未填时间不代表营业规则没有查到。</p>
    {judgments.map(j => {
      const currentFacts = facts.filter(f => j.factIds.includes(f.id)), overruled = facts.filter(f => j.overruledFactIds.includes(f.id));
      const ids = [...new Set([...j.evidenceIds, ...currentFacts.map(f => f.evidenceId), ...overruled.map(f => f.evidenceId)])];
      return <details className="judgment" key={j.id}>
        <summary><span>{checkLabels[j.type]}</span><Status verdict={j.verdict} compact/><ChevronDown size={14} className="details-chevron"/></summary>
        <div className="judgment-content"><p className="judgment-explanation">{j.explanation}</p>{j.notes.map((n, index) => <p className="judgment-note" key={index}><AlertCircle size={13}/>{n}</p>)}
          {ids.length > 0 && <p className="inline-citations">{[...new Map(ids.flatMap(eid => { const e = evidence.find(e => e.id === eid); return e ? [[e.url, e] as const] : []; })).values()].map(e => <a key={e.url} href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer">{e.title}<ExternalLink size={11}/></a>)}</p>}
          {!ids.length && <p className="no-source">{j.type === 'arrival_fit' ? '依据：你填写的抵离与计划时间。' : j.reasonCode === 'REALTIME' ? '该项属于实时信息边界，网页搜索不能证明当前库存。' : '本项暂没有可以支持结论的来源。'}</p>}
          {j.searchedScope.length > 0 && <details className="search-scope"><summary>查看已检索范围</summary><ul>{j.searchedScope.map((q, i) => <li key={i}>{q}</li>)}</ul></details>}
          <div className="judgment-footer">{(tripId || shareId) && <div className="vote-buttons"><span>有帮助吗</span><button className={votes[j.id] === 1 ? 'voted' : ''} aria-label="这条判定有帮助" onClick={() => vote(j.id, 1)}><ThumbsUp size={13}/></button><button className={votes[j.id] === -1 ? 'voted' : ''} aria-label="这条判定没帮助" onClick={() => vote(j.id, -1)}><ThumbsDown size={13}/></button></div>}</div>
        </div>
      </details>;
    })}
    {sources.length > 0 && <section className="deduplicated-sources"><h3>引用来源</h3>{sources.map(e => <SourceCard key={e.url} evidence={e} quotes={[...new Set(facts.filter(f => cited.has(f.evidenceId) && evidence.some(other => other.id === f.evidenceId && other.url === e.url)).map(f => f.quote))].slice(0, 3)}/>)}</section>}
    {otherSources.length > 0 && <details className="search-scope no-print"><summary>其他已检查来源（{otherSources.length}）</summary><p className="no-source">以下资料未用于确认本项规则，可检查链接状态及原文。搜索命中本身不代表证据足够。</p>{otherSources.map(e => <SourceCard key={e.id} evidence={e}/>)}</details>}
    {message && <p className="feedback-message no-print" role="status">{message}</p>}
  </details>;
}
export function EvidencePanel({ item, judgments, dossiers, tripId, shareId, onAlternative, onPlanTime, busy }: { item: Item; judgments: Judgment[]; dossiers: Dossier[]; tripId?: string; shareId?: string; onAlternative?: () => void; onPlanTime?: () => void; busy?: boolean }) {
  const insight = itemInsight(item, judgments, dossiers, judgments[0]?.date || today());
  return <div className="evidence-panel">
    <div className="panel-heading"><span className="section-eyebrow">EVIDENCE FILE</span><h2>{item.placeName}</h2><p>{item.activity || '行程规则核验'}</p></div>
    {!judgments.length && <div className="empty-evidence"><FileSearch size={28}/><h3>{busy ? '正在为这项安排查找证据' : '还没有检查结果'}</h3><p>结论会在规则与来源通过核验后显示。</p></div>}
    {!!judgments.length && <>
      <RuleGrid rules={insight.rules}/>
      <p className={`item-takeaway takeaway-${insight.state}`}>{insight.message}</p>
      {onPlanTime && <button className="plan-time-button no-print" onClick={onPlanTime} disabled={busy}>{item.start ? '修改计划到达时间' : '补充计划到达时间'} <ChevronDown size={13}/></button>}
      {insight.updates.length > 0 && <div className="rule-update"><span>攻略信息已过时</span><p>攻略写「{insight.staleClaims.join('、') || item.claimedRules.filter(c => c.kind === 'hours').map(c => c.text).join('；')}」<b> → </b>{insight.hours ? `现行营业时间 ${insight.allDay ? '全天开放' : insight.hours}` : insight.updates[0].explanation}</p><small>这是攻略与现行规则的差异，不表示你的实际到达时间已经冲突。</small></div>}
      {insight.citations.length > 0 && <div className="key-sources">依据：{insight.citations.slice(0, 2).map(({ evidence: e }) => <a key={e.url} href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer">{e.tier <= 2 ? '✓ ' : ''}{e.title}<ExternalLink size={11}/></a>)}</div>}
      <div className="print-evidence">{insight.citations.slice(0, 2).map(({ evidence: e, quote }) => <p key={e.url}><q>{quote}</q> <a href={e.finalUrl || e.url}>{e.title}</a> · 检索 {localTime(e.retrievedAt)}</p>)}</div>
      <EvidenceAudit item={item} judgments={judgments} dossiers={dossiers} tripId={tripId} shareId={shareId}/>
    </>}
    {onAlternative && <button className="alternative-button" onClick={onAlternative} disabled={busy}><FileSearch size={16}/> 查找同城替代场馆 <ExternalLink size={13}/></button>}
  </div>;
}
