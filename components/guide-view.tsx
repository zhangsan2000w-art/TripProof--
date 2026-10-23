'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Images, X } from 'lucide-react';
import type { GuideSummary, Item } from '@/lib/domain';

export const guideImageUrl = (shareId: string, n: number) => `/api/reports/${encodeURIComponent(shareId)}/guide/${n}`;

/** The guide as the user submitted it: screenshots first, then the pasted text. */
export function GuideCard({ shareId, guide, onOpen }: { shareId: string; guide: GuideSummary; onOpen: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const long = guide.text.length > 180 || guide.text.split('\n').length > 5;
  const meta = [guide.images.length ? `${guide.images.length} 张截图` : '', guide.text ? `${guide.text.length.toLocaleString()} 字` : ''].filter(Boolean).join(' · ');
  return <section className="card guide-card no-print" aria-label="原攻略">
    <div className="guide-head"><h2><Images size={17}/>原攻略</h2><span>{meta}</span></div>
    {guide.images.length > 0 && <div className="guide-thumbs">{guide.images.map(n => <button type="button" key={n} onClick={() => onOpen(n)} aria-label={`查看原攻略第${n}张`}>
      <img src={guideImageUrl(shareId, n)} alt="" loading="lazy"/><span>{n}</span>
    </button>)}</div>}
    {guide.text && <div className={`guide-text ${open || !long ? 'open' : ''}`}><p>{guide.text}</p>
      {long && <button type="button" className="text-link" onClick={() => setOpen(!open)}>{open ? '收起' : '展开全文'}</button>}</div>}
  </section>;
}

/** Full-size view of one screenshot, with previous / next and keyboard support. */
export function GuideViewer({ shareId, images, at, onChange }: { shareId: string; images: number[]; at: number; onChange: (n: number | null) => void }) {
  const pos = images.indexOf(at), url = guideImageUrl(shareId, at);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChange(null);
      else if (e.key === 'ArrowLeft' && pos > 0) onChange(images[pos - 1]);
      else if (e.key === 'ArrowRight' && pos < images.length - 1) onChange(images[pos + 1]);
    };
    addEventListener('keydown', key);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  }, [pos, images, onChange]);
  return <div className="guide-viewer no-print" role="dialog" aria-modal="true" aria-label={`原攻略第${at}张`}>
    <div className="guide-viewer-bar">
      <span>原攻略 · 第 {at} 张{images.length > 1 ? ` / 共 ${images.length} 张` : ''}</span>
      <div>
        {images.length > 1 && <>
          <button type="button" disabled={pos <= 0} onClick={() => onChange(images[pos - 1])} aria-label="上一张"><ChevronLeft size={18}/></button>
          <button type="button" disabled={pos >= images.length - 1} onClick={() => onChange(images[pos + 1])} aria-label="下一张"><ChevronRight size={18}/></button>
        </>}
        <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>原图</a>
        <button type="button" onClick={() => onChange(null)} aria-label="关闭"><X size={18}/></button>
      </div>
    </div>
    <div className="guide-viewer-body" onClick={e => { if (e.target === e.currentTarget) onChange(null); }}>
      <img src={url} alt={`原攻略第${at}张`}/>
    </div>
  </div>;
}

/** What the guide said about one stop, with a link to the screenshot it came from. */
export function StopSource({ item, images, onOpen }: { item: Item; images: number[]; onOpen: (n: number) => void }) {
  const image = item.sourceImage && images.includes(item.sourceImage) ? item.sourceImage : null;
  return <div className="stop-source">
    <span className="stop-source-label">攻略原文{item.sourceImage ? ` · 图${item.sourceImage}` : ''}</span>
    <p>{item.sourceText}</p>
    {image && <button type="button" className="text-link" onClick={() => onOpen(image)}>看原图</button>}
  </div>;
}
