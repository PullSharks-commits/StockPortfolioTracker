// Detail panels for the combined summary cards, across all portfolio tabs: holdings
// by value, return by holding, each sale behind Realized Return, today's movers, and
// what makes up Total Gain 6M / YTD / 1Y. Rows come from the same breakdown the cards
// sum (src/lib/combinedBreakdown.ts), so each panel adds up to its card.

import React from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency } from '../lib/currency';
import type { CombinedBreakdown, HoldingBreakdown, PeriodKey } from '../lib/combinedBreakdown';

export type CombinedDetailKey = 'value' | 'return' | 'realized' | 'day' | PeriodKey;

const TAB_LABEL: Record<string, string> = { global: 'Global', australia: 'Australia', bot: 'Trading Bot' };
const PERIOD_LABEL: Record<PeriodKey, string> = { sixMonths: '6 months', ytd: 'year to date', oneYear: '1 year' };
const tone = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.005 ? 'text-zinc-500' : v > 0 ? 'text-emerald-600' : 'text-rose-600');
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Diverging bar around zero (or a plain bar for shares of a whole), scaled to `max`.
function Bar({ v, max, share = false }: { v: number; max: number; share?: boolean }) {
  const w = max > 0 ? Math.min(100, (Math.abs(v) / max) * 100) : 0;
  if (share) {
    return <div className="h-2 w-full min-w-20 rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${w}%` }} /></div>;
  }
  return (
    <div className="relative h-2 w-full min-w-20 rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-300 dark:bg-zinc-600" />
      {v !== 0 && <div className={clsx('absolute inset-y-0', v > 0 ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-rose-500')} style={{ width: `${w / 2}%` }} />}
    </div>
  );
}

// `secondary` columns are hidden on phones so each row's key figures fit.
interface Column<T> { label: string; align?: 'left' | 'right'; cell: (r: T) => React.ReactNode; className?: string; wide?: boolean; secondary?: boolean }

function Table<T>({ rows, columns, rowKey, footer }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; footer?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
            {columns.map((c, i) => (
              <th key={c.label} className={clsx('py-2 font-medium whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left', i === 0 ? 'pl-4 pr-3 sticky left-0 bg-white dark:bg-zinc-900' : 'px-3', c.wide && 'w-1/4', c.secondary && 'hidden sm:table-cell')}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map(r => (
            <tr key={rowKey(r)} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
              {columns.map((c, i) => (
                <td key={c.label} className={clsx('py-2.5 whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left', i === 0 ? 'pl-4 pr-3 sticky left-0 bg-white dark:bg-zinc-900 font-semibold text-zinc-900 dark:text-zinc-100' : 'px-3', c.className, c.secondary && 'hidden sm:table-cell')}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

export function CombinedDetails({ detail, breakdown, currency, onClose }: {
  detail: CombinedDetailKey; breakdown: CombinedBreakdown; currency: string; onClose: () => void;
}) {
  const money = (v: number | null | undefined, sign = false) => (v == null ? '—' : formatCurrency(v, currency, sign));
  const { rows, sales, totals, periodStats } = breakdown;
  const tabCell = (r: { tab: string }): React.ReactNode => <span className="text-xs text-zinc-500">{TAB_LABEL[r.tab] ?? r.tab}</span>;
  const assetCell = (r: HoldingBreakdown) => (r.isCash ? `Cash` : r.ticker);
  const nonCash = rows.filter(r => !r.isCash && Math.abs(r.shares) > 0);

  let title = '', summary: React.ReactNode = null, body: React.ReactNode = null;

  if (detail === 'value') {
    const list = rows.filter(r => Math.abs(r.value) > 0.005).sort((a, b) => b.value - a.value);
    const max = Math.max(0, ...list.map(r => r.value));
    const byTab = Object.entries(list.reduce<Record<string, number>>((acc, r) => { acc[r.tab] = (acc[r.tab] ?? 0) + r.value; return acc; }, {}));
    title = 'Holdings by value';
    summary = <>{money(totals.totalValue)} across {list.length} holdings · {byTab.map(([t, v]) => `${TAB_LABEL[t] ?? t} ${money(v)} (${((v / totals.totalValue) * 100).toFixed(0)}%)`).join(' · ')}</>;
    body = <Table rows={list} rowKey={r => r.id} columns={[
      { label: 'Asset', cell: assetCell },
      { label: 'Tab', cell: r => tabCell(r), secondary: true },
      { label: 'Shares', align: 'right', cell: r => (r.isCash ? '—' : r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })), className: 'font-mono', secondary: true },
      { label: 'Price', align: 'right', cell: r => money(r.price), className: 'font-mono', secondary: true },
      { label: 'Value', align: 'right', cell: r => money(r.value), className: 'font-mono font-semibold' },
      { label: 'Weight', align: 'right', cell: r => `${((r.value / totals.totalValue) * 100).toFixed(1)}%`, className: 'text-zinc-500' },
      { label: '', cell: r => <Bar v={r.value} max={max} share />, wide: true, secondary: true },
    ]} />;
  } else if (detail === 'return') {
    const list = nonCash.map(r => ({ ...r, pl: r.value - r.cost })).sort((a, b) => b.pl - a.pl);
    const max = Math.max(0, ...list.map(r => Math.abs(r.pl)));
    const up = list.filter(r => r.pl > 0.005).length, down = list.filter(r => r.pl < -0.005).length;
    title = 'Return by holding';
    summary = <>Current value minus what you paid for the shares you hold: <span className={tone(totals.totalProfitLoss)}>{money(totals.totalProfitLoss, true)} ({pct(totals.totalProfitLossPercent)})</span> on {money(totals.totalCost)} · {up} up, {down} down</>;
    body = <Table rows={list} rowKey={r => r.id} columns={[
      { label: 'Asset', cell: r => r.ticker },
      { label: 'Tab', cell: r => tabCell(r), secondary: true },
      { label: 'Cost', align: 'right', cell: r => money(r.cost), className: 'font-mono text-zinc-500', secondary: true },
      { label: 'Value', align: 'right', cell: r => money(r.value), className: 'font-mono', secondary: true },
      { label: 'Return', align: 'right', cell: r => <span className={clsx('font-mono font-semibold', tone(r.pl))}>{money(r.pl, true)}</span> },
      { label: '%', align: 'right', cell: r => <span className={tone(r.pl)}>{pct(r.cost > 0 ? (r.pl / r.cost) * 100 : null)}</span> },
      { label: '', cell: r => <Bar v={r.pl} max={max} />, wide: true, secondary: true },
    ]} />;
  } else if (detail === 'realized') {
    const wins = sales.filter(s => s.gain > 0.005).length, losses = sales.filter(s => s.gain < -0.005).length;
    title = 'Realized return · every sale';
    summary = <>{sales.length} sale{sales.length === 1 ? '' : 's'} · {wins} at a gain, {losses} at a loss · total <span className={tone(periodStats.allTimeRealized)}>{money(periodStats.allTimeRealized, true)}</span> · gains use the oldest shares first (FIFO)</>;
    body = sales.length === 0 ? <p className="px-4 py-8 text-center text-sm text-zinc-500">No sales recorded yet.</p> : <Table rows={sales} rowKey={s => `${s.holdingId}-${s.date}-${s.shares}`} columns={[
      { label: 'Asset', cell: s => s.ticker },
      { label: 'Tab', cell: r => tabCell(r), secondary: true },
      { label: 'Sold', cell: s => <span className="text-zinc-500">{day(s.date)}</span> },
      { label: 'Shares', align: 'right', cell: s => s.shares.toLocaleString(undefined, { maximumFractionDigits: 4 }), className: 'font-mono', secondary: true },
      { label: 'Proceeds', align: 'right', cell: s => money(s.proceeds), className: 'font-mono', secondary: true },
      { label: 'Cost', align: 'right', cell: s => money(s.cost), className: 'font-mono text-zinc-500', secondary: true },
      { label: 'Gain', align: 'right', cell: s => <span className={clsx('font-mono font-semibold', tone(s.gain))}>{money(s.gain, true)}</span> },
      { label: '%', align: 'right', secondary: true, cell: s => <span className={tone(s.gain)}>{pct(s.cost > 0 ? (s.gain / s.cost) * 100 : null)}</span> },
    ]} />;
  } else if (detail === 'day') {
    const list = nonCash.filter(r => Math.abs(r.dayChange) > 0.005).sort((a, b) => b.dayChange - a.dayChange);
    const max = Math.max(0, ...list.map(r => Math.abs(r.dayChange)));
    const up = list.filter(r => r.dayChange > 0).length, down = list.filter(r => r.dayChange < 0).length;
    title = "Today's movers";
    summary = <><span className={tone(totals.totalDayChange)}>{money(totals.totalDayChange, true)} ({pct(totals.totalDayChangePercent)})</span> today · {up} up, {down} down{nonCash.length > list.length ? ` · ${nonCash.length - list.length} unchanged` : ''}</>;
    body = list.length === 0 ? <p className="px-4 py-8 text-center text-sm text-zinc-500">Nothing has moved yet today.</p> : <Table rows={list} rowKey={r => r.id} columns={[
      { label: 'Asset', cell: r => r.ticker },
      { label: 'Tab', cell: r => tabCell(r), secondary: true },
      { label: 'Price', align: 'right', cell: r => money(r.price), className: 'font-mono', secondary: true },
      { label: 'Change', align: 'right', cell: r => <span className={clsx('font-mono font-semibold', tone(r.dayChange))}>{money(r.dayChange, true)}</span> },
      { label: '%', align: 'right', cell: r => { const prev = r.value - r.dayChange; return <span className={tone(r.dayChange)}>{pct(prev > 0 ? (r.dayChange / prev) * 100 : null)}</span>; } },
      { label: '', cell: r => <Bar v={r.dayChange} max={max} />, wide: true, secondary: true },
    ]} />;
  } else {
    const k = detail;
    const p = periodStats[k];
    const list = rows.filter(r => !r.isCash).map(r => ({ ...r, part: r.periods[k], total: r.periods[k].realized + r.periods[k].unrealized }))
      .filter(r => Math.abs(r.total) > 0.005 || r.part.costBasis > 0.005).sort((a, b) => b.total - a.total);
    const max = Math.max(0, ...list.map(r => Math.abs(r.total)));
    title = `Total gain · ${PERIOD_LABEL[k]}`;
    summary = <><span className={tone(p.total)}>{money(p.total, true)} ({pct(p.percent)})</span> = realized <span className={tone(p.realized)}>{money(p.realized, true)}</span> from sales in the period + unrealized <span className={tone(p.unrealized)}>{money(p.unrealized, true)}</span> on shares bought in the period</>;
    body = list.length === 0 ? <p className="px-4 py-8 text-center text-sm text-zinc-500">No buys or sales in this period.</p> : <Table rows={list} rowKey={r => r.id} columns={[
      { label: 'Asset', cell: r => r.ticker },
      { label: 'Tab', cell: r => tabCell(r), secondary: true },
      { label: 'Realized', align: 'right', secondary: true, cell: r => <span className={clsx('font-mono', tone(r.part.realized))}>{Math.abs(r.part.realized) > 0.005 ? money(r.part.realized, true) : '—'}</span> },
      { label: 'Unrealized', align: 'right', secondary: true, cell: r => <span className={clsx('font-mono', tone(r.part.unrealized))}>{Math.abs(r.part.unrealized) > 0.005 ? money(r.part.unrealized, true) : '—'}</span> },
      { label: 'Total', align: 'right', cell: r => <span className={clsx('font-mono font-semibold', tone(r.total))}>{money(r.total, true)}</span> },
      { label: '%', align: 'right', cell: r => <span className={tone(r.total)}>{pct(r.part.costBasis > 0 ? (r.total / r.part.costBasis) * 100 : null)}</span> },
      { label: '', cell: r => <Bar v={r.total} max={max} />, wide: true, secondary: true },
    ]} />;
  }

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title} <span className="font-normal text-zinc-400">· all portfolio tabs, {currency}</span></h3>
          <p className="text-xs text-zinc-500 mt-0.5">{summary}</p>
        </div>
        <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg shrink-0" aria-label="Hide details"><X className="w-4 h-4" /></button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">{body}</div>
    </div>
  );
}

// A summary card that opens (and, when open, highlights) its detail panel.
export function SummaryCardButton({ active, onClick, label, className, children }: {
  active: boolean; onClick: () => void; label: string; className?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${active ? 'hide' : 'show'} details`}
      className={clsx(
        'group text-left rounded-lg -m-2 p-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        active ? 'bg-indigo-50 ring-1 ring-indigo-300 dark:bg-indigo-950/40 dark:ring-indigo-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
        className
      )}
    >
      {children}
      <span className={clsx('mt-0.5 block text-[10px] font-medium', active ? 'text-indigo-600' : 'text-indigo-500 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}>
        {active ? 'Hide details' : 'Details'}
      </span>
    </button>
  );
}
