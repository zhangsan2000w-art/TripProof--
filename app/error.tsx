'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <main className="loading-page"><h1>页面暂时未能打开。</h1><p>已有行程和调查记录仍保留在服务器中。</p><button className="button button-primary" onClick={reset}>重试</button><Link href="/">返回首页</Link></main>; }
