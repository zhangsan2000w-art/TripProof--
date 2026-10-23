'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Printer, Share2, Check, Download, ArrowUpRight, FileSearch, AlertCircle, LoaderCircle, AlertTriangle, CloudRain, CloudSun, Cloud, Ticket, Clock3, CircleHelp, ExternalLink, Footprints, CircleCheck, BookOpenCheck } from 'lucide-react';
import type { Trip, RunResult, Judgment, Item } from '@/lib/domain';
import { Header } from './brand';
import { Button } from './ui/button';
import { EvidenceAudit, RuleGrid, SourceCard, checkLabels } from './evidence-panel';
import { Status } from './status';
import { CallLog } from './call-log';
import { dateForDay, localTime, weekdayLabel } from '@/lib/dates';
import { statusLabels } from '@/lib/utils';
import { api } from '@/lib/client';
import { alternativeInsight, dayWeather, itineraryInsights, planHints, planLabels, type ItemInsight, type PlanState } from '@/lib/presentation';
import { PlanStatus } from './itinerary-overview';

const kindLabels: Record<Item['kind'], string> = { museum: '博物馆 · 展馆', scenic: '景点', show: '演出', restaurant: '餐饮', transport: '交通', hotel: '住宿', other: '街区 · 其他' };
const monthDay = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
const states = ['adjust', 'fits', 'needs_time', 'verify'] as const;
type Todo = { tone: 'bad' | 'warn' | 'info' | 'muted'; title: string; text: string; href?: string; icon: typeof AlertTriangle };

export function ReportView({ trip, initialResult, checkedAt, updating = false }: { trip: Trip; initialResult: RunResult | null; checkedAt: string | null; updating?: boolean }) {
  const [copied, setCopied] = useState(false), [printing, setPrinting] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(initialResult);
  const [day, setDay] = useState(0), [filter, setFilter] = useState<'all' | PlanState>('all'), [includeEvidence, setIncludeEvidence] = useState(false);
  const calls = [...new Map((result?.dossiers.flatMap(d => d.calls) ?? []).map(c => [c.id, c])).values()];
  const insights = itineraryInsights(trip, result?.judgments ?? [], result?.dossiers ?? []);
  const days = [...new Set(trip.items.map(i => i.day))].sort((a, b) => a - b);
  const visible = insights.items.filter(({ item, insight }) => (!day || item.day === day) && (filter === 'all' || insight.state === filter));
  const sourceCount = new Set(result?.dossiers.flatMap(d => d.evidence.filter(e => e.linkStatus !== 'broken').map(e => e.url)) ?? []).size;
  const weather = new Map(days.map(d => { const date = dateForDay(trip.startDate, d); return [d, dayWeather(result?.judgments ?? [], result?.dossiers ?? [], date)] as const; }));
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
  for (const verdict of ['conflict', 'confirmed', 'unknown'] as const) { const j = result?.judgments.find(j => j.verdict === verdict && j.type !== 'arrival_fit'); if (j) cards.push(j); }

  const { counts } = insights;
  const adjustItems = insights.items.filter(i => i.insight.state === 'adjust');
  const verifyItems = insights.items.filter(i => i.insight.state === 'verify');
  const riskDays = days.filter(d => weather.get(d)?.risk);
  // A trip that is mostly unverified must not read as fine just because nothing conflicts.
  const mostlyUnknown = counts.verify * 2 >= trip.items.length;
  const tone = counts.adjust ? 'bad' : mostlyUnknown ? 'info' : riskDays.length ? 'warn' : counts.verify ? 'info' : 'good';
  const headline = counts.adjust ? `有 ${counts.adjust} 处安排需要调整` : mostlyUnknown ? `${counts.verify} 个地点没查到可靠规则，出发前逐一确认` : riskDays.length ? '规则上走得通，但要留意天气' : counts.verify ? `大部分安排已核实，${counts.verify} 处出发前再确认` : '按查到的规则，这趟行程走得通';
  const HeadIcon = counts.adjust ? AlertTriangle : mostlyUnknown ? CircleHelp : riskDays.length ? CloudRain : counts.verify ? CircleHelp : CircleCheck;
  // Venues closed for the same weekly rule on the same day share one line.
  const adjustGroups = new Map<string, { names: string[]; ids: string[]; day: number; weekly: boolean; text: string }>();
  for (const { item, insight } of adjustItems) {
    const conflict = insight.conflicts[0], weekly = conflict?.reasonCode === 'CLOSED_WEEKLY', date = dateForDay(trip.startDate, item.day);
    const key = weekly ? `weekly:${item.day}` : `${item.placeName}:${item.day}:${conflict?.reasonCode}`;
    const group = adjustGroups.get(key) ?? { names: [], ids: [], day: item.day, weekly, text: '' };
    if (!group.names.includes(item.placeName)) group.names.push(item.placeName);
    group.ids.push(item.id);
    group.text = weekly ? `${monthDay(date)}（${weekdayLabel(date)}）是${group.names.length > 1 ? '这些场馆' : '该场馆'}的闭馆日，这天去会扑空。` : conflict?.explanation ?? insight.message;
    adjustGroups.set(key, group);
  }
  const todos: Todo[] = [
    ...[...adjustGroups.values()].map(g => ({ tone: 'bad' as const, icon: AlertTriangle, title: `${g.names.join('、')} · 第 ${g.day} 天`, href: `#stop-${g.ids[0]}`,
      text: `${g.text}${result?.suggestions.some(s => s.ops.some(op => g.ids.includes(op.itemId))) ? '下方有改法建议。' : g.weekly ? '换一天去可避开，原行程工作台可以用“换个日期”预览。' : ''}` })),
    // Days with the same storm headlines share one line.
    ...[...riskDays.reduce((groups, d) => { const w = weather.get(d)!, key = w.forecast?.reasonCode === 'WEATHER_RISK' ? w.forecast.explanation : `检索到相关报道：${w.alerts.map(a => a.title).join('；')}`; return groups.set(key, [...(groups.get(key) ?? []), d]); }, new Map<string, number[]>())].map(([text, group]) => ({ tone: 'warn' as const, icon: CloudRain, title: `${group.map(d => monthDay(dateForDay(trip.startDate, d))).join('、')} 天气`, text: `${text}${text.startsWith('检索到') ? '。报道未逐字写明行程当天，出发前再看一次预报。' : ''}`, href: `#day-${group[0]}` })),
    ...insights.items.filter(({ insight }) => insight.state !== 'adjust' && insight.rules.some(r => r.label === '预约 / 购票' && r.value === '需提前预约')).map(({ item }) => {
      const j = result?.judgments.find(j => j.itemId === item.id && j.type === 'reservation_rule');
      return { tone: 'info' as const, icon: Ticket, title: `${item.placeName} 要提前预约`, text: j?.explanation.replace('此结论不表示已有名额或已完成预约。', '').replace(/^需提前预约[；，]?/, '') || '出发前在官方渠道预约。', href: `#stop-${item.id}` };
    }),
    ...(verifyItems.length ? [{ tone: 'muted' as const, icon: CircleHelp, title: `${verifyItems.length} 个地点出发前再确认`, text: verifyItems.slice(0, 6).map(i => `${i.item.placeName}（${i.insight.rules.find(r => r.label === '营业时间' || r.label === '运营时间')?.note?.startsWith('来源说法不一致') ? '来源说法不一致' : '没查到可靠规则'}）`).join('、') + (verifyItems.length > 6 ? ` 等 ${verifyItems.length} 处` : ''), href: `#stop-${verifyItems[0].item.id}` }] : []),
    ...(counts.needs_time ? [{ tone: 'muted' as const, icon: Clock3, title: `${counts.needs_time} 个地点缺到达时间`, text: '营业规则已查到；在原行程工作台补上计划到达时间，就能核对是否赶在停止入场之前。' }] : []),
  ];

  return <><Header><span className="header-note">出发前，心里有数</span><Button asChild variant="outline" size="sm"><Link href="/">检查我的攻略 <ArrowUpRight size={14}/></Link></Button></Header><main className={`report rp ${includeEvidence ? 'print-full' : 'print-brief'}`}>
    <section className="rp-hero">
      <div className="rp-hero-text">
        <span className="rp-kicker">行程核对报告 · {trip.destinationCity}</span>
        <h1>{trip.title}</h1>
        <p className="rp-meta">{monthDay(trip.startDate)} {weekdayLabel(trip.startDate)}{days.length > 1 ? ` — ${monthDay(dateForDay(trip.startDate, days.at(-1)!))} ${weekdayLabel(dateForDay(trip.startDate, days.at(-1)!))}` : ''} · {days.length} 天 · <span className="overview-stops">{trip.items.length}<small> 个地点</small></span></p>
      </div>
      <div className="rp-hero-actions no-print"><Button variant="outline" onClick={share}>{copied ? <Check size={15}/> : <Share2 size={15}/>} {copied ? '已复制链接' : '复制分享链接'}</Button><Button onClick={print} disabled={printing || !result}>{printing ? <LoaderCircle size={15} className="spin"/> : <Printer size={15}/>} {printing ? '重新检查来源链接…' : '核查链接并打印 PDF'}</Button><label className="print-option"><input type="checkbox" checked={includeEvidence} onChange={e => setIncludeEvidence(e.target.checked)}/>打印时附完整证据</label></div>
    </section>
    {error && <div className="error-banner no-print" role="alert"><AlertCircle size={15}/>{error}</div>}
    {updating && <p className="report-updating no-print">正在重新核验。先展示上次完成的报告，新结果完成后刷新即可查看。</p>}
    {!result || !result.judgments.length ? <div className="report-empty"><FileSearch size={25}/><p>调查结果尚未生成。请等待原行程完成调查后刷新。</p></div> : <>
      <section className={`rp-verdict tone-${tone}`} aria-label="行程结论">
        <div className="rp-verdict-head"><span className="rp-verdict-icon"><HeadIcon size={22}/></span><div><h2>{headline}</h2><p>按 {monthDay(trip.startDate)} 出发逐站核对开放日、营业时间、停止入场和预约规则 · 核对于 {localTime(checkedAt)}</p></div></div>
        <div className="rp-stats">{states.map(s => <button key={s} className={`rp-stat plan-${s} ${filter === s ? 'active' : ''}`} onClick={() => { setFilter(filter === s ? 'all' : s); setDay(0); }} aria-pressed={filter === s} title={planHints[s]}><strong>{counts[s]}</strong><span>{planLabels[s]}</span></button>)}</div>
        <p className="rp-proof"><BookOpenCheck size={14}/>元宝 SearchPro 检索记录 {calls.length} 条{calls.some(c => c.cacheHit) ? `（${calls.filter(c => c.cacheHit).length} 条复用此前的真实检索）` : ''}，核对 {sourceCount} 个可打开的来源；每条结论都能展开看到原文引文。</p>
      </section>

      {todos.length > 0 && <section className="rp-todo" aria-label="出发前要处理的事">
        <h2>出发前先看这几件事</h2>
        <ul>{todos.map((t, n) => { const Icon = t.icon; const body = <><Icon size={16}/><span><strong>{t.title}</strong>{t.text}</span>{t.href && <ArrowUpRight size={14} className="rp-todo-go"/>}</>; return <li key={n} className={`tone-${t.tone}`}>{t.href ? <a href={t.href}>{body}</a> : <div>{body}</div>}</li>; })}</ul>
      </section>}

      <nav className="report-filters rp-toolbar no-print" aria-label="筛选行程"><div className="day-tabs"><button className={day === 0 ? 'active' : ''} onClick={() => setDay(0)}>全部行程</button>{days.map(d => <button key={d} className={day === d ? 'active' : ''} onClick={() => setDay(d)}>第 {d} 天</button>)}</div><div className="outcome-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部状态</button>{states.map(s => <button key={s} aria-pressed={filter === s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>{planLabels[s]} <span>{counts[s]}</span></button>)}</div></nav>
      {visible.length === 0 && <div className="report-empty"><p>这个分类下没有安排。</p><Button variant="outline" onClick={() => { setDay(0); setFilter('all'); }}>查看全部行程</Button></div>}
      {days.filter(d => visible.some(v => v.item.day === d)).map(d => {
        const date = dateForDay(trip.startDate, d), w = weather.get(d)!;
        const stops = visible.filter(v => v.item.day === d).sort((a, b) => a.item.seq - b.item.seq);
        return <section className="report-day rp-day" id={`day-${d}`} key={d}>
          <header className="rp-day-head"><div className="rp-day-title"><span className="rp-day-tag">DAY {String(d).padStart(2, '0')}</span><h2>{monthDay(date)} <small>{weekdayLabel(date)}</small></h2></div><WeatherChip weather={w} result={result}/></header>
          <p className="rp-day-route">{trip.items.filter(i => i.day === d).sort((a,b) => a.seq-b.seq).map(i => i.placeName).join(' → ')}</p>
          {w.alerts.length > 0 && <p className="rp-day-alerts">相关天气报道：{w.alerts.map(a => <a key={a.url} href={a.finalUrl || a.url} target="_blank" rel="noopener noreferrer">{a.title}{a.publishedAt ? `（${a.publishedAt.slice(5)}）` : ''}<ExternalLink size={11}/></a>)}<span>报道未逐字写明当天，仅作提醒</span></p>}
          <ol className="rp-stops">{stops.map(({ item, insight }) => <Stop key={item.id} item={item} insight={insight} index={trip.items.filter(i => i.day === d).sort((a,b) => a.seq-b.seq).findIndex(i => i.id === item.id)} trip={trip} result={result}/>)}</ol>
        </section>;
      })}

      {result.suggestions.length > 0 && <section className="rp-section" id="suggestions"><div className="report-section-heading"><h2>怎么改最省事</h2><span>只用已存事实复核，不新增搜索</span></div><div className="rp-suggestions">{result.suggestions
        .map(s => ({ s, after: itineraryInsights({ ...trip, items: s.itemsAfter }, s.judgments, result.dossiers) }))
        .sort((a, b) => a.after.counts.adjust - b.after.counts.adjust || a.after.counts.verify - b.after.counts.verify || b.after.counts.fits - a.after.counts.fits).slice(0, 2)
        .map(({ s, after }) => <article className="rp-suggestion" key={s.id}>
          <div className="rp-suggestion-head"><h3>{suggestionTitle(s.ops, trip)}</h3><span>需调整 {counts.adjust} → <b>{after.counts.adjust}</b></span></div>
          <ul>{after.items.filter(({item:i}) => s.ops.some(op => op.itemId === i.id || (op.type === 'swap' && op.otherItemId === i.id))).map(({item:i, insight}) => <li key={i.id}><span>第 {i.day} 天 · {monthDay(dateForDay(trip.startDate, i.day))} {weekdayLabel(dateForDay(trip.startDate, i.day))}</span><strong>{i.placeName}</strong><PlanStatus state={insight.state}/></li>)}</ul>
          <p className="rp-suggestion-note">可在原行程工作台预览并应用；预约名额与交通衔接仍需自行确认。</p>
        </article>)}</div></section>}
      {result.announcement && <section className="announcement-result"><div><h2>{result.announcement.title}</h2><Status verdict={result.announcement.verdict}/></div><p>{result.announcement.explanation}</p>{result.announcement.claims.map((c, n) => <p key={n}>{c}</p>)}{result.dossiers.flatMap(d=>d.evidence).filter(e=>result.announcement!.evidenceIds.includes(e.id)).slice(0,5).map(e=><SourceCard key={e.id} evidence={e} quotes={result.dossiers.flatMap(d=>d.facts).filter(f=>f.evidenceId===e.id).map(f=>f.quote).slice(0,2)}/>)}</section>}
      {!!result.alternatives.length && <section className="rp-section"><div className="report-section-heading"><h2>独立核查的替代场馆</h2></div>{result.alternatives.map(a => { const view = alternativeInsight(trip, a); if (!view) return null; return <article className="report-item rp-card" key={a.name}><div className="rp-card-head"><div className="rp-card-title"><h3>{a.name}</h3><p>{a.reason}</p></div><PlanStatus state={view.insight.state}/></div><p className={`rp-card-msg tone-${view.insight.state}`}>{view.insight.message}</p><RuleGrid rules={view.insight.rules} className="rp-rules"/><EvidenceAudit item={view.item} judgments={a.judgments} dossiers={[a.dossier]}/></article>; })}</section>}

      <section className="report-common-notes"><h2>这份报告的边界</h2><p>预约是否完成、当天是否有票，请到场馆官方渠道确认；交通与排队受实时情况影响，逐站可前往也不代表整条路线一定来得及。</p><p>“多源一致”表示至少两个互相独立的平台说法相同，“仅供参考”表示只查到个别来源。未发现临时公告不代表没有临时变更；原始上传图片不会公开。</p></section>
      <details className="report-appendix"><summary>查询卡片与调查记录 <span>{calls.length} 条检索记录 · 按需查看</span></summary>
      {cards.length > 0 && <><div className="report-section-heading"><h2>查询卡片</h2><span>可下载的结论与来源</span></div>{cards.map((judgment, n) => <QueryCard key={judgment.id} index={n + 1} judgment={judgment} trip={trip} result={result}/>)}</>}
      <div className="report-section-heading"><h2>调查调用记录</h2><span>SearchPro · {calls.filter(c => !c.cacheHit).length}次实际请求 · {calls.filter(c => c.cacheHit).length}次缓存复用</span></div><div className="report-log"><CallLog calls={calls}/></div>
      {result.limitations.length > 0 && <details className="recommendations"><summary>调查限制与未确认事项</summary>{result.limitations.map((l, i) => <p key={i}>{l}</p>)}</details>}
      </details>
    </>}
    <footer className="workspace-footer report-footer"><span className="mono">TRIPPROOF · {trip.shareId.slice(0, 8).toUpperCase()}</span><span>原始来源可点击，发布时间未注明的来源不虚构日期。</span></footer>
  </main></>;
}

function suggestionTitle(ops: RunResult['suggestions'][number]['ops'], trip: Trip) {
  const name = (id: string) => trip.items.find(i => i.id === id)?.placeName ?? '该安排';
  return ops.map(op => {
    if (op.type === 'swap') { const other = trip.items.find(i => i.id === op.otherItemId); return `把「${name(op.itemId)}」改到第 ${other?.day} 天（与「${other?.placeName}」对调）`; }
    if (op.type === 'shift') return `把「${name(op.itemId)}」改到 ${op.start}${op.end ? `—${op.end}` : ''}`;
    return `去掉「${name(op.itemId)}」`;
  }).join('，');
}
function WeatherChip({ weather, result }: { weather: ReturnType<typeof dayWeather>; result: RunResult }) {
  const { forecast, alerts } = weather;
  const summary = result.dossiers.flatMap(d => d.facts).find(f => forecast?.factIds.includes(f.id) && f.kind === 'weather');
  const text = summary?.kind === 'weather' ? summary.payload.summary.replace(/[。.]$/, '') : null;
  if (forecast?.reasonCode === 'WEATHER_RISK') return <span className="rp-weather tone-warn" title={forecast.explanation}><CloudRain size={15}/>{text || '有降雨或预警'}</span>;
  if (text) return <span className="rp-weather tone-good" title={forecast?.explanation}><CloudSun size={15}/>{text}{forecast?.verdict !== 'confirmed' && '（仅一个来源）'}</span>;
  if (alerts.length) return <span className="rp-weather tone-warn"><CloudRain size={15}/>有台风或强降雨报道</span>;
  return <span className="rp-weather tone-muted" title={forecast?.explanation}><Cloud size={15}/>{forecast?.reasonCode === 'FORECAST_NOT_YET' ? '超出7天预报范围' : '天气预报未查到'}</span>;
}

function Stop({ item, insight, index, trip, result }: { item: Item; insight: ItemInsight; index: number; trip: Trip; result: RunResult }) {
  // Only short travel notes ("步行20分钟") read as a leg; timetables stay in the audit trail.
  const leg = index > 0 ? item.claimedRules.find(c => c.kind === 'transport' && [...c.text].length <= 30)?.text : undefined;
  const ripples = result.ripples.filter(r => r.itemId === item.id);
  const guideHours = insight.staleClaims.join('、') || item.claimedRules.filter(c => c.kind === 'hours').map(c => c.text.replace(/^(?:开放|营业)时间[:：]\s*/, '')).join('；');
  return <li className={`rp-stop is-${insight.state}`}>
    {leg && <div className="rp-leg"><Footprints size={13}/>攻略：{leg}</div>}
    <section className={`report-item rp-card stop-${insight.state}`} id={`stop-${item.id}`}>
      <div className="rp-card-head"><span className="rp-num">{index + 1}</span><div className="rp-card-title"><h3>{item.placeName}</h3><p>{kindLabels[item.kind]} · {item.start ? `计划 ${item.start}${item.end ? `—${item.end}` : ' 到达'}` : '攻略未写到达时间'}</p></div><PlanStatus state={insight.state}/></div>
      <p className={`rp-card-msg tone-${insight.state}`}>{insight.message}</p>
      <RuleGrid rules={insight.rules} className="rp-rules"/>
      {insight.updates.length > 0 && <div className="rule-update rp-update"><span>攻略信息已过时</span><p>攻略写「{guideHours}」<b>→</b>现行 {insight.hours ? insight.allDay ? '全天开放' : insight.hours : '规则见下方'}<small>已按现行规则核对</small></p></div>}
      {ripples.map((r, n) => <p className="ripple-note" key={n}>需重新确认：{r.reason}</p>)}
      {insight.citations.length > 0 && <div className="key-sources">依据：{insight.citations.slice(0, 2).map(({ evidence: e }) => <a key={e.url} href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer">{e.title || e.site}<ExternalLink size={11}/></a>)}</div>}
      <div className="print-evidence">{insight.citations.slice(0, 2).map(({ evidence: e, quote }) => <p key={e.url}><q>{quote}</q> <a href={e.finalUrl || e.url}>{e.title}</a> · 检索 {localTime(e.retrievedAt)}</p>)}</div>
      <EvidenceAudit item={item} judgments={result.judgments.filter(j => j.itemId === item.id)} dossiers={result.dossiers} shareId={trip.shareId}/>
    </section>
  </li>;
}

function QueryCard({ judgment, trip, result, index }: { judgment: Judgment; trip: Trip; result: RunResult; index: number }) {
  const item = trip.items.find(i => i.id === judgment.itemId)!;
  const sources = result.dossiers.flatMap(d => d.evidence).filter(e => judgment.evidenceIds.includes(e.id)).slice(0, 2);
  const calls = result.dossiers.find(d => d.venue.id === judgment.venueId)?.calls ?? [];
  const question = `${judgment.date}（${weekdayLabel(judgment.date)}）${item.start || '计划时间未提供'} 去「${item.placeName}」：${checkLabels[judgment.type]}？`;
  const markdown = `问题：${question}\n\n答案：${statusLabels[judgment.verdict]}\n\n一句话解释：${judgment.explanation}\n\n来源：\n${sources.map(e => `- [${e.title}](${e.finalUrl || e.url})（发布 ${e.publishedAt || '未注明'}，检索 ${localTime(e.retrievedAt)}）`).join('\n') || '无可用于本项确认的来源，详见报告中的信息边界。'}\n\n检索记录：SearchPro ×${calls.length}\n${calls.map(c => `RequestId ${c.requestId || '未获得'}${c.cacheHit ? '（缓存）' : ''}`).join('\n')}\n`;
  function download() { const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `TripProof-查询${index}.md`; a.click(); URL.revokeObjectURL(url); }
  return <article className="query-card"><span className="section-eyebrow">QUERY {String(index).padStart(2, '0')} / REAL INVESTIGATION</span><h3>{question}</h3><Status verdict={judgment.verdict}/><p>一句话解释：{judgment.explanation}</p>{sources.map(e => <p key={e.id}>来源：<a href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer">{e.title}</a>（发布 {e.publishedAt || '未注明'}，检索 {localTime(e.retrievedAt)}）</p>)}{!sources.length && <p>此项没有可用于确认的来源，核实渠道见对应判定。</p>}<p className="mono">SearchPro ×{calls.length} · RequestId {calls.find(c => c.requestId)?.requestId || '本项无需或未完成有效搜索'}</p><Button variant="outline" size="sm" className="no-print" onClick={download}><Download size={13}/>下载含可点击来源的查询卡片</Button></article>;
}
