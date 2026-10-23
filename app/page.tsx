import Link from 'next/link';
import { ScanText, Fingerprint, Route, ArrowUpRight, Siren, CalendarCheck, Link2, CircleHelp } from 'lucide-react';
import { Header, Footer } from '@/components/brand';
import { HomeForm } from '@/components/home-form';
import { StatusBar } from '@/components/trip-ui';
import { statistics } from '@/lib/store';
import { sampleEndDate, sampleReports } from '@/lib/samples';
const monthDay = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default function Home() {
  const stats = statistics(), samples = sampleReports();
  return <><Header/><main className="home">
    <section className="hero page">
      <div className="hero-copy">
        <p className="kicker"><span className="dot"/>给收藏的攻略做一次出发前核对</p>
        <h1>攻略说能去，<br/>那天<em>真的能去吗？</em></h1>
        <p className="lead">上传小红书截图或粘贴攻略文字，按你的出行日期逐站核对。</p>
        <ul className="hero-points">
          <li><CalendarCheck size={18}/><span><strong>规则对上你的日期</strong>闭馆日、停止入场、预约放票，按你去的那一天来算。</span></li>
          <li><Siren size={18}/><span><strong>临时关闭照样查出来</strong>景区发了临时关闭公告，就不会再按平时的开放时间说能去。</span></li>
          <li><Link2 size={18}/><span><strong>每条结论都有出处</strong>点开就是原文引文和链接；查不到就标“待核实”。</span></li>
        </ul>
      </div>
      <HomeForm/>
    </section>
    {samples.length > 0 && <section className="samples page" aria-label="真实攻略的核对结果">
      <div className="section-head"><h2>真实攻略的核对结果</h2><span>{samples.length} 份小红书攻略，点开即看，无需等待</span></div>
      <div className="sample-grid">{samples.map(s => <Link key={s.shareId} href={`/r/${s.shareId}`} className={`card sample-card tone-${s.tone}`}>
        <span className="sample-meta">{s.city} · {monthDay(s.startDate)}{s.days > 1 ? `—${monthDay(sampleEndDate(s))}` : ''} · {s.stops} 个地点</span>
        <h3>{s.title}</h3>
        <p className="sample-finding">{s.finding}</p>
        <StatusBar counts={s.counts}/>
        <span className="sample-open">查看报告 <ArrowUpRight size={14}/></span>
      </Link>)}</div>
    </section>}
    <section className="steps page" id="how">
      <div className="section-head"><h2>怎么核对的</h2><span>三步，每一步都留有记录</span></div>
      <div className="step-grid">
        <article className="card"><span className="step-no">1</span><ScanText size={22}/><h3>读懂原来的安排</h3><p>截图和文字都可以。整理成行程后由你校对，没写的时间不替你补。</p></article>
        <article className="card"><span className="step-no">2</span><Fingerprint size={22}/><h3>逐站查规则</h3><p>搜索官方与可靠来源，核对每一站的开放、入场、预约规则和临时关闭公告。</p></article>
        <article className="card"><span className="step-no">3</span><Route size={22}/><h3>发现问题，少改一点</h3><p>标出需要调整和待核实的地点，给出换天或换时段的方案，应用前先预览。</p></article>
      </div>
    </section>
    <section className="honesty page"><div className="card honesty-card"><CircleHelp size={22}/><div><h2>查不到，就说不知道</h2><p>实时余票、预约库存和没有可靠来源的信息，会明确标为“待核实”，不会说成能去。</p></div><span className="real-counter"><strong>{stats.trips}</strong>份真实行程已完成核对</span></div></section>
  </main><Footer/></>;
}
