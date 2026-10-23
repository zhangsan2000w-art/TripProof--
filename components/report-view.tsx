'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Printer, Share2, Check, Download, ArrowUpRight, FileSearch, AlertCircle, LoaderCircle, AlertTriangle, Ticket, Clock3, CircleHelp, ChevronDown, Bus, Siren, Route } from 'lucide-react';
import type { Trip, RunResult, Judgment, Item, GuideSummary } from '@/lib/domain';
import { GuideCard, GuideViewer, StopSource } from './guide-view';
import { Header } from './brand';
import { Button } from './ui/button';
import { EvidenceAudit, GuideUpdate, KeySources, RuleGrid, SourceCard, checkLabels } from './evidence-panel';
import { Status } from './status';
import { CallLog } from './call-log';
import { dateForDay, localTime, weekdayLabel } from '@/lib/dates';
import { statusLabels } from '@/lib/utils';
import { api } from '@/lib/client';
import { alternativeInsight, itineraryInsights, safetyDriven, tripVerdict, usefulSuggestions, type ItemInsight, type PlanState } from '@/lib/presentation';
import { DayAlert, DayHead, NoticeList, PlanStatus, ProofLine, StatusBar, VerdictCard, dayViews, kindLabels, monthDay } from './trip-ui';

type Todo = { tone: 'bad' | 'warn' | 'info' | 'muted'; title: string; text: string; href?: string; icon: typeof AlertTriangle };

export function ReportView({ trip, initialResult, checkedAt, updating = false, guide = null }: { trip: Trip; initialResult: RunResult | null; checkedAt: string | null; updating?: boolean; guide?: GuideSummary | null }) {
  const [viewing, setViewing] = useState<number | null>(null), images = guide?.images ?? [];
  const [copied, setCopied] = useState(false), [printing, setPrinting] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(initialResult);
  const [day, setDay] = useState(0), [filter, setFilter] = useState<'all' | PlanState>('all'), [includeEvidence, setIncludeEvidence] = useState(false), [open, setOpen] = useState<Set<string>>(new Set());
  const calls = [...new Map((result?.dossiers.flatMap(d => d.calls) ?? []).map(c => [c.id, c])).values()];
  const judgments = result?.judgments ?? [], dossiers = result?.dossiers ?? [];
  const insights = itineraryInsights(trip, judgments, dossiers);
  const verdict = tripVerdict(trip, judgments, dossiers, insights);
  const days = [...new Set(trip.items.map(i => i.day))].sort((a, b) => a - b);
  const views = dayViews(days, trip.startDate, judgments, dossiers, dateForDay);
  const visible = insights.items.filter(({ item, insight }) => (!day || item.day === day) && (filter === 'all' || insight.state === filter));
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  async function share() { try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('请复制浏览器地址栏中的报告链接。'); } }
  async function print() {
    setPrinting(true); setError(''); setDay(0); setFilter('all');
    try {
      if (result) { const refreshed = await api<{ result: RunResult }>(`/api/reports/${trip.shareId}/links`, {}); setResult(refreshed.result); }
      setTimeout(() => {
        const details = Array.from(document.querySelectorAll<HTMLDetailsElement>('.evidence-audit, .evidence-audit details, .report-appendix, .report-appendix details'));
        const previous = details.map(d => d.open);
        if (includeEvidence) details.forEach(d => d.open = true);
        window.print(); details.forEach((d, i) => d.open = previous[i]); setPrinting(false);
      }, 350);
    } catch (error) { setPrinting(false); setError((error as Error).message); }
  }
  const cards: Judgment[] = [];
  for (const v of ['conflict', 'confirmed', 'unknown'] as const) { const j = judgments.find(j => j.verdict === v && j.type !== 'arrival_fit'); if (j) cards.push(j); }
  const { counts } = insights;
  // Days in a row with the same notices share one block.
  const notices: (typeof views)[] = [];
  for (const v of views.filter(v => v.weather.notices.length && v.weather.blocked + v.weather.alerted > 0)) {
    const key = (x: (typeof views)[number]) => x.weather.notices.map(n => n.advisory.id).join();
    const last = notices.at(-1), prev = last?.at(-1);
    if (last && prev && prev.day + 1 === v.day && key(prev) === key(v)) last.push(v); else notices.push([v]);
  }

  // The to-do list: closures grouped by day, then bookings and what is still open.
  const adjustGroups = new Map<string, { names: string[]; ids: string[]; day: number; text: string; safety: boolean }>();
  for (const { item, insight } of insights.items.filter(i => i.insight.state === 'adjust')) {
    const conflict = insight.conflicts[0], weekly = conflict?.reasonCode === 'CLOSED_WEEKLY', safety = conflict?.type === 'safety', date = dateForDay(trip.startDate, item.day);
    const key = weekly ? `weekly:${item.day}` : safety ? `safety:${item.day}:${conflict.reasonCode}` : `${item.id}`;
    const group = adjustGroups.get(key) ?? { names: [], ids: [], day: item.day, text: '', safety };
    if (!group.names.includes(item.placeName)) group.names.push(item.placeName);
    group.ids.push(item.id);
    group.text = weekly ? `${monthDay(date)}（${weekdayLabel(date)}）是闭馆日，这天去会扑空。` : safety ? (conflict.reasonCode === 'HAZARD_EXPOSED' ? '预警期间海边、山上和涉水点位默认不安全。' : '已公告关闭，没查到恢复通知。') : conflict?.explanation ?? insight.message;
    adjustGroups.set(key, group);
  }
  const alerted = insights.items.filter(i => i.insight.state === 'verify' && judgments.some(j => j.itemId === i.item.id && j.type === 'safety'));
  const verifyItems = insights.items.filter(i => i.insight.state === 'verify' && !alerted.includes(i));
  const todos: Todo[] = [
    ...[...adjustGroups.values()].map(g => ({ tone: 'bad' as const, icon: g.safety ? Siren : AlertTriangle, title: `第 ${g.day} 天 · ${g.names.slice(0, 4).join('、')}${g.names.length > 4 ? ` 等 ${g.names.length} 处` : ''}`, href: `#stop-${g.ids[0]}`,
      text: `${g.text}${result?.suggestions.some(s => s.ops.some(op => g.ids.includes(op.itemId))) ? '下方有改法。' : ''}` })),
    ...(alerted.length ? [{ tone: 'warn' as const, icon: Bus, title: `${alerted.length} 处要在出发当天再确认`, text: `${alerted.slice(0, 4).map(i => i.item.placeName).join('、')}${alerted.length > 4 ? ' 等' : ''}：预警期间可能停运或临时关闭，以当天公告为准。`, href: `#stop-${alerted[0].item.id}` }] : []),
    ...insights.items.filter(({ insight }) => insight.state !== 'adjust' && insight.rules.some(r => r.label === '预约 / 购票' && r.value === '需提前预约')).map(({ item }) => {
      const j = judgments.find(j => j.itemId === item.id && j.type === 'reservation_rule');
      const detail = (j?.explanation ?? '').replace('此结论不表示已有名额或已完成预约。', '').replace(/^需提前预约[；，。]?/, '').trim();
      return { tone: 'info' as const, icon: Ticket, title: `${item.placeName} 要提前预约`, text: /[\p{L}\p{N}]/u.test(detail) ? detail : '出发前在官方渠道预约。', href: `#stop-${item.id}` };
    }),
    ...(verifyItems.length ? [{ tone: 'muted' as const, icon: CircleHelp, title: `${verifyItems.length} 个地点没查到可靠规则`, text: `${verifyItems.slice(0, 5).map(i => i.item.placeName).join('、')}${verifyItems.length > 5 ? ` 等` : ''}，出发前向场馆确认。`, href: `#stop-${verifyItems[0].item.id}` }] : []),
    ...(counts.needs_time ? [{ tone: 'muted' as const, icon: Clock3, title: `${counts.needs_time} 个地点缺到达时间`, text: '营业规则已查到；在原行程工作台补上计划到达时间，就能核对是否赶在停止入场之前。' }] : []),
  ];

  return <><Header><Button asChild variant="outline" size="sm"><Link href="/">核对我的攻略 <ArrowUpRight size={14}/></Link></Button></Header>
  <main className={`page report ${includeEvidence ? 'print-full' : 'print-brief'}`}>
    <section className="page-head">
      <div><p className="kicker">行程核对报告 · {trip.destinationCity}</p><h1>{trip.title}</h1>
        <p className="meta">{monthDay(trip.startDate)} {weekdayLabel(trip.startDate)}{days.length > 1 ? ` — ${monthDay(dateForDay(trip.startDate, days.at(-1)!))} ${weekdayLabel(dateForDay(trip.startDate, days.at(-1)!))}` : ''} · {days.length} 天 · <span className="overview-stops">{trip.items.length} 个地点</span>{checkedAt ? ` · 核对于 ${localTime(checkedAt, true)}` : ''}</p></div>
      <div className="head-actions no-print"><Button variant="outline" onClick={share}>{copied ? <Check size={15}/> : <Share2 size={15}/>} {copied ? '已复制链接' : '复制分享链接'}</Button><Button onClick={print} disabled={printing || !result}>{printing ? <LoaderCircle size={15} className="spin"/> : <Printer size={15}/>} {printing ? '重新检查来源链接…' : '核查链接并打印 PDF'}</Button><label className="print-option"><input type="checkbox" checked={includeEvidence} onChange={e => setIncludeEvidence(e.target.checked)}/>打印时附完整证据</label></div>
    </section>
    {error && <div className="banner banner-error no-print" role="alert"><AlertCircle size={15}/>{error}</div>}
    {updating && <div className="banner no-print"><LoaderCircle size={15} className="spin"/>正在重新核验。先展示上次完成的报告，新结果完成后刷新即可查看。</div>}
    {!result || !result.judgments.length ? <div className="empty-state"><FileSearch size={26}/><p>调查结果尚未生成。请等待原行程完成调查后刷新。</p></div> : <>
      <VerdictCard verdict={verdict}>
        <StatusBar counts={counts} filter={filter} onFilter={s => { setFilter(s); setDay(0); }}/>
        <ProofLine result={result}/>
      </VerdictCard>

      {guide && (guide.images.length > 0 || guide.text) && <GuideCard shareId={trip.shareId} guide={guide} onOpen={setViewing}/>}

      {notices.length > 0 && <section className="card notices-card" aria-label="预警与区域公告">
        <h2><Siren size={17}/>关闭公告与预警<span>官方公告优先于平台上的营业时间</span></h2>
        {notices.map(group => { const blocked = group.reduce((n, v) => n + v.weather.blocked, 0), alerted = group.reduce((n, v) => n + v.weather.alerted, 0);
          return <div className="notices-day" key={group[0].day}><h3>{group.map(v => `${monthDay(v.date)} ${weekdayLabel(v.date)}`).join('、')}<span>{blocked ? `${blocked} 个地点不建议去` : ''}{blocked && alerted ? ' · ' : ''}{alerted ? `${alerted} 处待当天确认` : ''}</span></h3><NoticeList notices={group[0].weather.notices}/></div>; })}
      </section>}

      {todos.length > 0 && <section className="card todo" aria-label="出发前要处理的事">
        <h2>出发前要处理的事</h2>
        <ul>{todos.map((t, n) => { const Icon = t.icon; const body = <><Icon size={16}/><span><strong>{t.title}</strong>{t.text}</span>{t.href && <ArrowUpRight size={14} className="todo-go"/>}</>; return <li key={n} className={`tone-${t.tone}`}>{t.href ? <a href={t.href}>{body}</a> : <div>{body}</div>}</li>; })}</ul>
      </section>}

      <nav className="toolbar no-print" aria-label="按天查看"><div className="day-tabs"><button className={day === 0 ? 'active' : ''} onClick={() => setDay(0)}>全部行程</button>{days.map(d => <button key={d} className={day === d ? 'active' : ''} onClick={() => setDay(d)}>第 {d} 天</button>)}</div>
        <div className="toolbar-right"><button className="text-button" onClick={() => setOpen(open.size ? new Set() : new Set(visible.map(v => v.item.id)))}>{open.size ? '全部收起' : '全部展开'}</button></div></nav>
      {visible.length === 0 && <div className="empty-state"><p>这个分类下没有安排。</p><Button variant="outline" onClick={() => { setDay(0); setFilter('all'); }}>查看全部行程</Button></div>}
      {views.filter(v => visible.some(x => x.item.day === v.day)).map(v => {
        const all = trip.items.filter(i => i.day === v.day).sort((a, b) => a.seq - b.seq);
        const stops = visible.filter(x => x.item.day === v.day).sort((a, b) => a.item.seq - b.item.seq);
        return <section className="report-day day" id={`day-${v.day}`} key={v.day}>
          <DayHead day={v.day} date={v.date} weather={v.weather} result={result} stops={all.length}/>
          <DayAlert weather={v.weather} compact/>
          <ol className="timeline">{stops.map(({ item, insight }) => <Stop key={item.id} item={item} insight={insight} index={all.findIndex(i => i.id === item.id)} trip={trip} result={result} open={open.has(item.id)} onToggle={() => toggle(item.id)} images={images} onImage={setViewing}/>)}</ol>
        </section>;
      })}

      {safetyDriven(insights) && <section className="section" id="suggestions"><div className="section-head"><h2><Route size={17}/>怎么改最省事</h2></div><div className="card suggestion"><h3>换个日期，或换成不受影响的室内安排</h3><p className="suggestion-note">需要调整的地点都来自预警或区域关闭公告，逐个删掉地点解决不了问题。等官方解除预警、发布恢复开放通知后再去；原行程工作台可以用“换个日期”预览。</p></div></section>}
      {usefulSuggestions(result.suggestions, insights).length > 0 && <section className="section" id={safetyDriven(insights) ? 'swaps' : 'suggestions'}><div className="section-head"><h2><Route size={17}/>{safetyDriven(insights) ? '也可以把受影响的地点换到别的日子' : '怎么改最省事'}</h2><span>只用已存事实复核，不新增搜索</span></div><div className="suggestions">{usefulSuggestions(result.suggestions, insights)
        .map(s => ({ s, after: itineraryInsights({ ...trip, items: s.itemsAfter }, s.judgments, result.dossiers) }))
        .sort((a, b) => a.after.counts.adjust - b.after.counts.adjust || a.after.counts.verify - b.after.counts.verify || b.after.counts.fits - a.after.counts.fits).slice(0, 2)
        .map(({ s, after }) => <article className="card suggestion" key={s.id}>
          <div className="suggestion-head"><h3>{suggestionTitle(s.ops, trip)}</h3><span>需调整 {counts.adjust} → <b>{after.counts.adjust}</b></span></div>
          <ul>{after.items.filter(({ item: i }) => s.ops.some(op => op.itemId === i.id || (op.type === 'swap' && op.otherItemId === i.id))).map(({ item: i, insight }) => <li key={i.id}><span>第 {i.day} 天 · {monthDay(dateForDay(trip.startDate, i.day))} {weekdayLabel(dateForDay(trip.startDate, i.day))}</span><strong>{i.placeName}</strong><PlanStatus state={insight.state}/></li>)}</ul>
          <p className="suggestion-note">可在原行程工作台预览并应用；预约名额与交通衔接仍需自行确认。</p>
        </article>)}</div></section>}
      {result.announcement && <section className="card announcement-result"><div><h2>{result.announcement.title}</h2><Status verdict={result.announcement.verdict}/></div><p>{result.announcement.explanation}</p>{result.announcement.claims.map((c, n) => <p key={n}>{c}</p>)}{result.dossiers.flatMap(d => d.evidence).filter(e => result.announcement!.evidenceIds.includes(e.id)).slice(0, 5).map(e => <SourceCard key={e.id} evidence={e} quotes={result.dossiers.flatMap(d => d.facts).filter(f => f.evidenceId === e.id).map(f => f.quote).slice(0, 2)}/>)}</section>}
      {!!result.alternatives.length && <section className="section"><div className="section-head"><h2>独立核查的替代场馆</h2></div>{result.alternatives.map(a => { const view = alternativeInsight(trip, a); if (!view) return null; return <article className="card report-item alt-card" key={a.name}><div className="alt-head"><div><h3>{a.name}</h3><p>{a.reason}</p></div><PlanStatus state={view.insight.state}/></div><p className={`stop-takeaway tone-${view.insight.state}`}>{view.insight.message}</p><RuleGrid rules={view.insight.rules}/><EvidenceAudit item={view.item} judgments={a.judgments} dossiers={[a.dossier]}/></article>; })}</section>}

      <section className="fineprint"><h2>这份报告的边界</h2><p>预约是否完成、当天是否有票，请到官方渠道确认；交通与排队受实时情况影响。临时关闭以官方公告为准，临近出发再看一次景区公告。</p><p>来源标签：官方＝政府或场馆官网；权威来源＝主流或当地官方媒体；多源一致＝至少两个独立来源说法相同；仅供参考＝只查到个别来源。没查到临时公告不代表没有临时变更。原攻略图文只在提交时选择附上才会随报告展示。</p></section>
      <details className="report-appendix"><summary>查询卡片与调查记录<span>{calls.length} 条检索记录</span><ChevronDown size={14} className="chev"/></summary>
        <div className="appendix-body">
          {cards.length > 0 && <><div className="section-head"><h2>查询卡片</h2><span>可下载的结论与来源</span></div>{cards.map((judgment, n) => <QueryCard key={judgment.id} index={n + 1} judgment={judgment} trip={trip} result={result}/>)}</>}
          <div className="section-head"><h2>调查调用记录</h2><span>SearchPro · {calls.filter(c => !c.cacheHit).length} 次实际请求 · {calls.filter(c => c.cacheHit).length} 次缓存复用</span></div><CallLog calls={calls}/>
          {result.limitations.length > 0 && <details className="search-scope"><summary>调查限制与未确认事项</summary><ul>{result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
        </div>
      </details>
    </>}
    <footer className="page-foot"><span className="mono">TRIPPROOF · {trip.shareId.slice(0, 8).toUpperCase()}</span><span>来源可点击核对；没注明发布日期的来源不虚构日期。</span></footer>
  </main>
  {viewing !== null && <GuideViewer shareId={trip.shareId} images={images} at={viewing} onChange={setViewing}/>}</>;
}

function suggestionTitle(ops: RunResult['suggestions'][number]['ops'], trip: Trip) {
  const name = (id: string) => trip.items.find(i => i.id === id)?.placeName ?? '该安排';
  return ops.map(op => {
    if (op.type === 'swap') { const other = trip.items.find(i => i.id === op.otherItemId); return `把「${name(op.itemId)}」改到第 ${other?.day} 天（与「${other?.placeName}」对调）`; }
    if (op.type === 'shift') return `把「${name(op.itemId)}」改到 ${op.start}${op.end ? `—${op.end}` : ''}`;
    return `去掉「${name(op.itemId)}」`;
  }).join('，');
}

function Stop({ item, insight, index, trip, result, open, onToggle, images, onImage }: { item: Item; insight: ItemInsight; index: number; trip: Trip; result: RunResult; open: boolean; onToggle: () => void; images: number[]; onImage: (n: number) => void }) {
  const ripples = result.ripples.filter(r => r.itemId === item.id);
  const leg = item.kind === 'transport';
  const short = ['fits', 'needs_time'].includes(insight.state) ? insight.rules.find(r => /营业时间|运营时间/.test(r.label) && r.verified)?.value : undefined;
  return <li className={`stop report-item is-${insight.state} ${leg ? 'is-leg' : ''} ${open ? 'open' : ''}`} id={`stop-${item.id}`}>
    <span className="stop-node" aria-hidden>{leg ? <Bus size={12}/> : index + 1}</span>
    <div className="stop-card">
      <div className="stop-row" onClick={onToggle}>
        <div className="stop-text">
          <div className="stop-title"><h3>{item.placeName}</h3><span className="stop-kind">{kindLabels[item.kind]}{item.proposedBy === 'agent' ? ' · Agent 建议' : ''}{item.start ? ` · ${item.start}${item.end ? `—${item.end}` : ''}` : ''}{short && !open ? ` · ${short}` : ''}</span></div>
          <p className={`stop-msg tone-${insight.state}`}>{insight.message}</p>
        </div>
        <PlanStatus state={insight.state}/>
        <button type="button" className="stop-toggle no-print" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}${item.placeName}的详情`} onClick={e => { e.stopPropagation(); onToggle(); }}><ChevronDown size={16}/></button>
      </div>
      <div className="stop-body">
        <StopSource item={item} images={images} onOpen={onImage}/>
        <RuleGrid rules={insight.rules}/>
        <GuideUpdate item={item} insight={insight}/>
        {ripples.map((r, n) => <p className="ripple-note" key={n}>需重新确认：{r.reason}</p>)}
        <KeySources insight={insight}/>
        <EvidenceAudit item={item} judgments={result.judgments.filter(j => j.itemId === item.id)} dossiers={result.dossiers} shareId={trip.shareId}/>
      </div>
    </div>
  </li>;
}

function QueryCard({ judgment, trip, result, index }: { judgment: Judgment; trip: Trip; result: RunResult; index: number }) {
  const item = trip.items.find(i => i.id === judgment.itemId)!;
  const sources = result.dossiers.flatMap(d => d.evidence).filter(e => judgment.evidenceIds.includes(e.id)).slice(0, 2);
  const calls = result.dossiers.find(d => d.venue.id === judgment.venueId)?.calls ?? [];
  const question = `${judgment.date}（${weekdayLabel(judgment.date)}）${item.start || '计划时间未提供'} 去「${item.placeName}」：${checkLabels[judgment.type]}？`;
  const markdown = `问题：${question}\n\n答案：${statusLabels[judgment.verdict]}\n\n一句话解释：${judgment.explanation}\n\n来源：\n${sources.map(e => `- [${e.title}](${e.finalUrl || e.url})（发布 ${e.publishedAt || '未注明'}，检索 ${localTime(e.retrievedAt)}）`).join('\n') || '无可用于本项确认的来源，详见报告中的信息边界。'}\n\n检索记录：SearchPro ×${calls.length}\n${calls.map(c => `RequestId ${c.requestId || '未获得'}${c.cacheHit ? '（缓存）' : ''}`).join('\n')}\n`;
  function download() { const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `TripProof-查询${index}.md`; a.click(); URL.revokeObjectURL(url); }
  return <article className="query-card"><span className="kicker">查询 {String(index).padStart(2, '0')}</span><h3>{question}</h3><Status verdict={judgment.verdict}/><p>{judgment.explanation}</p>{sources.map(e => <p key={e.id}>来源：<a href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer">{e.title}</a>（发布 {e.publishedAt || '未注明'}，检索 {localTime(e.retrievedAt)}）</p>)}{!sources.length && <p>此项没有可用于确认的来源，核实渠道见对应判定。</p>}<p className="mono small">SearchPro ×{calls.length} · RequestId {calls.find(c => c.requestId)?.requestId || '本项无需或未完成有效搜索'}</p><Button variant="outline" size="sm" className="no-print" onClick={download}><Download size={13}/>下载查询卡片</Button></article>;
}
