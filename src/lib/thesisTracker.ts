// Types and labels for the Thesis Tracker data served by /api/thesis-tracker
// (server-thesis-tracker.ts reads the tracker's files).

export type { Rating, ThesisDoc, TrackerHolding, TrackerSnapshot } from '../../server-thesis-tracker';
import type { Rating } from '../../server-thesis-tracker';

export const RATING_LABEL: Record<Rating, string> = { green: 'Intact', yellow: 'In question', red: 'Broken' };
export const RATING_EMOJI: Record<Rating, string> = { green: '🟢', yellow: '🟡', red: '🔴' };
export const RATING_ACTION: Record<Rating, string> = {
  green: 'Buy more / hold full size',
  yellow: 'Hold, no adds, tighten watch',
  red: 'Trim / exit, reassess',
};

// Tickers held under another ticker's thesis, matching TICKER_ALIASES in the
// tracker's build_holdings_cache.py: GOOG (Alphabet Class C) is graded as GOOGL.
export const TICKER_ALIASES: Record<string, string> = { GOOG: 'GOOGL' };
export const canonicalTicker = (ticker: string) => {
  const t = ticker.toUpperCase();
  return TICKER_ALIASES[t] ?? t;
};

export const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
