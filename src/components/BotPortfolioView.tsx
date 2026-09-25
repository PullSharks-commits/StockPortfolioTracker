// The "Trading Bot" tab: a compact view of the bot's positions modelled on the bot's
// own dashboard (TradingBot/dashboard.html) - totals, realized P&L, and one card per
// position showing where the price sits between its stop and target. Prices come
// from the tracker's live quote stream when available, else the bot's last snapshot.

import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import type { BotStatus } from '../botPortfolio';

const usd = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const dist = (v: number) => `${v.toFixed(2)}%`;
const tone = (v: number | null | undefined) => (v == null ? 'text-zinc-900 dark:text-zinc-100' : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-rose-600' : 'text-zinc-900 dark:text-zinc-100');
const clamp = (v: number) => Math.max(0, Math.min(100, v));

const REALIZED_WINDOWS: [string, string][] = [['6m', '6 Months'], ['1y', '1 Year'], ['ytd', 'YTD'], ['all_time', 'All-Time']];

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

export function BotPortfolioView({ status, livePrices, onRefresh, isRefreshing, onRunHousekeeping, isRunningHousekeeping, onClosePosition }: Props) {
  const snap = status?.snapshot;
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
          ].map(([label, value, signed]) => (
            <div key={label as string} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">{label}</div>
              <div className={clsx('mt-1 text-xl font-semibold font-mono', tone(signed as number | null))}>
                {value}
                {label === 'Unrealized P&L' && cost > 0 && <span className="ml-1 text-sm">({pct((unrealized / cost) * 100)})</span>}
                {label === 'Remaining Cash' && totals.bot_capital_usd != null && <span className="ml-1 text-sm font-normal text-zinc-400">of {usd(totals.bot_capital_usd)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {snap?.realized && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {REALIZED_WINDOWS.map(([key, label]) => {
            const w = snap.realized[key] || { realized_pnl: null, n_trades: 0 };
            return (
              <div key={key} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-[11px] uppercase tracking-wider text-zinc-400">Realized · {label}</div>
                <div className={clsx('mt-1 text-lg font-semibold font-mono', tone(w.realized_pnl))}>{usd(w.realized_pnl)}</div>
                <div className="text-xs text-zinc-400">{w.n_trades} trade{w.n_trades === 1 ? '' : 's'}</div>
              </div>
            );
          })}
        </div>
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
