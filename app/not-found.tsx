import Link from 'next/link';
import { Header } from '@/components/brand';
export default function NotFound() { return <><Header/><main className="center-page"><h1>这份报告暂时找不到</h1><p>链接可能不完整，请检查后再试。</p><Link className="button button-primary" href="/">回到首页</Link></main></>; }
