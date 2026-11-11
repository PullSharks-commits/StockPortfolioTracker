// "Sync with <broker>" for the Global tab: fetches the broker's real holdings
// (server-broker-sync.ts), shows how the app differs, and applies only the rows the
// owner ticks. Schwab is read through Truthifi, which needs a one-time sign-in.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { authedFetch, notifyCollectionsChanged } from '../backend';
import type { SyncBroker, SyncChange } from '../lib/brokerSync';

interface PreviewResponse {
  previewId: string;
  broker: SyncBroker;
  asOf: string | null;
  notes: string[];
  changes: SyncChange[];
  brokerCash: number | null;
  brokerPositions: number;
}

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 }));
const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

const KIND_LABEL: Record<SyncChange['kind'], string> = {
  new: 'New holding',
  buy: 'Add shares',
  sell: 'Remove shares',
  'split-only': 'Fix broker split',
  cash: 'Cash',
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function BrokerSyncModal({ broker, onClose }: { broker: SyncBroker; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsConnect(false);
    setPreview(null);
    const { ok, data } = await postJson(`/api/broker-sync/${broker.toLowerCase()}/preview`);
    if (!ok) {
      setError(data.error || 'Sync failed.');
      setNeedsConnect(!!data.needsConnect);
    } else {
      const p = data as PreviewResponse;
      setPreview(p);
      setSelected(new Set(p.changes.map(c => c.key)));
      setPrices(Object.fromEntries(p.changes.filter(c => c.txPrice != null && c.kind !== 'cash').map(c => [c.key, String(+c.txPrice!.toFixed(4))])));
    }
    setLoading(false);
  }, [broker]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !applying) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applying, onClose]);

  const connect = async () => {
    setConnecting(true);
    const { ok, data } = await postJson('/api/broker-sync/schwab/connect', { origin: window.location.origin });
    setConnecting(false);
    if (!ok) { setError(data.error || 'Could not start Truthifi sign-in.'); return; }
    if (data.connected) { load(); return; }
    window.location.assign(data.authorizationUrl);
  };

  const changes = preview?.changes ?? [];
  const chosen = changes.filter(c => selected.has(c.key));
  const missingPrice = chosen.some(c => c.txType && c.kind !== 'cash' && !(Number(prices[c.key]) > 0));

  const toggle = (key: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const apply = async () => {
    if (!preview || !chosen.length) return;
    setApplying(true);
    setError(null);
    try {
      await authedFetch('POST', '/api/broker-sync/apply', {
        previewId: preview.previewId,
        date,
        items: chosen.map(c => ({ key: c.key, ...(c.txType && c.kind !== 'cash' ? { price: Number(prices[c.key]) } : {}) })),
      });
      notifyCollectionsChanged('holdings', 'transactions');
      toast.success(`Synced ${chosen.length} change${chosen.length === 1 ? '' : 's'} from ${broker}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Apply failed.');
    } finally {
      setApplying(false);
    }
  };

  const summary = useMemo(() => {
    if (!preview) return '';
    const n = preview.changes.length;
    return n === 0
      ? `The Global tab matches ${broker}${preview.brokerCash != null ? `, cash included (${fmtUsd(preview.brokerCash)})` : ''}.`
      : `${n} difference${n === 1 ? '' : 's'} between the Global tab and ${broker}. Tick the ones to apply.`;
  }, [preview, broker]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => !applying && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="broker-sync-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div>
            <h3 id="broker-sync-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Sync with {broker}</h3>
            <p className="text-xs text-zinc-500">Read-only from the broker. Nothing changes here until you apply.</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={load} disabled={loading || applying} title="Fetch again" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} disabled={applying} title="Close" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading {broker}…
            </div>
          )}

          {!loading && error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {!loading && needsConnect && (
            <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-700">
              <p className="mb-3 text-zinc-700 dark:text-zinc-300">
                Schwab is read through Truthifi. Sign in to Truthifi once and this app keeps a refresh token on this Mac, so later syncs don't ask again.
              </p>
              <button onClick={connect} disabled={connecting} className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect Truthifi
              </button>
            </div>
          )}

          {!loading && preview && (
            <>
              <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">{summary}</p>
              {preview.notes.length > 0 && (
                <ul className="mb-4 space-y-1 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                  {preview.notes.map((n, i) => <li key={i}>• {n}</li>)}
                </ul>
              )}

              {changes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                        <th className="py-2 pr-2">
                          <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={chosen.length === changes.length}
                            onChange={e => setSelected(e.target.checked ? new Set(changes.map(c => c.key)) : new Set())}
                          />
                        </th>
                        <th className="py-2 pr-3">Ticker</th>
                        <th className="py-2 pr-3">Change</th>
                        <th className="py-2 pr-3 text-right">At {broker}: app → broker</th>
                        <th className="py-2 pr-3 text-right">Total shares</th>
                        <th className="py-2 pr-3">Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map(c => {
                        const isCash = c.kind === 'cash';
                        const fmt = isCash ? fmtUsd : fmtQty;
                        return (
                          <tr key={c.key} className="border-b border-zinc-50 align-top dark:border-zinc-800/60">
                            <td className="py-2 pr-2">
                              <input type="checkbox" aria-label={`Apply ${c.ticker}`} checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
                            </td>
                            <td className="py-2 pr-3 font-semibold text-zinc-900 dark:text-zinc-100">{c.ticker}</td>
                            <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{KIND_LABEL[c.kind]}</td>
                            <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                              {fmt(c.appLeg)} <ArrowRight className="inline h-3 w-3 text-zinc-400" /> <span className="font-medium">{fmt(c.brokerLeg)}</span>
                            </td>
                            <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                              {fmt(c.sharesBefore)} <ArrowRight className="inline h-3 w-3 text-zinc-400" /> {fmt(c.sharesAfter)}
                            </td>
                            <td className="py-2 pr-3 text-xs text-zinc-600 dark:text-zinc-400">
                              {!c.txType ? (
                                <span>Broker split only, no transaction</span>
                              ) : isCash ? (
                                <span>{c.txType === 'buy' ? 'Deposit' : 'Withdraw'} {fmtUsd(c.txShares)} (adjustment)</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className={c.txType === 'buy' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                                    {c.txType === 'buy' ? 'Buy' : 'Sell'} {fmtQty(c.txShares)} @ $
                                  </span>
                                  <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    value={prices[c.key] ?? ''}
                                    onChange={e => setPrices(p => ({ ...p, [c.key]: e.target.value }))}
                                    className="w-24 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-800"
                                    aria-label={`Price for ${c.ticker}`}
                                  />
                                  <span className="w-full text-[11px] text-zinc-400">{c.priceSource}</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-zinc-500">
                    Buys and sells here are bookkeeping adjustments so the app's share counts match {broker}; enter the real trade price if you know it (a sell's price sets its realized P&amp;L). They don't move cash: the cash row is synced to the broker's own figure instead.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {!loading && preview && changes.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              Transaction date
              <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800" />
            </label>
            <div className="flex items-center gap-2">
              {missingPrice && <span className="text-xs text-rose-600">Enter a price for every ticked buy/sell.</span>}
              <button onClick={onClose} disabled={applying} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Cancel</button>
              <button
                onClick={apply}
                disabled={applying || !chosen.length || missingPrice}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Apply {chosen.length} change{chosen.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
