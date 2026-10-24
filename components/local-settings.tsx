'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, KeyRound, LoaderCircle, PlugZap, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Button } from './ui/button';

type Status = { configured: boolean; enabled: boolean; yuanbao: boolean };
type CheckResult = { resultCount: number; bodyCount: number; latencyMs: number; requestId: string | null };
export function LocalSettingsLink() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { const controller = new AbortController(); fetch('/api/local-settings', { cache: 'no-store', signal: controller.signal }).then(r => setEnabled(r.ok)).catch(() => {}); return () => controller.abort(); }, []);
  return enabled ? <Link href="/settings" className="text-link local-settings-link"><KeyRound size={14}/>本机密钥</Link> : null;
}
export function LocalSettingsForm() {
  const [status, setStatus] = useState<Status | null>(null), [key, setKey] = useState(''), [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  useEffect(() => { const controller = new AbortController(); api<Status>('/api/local-settings', undefined, controller.signal).then(data => { setStatus(data); setEnabled(data.enabled); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, []);
  async function save(event?: FormEvent, clear = false) {
    event?.preventDefault(); setBusy(true); setError(''); setMessage(''); setCheck(null);
    try {
      const result = await api<Status>('/api/local-settings', { ...(clear ? { DEEPSEEK_API_KEY: '' } : key.trim() ? { DEEPSEEK_API_KEY: key.trim() } : {}), DEEPSEEK_SEARCH_ENABLED: enabled ? '1' : '0' });
      setStatus(result); setKey(''); setMessage(clear ? 'DeepSeek Key 已移除。' : '已保存，新的检索将使用此配置。');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setChecking(true); setError(''); setMessage(''); setCheck(null);
    try { setCheck(await api<CheckResult>('/api/local-settings/check', {})); }
    catch (e) { setError((e as Error).message); } finally { setChecking(false); }
  }
  return <form className="local-settings-form" onSubmit={save} autoComplete="off">
    <Link href="/" className="text-link"><ArrowLeft size={14}/>返回攻略核对</Link>
    <header><p className="kicker">DeepSeek Search</p><h1>本机密钥</h1></header>
    {error && <p className="banner banner-error" role="alert"><AlertCircle size={16}/>{error}</p>}
    <div className="local-key-field"><label htmlFor="deepseek-key"><strong>DeepSeek API Key</strong><span>{!status ? '读取中' : status.configured ? '已配置' : '未配置'}</span></label>
      <div><input id="deepseek-key" type="password" autoComplete="new-password" spellCheck={false} value={key} maxLength={512} disabled={!status || busy || checking} placeholder={status?.configured ? '输入新 Key 替换，留空保留' : '输入 DeepSeek API Key'} onChange={event => { setKey(event.target.value); setCheck(null); }}/><button type="button" className="icon-button" title="移除 DeepSeek Key" aria-label="移除 DeepSeek Key" disabled={!status?.configured || busy || checking} onClick={() => void save(undefined, true)}><Trash2 size={16}/></button></div>
    </div>
    <label className="local-search-toggle"><input type="checkbox" checked={enabled} disabled={!status || busy || checking} onChange={event => { setEnabled(event.target.checked); setCheck(null); }}/>启用 DeepSeek Search</label>
    <dl className="local-settings-state"><div><dt>DeepSeek</dt><dd>{!status ? '读取中' : !status.configured ? '未配置' : status.enabled ? '已启用' : '已停用'}</dd></div><div><dt>元宝 SearchPro</dt><dd>{!status ? '读取中' : status.yuanbao ? '已配置 · 保持原配置' : '未配置'}</dd></div></dl>
    {message && <p className="local-settings-message" role="status">{message}</p>}
    <div className="local-settings-actions"><Button type="submit" disabled={!status || busy || checking || (!key.trim() && enabled === status.enabled)}>{busy ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>}保存密钥</Button><Button type="button" variant="outline" disabled={!status?.configured || busy || checking || Boolean(key.trim()) || enabled !== status.enabled} onClick={verify} title="将发起一次真实 DeepSeek 搜索请求">{checking ? <LoaderCircle size={15} className="spin"/> : <PlugZap size={15}/>}验证接口</Button></div>
    {check && <div className={`local-settings-check ${check.resultCount ? '' : 'is-empty'}`} role="status"><strong><CheckCircle2 size={16}/>{check.resultCount ? '接口验证成功' : '接口已响应，但未返回有效结果'}</strong><p>{check.resultCount} 条结果 · {check.bodyCount} 条含正文 · {check.latencyMs} ms</p>{check.requestId && <code>RequestId: {check.requestId}</code>}</div>}
    <p className="local-settings-note">Key 仅保存在本机服务端，不回显，不进入浏览器存储、报告或 Git。</p>
    <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-link">DeepSeek 控制台</a>
  </form>;
}
