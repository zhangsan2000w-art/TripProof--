import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LockKeyhole, ArrowRight } from 'lucide-react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { ACCESS_COOKIE, accessConfig, safeAccessNext, validAccessToken } from '@/lib/access';

export const dynamic = 'force-dynamic';
export const metadata = { title: '访问密码 · TripProof', robots: { index: false, follow: false } };

export default async function AccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, config = accessConfig(), next = safeAccessNext(params.next);
  if (config.mode === 'off' || validAccessToken((await cookies()).get(ACCESS_COOKIE)?.value, config)) redirect(next);
  const error = params.error === 'limited' ? `尝试次数过多，请在 ${Math.max(1, Math.min(15, Math.ceil(Number(params.retry) / 60) || 15))} 分钟后重试。` : params.error === 'invalid' ? '密码不正确，请再试一次。' : '';
  return <main className="access-shell"><div className="access-brand"><Brand/></div><section className="access-card" aria-labelledby="access-title">
    <span className="access-icon"><LockKeyhole size={25} strokeWidth={1.6}/></span>
    <p className="access-eyebrow mono">TRIPPROOF · PRIVATE PREVIEW</p>
    <h1 id="access-title">先输密码，再出发。</h1>
    <p className="access-description">这是一个私人试用空间。<br/>输入访问密码，查看行程和调查报告。</p>
    {config.mode === 'invalid' ? <p className="access-error" role="alert">访问保护尚未配置完成，请联系部署者。</p> : <form action="/api/access/login" method="post">
      <input type="hidden" name="next" value={next}/>
      <label htmlFor="access-password">访问密码</label>
      <input id="access-password" name="password" type="password" autoComplete="current-password" placeholder="请输入访问密码" required maxLength={256} autoFocus aria-invalid={Boolean(error)} aria-describedby={error ? 'access-error' : undefined}/>
      {error && <p id="access-error" className="access-error" role="alert">{error}</p>}
      <Button type="submit">进入 TripProof <ArrowRight size={16}/></Button>
      <p className="access-note">此浏览器记住 7 天，可随时点击“锁定访问”。</p>
    </form>}
  </section><p className="access-footer">出发前，多一份确定。</p></main>;
}
