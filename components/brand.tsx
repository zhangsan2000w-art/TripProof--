import Link from 'next/link';
import { Fingerprint, ArrowUpRight } from 'lucide-react';
export function Brand({ small = false }: { small?: boolean }) {
  return <Link href="/" className={`brand ${small ? 'brand-small' : ''}`} aria-label="TripProof 首页"><span className="brand-icon"><Fingerprint size={24} strokeWidth={1.7} /></span><span>Trip<span className="brand-proof">Proof</span><small>攻略压力测试</small></span></Link>;
}
export function Header({ children }: React.PropsWithChildren) {
  return <header className="site-header"><div className="header-inner"><Brand /><div className="header-right">{children ?? <><span className="header-note">出发前，多一份确定。</span><a href="#how-it-works" className="text-link">工作原理 <ArrowUpRight size={14}/></a></>}</div></div></header>;
}
