// App-styled replacement for window.confirm(): `await confirmDialog({...})` resolves
// true/false. Mount <ConfirmDialogHost /> once (App does); calls from anywhere show
// in it, one at a time.

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Request = ConfirmOptions & { resolve: (ok: boolean) => void };
let show: ((req: Request) => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) {
      // Host not mounted (shouldn't happen): fall back to the browser dialog.
      resolve(window.confirm(options.title));
      return;
    }
    show({ ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => {
    show = (req) => setQueue((q) => [...q, req]);
    return () => { show = null; };
  }, []);

  useEffect(() => {
    if (!current) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  const close = (ok: boolean) => {
    current?.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  if (!current) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={() => close(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {current.danger && (
            <div className="shrink-0 rounded-full bg-rose-50 dark:bg-rose-950 p-2">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
          )}
          <div>
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{current.title}</h3>
            {current.message && <div className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">{current.message}</div>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => close(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {current.cancelLabel || 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            onClick={() => close(true)}
            className={current.danger
              ? 'px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700'
              : 'px-4 py-2 rounded-lg text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800'}
          >
            {current.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
