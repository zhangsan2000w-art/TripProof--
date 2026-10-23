'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, RefreshCw, Share2, FileDown, Search, LoaderCircle, ChevronRight, Clock3, MapPin, Layers, ArrowUpRight, CalendarDays, WandSparkles, AlertCircle, FileSearch, Upload, Check, X } from 'lucide-react';
import type { TripState, Item, Judgment, Operation, RunEvent, RunResult, Trip, SearchCall, Alternative } from '@/lib/domain';
import { api } from '@/lib/client';
import { dateForDay, weekdayLabel, localTime } from '@/lib/dates';
import { prepareImages } from '@/lib/images-client';
import { Header } from './brand';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { EvidencePanel, SourceCard } from './evidence-panel';
import { CallLog } from './call-log';
import { Status } from './status';
import { ItineraryOverview, PlanStatus } from './itinerary-overview';
import { alternativeInsight, itemInsight, itineraryInsights } from '@/lib/presentation';

type Preview = { title: string; ops: Operation[]; startDate?: string; trip: Trip; result: RunResult };
export function Workspace({ tripId }: { tripId: string }) {
  const [state, setState] = useState<TripState | null>(null), [error, setError] = useState(''), [actionBusy, setActionBusy] = useState(false), [selected, setSelected] = useState('');
  const [events, setEvents] = useState<RunEvent[]>([]), [tab, setTab] = useState<'itinerary' | 'evidence' | 'log'>('itinerary'), [day, setDay] = useState(0);
  const [dateModal, setDateModal] = useState(false), [newDate, setNewDate] = useState(''), [preview, setPreview] = useState<Preview | null>(null), [noticeModal, setNoticeModal] = useState(false), [noticeText, setNoticeText] = useState(''), [noticeFiles, setNoticeFiles] = useState<File[]>([]), [copied, setCopied] = useState(false);
  const [alternativeModal, setAlternativeModal] = useState(false);
  const [timeModal, setTimeModal] = useState(false), [planStart, setPlanStart] = useState(''), [planEnd, setPlanEnd] = useState('');
  const noticeUpload = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try { const next = await api<TripState>(`/api/trips/${tripId}`); setState(next); setSelected(current => next.trip.items.some(i => i.id === current) ? current : next.trip.items[0]?.id ?? ''); setEvents(current => { const map = new Map([...current, ...next.events].map(e => [e.id, e])); return [...map.values()].sort((a, b) => a.id - b.id); }); }
    catch (error) { setError((error as Error).message); }
  }, [tripId]);
  useEffect(() => { refresh(); }, [refresh]);
  const busy = state?.run?.status === 'queued' || state?.run?.status === 'running';
  useEffect(() => { if (!busy) return; const interval = setInterval(refresh, 2200); return () => clearInterval(interval); }, [busy, refresh]);
  useEffect(() => {
    if (!state?.run || !['queued', 'running'].includes(state.run.status)) return;
    const source = new EventSource(`/api/runs/${state.run.id}/events`);
    source.onmessage = event => {
      try {
        const data: RunEvent = JSON.parse(event.data);
        setEvents(current => current.some(e => e.id === data.id) ? current : [...current, data]);
        if (data.type === 'done' || data.type === 'error') { source.close(); refresh(); }
      } catch { /* The next persisted snapshot restores any missing event. */ }
    };
    source.onerror = () => { refresh(); };
    return () => source.close();
  }, [state?.run?.id, state?.run?.status, refresh]);
  const activeEvents = events.filter(e => e.runId === state?.run?.id);
  const judgments = state?.result?.judgments ?? [];
  const live = new Map(judgments.map(j => [`${j.itemId}:${j.type}`, j]));
  if (busy && state?.run?.kind === 'investigation') for (const e of activeEvents) if (e.type === 'verdict') { const j = e.data as Judgment; live.set(`${j.itemId}:${j.type}`, j); }
  const currentJudgments = [...live.values()];
  const selectedItem = state?.trip.items.find(i => i.id === selected);
  const callMap = new Map<string, SearchCall>();
  for (const d of state?.result?.dossiers ?? []) for (const c of d.calls) callMap.set(c.id, c);
  for (const e of activeEvents) if (e.type === 'search') { const c = e.data as SearchCall; callMap.set(c.id, c); }
  const calls = [...callMap.values()].sort((a, b) => a.calledAt.localeCompare(b.calledAt));
  async function run() {
    setError(''); setActionBusy(true);
    try { await api(`/api/trips/${tripId}/runs`, {}); setEvents([]); await refresh(); } catch (error) { setError((error as Error).message); } finally { setActionBusy(false); }
  }
  async function getPreview(ops: Operation[], title: string, startDate?: string) {
    if (!state) return; setError(''); setActionBusy(true);
    try { const next = await api<{ trip: Trip; result: RunResult }>(`/api/trips/${tripId}/whatif`, { ops, ...(startDate ? { startDate } : {}), revision: state.trip.revision, apply: false }); setDateModal(false); setPreview({ ...next, title, ops, startDate }); }
    catch (error) { setError((error as Error).message); } finally { setActionBusy(false); }
  }
  async function applyPreview() {
    if (!state || !preview) return; setActionBusy(true); setError('');
    try { await api(`/api/trips/${tripId}/whatif`, { ops: preview.ops, ...(preview.startDate ? { startDate: preview.startDate } : {}), revision: state.trip.revision, apply: true }); setPreview(null); setEvents([]); await refresh(); }
    catch (error) { setError((error as Error).message); } finally { setActionBusy(false); }
  }
  async function announcement() {
    setActionBusy(true); setError('');
    try { const images = await prepareImages(noticeFiles); await api(`/api/trips/${tripId}/announcements`, { text: noticeText, images }); setNoticeModal(false); setNoticeFiles([]); setNoticeText(''); setEvents([]); await refresh(); }
    catch (error) { setError((error as Error).message); } finally { setActionBusy(false); }
  }
  async function alternatives() {
    if (!selectedItem) return; setActionBusy(true); setError('');
    try { await api(`/api/trips/${tripId}/alternatives`, { itemId: selectedItem.id }); setEvents([]); setAlternativeModal(true); await refresh(); }
    catch (error) { setError((error as Error).message); } finally { setActionBusy(false); }
  }
  async function copyShare() {
    if (!state) return;
    try { await navigator.clipboard.writeText(`${location.origin}/r/${state.trip.shareId}`); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError('自动复制未完成，可以使用“查看报告”打开并复制地址。'); }
  }
  if (!state) return <><Header/><main className="loading-page">{error ? <div className="error-banner" role="alert">{error}<Link href="/">返回首页</Link></div> : <><LoaderCircle size={28} className="spin"/><p>正在打开调查档案…</p></>}</main></>;
  const { trip, result } = state;
  const currentInsights = itineraryInsights(trip, currentJudgments, result?.dossiers ?? []);
  const previewInsights = preview ? itineraryInsights(preview.trip, preview.result.judgments, preview.result.dossiers) : null;
  const days = [...new Set(trip.items.map(i => i.day))].sort((a, b) => a - b);
  const selectedJudgments = currentJudgments.filter(j => j.itemId === selected);
  const relevantEvents = activeEvents.filter(e => e.type !== 'budget');
  const latest = relevantEvents.at(-1);
  return <><Header><span className="workspace-header-note"><span className={`small-dot ${busy ? 'pulse' : ''}`}/>{busy ? '调查进行中' : '调查档案'}</span><Button variant="outline" size="sm" asChild><Link href="/">新建测试 <ArrowUpRight size={14}/></Link></Button></Header>
    <main className="workspace">
      <div className="workspace-breadcrumb"><Link href="/"><ArrowLeft size={13}/>全部测试</Link><ChevronRight size={12}/><span>行程调查</span><span className="file-number mono">FILE / {trip.id.slice(0, 8).toUpperCase()}</span></div>
      <div className="workspace-title"><div><div className="section-eyebrow">YOUR TRIP, UNDER REVIEW</div><h1>{trip.title}</h1><p><MapPin size={14}/>{trip.destinationCity}<span>·</span><CalendarDays size={14}/>{trip.startDate} 起 · {days.length}天<span>·</span>{trip.items.length}项安排</p></div><div className="workspace-actions"><Button variant="outline" size="sm" onClick={copyShare}>{copied ? <Check size={14}/> : <Share2 size={14}/>} {copied ? '已复制' : '分享报告'}</Button><Button size="sm" asChild><Link href={`/r/${trip.shareId}`} target="_blank"><FileDown size={14}/>查看报告</Link></Button></div></div>
      {error && <div className="error-banner" role="alert"><AlertCircle size={16}/>{error}<button className="icon-button" onClick={() => setError('')} aria-label="关闭错误"><X size={14}/></button></div>}
      {state.run?.status === 'failed' && <div className="error-banner"><AlertCircle size={16}/>{state.run.error}</div>}
      <ItineraryOverview trip={trip} judgments={currentJudgments} dossiers={result?.dossiers ?? []} busy={busy}/>
      <div className={`run-bar ${busy ? 'is-running' : ''}`}><div>{busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}<span>{busy ? state.run?.kind === 'alternatives' ? '正在查找并核实替代场馆' : state.run?.kind === 'announcement' ? '正在为公告寻找独立佐证' : latest?.type === 'search' ? `正在查证：${(latest.data as SearchCall).query}` : '正在核对规则与来源…' : state.run ? `上次检查 ${localTime(state.run.completedAt || state.run.createdAt)}` : '行程已保存，开始一次真实调查'}</span></div><span className="budget-label">搜索 {state.run?.used ?? 0}/{state.run?.limit ?? 40}</span><Button variant="ghost" size="sm" disabled={busy || actionBusy} onClick={run}>{actionBusy ? <LoaderCircle size={13} className="spin"/> : <RefreshCw size={13}/>} {state.run ? '重新检查' : '开始检查'}</Button></div>
      <div className="workspace-toolbar"><div className="day-tabs"><button className={!day ? 'active' : ''} onClick={() => setDay(0)}>全部行程</button>{days.map(d => <button className={day === d ? 'active' : ''} key={d} onClick={() => setDay(d)}>Day {d}</button>)}</div><div className="toolbar-extra"><button disabled={busy || !result} onClick={() => { setNewDate(trip.startDate); setDateModal(true); }}><CalendarDays size={14}/>换个日期</button><button disabled={busy} onClick={() => setNoticeModal(true)}><FileSearch size={14}/>核验公告</button><button onClick={() => setTab(tab === 'log' ? 'itinerary' : 'log')}><Search size={14}/>调用记录 <span>{calls.length}</span></button></div></div>
      <div className="mobile-tabs"><button className={tab === 'itinerary' ? 'active' : ''} onClick={() => setTab('itinerary')}>行程与修复</button><button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>判定与证据</button><button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>调查记录</button></div>
      {tab === 'log' ? <section className="log-panel"><div className="log-panel-heading"><div><span className="section-eyebrow">INVESTIGATION TRAIL</span><h2>每一次搜索，都留有记录。</h2><p>缓存保留原始 RequestId 和检索时间，不伪造新的调用。</p></div><Button variant="outline" size="sm" onClick={() => setTab('itinerary')}>返回行程 <ArrowRight size={14}/></Button></div><CallLog calls={calls}/>{busy && <p className="log-live"><span className="small-dot pulse"/>新的调用将实时出现在这里</p>}</section> : <div className={`workbench ${tab === 'evidence' ? 'show-evidence' : 'show-itinerary'}`}>
        <div className="timeline-panel"><div className="pane-title"><span><Layers size={15}/>行程时间线</span><span>选择安排查看证据 <ArrowRight size={12}/></span></div>
          {days.filter(d => !day || day === d).map(d => <section className="timeline-day" key={d}><div className="timeline-day-heading"><span>DAY {String(d).padStart(2, '0')}</span><strong>{dateForDay(trip.startDate, d)} <small>{weekdayLabel(dateForDay(trip.startDate, d))}</small></strong></div><div className="timeline-items">{trip.items.filter(i => i.day === d).sort((a, b) => a.seq - b.seq).map(item => {
            const js = currentJudgments.filter(j => j.itemId === item.id), insight = itemInsight(item, js, result?.dossiers ?? [], dateForDay(trip.startDate,item.day)), ripples = result?.ripples.filter(r => r.itemId === item.id) ?? [];
            return <div className={`timeline-entry state-${insight.state === 'adjust' ? 'conflict' : insight.state === 'fits' ? 'confirmed' : 'unknown'}`} id={`stop-${item.id}`} key={item.id}><span className="timeline-node"/><button className={`timeline-card ${selected === item.id ? 'selected' : ''}`} onClick={() => { setSelected(item.id); if (window.innerWidth < 850) setTab('evidence'); }}><div className="timeline-card-top"><span className="timeline-time"><Clock3 size={12}/>{item.start ? `${item.start}${item.end ? `—${item.end}` : ''}` : '到达时间未填写'}</span><PlanStatus state={insight.state} busy={busy && !js.length}/></div><div className="timeline-card-name"><h3>{item.placeName}</h3><ChevronRight size={16}/></div><p>{insight.conflicts[0]?.explanation ?? (insight.allDay ? '全天开放' : insight.hours ? `营业 ${insight.hours}` : insight.message)}</p><div className="timeline-card-bottom"><span>{insight.updates.length ? '攻略信息已过时' : '查看营业与预约摘要'}</span><span>查看详情 <ChevronRight size={11}/></span></div></button>{ripples.map((r, n) => <div className="ripple-note" key={n}><span>↳ 需重新确认</span>{r.reason}</div>)}</div>;
          })}</div></section>)}
          {!!result?.suggestions.length && <section className="repair-section"><div className="repair-heading"><span className="repair-icon"><WandSparkles size={18}/></span><div><h2>少改一点，重新走通。</h2><p>以下方案使用已存事实复核，应用前先看变化。</p></div></div>{result.suggestions.map((s, n) => { const after = itineraryInsights({ ...trip, items:s.itemsAfter }, s.judgments, result.dossiers).counts; return <button key={s.id} className="suggestion-card" onClick={() => getPreview(s.ops, s.title)} disabled={actionBusy || busy}><span className="suggestion-number">0{n + 1}</span><span><strong>{s.title}</strong><small>需调整 {currentInsights.counts.adjust} → {after.adjust}处 · 可前往 {after.fits}处 · 待核实 {after.verify}处</small></span><ArrowUpRight size={17}/></button>; })}</section>}
          {!!result?.alternatives.length && <section className="alternatives-section"><h2>同城替代场馆</h2>{result.alternatives.map(a => <AlternativeCard key={a.name} alternative={a} trip={trip}/>)}</section>}
        </div>
        <aside className="detail-panel">{selectedItem && <EvidencePanel key={selectedItem.id} item={selectedItem} judgments={selectedJudgments} dossiers={result?.dossiers ?? []} tripId={tripId} busy={busy || actionBusy} onAlternative={alternatives} onPlanTime={() => { setPlanStart(selectedItem.start || ''); setPlanEnd(selectedItem.end || ''); setTimeModal(true); }}/>}</aside>
      </div>}
      {result?.announcement && <section className="announcement-result"><div><FileSearch size={19}/><h2>{result.announcement.title}</h2><Status verdict={result.announcement.verdict}/></div><p>{result.announcement.explanation}</p><ul>{result.announcement.claims.map((c, i) => <li key={i}>{c}</li>)}</ul>{result.dossiers.flatMap(d=>d.evidence).filter(e=>result.announcement!.evidenceIds.includes(e.id)).slice(0,5).map(e=><SourceCard key={e.id} evidence={e} quotes={result.dossiers.flatMap(d=>d.facts).filter(f=>f.evidenceId===e.id).map(f=>f.quote).slice(0,2)}/>)}</section>}
      <section className="boundary-panel"><div><AlertCircle size={18}/><strong>这份报告的边界</strong></div><p>实时余票、预约库存、排队和实时路况需到官方或地图渠道确认。缺失的计划时段不会被自动补全；未搜到公告不能证明没有临时变化。天气仅代表本次查到的预报。</p></section>
      <footer className="workspace-footer"><span className="mono">TRIPPROOF · EVIDENCE BEFORE CONFIDENCE</span><span>事实来自搜索，日期与时间由代码核对。</span></footer>
    </main>
    {timeModal && selectedItem && <Modal title={`补充「${selectedItem.placeName}」的计划时间`} close={() => setTimeModal(false)}><p className="modal-description">营业时间是景区的规则；这里填写你打算几点到达。预览只用已存事实重新核对，不会搜索，也不会自动应用。</p><label className="modal-field">计划到达<input type="time" value={planStart} onChange={e => setPlanStart(e.target.value)}/></label><label className="modal-field">计划离开（选填）<input type="time" value={planEnd} onChange={e => setPlanEnd(e.target.value)}/></label><div className="modal-actions"><Button disabled={!planStart || actionBusy} onClick={() => { setTimeModal(false); getPreview([{type:'shift',itemId:selectedItem.id,start:planStart,end:planEnd || null}],`核对「${selectedItem.placeName}」的计划时段`); }}>预览时段是否合适</Button></div></Modal>}
    {dateModal && <Modal title="换个日期试试" close={() => setDateModal(false)}><p className="modal-description">只使用已存事实重新计算，不会新增搜索。新日期没有适用证据的检查将保持待确认。</p><label className="modal-field">新的第1天日期<input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}/></label><Button disabled={actionBusy || !newDate} onClick={() => getPreview([], '调整整趟行程的出发日期', newDate)}>{actionBusy ? <LoaderCircle size={16} className="spin"/> : <Search size={16}/>}预览重新判定结果</Button></Modal>}
    {preview && previewInsights && <Modal title="先看变化，再应用" close={() => setPreview(null)}><p className="modal-description">{preview.title}。此预览没有新增搜索，以下按地点统计。</p><div className="preview-stats"><span>需调整 <b>{previewInsights.counts.adjust}</b></span><span>可前往 <b>{previewInsights.counts.fits}</b></span><span>待补时间 <b>{previewInsights.counts.needs_time}</b></span><span>待核实 <b>{previewInsights.counts.verify}</b></span></div><div className="preview-list">{previewInsights.items.map(({item, insight}) => { const before = trip.items.find(i => i.id === item.id); const changed = before?.day !== item.day || before?.start !== item.start || before?.end !== item.end || trip.startDate !== preview.trip.startDate; return <div className={changed ? 'changed' : ''} key={item.id}><strong>{item.placeName}</strong>{changed && <del>Day {before?.day} {before?.start || '未定'}{before?.end ? `—${before.end}` : ''}</del>}<span>{dateForDay(preview.trip.startDate, item.day)} · {item.start || '时间未定'}{item.end ? `—${item.end}` : ''}</span><PlanStatus state={insight.state}/></div>; })}{trip.items.filter(i => !preview.trip.items.some(j => i.id === j.id)).map(i => <div className="removed" key={i.id}><del>{i.placeName}</del><span>将移除</span></div>)}</div><p className="modal-description">仍需确认的名额、交通及缺失时段不会因调整而变成已确认。</p><div className="modal-actions"><Button variant="outline" onClick={() => setPreview(null)}>保留原行程</Button><Button disabled={actionBusy} onClick={applyPreview}>{actionBusy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}应用修改</Button></div></Modal>}
    {noticeModal && <Modal title="核验一份公告" close={() => setNoticeModal(false)}><p className="modal-description">上传微信或场馆公告截图，或粘贴公告文字。系统会另行搜索佐证；截图本身不作为官方身份证明。</p><textarea className="notice-text" value={noticeText} onChange={e => setNoticeText(e.target.value)} placeholder="粘贴公告文字，尽量包含场馆名称、城市和日期…" maxLength={40000}/><input ref={noticeUpload} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={e => setNoticeFiles(Array.from(e.target.files ?? []).slice(0, 6))}/><Button variant="outline" onClick={() => noticeUpload.current?.click()}><Upload size={15}/>{noticeFiles.length ? `已选择${noticeFiles.length}张截图` : '选择公告截图'}</Button><div className="modal-actions"><Button disabled={actionBusy || (!noticeText.trim() && !noticeFiles.length)} onClick={announcement}>{actionBusy ? <LoaderCircle size={16} className="spin"/> : <FileSearch size={16}/>}开始寻找佐证</Button></div></Modal>}
    {alternativeModal && <Modal title="寻找同城替代场馆" close={() => setAlternativeModal(false)}><p className="modal-description">候选场馆会逐一核查开放、时段与预约规则，搜索结果不足时保持待确认。</p>{busy ? <div className="alternative-loading"><LoaderCircle className="spin" size={24}/><p>正在独立核实候选场馆…</p></div> : result?.alternatives.length ? result.alternatives.map(a => <AlternativeCard key={a.name} alternative={a} trip={trip}/>) : <p>未检索到足够证据支持的候选场馆。</p>}<Button variant="outline" onClick={() => setAlternativeModal(false)}>返回调查</Button></Modal>}
  </>;
}
function ShieldIcon() { return <span className="overview-shield">✓</span>; }
function ExternalArrow() { return <ArrowUpRight size={13}/>; }

function AlternativeCard({ alternative, trip }: { alternative: Alternative; trip: Trip }) {
  const view = alternativeInsight(trip, alternative);
  if (!view) return null;
  const source = alternative.dossier.evidence.find(e => e.linkStatus === 'ok');
  return <div className="alternative-card"><div><h3>{alternative.name}</h3><PlanStatus state={view.insight.state}/></div><p>{alternative.reason}</p><p>{view.insight.message}</p>{source && <a href={source.finalUrl || source.url} target="_blank" rel="noopener noreferrer">打开独立核查来源 <ExternalArrow/></a>}<details className="search-scope"><summary>营业、预约与来源详情</summary><EvidencePanel item={view.item} judgments={alternative.judgments} dossiers={[alternative.dossier]}/></details></div>;
}
