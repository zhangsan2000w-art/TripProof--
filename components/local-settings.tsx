'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, KeyRound, LoaderCircle, PlugZap, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Button } from './ui/button';

type Status = { configured: boolean; enabled: boolean; yuanbao: boolean; yuanbaoConfigured: boolean; yuanbaoKeyCount: number; yuanbaoEnabled: boolean; yuanbaoAuthMode: 'api-key' | 'tencent' };
type CheckResult = { resultCount: number; bodyCount: number; latencyMs: number; requestId: string | null };
export function LocalSettingsLink() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { const controller = new AbortController(); fetch('/api/local-settings', { cache: 'no-store', signal: controller.signal }).then(r => setEnabled(r.ok)).catch(() => {}); return () => controller.abort(); }, []);
  return enabled ? <Link href="/settings" className="text-link local-settings-link"><KeyRound size={14}/>本机密钥</Link> : null;
}
export function LocalSettingsForm() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); api<Status>('/api/local-settings', undefined, controller.signal).then(setStatus).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, []);
  return <div className="local-settings-form">
    <Link href="/" className="text-link"><ArrowLeft size={14}/>返回攻略核对</Link>
    <header><p className="kicker">搜索信源</p><h1>本机密钥</h1></header>
    {error && <p className="banner banner-error" role="alert"><AlertCircle size={16}/>{error}</p>}
    <ProviderSettings provider="yuanbao" status={status} onSaved={setStatus}/>
    <ProviderSettings provider="deepseek" status={status} onSaved={setStatus}/>
    <p className="local-settings-note">Key 仅保存在本机服务端，不回显，不进入浏览器存储、报告或 Git。</p>
  </div>;
}
function ProviderSettings({ provider, status, onSaved }: { provider: 'yuanbao' | 'deepseek'; status: Status | null; onSaved: (status: Status) => void }) {
  const yuanbao = provider === 'yuanbao', name = yuanbao ? '元宝 SearchPro' : 'DeepSeek Search';
  const configured = status ? yuanbao ? status.yuanbaoConfigured : status.configured : false;
  const savedEnabled = status ? yuanbao ? status.yuanbaoEnabled : status.enabled : true;
  const [key, setKey] = useState(''), [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  useEffect(() => { setEnabled(savedEnabled); }, [savedEnabled]);
  async function save(event?: FormEvent, clear = false) {
    event?.preventDefault(); setBusy(true); setError(''); setMessage(''); setCheck(null);
    try {
      const keyField = yuanbao ? 'WSA_API_KEYS' : 'DEEPSEEK_API_KEY', enabledField = yuanbao ? 'WSA_SEARCH_ENABLED' : 'DEEPSEEK_SEARCH_ENABLED';
      const result = await api<Status>('/api/local-settings', { ...(clear ? { [keyField]: '' } : key.trim() ? { [keyField]: key.trim() } : {}), [enabledField]: enabled ? '1' : '0' });
      onSaved(result); setKey(''); setMessage(clear ? `${name} Key 已移除。` : '已保存，新的检索将使用此配置。');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setChecking(true); setError(''); setMessage(''); setCheck(null);
    try { setCheck(await api<CheckResult>('/api/local-settings/check', { provider })); }
    catch (e) { setError((e as Error).message); } finally { setChecking(false); }
  }
  return <form className="local-provider-settings" aria-label={`${name} 配置`} onSubmit={save} autoComplete="off">
    <header><h2>{name}</h2>{yuanbao && <span className="kicker">服务 API</span>}</header>
    {error && <p className="banner banner-error" role="alert"><AlertCircle size={16}/>{error}</p>}
    <div className="local-key-field"><label htmlFor={`${provider}-key`}><strong>{yuanbao ? '元宝 SearchPro' : 'DeepSeek'} API Key</strong><span>{!status ? '读取中' : configured ? yuanbao ? status.yuanbaoAuthMode === 'tencent' ? '已配置 · 原有云鉴权' : `已配置 ${status.yuanbaoKeyCount} 个 Key · 轮询调用` : '已配置' : '未配置'}</span></label>
      <div><input id={`${provider}-key`} type="password" autoComplete="new-password" spellCheck={false} value={key} maxLength={yuanbao ? 16384 : 512} disabled={!status || busy || checking} placeholder={configured ? '输入新 Key 替换，留空保留' : yuanbao ? '输入一个或多个 Key，用逗号分隔' : '输入 DeepSeek API Key'} onChange={event => { setKey(event.target.value); setCheck(null); }} onPaste={event => {
        if (!yuanbao) return;
        const pasted = event.clipboardData.getData('text');
        if (!/[\r\n]/.test(pasted)) return;
        event.preventDefault();
        const field = event.currentTarget, next = pasted.split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean).join(',');
        setKey((key.slice(0, field.selectionStart ?? key.length) + next + key.slice(field.selectionEnd ?? key.length)).slice(0, 16384)); setCheck(null);
      }}/><button type="button" className="icon-button" title={`移除${name} Key`} aria-label={`移除${name} Key`} disabled={!configured || busy || checking} onClick={() => void save(undefined, true)}><Trash2 size={16}/></button></div>
    </div>
    {yuanbao && <p className="local-settings-note">最多 32 个 Key，用英文逗号分隔，也可粘贴每行一个的列表。请求依次轮换，失效、额度不足或限流的 Key 暂时跳过；搜索总预算保持不变。</p>}
    <label className="local-search-toggle"><input type="checkbox" checked={enabled} disabled={!status || busy || checking} onChange={event => { setEnabled(event.target.checked); setCheck(null); }}/>启用{name}</label>
    {message && <p className="local-settings-message" role="status">{message}</p>}
    <div className="local-settings-actions"><Button type="submit" disabled={!status || busy || checking || (!key.trim() && enabled === savedEnabled)}>{busy ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>}保存密钥</Button><Button type="button" variant="outline" disabled={!configured || busy || checking || Boolean(key.trim()) || enabled !== savedEnabled} onClick={verify} title={`将发起一次真实${name}搜索请求`}>{checking ? <LoaderCircle size={15} className="spin"/> : <PlugZap size={15}/>}验证接口</Button></div>
    {check && <div className={`local-settings-check ${check.resultCount ? '' : 'is-empty'}`} role="status"><strong><CheckCircle2 size={16}/>{check.resultCount ? '接口验证成功' : '接口已响应，但未返回有效结果'}</strong><p>{check.resultCount} 条结果 · {check.bodyCount} 条含正文 · {check.latencyMs} ms</p>{check.requestId && <code>RequestId: {check.requestId}</code>}</div>}
    {!yuanbao && <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-link">DeepSeek 控制台</a>}
  </form>;
}
