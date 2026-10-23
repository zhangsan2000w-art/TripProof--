'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Upload, FileText, ImagePlus, X, LoaderCircle, Sparkles, Plus, Trash2, ShieldCheck, CalendarDays, MapPin, AlertCircle, Check } from 'lucide-react';
import type { Draft, Item, Trip } from '@/lib/domain';
import { kinds } from '@/lib/domain';
import { api } from '@/lib/client';
import { prepareImages } from '@/lib/images-client';
import { Button } from './ui/button';
import { dateForDay, tomorrow, weekdayLabel } from '@/lib/dates';

const kindLabels = { museum: '博物馆', scenic: '景点', show: '演出', restaurant: '餐饮', transport: '交通', hotel: '住宿', other: '其他' };
const example = '杭州两日游\nDay 1\n09:00—11:00 浙江省博物馆之江馆区参观\n13:00—15:00 杭州西湖散步\n16:30—18:00 雷峰塔参观\nDay 2\n09:00—11:00 灵隐寺参观\n13:00—14:30 中国丝绸博物馆参观\n16:00—17:30 河坊街散步';
export function HomeForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'text' | 'image'>('text'), [text, setText] = useState(''), [files, setFiles] = useState<File[]>([]), [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draft, setDraft] = useState<Draft | null>(null), [items, setItems] = useState<Item[]>([]);
  const [startDate, setStartDate] = useState(tomorrow), [city, setCity] = useState('杭州'), [origin, setOrigin] = useState(''), [arrival, setArrival] = useState(''), [departure, setDeparture] = useState(''), [travelMode, setTravelMode] = useState<'transit' | 'drive'>('transit');
  const effectiveDate = startDate || tomorrow();
  const [selected, setSelected] = useState(0), [dragging, setDragging] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => { const urls = files.map(f => URL.createObjectURL(f)); setPreviews(urls); return () => urls.forEach(URL.revokeObjectURL); }, [files]);
  function addFiles(incoming: FileList | File[]) {
    const list = [...files, ...Array.from(incoming)];
    if (list.length > 6) { setError('每次最多上传6张图片。'); return; }
    if (list.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type))) { setError('请上传 JPG、PNG 或 WebP 图片。'); return; }
    setFiles(list); setError('');
  }
  async function extract() {
    if (!text.trim() && !files.length) { setError('先粘贴一份攻略，或上传路线截图。'); return; }
    setBusy(true); setError('');
    try {
      const images = await prepareImages(files);
      const { draft } = await api<{ draft: Draft }>('/api/extract', { text, images });
      const next: Item[] = [];
      for (const day of draft.days) for (const extracted of day.items) {
        const previous = next.at(-1); const { dependsOnPrevious, ...item } = extracted;
        next.push({ ...item, id: crypto.randomUUID(), day: day.dayIndex, dependsOn: dependsOnPrevious && previous?.day === day.dayIndex ? [previous.id] : [] });
      }
      setDraft(draft); setItems(next); setCity(next.find(i => i.city)?.city || city);
      document.getElementById('input')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  function update(itemId: string, change: Partial<Item>) { setItems(items => items.map(i => i.id === itemId ? { ...i, ...change } : i)); }
  async function confirm() {
    setBusy(true); setError('');
    try {
      const { trip } = await api<{ trip: Trip }>('/api/trips', { title: draft?.guideMeta.title || `${city}行程压力测试`, startDate: startDate || tomorrow(), originCity: origin, destinationCity: city, arriveDay1: arrival || null, leaveLastDay: departure || null, mode: travelMode, guidePublishedAt: draft?.guideMeta.publishedAt || null, items });
      try { await api(`/api/trips/${trip.id}/runs`, {}); } catch { /* The workspace retains the trip and offers a visible retry. */ }
      router.push(`/trips/${trip.id}`);
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }
  if (draft) return <section className="review-section" id="input">
    <div className="section-eyebrow"><span className="step-dot">01</span> 确认你的行程 <span className="eyebrow-divider"/> 搜索还未开始</div>
    <div className="review-title"><div><h2>先对一遍，再出发查证。</h2><p>未写明的时间保持为空。你可以补充、调整或删除安排。</p></div><Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}><ArrowLeft size={15}/> 返回输入</Button></div>
    {error && <div className="error-banner" role="alert"><AlertCircle size={17}/>{error}</div>}
    {draft.ambiguities.length > 0 && <div className="ambiguities"><AlertCircle size={17}/><div><strong>有几处需要你确认</strong>{draft.ambiguities.map((a, i) => <p key={i}>{a}</p>)}</div></div>}
    <div className="context-form">
      <label>第1天日期<span className="field-with-icon"><CalendarDays size={16}/><input aria-label="第1天日期" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}/></span><small className="date-default-note">不填按明天（{tomorrow()}）出发</small></label>
      <label>目的城市<span className="field-with-icon"><MapPin size={16}/><input value={city} onChange={e => setCity(e.target.value)} placeholder="例如：杭州" maxLength={60}/></span></label>
      <label>出发城市<input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="选填" maxLength={60}/></label>
      <label>第1天抵达时间<input type="time" value={arrival} onChange={e => setArrival(e.target.value)}/></label>
      <label>最后一天离开时间<input type="time" value={departure} onChange={e => setDeparture(e.target.value)}/></label>
      <label>出行方式<select value={travelMode} onChange={e => setTravelMode(e.target.value as 'transit' | 'drive')}><option value="transit">公共交通</option><option value="drive">自驾</option></select></label>
    </div>
    <div className={`review-grid ${!previews.length ? 'review-no-image' : ''}`}>
      {previews.length > 0 && <aside className="original-pane"><div className="pane-title"><span>原始攻略</span><span>{previews.length} 张</span></div><div className="image-tabs">{previews.map((url, index) => <button key={url} onClick={() => setSelected(index)} className={selected === index ? 'active' : ''}>{index + 1}</button>)}</div><div className="image-controls"><span>可在图内滚动查看</span><a href={previews[selected] || previews[0]} target="_blank" rel="noopener noreferrer">打开原图 ↗</a></div>{/* User-provided images stay in this browser. */}<div className="original-image-scroll"><img src={previews[selected] || previews[0]} alt={`原始攻略第${selected + 1}张`} /></div></aside>}
      <div className="editable-pane"><div className="pane-title"><span>行程清单 <b>{items.length}</b></span><span>点击字段即可修改</span></div>
        {items.map((item, index) => <div key={item.id} className={`edit-item ${item.confidence < .7 ? 'low-confidence' : ''}`}>
          <div className="edit-item-top"><span className="item-number">{String(index + 1).padStart(2, '0')}</span><label className="day-input">第<input aria-label={`第${index + 1}项所在天数`} type="number" min={1} max={30} value={item.day} onChange={e => update(item.id, { day: Number(e.target.value) })}/>天</label><span className="subtle">{dateForDay(effectiveDate, item.day)} {weekdayLabel(dateForDay(effectiveDate, item.day))}</span><button type="button" className="icon-button delete-item" title="删除这项安排" aria-label={`删除${item.placeName}`} onClick={() => setItems(list => list.filter(i => i.id !== item.id).map(i => ({ ...i, dependsOn: i.dependsOn.filter(id => id !== item.id) })))}><Trash2 size={15}/></button></div>
          <div className="edit-fields"><input className="place-input" aria-label={`第${index + 1}项地点`} value={item.placeName} onChange={e => update(item.id, { placeName: e.target.value })}/><input aria-label={`第${index + 1}项城市`} placeholder={city} value={item.city || ''} onChange={e => update(item.id, { city: e.target.value || null })}/><select aria-label={`第${index + 1}项类型`} value={item.kind} onChange={e => update(item.id, { kind: e.target.value as Item['kind'] })}>{kinds.map(k => <option value={k} key={k}>{kindLabels[k]}</option>)}</select></div>
          <div className="edit-times"><label>计划开始<input type="time" value={item.start || ''} onChange={e => update(item.id, { start: e.target.value || null })}/></label><span>—</span><label>计划结束<input type="time" value={item.end || ''} onChange={e => update(item.id, { end: e.target.value || null })}/></label>{!item.start && <span className="missing-note">原文未写明时间</span>}</div>
          <details className="source-detail"><summary>{item.confidence < .7 ? '⚠ 读取不确定，请对照原文' : '查看原文与攻略声称的规则'}{item.sourceImage ? ` · 图${item.sourceImage}` : ''}</summary><p>{item.sourceText}</p>{item.claimedRules.map((c, n) => <p className="claim-text" key={n}>攻略说：{c.text}</p>)}<label>活动说明<input value={item.activity} onChange={e => update(item.id, { activity: e.target.value })}/></label></details>
        </div>)}
        <Button variant="ghost" onClick={() => setItems(list => [...list, { id: crypto.randomUUID(), day: list.at(-1)?.day ?? 1, seq: list.length + 1, start: null, end: null, placeName: '新地点', city, kind: 'other', activity: '参观', sourceText: '用户手动添加的安排', sourceImage: null, confidence: 1, claimedRules: [], dependsOn: [] }])}><Plus size={15}/> 添加安排</Button>
      </div>
    </div>
    {draft.recommendations.length > 0 && <details className="recommendations"><summary>{draft.recommendations.length} 条住宿、美食或备选建议未自动排入行程</summary>{draft.recommendations.map((r, i) => <p key={i}><strong>{r.name}</strong> {r.note}</p>)}</details>}
    <div className="review-bottom"><span><ShieldCheck size={17}/> {effectiveDate} 出发 · 原图不进入报告</span><Button onClick={confirm} disabled={busy || !items.length || !city.trim()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Check size={17}/>} 确认行程，开始压力测试 <ArrowRight size={16}/></Button></div>
  </section>;
  return <div className="input-card" id="input">
    <div className="input-card-heading"><span className="input-card-label"><span className="small-dot"/> 新建一次压力测试</span><span className="mono subtle">NO. 001</span></div>
    <div className="input-tabs" role="tablist" aria-label="攻略输入方式"><button role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><FileText size={16}/>粘贴攻略</button><button role="tab" aria-selected={mode === 'image'} className={mode === 'image' ? 'active' : ''} onClick={() => setMode('image')}><ImagePlus size={16}/>上传截图</button></div>
    {mode === 'text' ? <div className="text-input-wrap"><textarea aria-label="旅行攻略文字" maxLength={40000} value={text} onChange={e => setText(e.target.value)} placeholder={'把收藏的攻略粘贴到这里…\n\n例如：\nDay 1 上午去博物馆，下午逛西湖\nDay 2 09:00 灵隐寺，16:30 雷峰塔'}/><div className="textarea-bottom"><span>保留原来的日期、地点和时间</span><span>{text.length.toLocaleString()} / 40,000</span></div></div> : <div className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
      <button className="upload-trigger" type="button" onClick={() => upload.current?.click()}><span className="upload-icon"><Upload size={25}/></span><strong>把攻略截图放进来</strong><span>点击选择，或拖拽图片到这里</span><small>支持 JPG / PNG / WebP，最多6张，单张15MB</small></button>
    </div>}
    <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}/>
    {files.length > 0 && <div className="upload-previews">{files.map((file, i) => <div key={`${file.name}-${i}`}><img src={previews[i]} alt={file.name}/><span>{i + 1}</span><button aria-label={`移除${file.name}`} onClick={() => setFiles(files.filter((_, n) => n !== i))}><X size={12}/></button></div>)}<button className="add-image" onClick={() => upload.current?.click()} aria-label="继续添加图片"><Plus size={20}/></button></div>}
    {mode === 'image' && <textarea className="image-note" value={text} onChange={e => setText(e.target.value)} aria-label="图片补充文字" placeholder="也可以补充文字、路线或说明（选填）" maxLength={40000}/>}
    {error && <div className="error-banner" role="alert"><AlertCircle size={16}/>{error}</div>}
    <Button className="extract-button" onClick={extract} disabled={busy}>{busy ? <LoaderCircle size={18} className="spin"/> : <Sparkles size={17}/>} {busy ? '正在读取攻略，请稍候…' : '读取攻略，整理行程'}{!busy && <ArrowRight size={17}/>}</Button>
    <div className="input-footnote"><ShieldCheck size={14}/>{busy ? '正在读取文字与路线，尚未联网查证' : '先校对，再查证。不会替你编造行程。'}</div>
    <div className="example-entry"><span>还没准备好攻略？</span><button onClick={() => { setText(example); setMode('text'); setError(''); }}>填入杭州示例 <ArrowRight size={13}/></button></div>
  </div>;
}
