import type { ReactNode } from 'react';
import type { ReviewPriority } from '@wf/shared';
import { avColor, dotColor, dots, priorityLabel } from '../../lib/format.js';
import { useUiStore } from '../../store.js';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'error' | 'info' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PriBadge({ value }: { value: ReviewPriority }) {
  const tone = value === 'p0' ? 'error' : value === 'p1' ? 'warn' : 'info';
  return <Badge tone={tone}>{priorityLabel(value)}</Badge>;
}

export function Certainty({ value }: { value: number }) {
  return <span className="certainty" style={{ color: dotColor(value) }}>{dots(value)}</span>;
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" style={{ background: avColor(name) }}>{name.slice(0, 1)}</span>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-ov" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><button type="button" onClick={onClose}>×</button></header>
        {children}
      </section>
    </div>
  );
}

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);
  if (!toast) return null;
  return <button type="button" className={`toast toast-${toast.type}`} onClick={clearToast}>{toast.msg}</button>;
}
