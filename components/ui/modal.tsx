'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({ children, title, close }: React.PropsWithChildren<{ title: string; close: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} className="modal" onCancel={close} aria-label={title} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="modal-heading"><h2>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="关闭"><X size={20} /></button></div>{children}
  </dialog>;
}
