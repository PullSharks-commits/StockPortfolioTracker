import React from 'react';
import { RATING_LABEL, type Rating } from '../lib/thesisTracker';

const STYLES: Record<Rating, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800',
  yellow: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800',
  red: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-800',
};

// Inset left bar for a holding row's first (sticky) cell, plus the cell's divider.
export const THESIS_ROW_EDGE: Record<Rating, string> = {
  green: 'shadow-[inset_3px_0_0_0_#10b981,1px_0_0_0_rgb(228_228_231)]',
  yellow: 'shadow-[inset_3px_0_0_0_#f59e0b,1px_0_0_0_rgb(228_228_231)]',
  red: 'shadow-[inset_3px_0_0_0_#e11d48,1px_0_0_0_rgb(228_228_231)]',
};

export const RATING_DOT: Record<Rating, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-rose-500' };

export function ThesisBadge({ rating, title, onClick }: { rating: Rating; title?: string; onClick?: (e: React.MouseEvent) => void }) {
  const cls = `inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset whitespace-nowrap ${STYLES[rating]}`;
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={`${cls} hover:opacity-80`}>{RATING_LABEL[rating]}</button>
    : <span title={title} className={cls}>{RATING_LABEL[rating]}</span>;
}
