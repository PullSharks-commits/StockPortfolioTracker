// "Portfolio as one company": look-through fundamentals of the holdings combined,
// plus what drove each holding's share price - business growth, share count or the
// valuation multiple.

import React, { useMemo, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { getCurrencySymbol } from '../lib/currency';
import { lookThrough, portfolioAttribution, type HoldingInput } from '../lib/portfolioFundamentals';

const pct = (x: number | null | undefined, signed = false, digits = 1) =>
  x == null || !Number.isFinite(x) ? '—' : `${signed && x > 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
const multiple = (x: number | null) => (x == null || !Number.isFinite(x) ? 'n/m' : `${x.toFixed(1)}×`);
const tone = (x: number | null | undefined) => (x == null ? 'text-zinc-400' : x > 0 ? 'text-emerald-600' : x < 0 ? 'text-rose-600' : 'text-zinc-500');

function money(v: number | null, currency: string) {
  if (v == null) return '—';
  const a = Math.abs(v), sym = getCurrencySymbol(currency);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${v < 0 ? '-' : ''}${sym}${s}`;
}

function Tile({ label, value, sub, hint }: { label: string; value: React.ReactNode; sub?: React.ReactNode; hint: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900 p-3" title={hint}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// Three drivers as a diverging bar around zero, scaled to the largest magnitude shown.
function DriverBar({ parts, scale }: { parts: { v: number; color: string }[]; scale: number }) {
  const pos = parts.filter(p => p.v > 0), neg = parts.filter(p => p.v < 0);
  const w = (v: number) => `${Math.min(100, (Math.abs(v) / scale) * 100)}%`;
  return (
    <div className="relative h-3 w-full rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-300 dark:bg-zinc-600" />
      <div className="absolute inset-y-0 left-1/2 w-1/2 flex">{pos.map((p, i) => <div key={i} style={{ width: w(p.v) }} className={p.color} />)}</div>
      <div className="absolute inset-y-0 right-1/2 w-1/2 flex flex-row-reverse">{neg.map((p, i) => <div key={i} style={{ width: w(p.v) }} className={p.color} />)}</div>
    </div>
  );
}

const COLORS = { revenue: 'bg-indigo-500', shares: 'bg-amber-400', multiple: 'bg-fuchsia-400' };

export function PortfolioFundamentals({ holdings, currency, loading, error }: {
  holdings: HoldingInput[]; currency: string; loading: boolean; error: string | null;
}) {
  const [years, setYears] = useState<1 | 3>(1);
  const [showAll, setShowAll] = useState(false);
  const lt = useMemo(() => lookThrough(holdings), [holdings]);
  const attr = useMemo(() => portfolioAttribution(holdings, years), [holdings, years]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (loading && lt.included.length === 0) {
    return <p className="inline-flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> Loading company financials for your holdings…</p>;
  }
  if (lt.included.length === 0) return <p className="text-sm text-zinc-500">None of these holdings file financials with the SEC, so there's nothing to combine.</p>;

  const coverage = lt.totalValue > 0 ? lt.coveredValue / lt.totalValue : 0;
  const rows = attr ? (showAll ? attr.rows : attr.rows.slice(0, 10)) : [];
  const scale = Math.max(0.05, ...(attr ? [attr, ...rows].flatMap(r => [r.fromRevenue, r.fromShares, r.fromMultiple].map(Math.abs)) : [0]));

  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-500">
        Your stake in each company (position value ÷ market cap) applied to its last twelve months of results, added up.
        {lt.excluded.length > 0 && <>{' '}Not included: <span title={lt.excluded.map(e => `${e.ticker}: ${e.reason}`).join('\n')} className="underline decoration-dotted cursor-help">{lt.excluded.map(e => e.ticker).join(', ')}</span>.</>}
        {loading && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-indigo-600" />}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Revenue" value={money(lt.revenue, currency)} sub={<span className={tone(lt.revenueGrowth)}>{pct(lt.revenueGrowth, true)} YoY</span>} hint="Your share of the companies' revenue over the last twelve months, and its growth on the twelve months before." />
        <Tile label="Operating margin" value={pct(lt.operatingMargin)} sub={`Gross ${pct(lt.grossMargin)}`} hint="Combined operating income ÷ combined revenue (holdings that report it)." />
        <Tile label="Net margin" value={pct(lt.netMargin)} sub={`Earnings ${money(lt.netIncome, currency)}`} hint="Combined net income ÷ combined revenue." />
        <Tile label="FCF margin" value={pct(lt.fcfMargin)} sub={`FCF ${money(lt.freeCashFlow, currency)}`} hint="Combined free cash flow (operating cash flow − capex) ÷ combined revenue. Not shown for lenders." />
        <Tile label="P/E" value={multiple(lt.pe)} sub={`Earnings yield ${pct(lt.earningsYield)}`} hint="Value of the covered holdings ÷ your share of their earnings. Losses count against profits, as they would for one company." />
        <Tile label="P/S" value={multiple(lt.ps)} hint="Value of the covered holdings ÷ your share of their revenue." />
        <Tile label="FCF yield" value={pct(lt.fcfYield)} hint="Your share of free cash flow ÷ value of those holdings." />
        <Tile label="Covered" value={pct(coverage, false, 0)} sub={`${lt.included.length} of ${lt.included.length + lt.excluded.length} holdings`} hint={lt.excluded.length ? `Not included:\n${lt.excluded.map(e => `${e.ticker}: ${e.reason}`).join('\n')}` : 'All holdings included.'} />
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-1">
            What drove the share prices
            <span title="Price return splits exactly into: revenue growth, change in share count (buybacks help, dilution hurts), and change in the price-to-sales multiple. Uses only figures filed by each date. Weighted by today's position values, so it describes your current holdings, not your past trades."><Info className="w-3.5 h-3.5 text-zinc-400" /></span>
          </h3>
          <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 text-xs">
            {([1, 3] as const).map(y => (
              <button key={y} onClick={() => setYears(y)} className={`px-2.5 py-1 rounded-md ${years === y ? 'bg-indigo-600 text-white' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                {y} year{y > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        {!attr ? <p className="text-sm text-zinc-500">Not enough price and filing history for this period.</p> : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 mb-2">
              <span className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${COLORS.revenue}`} /> Revenue growth</span>
              <span className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${COLORS.shares}`} /> Share count</span>
              <span className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${COLORS.multiple}`} /> Valuation (P/S)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-zinc-400 text-right">
                    <th className="text-left font-medium py-1.5 pr-2">Holding</th>
                    <th className="font-medium py-1.5 px-2">Price</th>
                    <th className="font-medium py-1.5 px-2">Revenue</th>
                    <th className="font-medium py-1.5 px-2">Shares</th>
                    <th className="font-medium py-1.5 px-2">Valuation</th>
                    <th className="font-medium py-1.5 px-2 hidden md:table-cell">P/S</th>
                    <th className="font-medium py-1.5 pl-2 w-[28%] hidden sm:table-cell" />
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr className="border-y border-zinc-200 dark:border-zinc-700 font-semibold">
                    <td className="text-left py-2 pr-2 font-sans">Portfolio <span className="hidden sm:inline font-normal text-xs text-zinc-400">({pct(attr.coveredValue / lt.totalValue, false, 0)} of value)</span></td>
                    <td className={`text-right px-2 ${tone(attr.priceReturn)}`}>{pct(attr.priceReturn, true)}</td>
                    <td className={`text-right px-2 ${tone(attr.fromRevenue)}`}>{pct(attr.fromRevenue, true)}</td>
                    <td className={`text-right px-2 ${tone(attr.fromShares)}`}>{pct(attr.fromShares, true)}</td>
                    <td className={`text-right px-2 ${tone(attr.fromMultiple)}`}>{pct(attr.fromMultiple, true)}</td>
                    <td className="hidden md:table-cell" />
                    <td className="pl-2 hidden sm:table-cell"><DriverBar scale={scale} parts={[{ v: attr.fromRevenue, color: COLORS.revenue }, { v: attr.fromShares, color: COLORS.shares }, { v: attr.fromMultiple, color: COLORS.multiple }]} /></td>
                  </tr>
                  {rows.map(r => (
                    <tr key={r.ticker} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="text-left py-1.5 pr-2 font-sans font-medium">{r.ticker} <span className="text-xs font-normal text-zinc-400">{pct(r.weight, false, 0)}</span></td>
                      <td className={`text-right px-2 ${tone(r.priceReturn)}`}>{pct(r.priceReturn, true)}</td>
                      <td className={`text-right px-2 ${tone(r.fromRevenue)}`} title={`Revenue ${pct(r.revenueGrowth, true)} over the period`}>{pct(r.fromRevenue, true)}</td>
                      <td className={`text-right px-2 ${tone(r.fromShares)}`} title={`Share count ${pct(r.shareChange, true)}`}>{pct(r.fromShares, true)}</td>
                      <td className={`text-right px-2 ${tone(r.fromMultiple)}`}>{pct(r.fromMultiple, true)}</td>
                      <td className="text-right px-2 text-xs text-zinc-500 whitespace-nowrap hidden md:table-cell">{r.psFrom.toFixed(1)}→{r.psTo.toFixed(1)}</td>
                      <td className="pl-2 hidden sm:table-cell"><DriverBar scale={scale} parts={[{ v: r.fromRevenue, color: COLORS.revenue }, { v: r.fromShares, color: COLORS.shares }, { v: r.fromMultiple, color: COLORS.multiple }]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {attr.rows.length > 10 && (
              <button onClick={() => setShowAll(v => !v)} className="mt-2 text-xs text-indigo-600 hover:underline">
                {showAll ? 'Show top 10' : `Show all ${attr.rows.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
