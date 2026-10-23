import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { LockKeyhole } from 'lucide-react';
import { ACCESS_COOKIE, accessConfig, validAccessToken } from '@/lib/access';
import './globals.css';
export const metadata: Metadata = { title: 'TripProof — 攻略出发前核对', description: '上传或粘贴收藏的旅行攻略，按你的出行日期先查预警和区域关闭公告，再逐站核对开放、入场和预约规则；每条结论都有出处。' };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const config = accessConfig();
  const unlocked = config.mode === 'on' && validAccessToken((await cookies()).get(ACCESS_COOKIE)?.value, config);
  return <html lang="zh-CN" data-scroll-behavior="smooth"><body>{unlocked && <aside className="access-session no-print" aria-label="访问保护"><span><LockKeyhole size={12}/>私人试用 · 已解锁</span><form action="/api/access/logout" method="post"><button type="submit">锁定访问</button></form></aside>}{children}</body></html>;
}
