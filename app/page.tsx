import Link from 'next/link';
import { ArrowDown, Check, AlertTriangle, CircleHelp, ScanText, Fingerprint, Route, ArrowUpRight, MoveRight } from 'lucide-react';
import { Header, Brand } from '@/components/brand';
import { HomeForm } from '@/components/home-form';
import { statistics } from '@/lib/store';
import { sampleEndDate, sampleReports } from '@/lib/samples';
import { planLabels } from '@/lib/presentation';
const monthDay = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default function Home() {
  const stats = statistics(), samples = sampleReports();
  return <><Header/><main className="home-main"><section className="hero-grid"><div className="hero-copy"><div className="hero-eyebrow"><span className="small-dot"/> 给收藏的攻略，做一次压力测试</div><h1>攻略很心动，<br/>出发前<span>再确认。</span></h1><p className="hero-description">你选好了想去的地方，<br/>我们帮你查清：那一天，真的走得通吗？</p><div className="hero-states"><span><Check size={14}/>可确认</span><span><AlertTriangle size={14}/>存在冲突</span><span><CircleHelp size={14}/>尚无法确认</span></div><div className="hero-note"><div className="note-line"/><p>从闭馆日期到停止入场，<br/><strong>每一个结论，都能回到原始出处。</strong></p></div><a href="#how-it-works" className="how-link">看看我们怎么查 <ArrowDown size={14}/></a><div className="hero-coordinate mono">30°15′N · 120°09′E <span>LEAVE WITH CONFIDENCE</span></div></div><HomeForm/></section>
    {samples.length > 0 && <section className="sample-section" aria-label="真实调查报告"><div className="how-heading"><span className="section-eyebrow">REAL REPORTS</span><p>四份真实攻略的核对结果，点开即看，无需等待调查。</p></div>
      <div className="sample-grid">{samples.map(s => <Link key={s.shareId} href={`/r/${s.shareId}`} className="sample-card">
        <span className="sample-meta">{s.city} · {monthDay(s.startDate)}{s.days > 1 ? `—${monthDay(sampleEndDate(s))}` : ''} · {s.stops} 个地点</span>
        <h3>{s.title}</h3>
        <p className={`sample-finding tone-${s.tone}`}>{s.tone === 'bad' ? <AlertTriangle size={14}/> : s.tone === 'good' ? <Check size={14}/> : <CircleHelp size={14}/>}{s.finding}</p>
        <div className="sample-counts">{(['adjust', 'fits', 'needs_time', 'verify'] as const).map(state => <span key={state} className={`plan-${state}`}><b>{s.counts[state]}</b>{planLabels[state]}</span>)}</div>
        <span className="sample-open">查看报告 <ArrowUpRight size={14}/></span>
      </Link>)}</div>
    </section>}
    <section className="how-section" id="how-it-works"><div className="how-heading"><span className="section-eyebrow">LESS GUESSWORK. MORE PROOF.</span><p>一份攻略，三步查清。</p></div><div className="how-cards"><article><span className="how-number mono">01 / READ</span><ScanText size={25} strokeWidth={1.5}/><h2>读懂原来的安排</h2><p>截图、文字都可以。先整理成行程，<br/>由你校对地点与时间，不擅自补全。</p></article><article><span className="how-number mono">02 / VERIFY</span><Fingerprint size={25} strokeWidth={1.5}/><h2>让规则对上你的日期</h2><p>查官方规则与近期公告，核对闭馆、<br/>入场和预约信息，保留每条证据。</p></article><article><span className="how-number mono">03 / REPAIR</span><Route size={25} strokeWidth={1.5}/><h2>发现问题，少改一点</h2><p>看清哪些安排需要重新确认，<br/>预览调整方案，再决定怎么走。</p></article></div></section>
    <section className="honesty-strip"><div><span className="honesty-star">✳</span><div><h2>知道边界，也是可靠的一部分。</h2><p>实时余票、预约库存与查不到的信息，会明确告诉你“尚无法确认”。</p></div></div><span className="real-counter"><strong>{stats.trips}</strong> 份真实行程已完成检查 <MoveRight size={18}/></span></section>
  </main><footer className="site-footer"><Brand small/><span>元宝搜索提供来源 · 日期与时间由规则核对</span><span className="mono">BUILT FOR THE JOURNEY AHEAD <ArrowUpRight size={13}/></span></footer></>;
}
