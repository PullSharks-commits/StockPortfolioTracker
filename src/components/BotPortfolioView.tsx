// The "Trading Bot" tab: a compact view of the bot's positions modelled on the bot's
// own dashboard (TradingBot/dashboard.html) - totals, realized P&L, and one card per
// position showing where the price sits between its stop and target. Prices come
// from the tracker's live quote stream when available, else the bot's last snapshot.

import React, { useState } from 'react';
import { ChevronDown, Loader2, RefreshCw, X } from 'lucide-react';
import { clsx } from 'clsx';
import type { BotStatus, ClosedTrade } from '../botPortfolio';

const usd = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const dist = (v: number) => `${v.toFixed(2)}%`;
const tone = (v: number | null | undefined) => (v == null ? 'text-zinc-900 dark:text-zinc-100' : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-rose-600' : 'text-zinc-900 dark:text-zinc-100');
const clamp = (v: number) => Math.max(0, Math.min(100, v));

const REALIZED_WINDOWS: [string, string][] = [['6m', '6 Months'], ['1y', '1 Year'], ['ytd', 'YTD'], ['all_time', 'All-Time']];

// Same windows as the bot's realized_pnl_windows(): by exit date, trailing 182 / 365
// days, since 1 January, or everything.
function windowStart(key: string, today = new Date()): string | null {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const back = (days: number) => iso(new Date(today.getTime() - days * 86_400_000));
  if (key === '6m') return back(182);
  if (key === '1y') return back(365);
  if (key === 'ytd') return `${today.getFullYear()}-01-01`;
  return null;
}

const EXIT_REASONS: Record<string, { label: string; className: string }> = {
  target: { label: 'Target hit', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  stop: { label: 'Stop hit', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  time_stop: { label: 'Time stop', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  manual_dashboard: { label: 'Closed from app', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  closed_elsewhere: { label: 'Closed outside bot', className: 'bg-zinc-50 text-zinc-600 border-zinc-200' },
  manual: { label: 'Manual', className: 'bg-zinc-50 text-zinc-600 border-zinc-200' },
};
const reasonOf = (r: string) => EXIT_REASONS[r] ?? { label: r.replace(/_/g, ' '), className: 'bg-zinc-50 text-zinc-600 border-zinc-200' };
const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const daysHeld = (t: ClosedTrade) => (t.entry_date ? Math.round((Date.parse(t.exit_date.slice(0, 10)) - Date.parse(t.entry_date.slice(0, 10))) / 86_400_000) : null);

function ClosedTradesPanel({ title, trades, onClose }: { title: string; trades: ClosedTrade[]; onClose: () => void }) {
  const known = trades.filter(t => t.realized_pnl != null);
  const wins = known.filter(t => t.realized_pnl! > 0);
  const losses = known.filter(t => t.realized_pnl! < 0);
  const total = known.reduce((s, t) => s + t.realized_pnl!, 0);
  const avg = (xs: ClosedTrade[]) => (xs.length ? xs.reduce((s, t) => s + t.realized_pnl!, 0) / xs.length : null);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Closed trades · {title}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {trades.length} trade{trades.length === 1 ? '' : 's'}
            {known.length > 0 && <> · {wins.length} won, {losses.length} lost ({Math.round((wins.length / known.length) * 100)}% win rate) · total <span className={tone(total)}>{usd(total)}</span></>}
            {avg(wins) != null && <> · avg win {usd(avg(wins))}</>}
            {avg(losses) != null && <> · avg loss {usd(avg(losses))}</>}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg" aria-label="Hide closed trades"><X className="w-4 h-4" /></button>
      </div>
      {trades.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">No trades closed in this period.</p>
      ) : (
        <>
        {/* Phones: one compact card per trade. */}
        <ul className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {trades.map(t => {
            const reason = reasonOf(t.exit_reason);
            const cost = t.entry_price != null ? t.entry_price * t.qty : null;
            const pnlPct = t.realized_pnl != null && cost ? (t.realized_pnl / cost) * 100 : null;
            const held = daysHeld(t);
            return (
              <li key={t.id} className="px-4 py-3 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{t.symbol} <span className="text-xs font-normal text-zinc-500">{t.qty} sh</span></span>
                  <span className={clsx('font-mono font-semibold', tone(t.realized_pnl))}>
                    {t.realized_pnl == null ? <span className="text-zinc-400 font-normal text-sm">P&amp;L unknown</span> : <>{usd(t.realized_pnl)} <span className="text-xs font-normal">{pct(pnlPct)}</span></>}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 font-mono">
                  {usd(t.entry_price)} → {usd(t.exit_price)}
                  <span className="font-sans"> · {day(t.entry_date)} – {day(t.exit_date)}{held != null ? ` · ${held} day${held === 1 ? '' : 's'}` : ''}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx('inline-block text-[11px] font-semibold border rounded-full px-2 py-0.5', reason.className)}>{reason.label}</span>
                  {t.note && <span className="text-xs text-zinc-400">{t.note}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-zinc-400 text-left border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-5 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium">Entry</th>
                <th className="px-3 py-2 font-medium">Exit</th>
                <th className="px-3 py-2 font-medium text-right">Held</th>
                <th className="px-3 py-2 font-medium text-right">P&amp;L</th>
                <th className="px-5 py-2 font-medium">Exit reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {trades.map(t => {
                const reason = reasonOf(t.exit_reason);
                const cost = t.entry_price != null ? t.entry_price * t.qty : null;
                const pnlPct = t.realized_pnl != null && cost ? (t.realized_pnl / cost) * 100 : null;
                const held = daysHeld(t);
                return (
                  <tr key={t.id} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                    <td className="px-5 py-3 font-semibold text-zinc-900 dark:text-zinc-100">{t.symbol}</td>
                    <td className="px-3 py-3 text-right font-mono">{t.qty}</td>
                    <td className="px-3 py-3 whitespace-nowrap"><span className="font-mono">{usd(t.entry_price)}</span> <span className="text-xs text-zinc-400">{day(t.entry_date)}</span></td>
                    <td className="px-3 py-3 whitespace-nowrap"><span className="font-mono">{usd(t.exit_price)}</span> <span className="text-xs text-zinc-400">{day(t.exit_date)}</span></td>
                    <td className="px-3 py-3 text-right text-zinc-500 whitespace-nowrap">{held == null ? '—' : `${held} day${held === 1 ? '' : 's'}`}</td>
                    <td className={clsx('px-3 py-3 text-right font-mono font-semibold whitespace-nowrap', tone(t.realized_pnl))}>
                      {t.realized_pnl == null ? <span className="text-zinc-400 font-normal" title="The exit price wasn't available, so this trade isn't counted in the totals">unknown</span> : <>{usd(t.realized_pnl)} <span className="text-xs font-normal">{pct(pnlPct)}</span></>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={clsx('inline-block text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap', reason.className)} title={t.note || undefined}>{reason.label}</span>
                      {t.note && <div className="mt-1 text-xs text-zinc-400 max-w-xs">{t.note}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

interface Props {
  status: BotStatus | null;
  livePrices: Record<string, { price?: number } | undefined>;
  onRefresh: () => void;
  isRefreshing: boolean;
  onRunHousekeeping: () => void;
  isRunningHousekeeping: boolean;
  onClosePosition: (symbol: string) => void;
}

function PositionCard({ row, livePrice, onClose }: { row: any; livePrice?: number; onClose: () => void }) {
  const entry = Number(row.entry_price);
  const qty = Number(row.qty);
  const price: number | null = livePrice ?? row.current_price ?? null;
  const stop = row.stop != null ? Number(row.stop) : null;
  const target = row.target != null ? Number(row.target) : null;

  const pnl = price != null ? (price - entry) * qty : null;
  const pnlPct = price != null && entry ? (price / entry - 1) * 100 : null;
  const hasAxis = price != null && stop != null && target != null && target > stop;
  const axisPct = hasAxis ? clamp(((price! - stop!) / (target! - stop!)) * 100) : 0;
  const entryAxisPct = hasAxis ? clamp(((entry - stop!) / (target! - stop!)) * 100) : 0;

  return (
    <div className={clsx('rounded-2xl border bg-white dark:bg-zinc-900 p-5 shadow-sm', row.stale ? 'border-amber-300' : 'border-zinc-200 dark:border-zinc-800')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{row.symbol}</span>
          <span className="text-sm text-zinc-500">{qty} sh</span>
          {row.stale && !livePrice && <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">stale price</span>}
          {row.pending_confirmation && <span className="text-[10px] font-bold uppercase text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">pending</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold font-mono text-zinc-900 dark:text-zinc-100">{usd(price)}</span>
          {pnlPct != null && (
            <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', pnlPct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{pct(pnlPct)}</span>
          )}
          <button
            onClick={onClose}
            className="ml-1 px-2.5 py-1 text-xs font-semibold text-rose-600 border border-rose-200 hover:bg-rose-50 rounded-lg transition-colors"
            title="Market-sell this whole position now through the trading bot"
          >
            Close
          </button>
        </div>
      </div>

      {hasAxis && (
        <div className="mt-5">
          <div className="relative h-2 rounded-full bg-gradient-to-r from-rose-100 via-zinc-100 to-emerald-100 dark:from-rose-950 dark:via-zinc-800 dark:to-emerald-950">
            <div className={clsx('absolute inset-y-0 left-0 rounded-full', axisPct >= entryAxisPct ? 'bg-emerald-400/60' : 'bg-rose-400/60')} style={{ width: `${axisPct}%` }} />
            <div className="absolute -top-1 h-4 w-0.5 bg-zinc-500" style={{ left: `${entryAxisPct}%` }} title={`Entry ${usd(entry)}`} />
            <div
              className={clsx('absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white dark:border-zinc-900 shadow', axisPct >= entryAxisPct ? 'bg-emerald-600' : 'bg-rose-600')}
              style={{ left: `${axisPct}%` }}
              title={`Now ${usd(price)}`}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs font-mono">
            <span className="text-rose-600">stop {usd(stop)}</span>
            <span className="text-zinc-500">entry {usd(entry)}</span>
            <span className="text-emerald-600">target {usd(target)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Entry</div>
          <div className="font-mono">{usd(entry)} <span className="text-zinc-400">· {row.entry_date || '—'}</span></div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Unrealized P&amp;L</div>
          <div className={clsx('font-mono font-semibold', tone(pnl))}>{usd(pnl)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">To Target</div>
          <div className="font-mono">{target != null && price != null ? <>{usd(target - price)} <span className="text-zinc-400">({dist((target / price - 1) * 100)})</span></> : '—'}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">To Stop</div>
          <div className="font-mono">{stop != null && price != null ? <>{usd(price - stop)} <span className="text-zinc-400">({dist((1 - stop / price) * 100)})</span></> : '—'}</div>
        </div>
      </div>
    </div>
  );
}

// Open positions as one table, from the Position Value card: live price, value and
// weight, unrealized P&L, and where the price sits relative to stop and target.
function OpenPositionsPanel({ positions, livePrices, onClose }: { positions: any[]; livePrices: Props['livePrices']; onClose: () => void }) {
  const rows = positions.map(p => {
    const qty = Number(p.qty), entry = Number(p.entry_price);
    const live = livePrices[p.symbol]?.price;
    const price: number | null = live ?? p.current_price ?? null;
    const value = (price ?? entry) * qty;
    const cost = entry * qty;
    const pnl = price != null ? (price - entry) * qty : null;
    const stop = p.stop != null ? Number(p.stop) : null, target = p.target != null ? Number(p.target) : null;
    const held = p.entry_date ? Math.floor((Date.now() - Date.parse(`${String(p.entry_date).slice(0, 10)}T00:00:00`)) / 86_400_000) : null;
    return { p, qty, entry, price, live: live != null, value, cost, pnl, stop, target, held };
  }).sort((a, b) => b.value - a.value);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalPnl = totalValue - totalCost;
  const toStop = (r: typeof rows[number]) => (r.stop != null && r.price != null ? (1 - r.stop / r.price) * 100 : null);
  const toTarget = (r: typeof rows[number]) => (r.target != null && r.price != null ? (r.target / r.price - 1) * 100 : null);
  const priceNote = (r: typeof rows[number]) => (r.live ? 'live' : r.p.stale ? 'stale' : 'bot snapshot');

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Open positions</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {rows.length} position{rows.length === 1 ? '' : 's'}
            {rows.length > 0 && <> · value {usd(totalValue)} · cost {usd(totalCost)} · unrealized <span className={tone(totalPnl)}>{usd(totalPnl)} {totalCost > 0 && pct((totalPnl / totalCost) * 100)}</span></>}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg" aria-label="Hide open positions"><X className="w-4 h-4" /></button>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">The bot has no open positions.</p>
      ) : (
        <>
        <ul className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map(r => (
            <li key={r.p.symbol} className="px-4 py-3 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{r.p.symbol} <span className="text-xs font-normal text-zinc-500">{r.qty} sh · {totalValue > 0 ? `${((r.value / totalValue) * 100).toFixed(0)}%` : ''}</span></span>
                <span className={clsx('font-mono font-semibold', tone(r.pnl))}>{usd(r.pnl)} <span className="text-xs font-normal">{r.pnl != null && r.cost ? pct((r.pnl / r.cost) * 100) : ''}</span></span>
              </div>
              <div className="text-xs text-zinc-500 font-mono">{usd(r.entry)} → {usd(r.price)} <span className="font-sans">({priceNote(r)}) · value {usd(r.value)}</span></div>
              <div className="text-xs text-zinc-500">
                stop {usd(r.stop)}{toStop(r) != null && ` (${toStop(r)!.toFixed(1)}% away)`} · target {usd(r.target)}{toTarget(r) != null && ` (${toTarget(r)!.toFixed(1)}% away)`}
                {r.held != null && ` · held ${r.held} day${r.held === 1 ? '' : 's'}`}
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-zinc-400 text-left border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-5 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium">Entry</th>
                <th className="px-3 py-2 font-medium text-right">Price</th>
                <th className="px-3 py-2 font-medium text-right">Value</th>
                <th className="px-3 py-2 font-medium text-right">Unrealized</th>
                <th className="px-3 py-2 font-medium text-right">Stop</th>
                <th className="px-5 py-2 font-medium text-right">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map(r => (
                <tr key={r.p.symbol} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                  <td className="px-5 py-3 font-semibold text-zinc-900 dark:text-zinc-100">{r.p.symbol}</td>
                  <td className="px-3 py-3 text-right font-mono">{r.qty}</td>
                  <td className="px-3 py-3 whitespace-nowrap"><span className="font-mono">{usd(r.entry)}</span> <span className="text-xs text-zinc-400">{day(r.p.entry_date)}{r.held != null ? ` · ${r.held}d` : ''}</span></td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><span className="font-mono">{usd(r.price)}</span> <span className={clsx('text-[10px]', r.p.stale && !r.live ? 'text-amber-600' : 'text-zinc-400')}>{priceNote(r)}</span></td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><span className="font-mono">{usd(r.value)}</span> <span className="text-xs text-zinc-400">{totalValue > 0 ? `${((r.value / totalValue) * 100).toFixed(0)}%` : ''}</span></td>
                  <td className={clsx('px-3 py-3 text-right font-mono font-semibold whitespace-nowrap', tone(r.pnl))}>{usd(r.pnl)} <span className="text-xs font-normal">{r.pnl != null && r.cost ? pct((r.pnl / r.cost) * 100) : ''}</span></td>
                  <td className="px-3 py-3 text-right whitespace-nowrap"><span className="font-mono text-rose-600">{usd(r.stop)}</span> <span className="text-xs text-zinc-400">{toStop(r) != null ? `${toStop(r)!.toFixed(1)}%` : ''}</span></td>
                  <td className="px-5 py-3 text-right whitespace-nowrap"><span className="font-mono text-emerald-600">{usd(r.target)}</span> <span className="text-xs text-zinc-400">{toTarget(r) != null ? `${toTarget(r)!.toFixed(1)}%` : ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

export function BotPortfolioView({ status, livePrices, onRefresh, isRefreshing, onRunHousekeeping, isRunningHousekeeping, onClosePosition }: Props) {
  const snap = status?.snapshot;
  // Which Realized card's trades are listed below the cards (click again to hide).
  const [tradesWindow, setTradesWindow] = useState<string | null>(null);
  const [showPositions, setShowPositions] = useState(false);
  const closedTrades = status?.closedTrades ?? [];
  const windowTrades = (key: string) => {
    const start = windowStart(key);
    return closedTrades
      .filter(t => t.exit_date && (start == null || t.exit_date.slice(0, 10) >= start))
      .sort((a, b) => b.exit_date.localeCompare(a.exit_date) || b.id - a.id);
  };
  const positions: any[] = snap?.positions ?? [];
  const totals = snap?.totals;

  // Totals from live prices where we have them, so they move with the cards.
  const livePositionValue = positions.reduce((sum, p) => sum + (livePrices[p.symbol]?.price ?? p.current_price ?? p.entry_price) * p.qty, 0);
  const cost = totals?.deployed_cost ?? positions.reduce((sum, p) => sum + p.entry_price * p.qty, 0);
  const unrealized = livePositionValue - cost;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-500">
          {status?.error ? (
            <span className="text-rose-600 font-medium">{status.error}</span>
          ) : !status?.loaded ? (
            'Loading the trading bot…'
          ) : (
            <>
              Bot snapshot {status.updatedAt ? new Date(status.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              {status.regime && <> · <span className={status.regime.ok ? 'text-emerald-600' : 'text-rose-600'} title={status.regime.detail}>regime {status.regime.ok ? 'ON' : 'OFF'}</span></>}
              {status.jobs.map((j) => (
                <span key={j.name} className={j.last_exit_code !== 0 && j.last_exit_code != null ? 'text-rose-600' : ''} title={`last run ${j.last_run_at ?? 'never'}`}> · {j.name} {j.last_exit_code === 0 ? '✓' : j.last_exit_code == null ? '–' : '✗'}</span>
              ))}
              {status.errors.length > 0 && <span className="text-amber-600" title={status.errors.join('\n')}> · {status.errors.length} warning{status.errors.length > 1 ? 's' : ''}</span>}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onRefresh} disabled={isRefreshing} className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 rounded-lg text-sm font-medium disabled:opacity-50">
            <RefreshCw className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} /> Refresh
          </button>
          <button onClick={onRunHousekeeping} disabled={isRunningHousekeeping} className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:bg-amber-50 rounded-lg text-sm font-medium disabled:opacity-50" title="Run the trading bot's housekeeping job now">
            {isRunningHousekeeping && <Loader2 className="w-4 h-4 animate-spin" />} Run Housekeeping
          </button>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            ['Open Positions', String(positions.length), null],
            ['Position Value', usd(livePositionValue), null],
            ['Unrealized P&L', `${usd(unrealized)}`, unrealized],
            ['Remaining Cash', usd(totals.remaining_cash), null],
          ].map(([label, value, signed]) => {
            const body = (
              <>
                <div className="text-[11px] uppercase tracking-wider text-zinc-400">{label}</div>
                <div className={clsx('mt-1 text-xl font-semibold font-mono', tone(signed as number | null))}>
                  {value}
                  {label === 'Unrealized P&L' && cost > 0 && <span className="ml-1 text-sm">({pct((unrealized / cost) * 100)})</span>}
                  {label === 'Remaining Cash' && totals.bot_capital_usd != null && <span className="ml-1 text-sm font-normal text-zinc-400">of {usd(totals.bot_capital_usd)}</span>}
                </div>
              </>
            );
            if (label !== 'Position Value') {
              return <div key={label as string} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">{body}</div>;
            }
            // Position Value opens the open-positions table.
            return (
              <button
                key={label as string}
                type="button"
                onClick={() => setShowPositions(v => !v)}
                aria-pressed={showPositions}
                aria-label={`Position value ${value}. ${showPositions ? 'Hide' : 'Show'} open positions`}
                className={clsx(
                  'text-left rounded-2xl border bg-white dark:bg-zinc-900 p-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  showPositions ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-200 dark:border-zinc-800'
                )}
              >
                {body}
                <div className="mt-0.5 flex justify-end text-xs text-indigo-600">
                  <span className="inline-flex items-center gap-0.5">{showPositions ? 'Hide' : 'Details'} <ChevronDown className={clsx('w-3 h-3 transition-transform', showPositions && 'rotate-180')} /></span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showPositions && <OpenPositionsPanel positions={positions} livePrices={livePrices} onClose={() => setShowPositions(false)} />}

      {snap?.realized && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {REALIZED_WINDOWS.map(([key, label]) => {
            const w = snap.realized[key] || { realized_pnl: null, n_trades: 0 };
            const selected = tradesWindow === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTradesWindow(selected ? null : key)}
                aria-pressed={selected}
                aria-label={`Realized ${label}: ${w.n_trades} trades. ${selected ? 'Hide' : 'Show'} closed trades`}
                className={clsx(
                  'text-left rounded-2xl border bg-white dark:bg-zinc-900 p-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  selected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-200 dark:border-zinc-800'
                )}
              >
                <div className="text-[11px] uppercase tracking-wider text-zinc-400">Realized · {label}</div>
                <div className={clsx('mt-1 text-lg font-semibold font-mono', tone(w.realized_pnl))}>{usd(w.realized_pnl)}</div>
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>{w.n_trades} trade{w.n_trades === 1 ? '' : 's'}</span>
                  <span className="inline-flex items-center gap-0.5 text-indigo-600">{selected ? 'Hide' : 'Details'} <ChevronDown className={clsx('w-3 h-3 transition-transform', selected && 'rotate-180')} /></span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {tradesWindow && (
        <ClosedTradesPanel
          title={REALIZED_WINDOWS.find(([k]) => k === tradesWindow)?.[1] ?? ''}
          trades={windowTrades(tradesWindow)}
          onClose={() => setTradesWindow(null)}
        />
      )}

      {status?.loaded && !status.error && positions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500">The bot has no open positions.</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {positions.map((row) => (
          <PositionCard key={row.symbol} row={row} livePrice={livePrices[row.symbol]?.price} onClose={() => onClosePosition(row.symbol)} />
        ))}
      </div>
    </div>
  );
}
