import Link from 'next/link';
import { Fingerprint } from 'lucide-react';
export function Brand({ small = false }: { small?: boolean }) {
  return <Link href="/" className={`brand ${small ? 'brand-small' : ''}`} aria-label="TripProof 首页"><span className="brand-icon"><Fingerprint size={small ? 16 : 19} strokeWidth={1.8}/></span><span className="brand-name">Trip<b>Proof</b></span>{!small && <span className="brand-tag">攻略出发前核对</span>}</Link>;
}
export function Header({ children }: React.PropsWithChildren) {
  return <header className="site-header no-print"><div className="header-inner"><Brand/><div className="header-right">{children ?? <a href="/#how" className="text-link">怎么核对的</a>}</div></div></header>;
}
export function Footer() {
  return <footer className="site-footer"><div className="footer-inner"><Brand small/><span>事实来自元宝 SearchPro 检索的原文，日期与时间由代码逐条核对。</span></div></footer>;
}
