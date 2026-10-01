// Choose a holding's theme for "Group by Theme": the automatic one (and why it was
// picked) or any theme from the list. Saved per ticker in the user's settings.

import React from 'react';
import { Check, X } from 'lucide-react';
import { THEMES, THEME_LABEL, type ThemeId, type ThemeSource } from '../lib/classification';

const WHY: Record<ThemeSource, string> = {
  yours: 'your choice',
  curated: 'from the built-in list',
  tracks: 'from the stock this fund tracks',
  industry: 'from its Yahoo industry',
  sector: 'from its Yahoo sector',
  fund: 'it is a fund',
  none: '',
};

export function ThemePicker({ ticker, current, auto, onPick, onClose }: {
  ticker: string;
  current: ThemeId;                                // what it's grouped under now
  auto: { theme: ThemeId; source: ThemeSource };   // what it would be without a choice
  onPick: (theme: ThemeId | null) => void;          // null = use the automatic theme
  onClose: () => void;
}) {
  const custom = current !== auto.theme || undefined;
  const choices = THEMES.filter(t => t.id !== 'cash');
  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Theme for ${ticker}`}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Theme for {ticker}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Automatic: {THEME_LABEL[auto.theme]}{WHY[auto.source] ? ` (${WHY[auto.source]})` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="py-1.5">
          <button
            onClick={() => onPick(null)}
            className="w-full flex items-center justify-between px-5 py-2 text-sm text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
          >
            <span>Automatic <span className="text-zinc-400">· {THEME_LABEL[auto.theme]}</span></span>
            {!custom && <Check className="w-4 h-4 text-indigo-600" />}
          </button>
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          {choices.map(t => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className="w-full flex items-center justify-between px-5 py-2 text-sm text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
            >
              {t.label}
              {custom && current === t.id && <Check className="w-4 h-4 text-indigo-600" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
