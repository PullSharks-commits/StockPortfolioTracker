// Where a holding's shares are held: one or more brokers with a share count each.
// "All at X" covers the common single-broker case; a split adds rows. The counts
// should add up to the holding's shares; a mismatch is flagged but can still be saved
// (the holding itself may be the stale side).

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';

export type Brokers = Record<string, number>;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));

// Compact label for the Broker column: "IBKR", or "IBKR · Schwab" for a split.
export function brokerLabel(b?: Brokers | null): string {
  if (!b) return '';
  return Object.entries(b).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).map(([name]) => name).join(' · ');
}
export function brokerTitle(b?: Brokers | null): string {
  if (!b) return 'Not set';
  return Object.entries(b).sort((x, y) => y[1] - x[1]).map(([name, n]) => `${name}: ${fmt(n)} shares`).join('\n');
}

export function BrokerEditor({ ticker, shares, brokers, knownBrokers, onSave, onClose }: {
  ticker: string;
  shares: number;
  brokers?: Brokers | null;
  knownBrokers: string[];
  onSave: (brokers: Brokers | null) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ name: string; shares: string }[]>(
    brokers && Object.keys(brokers).length
      ? Object.entries(brokers).map(([name, n]) => ({ name, shares: fmt(n) }))
      : [{ name: '', shares: fmt(shares) }],
  );
  const parsed = rows.map(r => ({ name: r.name.trim(), shares: Number(r.shares) }));
  const valid = parsed.every(r => r.name && Number.isFinite(r.shares) && r.shares >= 0) && new Set(parsed.map(r => r.name.toLowerCase())).size === parsed.length;
  const total = parsed.reduce((a, r) => a + (Number.isFinite(r.shares) ? r.shares : 0), 0);
  const mismatch = shares > 0 && Math.abs(total - shares) > 0.0001;

  const set = (i: number, patch: Partial<{ name: string; shares: string }>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => onSave(Object.fromEntries(parsed.map(r => [r.name, r.shares])));
  const input = 'rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';

  return createPortal(
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label={`Broker for ${ticker}`} onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl">
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Broker for {ticker}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">{fmt(shares)} shares held</p>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {knownBrokers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knownBrokers.map(b => (
                <button key={b} onClick={() => setRows([{ name: b, shares: fmt(shares) }])}
                  className="px-2.5 py-1 rounded-full text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-indigo-300 hover:text-indigo-600">
                  All at {b}
                </button>
              ))}
            </div>
          )}

          <datalist id="broker-names">{knownBrokers.map(b => <option key={b} value={b} />)}</datalist>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input list="broker-names" value={r.name} onChange={e => set(i, { name: e.target.value })} placeholder="Broker" maxLength={40} className={`${input} flex-1 min-w-0`} aria-label="Broker name" />
                <input value={r.shares} onChange={e => set(i, { shares: e.target.value })} inputMode="decimal" className={`${input} w-24 text-right`} aria-label="Shares at this broker" />
                <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}
                  className="p-1.5 text-zinc-400 hover:text-rose-600 disabled:opacity-30 rounded-lg" aria-label="Remove broker"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setRows(rs => [...rs, { name: '', shares: '0' }])} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
            <Plus className="w-3.5 h-3.5" /> Split across another broker
          </button>
          {mismatch && <p className="text-xs text-amber-600">These add up to {fmt(total)}, not {fmt(shares)}.</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-zinc-100 dark:border-zinc-800">
          <button onClick={() => onSave(null)} className="text-xs text-zinc-500 hover:text-rose-600">Clear</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
            <button onClick={save} disabled={!valid} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">Save</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
