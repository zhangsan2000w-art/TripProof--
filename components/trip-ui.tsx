import { AlertTriangle, Check, Clock3, CircleHelp, CircleCheck, CloudRain, CloudSun, Cloud, ShieldAlert, ExternalLink, Siren } from 'lucide-react';
import type { Dossier, Item, Judgment, RunResult } from '@/lib/domain';
import { localTime, weekdayLabel } from '@/lib/dates';
import { planHints, planLabels, tierLabels, type PlanState, type TripVerdict, dayWeather } from '@/lib/presentation';

export const kindLabels: Record<Item['kind'], string> = { museum: '博物馆', scenic: '景点', show: '演出', restaurant: '餐饮', transport: '交通', hotel: '住宿', other: '街区' };
export const monthDay = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
export const planStates = ['adjust', 'fits', 'needs_time', 'verify'] as const;
const stateIcons = { adjust: AlertTriangle, fits: Check, needs_time: Clock3, verify: CircleHelp, pending: CircleHelp };

export function PlanStatus({ state, busy = false }: { state: PlanState; busy?: boolean }) {
  const Icon = stateIcons[state];
  return <span className={`plan-status plan-${busy ? 'pending' : state}`}><Icon size={13} strokeWidth={2.2}/>{busy ? '核验中' : planLabels[state]}</span>;
}

/** Proportional bar of the four outcomes, with legend buttons that filter the list. */
export function StatusBar({ counts, filter, onFilter }: { counts: Record<PlanState, number>; filter?: PlanState | 'all'; onFilter?: (state: PlanState | 'all') => void }) {
  const total = planStates.reduce((n, s) => n + counts[s], 0) || 1;
  return <div className="status-bar-wrap">
    <div className="status-bar" aria-hidden>{planStates.filter(s => counts[s]).map(s => <span key={s} className={`seg plan-${s}`} style={{ width: `${(counts[s] / total) * 100}%` }}/>)}</div>
    <div className="outcome-filters" role={onFilter ? 'group' : undefined} aria-label="按状态筛选">
      {planStates.map(s => onFilter
        ? <button key={s} type="button" className={`legend plan-${s} ${filter === s ? 'active' : ''}`} aria-pressed={filter === s} title={planHints[s]} onClick={() => onFilter(filter === s ? 'all' : s)}>{planLabels[s]}<b>{counts[s]}</b></button>
        : <span key={s} className={`legend plan-${s}`} title={planHints[s]}>{planLabels[s]}<b>{counts[s]}</b></span>)}
      {onFilter && filter && filter !== 'all' && <button type="button" className="legend legend-reset" onClick={() => onFilter('all')}>显示全部</button>}
    </div>
  </div>;
}

const toneIcons = { bad: AlertTriangle, warn: Siren, info: CircleHelp, good: CircleCheck };
export function VerdictCard({ verdict, children, busy = false }: React.PropsWithChildren<{ verdict: TripVerdict; busy?: boolean }>) {
  const Icon = toneIcons[verdict.tone];
  return <section className={`verdict tone-${busy ? 'info' : verdict.tone}`} aria-label="行程结论">
    <div className="verdict-head"><span className="verdict-icon"><Icon size={22}/></span><div><h2>{busy ? '正在核对你的行程…' : verdict.headline}</h2>{!busy && verdict.detail && <p>{verdict.detail}</p>}</div></div>
    {children}
  </section>;
}

export function WeatherChip({ weather, result }: { weather: ReturnType<typeof dayWeather>; result: RunResult }) {
  const { forecast } = weather;
  const fact = result.dossiers.flatMap(d => d.facts).find(f => forecast?.factIds.includes(f.id) && f.kind === 'weather');
  const text = fact?.kind === 'weather' ? fact.payload.summary.replace(/[。.]$/, '') : null;
  if (text) return <span className={`chip ${forecast?.reasonCode === 'WEATHER_RISK' ? 'chip-warn' : 'chip-good'}`} title={forecast?.explanation}>{forecast?.reasonCode === 'WEATHER_RISK' ? <CloudRain size={14}/> : <CloudSun size={14}/>}{text}</span>;
  return <span className="chip chip-muted" title={forecast?.explanation}><Cloud size={14}/>{forecast?.reasonCode === 'FORECAST_NOT_YET' ? '超出 7 天预报范围' : forecast ? '没查到这天的预报' : '室内为主，未查天气'}</span>;
}

/** The notices in force on a day, with the sentence and the link they come from. */
export function NoticeList({ notices, compact = false }: { notices: ReturnType<typeof dayWeather>['notices']; compact?: boolean }) {
  if (!notices.length) return null;
  return <ul className={`notice-list ${compact ? 'compact' : ''}`}>{notices.map(({ advisory: a, name, confirmed, evidence: e }) => <li key={a.id} className={`notice notice-${a.payload.type} ${confirmed ? '' : 'is-reported'}`}>
    <div className="notice-top"><strong>{name}{!confirmed && <em className="notice-flag">仅转载报道，未经官方证实</em>}</strong><span>{monthDay(a.payload.from)}起{a.payload.to ? ` · 至${monthDay(a.payload.to)}` : ''}</span></div>
    {!compact && <q>{a.quote}</q>}
    {e && <a href={e.finalUrl || e.url} target="_blank" rel="noopener noreferrer"><span className={`tier tier-${e.tier}`}>{tierLabels[e.tier]}</span>{e.title || e.site}<ExternalLink size={11}/></a>}
  </li>)}</ul>;
}

/** Day heading shared by the report and the workspace. */
export function DayHead({ day, date, weather, result, stops }: { day: number; date: string; weather: ReturnType<typeof dayWeather>; result: RunResult | null; stops: number }) {
  return <header className="day-head">
    <div className="day-title"><span className="day-tag">第 {day} 天</span><h2>{monthDay(date)}<small>{weekdayLabel(date)} · {stops} 站</small></h2></div>
    <div className="day-chips">{result && <WeatherChip weather={weather} result={result}/>}{weather.checked && !weather.notices.length && <span className="chip chip-good" title="已搜索这天的气象预警和区域关闭公告"><ShieldAlert size={14}/>未查到预警或关闭公告</span>}</div>
  </header>;
}
export function DayAlert({ weather, compact = false }: { weather: ReturnType<typeof dayWeather>; compact?: boolean }) {
  if (!weather.notices.length) return null;
  const bad = weather.blocked > 0;
  return <div className={`day-alert ${bad ? 'tone-bad' : 'tone-warn'}`} role="note">
    <Siren size={18}/>
    <div><strong>{bad ? '这天有生效的预警或关闭公告' : weather.notices.some(n => n.confirmed) ? '这天有生效的预警' : '有网页报道这天的预警，未经官方证实'}</strong><p>{[weather.blocked ? `${weather.blocked} 个地点不建议去` : '', weather.alerted ? `${weather.alerted} 处要在出发前再确认` : ''].filter(Boolean).join('，') || '出发前查看官方公告'}。官方公告优先于平台上的营业时间。</p><NoticeList notices={weather.notices} compact={compact}/></div>
  </div>;
}
export function ProofLine({ result }: { result: RunResult }) {
  const calls = [...new Map(result.dossiers.flatMap(d => d.calls).map(c => [c.id, c])).values()];
  const sources = new Set(result.dossiers.flatMap(d => d.evidence.filter(e => e.linkStatus !== 'broken').map(e => e.url))).size;
  const cached = calls.filter(c => c.cacheHit).length;
  return <p className="proof-line">元宝 SearchPro 检索 {calls.length} 次{cached ? `（${cached} 次复用此前的真实检索）` : ''} · 核对 {sources} 个可打开的来源 · 每条结论都能点开看原文</p>;
}
export function checkedLabel(checkedAt: string | null) { return checkedAt ? `核对于 ${localTime(checkedAt, true)}` : ''; }
export type DayView = { day: number; date: string; weather: ReturnType<typeof dayWeather> };
export function dayViews(days: number[], startDate: string, judgments: Judgment[], dossiers: Dossier[], dateFor: (start: string, day: number) => string): DayView[] {
  return days.map(day => { const date = dateFor(startDate, day); return { day, date, weather: dayWeather(judgments, dossiers, date) }; });
}
