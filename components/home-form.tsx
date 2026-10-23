'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Upload, FileText, ImagePlus, X, LoaderCircle, Sparkles, Plus, Trash2, ShieldCheck, CalendarDays, MapPin, AlertCircle, Check } from 'lucide-react';
import type { Draft, Item, Trip } from '@/lib/domain';
import { kinds } from '@/lib/domain';
import { api, ApiError } from '@/lib/client';
import { submitExtraction, waitForExtraction } from '@/lib/extraction-client';
import { missingTimeNote } from '@/lib/itinerary';
import { prepareImages } from '@/lib/images-client';
import { Button } from './ui/button';
import { dateForDay, tomorrow, weekdayLabel } from '@/lib/dates';

const kindLabels = { museum: '博物馆', scenic: '景点', show: '演出', restaurant: '餐饮', transport: '交通', hotel: '住宿', other: '其他' };
const pendingKey = 'tripproof:pending-extraction';
const example = '杭州两日游\nDay 1\n09:00—11:00 浙江省博物馆之江馆区参观\n13:00—15:00 杭州西湖散步\n16:30—18:00 雷峰塔参观\nDay 2\n09:00—11:00 灵隐寺参观\n13:00—14:30 中国丝绸博物馆参观\n16:00—17:30 河坊街散步';
export function HomeForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'text' | 'image'>('text'), [text, setText] = useState(''), [files, setFiles] = useState<File[]>([]), [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draft, setDraft] = useState<Draft | null>(null), [items, setItems] = useState<Item[]>([]);
  const [startDate, setStartDate] = useState(tomorrow), [city, setCity] = useState(""), [origin, setOrigin] = useState(''), [arrival, setArrival] = useState(''), [departure, setDeparture] = useState(''), [travelMode, setTravelMode] = useState<'transit' | 'drive'>('transit');
  const effectiveDate = startDate || tomorrow();
  const [selected, setSelected] = useState(0), [dragging, setDragging] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const extractionController = useRef<AbortController | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [restoredImageCount, setRestoredImageCount] = useState(0);
  const acceptDraft = useCallback((draft: Draft) => {
    const next: Item[] = [];
    for (const day of draft.days) for (const extracted of day.items) {
      const previous = next.at(-1), { dependsOnPrevious, ...item } = extracted;
      next.push({ ...item, id: crypto.randomUUID(), day: day.dayIndex, dependsOn: dependsOnPrevious && previous?.day === day.dayIndex ? [previous.id] : [] });
    }
    setDraft(draft); setItems(next); setCity(current => next.find(i => i.city)?.city || current);
    document.getElementById('input')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const forgetJob = useCallback(() => {
    setPendingId(null);
    try { sessionStorage.removeItem(pendingKey); } catch { /* Storage can be disabled in an embedded browser. */ }
  }, []);
  const readJob = useCallback(async (jobId: string, signal: AbortSignal) => {
    try { const draft = await waitForExtraction(jobId, signal); if (!signal.aborted) { acceptDraft(draft); forgetJob(); } }
    catch (error) {
      if (signal.aborted) return;
      setError(error instanceof Error ? error.message : '读取暂未完成，可以继续读取同一任务。');
      if (error instanceof ApiError && [404, 422].includes(error.status)) forgetJob();
    } finally { if (!signal.aborted) setBusy(false); }
  }, [acceptDraft, forgetJob]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
      if (saved && typeof saved.id === 'string' && /^[\da-f-]{36}$/i.test(saved.id) && typeof saved.text === 'string') {
        setText(saved.text); setPendingId(saved.id); setBusy(true);
        if (Number.isInteger(saved.imageCount) && saved.imageCount > 0) { setRestoredImageCount(saved.imageCount); setMode('image'); }
        const control = new AbortController(); extractionController.current = control;
        void readJob(saved.id, control.signal);
      }
    } catch { /* A missing saved task does not prevent a fresh submission. */ }
    return () => extractionController.current?.abort();
  }, [readJob]);
  useEffect(() => { const urls = files.map(f => URL.createObjectURL(f)); setPreviews(urls); return () => urls.forEach(URL.revokeObjectURL); }, [files]);
  function addFiles(incoming: FileList | File[]) {
    const list = [...files, ...Array.from(incoming)];
    if (list.length > 9) { setError('每次最多上传9张图片。'); return; }
    if (list.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type))) { setError('请上传 JPG、PNG 或 WebP 图片。'); return; }
    forgetJob(); setRestoredImageCount(0); setFiles(list); setError('');
  }
  async function extract() {
    if (!pendingId && !text.trim() && !files.length) { setError('先粘贴一份攻略，或上传路线截图。'); return; }
    setBusy(true); setError('');
    const control = new AbortController(); extractionController.current?.abort(); extractionController.current = control;
    try {
      if (pendingId) { await readJob(pendingId, control.signal); return; }
      const images = await prepareImages(files);
      if (control.signal.aborted) return;
      const jobId = crypto.randomUUID(); setPendingId(jobId);
      setRestoredImageCount(0);
      try { sessionStorage.setItem(pendingKey, JSON.stringify({ id: jobId, text, imageCount: files.length })); } catch { /* Polling also works without browser storage. */ }
      await submitExtraction(jobId, { text, images }, control.signal);
      await readJob(jobId, control.signal);
    } catch (error) {
      if (control.signal.aborted) return;
      setError((error as Error).message);
      if (error instanceof ApiError && !error.retryable) forgetJob();
    } finally { if (!control.signal.aborted) setBusy(false); }
  }
  function update(itemId: string, change: Partial<Item>) { setItems(items => items.map(i => i.id === itemId ? { ...i, ...change } : i)); }
  async function confirm() {
    setBusy(true); setError('');
    try {
      const { trip } = await api<{ trip: Trip }>('/api/trips', { title: draft?.guideMeta.title || `${city}行程核对`, startDate: startDate || tomorrow(), originCity: origin, destinationCity: city, arriveDay1: arrival || null, leaveLastDay: departure || null, mode: travelMode, guidePublishedAt: draft?.guideMeta.publishedAt || null, items });
      try { await api(`/api/trips/${trip.id}/runs`, {}); }
      catch (error) { try { sessionStorage.setItem(`tripproof:start-error:${trip.id}`, (error as Error).message); } catch { /* The saved workspace still offers a retry. */ } }
      router.push(`/trips/${trip.id}`);
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }
  const days = [...new Set(items.map(i => i.day))].sort((a, b) => a - b);
  const removeItem = (id: string) => setItems(list => list.filter(i => i.id !== id).map(i => ({ ...i, dependsOn: i.dependsOn.filter(x => x !== id) })));
  if (draft) return <section className="review" id="input">
    <ol className="stepper" aria-label="步骤"><li className="done"><Check size={13}/>读取攻略</li><li className="current"><span>2</span>校对行程</li><li><span>3</span>开始核对</li></ol>
    <div className="review-head"><div><h2>先对一遍读取结果</h2><p>攻略没写的到达时间保持为空，不替你补。地点、日期和类型都可以直接改。</p></div><Button variant="outline" onClick={() => setDraft(null)} disabled={busy}><ArrowLeft size={15}/>返回修改</Button></div>
    {error && <div className="banner banner-error" role="alert"><AlertCircle size={17}/>{error}</div>}
    {restoredImageCount > 0 && <div className="banner"><AlertCircle size={17}/>已恢复图片读取结果。刷新前上传的{restoredImageCount}张图片需返回重新选择，才能对照原图。</div>}
    {draft.ambiguities.length > 0 && <div className="card ambiguities"><AlertCircle size={17}/><div><strong>读取时有 {draft.ambiguities.length} 处拿不准，请对照原图</strong>{draft.ambiguities.map((a, i) => <p key={i}>{a}</p>)}</div></div>}
    <div className="card context-form">
      <label>第1天日期<span className="field-with-icon"><CalendarDays size={15}/><input aria-label="第1天日期" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}/></span><small className="date-default-note">不填按明天（{tomorrow()}）出发</small></label>
      <label>目的城市<span className="field-with-icon"><MapPin size={15}/><input value={city} onChange={e => setCity(e.target.value)} placeholder="例如：广州" maxLength={60}/></span></label>
      <label>出发城市<input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="选填" maxLength={60}/></label>
      <label>第1天抵达<input type="time" value={arrival} onChange={e => setArrival(e.target.value)}/></label>
      <label>最后一天离开<input type="time" value={departure} onChange={e => setDeparture(e.target.value)}/></label>
      <label>出行方式<select value={travelMode} onChange={e => setTravelMode(e.target.value as 'transit' | 'drive')}><option value="transit">公共交通</option><option value="drive">自驾</option></select></label>
    </div>
    <div className={`review-grid ${!previews.length ? 'no-image' : ''}`}>
      {previews.length > 0 && <aside className="card original-pane"><div className="pane-title"><span>原始攻略</span><span>{previews.length} 张</span></div><div className="image-tabs">{previews.map((url, index) => <button key={url} onClick={() => setSelected(index)} className={selected === index ? 'active' : ''}>{index + 1}</button>)}</div>{/* User-provided images stay in this browser. */}<div className="original-image-scroll"><img src={previews[selected] || previews[0]} alt={`原始攻略第${selected + 1}张`}/></div><a className="text-link" href={previews[selected] || previews[0]} target="_blank" rel="noopener noreferrer">打开原图 ↗</a></aside>}
      <div className="card editable-pane"><div className="pane-title"><span>行程清单 · {items.length} 项</span><span>点击即可修改</span></div>
        {days.map(d => <div className="edit-day" key={d}><h3>第 {d} 天<small>{dateForDay(effectiveDate, d)} {weekdayLabel(dateForDay(effectiveDate, d))}</small></h3>
          {items.filter(i => i.day === d).map(item => { const index = items.indexOf(item); return <div key={item.id} className={`edit-item ${item.confidence < .7 ? 'low-confidence' : ''}`}>
            <div className="edit-main"><span className="item-number">{index + 1}</span><input className="place-input" aria-label={`第${index + 1}项地点`} value={item.placeName} onChange={e => update(item.id, { placeName: e.target.value })}/>
              <select aria-label={`第${index + 1}项类型`} value={item.kind} onChange={e => update(item.id, { kind: e.target.value as Item['kind'] })}>{kinds.map(k => <option value={k} key={k}>{kindLabels[k]}</option>)}</select>
              <label className="day-input">第<input aria-label={`第${index + 1}项所在天数`} type="number" min={1} max={30} value={item.day} onChange={e => update(item.id, { day: Number(e.target.value) })}/>天</label>
              <button type="button" className="icon-button delete-item" title="删除这项安排" aria-label={`删除${item.placeName}`} onClick={() => removeItem(item.id)}><Trash2 size={15}/></button></div>
            <div className="edit-sub"><label>到达<input type="time" value={item.start || ''} onChange={e => update(item.id, { start: e.target.value || null })}/></label><label>离开<input type="time" value={item.end || ''} onChange={e => update(item.id, { end: e.target.value || null })}/></label>{!item.start && <span className="missing-note">{missingTimeNote(item)}</span>}<input className="city-input" aria-label={`第${index + 1}项城市`} placeholder={city || '城市'} value={item.city || ''} onChange={e => update(item.id, { city: e.target.value || null })}/></div>
            <details className="source-detail"><summary>{item.confidence < .7 ? '读取不确定，请对照原文' : '原文与攻略写的规则'}{item.sourceImage ? ` · 图${item.sourceImage}` : ''}</summary><p>{item.sourceText}</p>{item.claimedRules.map((c, n) => <p className="claim-text" key={n}>攻略说：{c.text}</p>)}<label>活动说明<input value={item.activity} onChange={e => update(item.id, { activity: e.target.value })}/></label></details>
          </div>; })}
        </div>)}
        <Button variant="ghost" onClick={() => setItems(list => [...list, { id: crypto.randomUUID(), day: list.at(-1)?.day ?? 1, seq: list.length + 1, start: null, end: null, placeName: '新地点', city, kind: 'other', activity: '参观', sourceText: '用户手动添加的安排', sourceImage: null, confidence: 1, claimedRules: [], dependsOn: [] }])}><Plus size={15}/>添加安排</Button>
      </div>
    </div>
    {draft.recommendations.length > 0 && <details className="card recommendations"><summary>{draft.recommendations.length} 条住宿、美食或贴士没有排进行程</summary>{draft.recommendations.map((r, i) => <p key={i}><strong>{r.name}</strong> {r.note}</p>)}</details>}
    <div className="review-bar"><span><ShieldCheck size={16}/>{effectiveDate} 出发 · {days.length} 天 · {items.length} 项 · 原图不进入报告</span><Button onClick={confirm} disabled={busy || !items.length || !city.trim()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Check size={17}/>}确认行程，开始核对<ArrowRight size={16}/></Button></div>
  </section>;
  return <div className="card input-card" id="input">
    <div className="input-tabs" role="tablist" aria-label="攻略输入方式"><button role="tab" disabled={busy} aria-selected={mode === 'text'} className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><FileText size={16}/>粘贴攻略</button><button role="tab" disabled={busy} aria-selected={mode === 'image'} className={mode === 'image' ? 'active' : ''} onClick={() => setMode('image')}><ImagePlus size={16}/>上传截图</button></div>
    {mode === 'text' ? <div className="text-input-wrap"><textarea aria-label="旅行攻略文字" disabled={busy} maxLength={40000} value={text} onChange={e => { forgetJob(); setText(e.target.value); }} placeholder={'把收藏的攻略粘贴到这里…\n\n例如：\nDay 1 上午去博物馆，下午逛西湖\nDay 2 09:00 灵隐寺，16:30 雷峰塔'}/><div className="textarea-bottom"><span>保留原来的日期、地点和时间</span><span>{text.length.toLocaleString()} / 40,000</span></div></div> : <div className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) addFiles(e.dataTransfer.files); }}>
      <button className="upload-trigger" type="button" disabled={busy} onClick={() => upload.current?.click()}><span className="upload-icon"><Upload size={22}/></span><strong>把攻略截图放进来</strong><span>点击选择，或拖拽图片到这里</span><small>JPG / PNG / WebP，最多9张，单张15MB</small></button>
    </div>}
    <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}/>
    {files.length > 0 && <div className="upload-previews">{files.map((file, i) => <div key={`${file.name}-${i}`}><img src={previews[i]} alt={file.name}/><span>{i + 1}</span><button aria-label={`移除${file.name}`} onClick={() => setFiles(files.filter((_, n) => n !== i))}><X size={12}/></button></div>)}{files.length < 9 && <button className="add-image" onClick={() => upload.current?.click()} aria-label="继续添加图片"><Plus size={18}/></button>}</div>}
    {mode === 'image' && <textarea className="image-note" disabled={busy} value={text} onChange={e => { forgetJob(); setText(e.target.value); }} aria-label="图片补充文字" placeholder="也可以补充文字、路线或说明（选填）" maxLength={40000}/>}
    {error && <div className="banner banner-error" role="alert"><AlertCircle size={16}/>{error}</div>}
    <Button className="extract-button" onClick={extract} disabled={busy}>{busy ? <LoaderCircle size={18} className="spin"/> : <Sparkles size={17}/>}{busy ? '正在读取攻略，大约需要一分钟…' : pendingId ? '继续读取已提交的攻略' : '读取攻略，整理行程'}{!busy && <ArrowRight size={17}/>}</Button>
    <p className="input-footnote"><ShieldCheck size={14}/>{busy ? '正在整理文字和路线，刷新后可继续；还没有联网查证' : '先由你校对，再开始查证；不会替你编造行程'}</p>
    <div className="example-entry"><span>手边没有攻略？</span><button disabled={busy} onClick={() => { forgetJob(); setText(example); setMode('text'); setError(''); }}>填入示例 <ArrowRight size={13}/></button></div>
  </div>;
}
