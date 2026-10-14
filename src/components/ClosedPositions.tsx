// Positions you've fully sold: holdings with 0 shares that have trade history.
// Collapsible, under the holdings table. All figures come from the holding's own
// trades in its own currency; with every share sold, realized P&L is simply what the
// sells brought in minus what the buys cost.

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, LineChart, Trash2 } from 'lucide-react';
import { CompanyLogo } from './CompanyLogo';
import { formatCurrency } from '../lib/currency';

export interface ClosedTrade { type: 'buy' | 'sell'; shares: number; price: number; date: string }
export interface ClosedHolding { id: string; ticker: string; currency: string; trades: ClosedTrade[]; logo?: string }

export function ClosedPositions({ holdings, onHistory, onChart, onDelete }: {
  holdings: ClosedHolding[];
  onHistory: (id: string) => void;
  onChart: (ticker: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => holdings.map(h => {
    const buys = h.trades.filter(t => t.type === 'buy'), sells = h.trades.filter(t => t.type === 'sell');
    const cost = buys.reduce((a, t) => a + t.shares * t.price, 0);
    const proceeds = sells.reduce((a, t) => a + t.shares * t.price, 0);
    const dates = h.trades.map(t => t.date).sort();
    return { ...h, cost, proceeds, pnl: proceeds - cost, pct: cost > 0 ? ((proceeds - cost) / cost) * 100 : 0, opened: dates[0], closed: dates[dates.length - 1] };
  }).sort((a, b) => b.closed.localeCompare(a.closed)), [holdings]);

  if (rows.length === 0) return null;
  // Totals per currency (a tab can mix US and local listings).
  const totals = Object.entries(rows.reduce<Record<string, { cost: number; pnl: number }>>((acc, r) => {
    const t = (acc[r.currency] ??= { cost: 0, pnl: 0 });
    t.cost += r.cost; t.pnl += r.pnl;
    return acc;
  }, {}));
  const tone = (n: number) => (n > 0 ? 'text-emerald-600 dark:text-emerald-400' : n < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500');
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-6 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Closed positions
          <span className="text-xs font-medium text-zinc-400">{rows.length}</span>
        </span>
        <span className="text-xs text-zinc-500">
          Realized{' '}
          {totals.map(([cur, t], i) => (
            <span key={cur} className={`font-semibold ${tone(t.pnl)}`}>
              {i > 0 && <span className="text-zinc-400"> · </span>}
              {formatCurrency(t.pnl, cur, true)}
            </span>
          ))}
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto pb-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-zinc-400 border-y border-zinc-100 dark:border-zinc-800">
                <th className="px-6 py-2 font-medium">Asset</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Held</th>
                <th className="px-3 py-2 font-medium text-right hidden md:table-cell">Invested</th>
                <th className="px-3 py-2 font-medium text-right hidden md:table-cell">Sold for</th>
                <th className="px-3 py-2 font-medium text-right">Realized P&amp;L</th>
                <th className="px-6 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                  <td className="px-6 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <CompanyLogo ticker={r.ticker} logo={r.logo} />
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{r.ticker}</div>
                        <div className="text-[11px] text-zinc-400">{r.trades.length} trades</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-500 hidden sm:table-cell whitespace-nowrap">{day(r.opened)} – {day(r.closed)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-600 dark:text-zinc-300 hidden md:table-cell">{formatCurrency(r.cost, r.currency)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-600 dark:text-zinc-300 hidden md:table-cell">{formatCurrency(r.proceeds, r.currency)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${tone(r.pnl)}`}>
                    {formatCurrency(r.pnl, r.currency, true)}
                    <div className="text-[11px] font-medium">{r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)}%</div>
                  </td>
                  <td className="px-6 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => onChart(r.ticker)} className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title={`Chart for ${r.ticker}`} aria-label={`Chart for ${r.ticker}`}><LineChart className="w-4 h-4" /></button>
                      <button onClick={() => onHistory(r.id)} className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg" title="Trade history" aria-label={`Trade history for ${r.ticker}`}><FileText className="w-4 h-4" /></button>
                      <button onClick={() => onDelete(r.id)} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Delete (removes its trades and realized P&L)" aria-label={`Delete ${r.ticker}`}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
