import { useEffect, type ReactNode } from 'react';
import { initialsOf } from '../lib/format';

/* ------------------------------- Avatar ------------------------------- */

export function Avatar({
  name,
  src,
  size = 32,
  title,
}: {
  name: string;
  src?: string | null;
  size?: number;
  title?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        title={title ?? name}
        style={style}
        className="shrink-0 rounded-full object-cover ring-1 ring-slate-200"
        loading="lazy"
      />
    );
  }
  return (
    <span
      title={title ?? name}
      style={style}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-700 font-semibold text-white ring-1 ring-brand-800/30"
    >
      {initialsOf(name)}
    </span>
  );
}

/* ------------------------------- Drawer ------------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade bg-slate-900/45" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative flex h-full w-full animate-drawer flex-col bg-white shadow-2xl ${width}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-navy-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="thin-scroll flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------ Confirmação ---------------------------- */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Voltar',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade bg-slate-900/50" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-md animate-fade rounded-xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-navy-900">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed text-slate-600">{message}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${
              danger ? 'bg-danger-600 hover:bg-danger-700' : 'bg-brand-700 hover:bg-brand-800'
            }`}
          >
            {busy ? 'Processando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Toasts ------------------------------- */

export type ToastItem = {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
};

export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,26rem)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto animate-fade rounded-lg px-4 py-3 text-sm shadow-lg ring-1 ${
            t.kind === 'success'
              ? 'bg-success-50 text-success-600 ring-success-600/30'
              : t.kind === 'error'
                ? 'bg-danger-50 text-danger-700 ring-danger-600/30'
                : 'bg-brand-50 text-brand-800 ring-brand-600/30'
          }`}
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fechar aviso"
              className="-mr-1 rounded p-0.5 opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Diversos ------------------------------- */

export function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'red' | 'slate' | 'amber' | 'blue';
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    green: 'bg-success-50 text-success-600 ring-success-600/30',
    red: 'bg-danger-50 text-danger-700 ring-danger-600/30',
    slate: 'bg-slate-100 text-slate-600 ring-slate-400/30',
    amber: 'bg-warning-50 text-warning-600 ring-warning-600/30',
    blue: 'bg-brand-50 text-brand-800 ring-brand-600/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mb-3 text-3xl" aria-hidden="true">
        📅
      </div>
      <h3 className="text-base font-semibold text-navy-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700" />
      {label}
    </div>
  );
}
