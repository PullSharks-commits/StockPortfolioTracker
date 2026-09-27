import React from 'react';
import { STATUS_LABEL, type ThesisStatus } from '../lib/thesis';

const STYLES: Record<ThesisStatus, string> = {
  on_track: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800',
  at_risk: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800',
  broken: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-800',
  no_data: 'bg-zinc-50 text-zinc-500 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700',
};

// Inset left bar for a holding row's first (sticky) cell, plus the cell's divider.
export const THESIS_ROW_EDGE: Record<ThesisStatus, string> = {
  on_track: 'shadow-[inset_3px_0_0_0_#10b981,1px_0_0_0_rgb(228_228_231)]',
  at_risk: 'shadow-[inset_3px_0_0_0_#f59e0b,1px_0_0_0_rgb(228_228_231)]',
  broken: 'shadow-[inset_3px_0_0_0_#e11d48,1px_0_0_0_rgb(228_228_231)]',
  no_data: 'shadow-[inset_3px_0_0_0_#d4d4d8,1px_0_0_0_rgb(228_228_231)]',
};

export function ThesisBadge({ status, title, onClick }: { status: ThesisStatus; title?: string; onClick?: (e: React.MouseEvent) => void }) {
  const cls = `inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset whitespace-nowrap ${STYLES[status]}`;
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={`${cls} hover:opacity-80`}>{STATUS_LABEL[status]}</button>
    : <span title={title} className={cls}>{STATUS_LABEL[status]}</span>;
}
