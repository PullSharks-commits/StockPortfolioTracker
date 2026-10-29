// Combines share classes of one company (GOOG + GOOGL) into a single holdings-table
// row. The combined row is display-only: it carries a synthetic id and the
// underlying rows in `mergedFrom`, which the table shows when it is expanded, so
// edits, history and deletes always act on a real holding. Pure, no I/O.

import { canonicalTicker } from './thesisTracker';

export interface ClassRow {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  currentValue: number;
  costBasis: number;
  profitLoss: number;
  profitLossPercent: number;
  dayChange: number;
  dayChangePercent: number;
  realizedProfitLoss?: number;
  displayAvgPrice?: number;
  brokers?: Record<string, number> | null;
}

export const MERGED_PREFIX = 'merged:';
export const isMergedId = (id: string) => id.startsWith(MERGED_PREFIX);

export function mergeShareClasses<T extends ClassRow>(rows: T[]): (T & { mergedFrom?: T[] })[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const t = r.ticker === 'CASH' ? r.id : canonicalTicker(r.ticker);
    groups.set(t, [...(groups.get(t) ?? []), r]);
  }

  const out: (T & { mergedFrom?: T[] })[] = [];
  for (const [t, legs] of groups) {
    // A lone holding (even a lone GOOG) stays as it is.
    if (legs.length === 1) { out.push(legs[0]); continue; }
    const base = legs.find(r => r.ticker.toUpperCase() === t) ?? legs[0];
    const sum = (f: (r: T) => number | undefined) => legs.reduce((a, r) => a + (f(r) ?? 0), 0);
    const shares = sum(r => r.shares);
    const currentValue = sum(r => r.currentValue);
    const costBasis = sum(r => r.costBasis);
    const profitLoss = sum(r => r.profitLoss);
    const dayChange = sum(r => r.dayChange);
    const prevValue = currentValue - dayChange;
    const brokers: Record<string, number> = {};
    for (const r of legs) for (const [b, n] of Object.entries(r.brokers ?? {})) brokers[b] = (brokers[b] ?? 0) + n;
    out.push({
      ...base,
      id: `${MERGED_PREFIX}${t}`,
      ticker: t,
      shares,
      avg_price: shares ? sum(r => r.avg_price * r.shares) / shares : base.avg_price,
      displayAvgPrice: shares ? costBasis / shares : base.displayAvgPrice,
      currentValue,
      costBasis,
      profitLoss,
      profitLossPercent: costBasis > 0 ? (profitLoss / costBasis) * 100 : 0,
      dayChange,
      dayChangePercent: prevValue > 0 ? (dayChange / prevValue) * 100 : 0,
      realizedProfitLoss: sum(r => r.realizedProfitLoss),
      brokers: Object.keys(brokers).length ? brokers : base.brokers,
      mergedFrom: legs,
    });
  }
  return out;
}
