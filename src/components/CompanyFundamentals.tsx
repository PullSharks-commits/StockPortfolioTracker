// Company view for a holding: reported financials from SEC EDGAR (via
// /api/fundamentals), long-term trends, valuation against the company's own
// history, and recent earnings vs estimates.

import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ExternalLink, Info, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { authedFetch } from '../backend';
import { computeValuation, type FundPeriod, type MarketData, type MultipleStats } from '../lib/valuation';

type Range = '5' | '10' | 'all';
interface Props {
  ticker: string;
  onSource?: (source: 'sec' | 'none' | 'error' | null) => void;
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ', AUD: 'A$', CAD: 'C$', JPY: '¥', INR: '₹', BRL: 'R$', RUB: '₽' };
const money = (v: number | null | undefined, ccy: string | null) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const sym = (ccy && SYMBOLS[ccy]) ?? (ccy ? `${ccy} ` : '');
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(0)}M` : a.toFixed(0);
  return `${v < 0 ? '-' : ''}${sym}${s}`;
};
const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
const signedPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const mult = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}×`);
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-rose-600' : '');

const COLORS = { revenue: '#6366f1', netIncome: '#10b981', gross: '#6366f1', operating: '#f59e0b', net: '#10b981', fcf: '#8b5cf6', sbc: '#f43f5e', shares: '#0ea5e9', roic: '#14b8a6' };

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
      <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3">{title}</h4>
      {children}
      {note && <p className="mt-2 text-[11px] text-zinc-400">{note}</p>}
    </div>
  );
}

function Stat({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={clsx('mt-0.5 text-lg font-semibold font-mono', className)}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

function MultipleCard({ name, stats }: { name: string; stats: MultipleStats }) {
  const { current, median, min, max, percentile } = stats;
  const pos = (v: number | null) => (v == null || min == null || max == null || max === min ? null : ((v - min) / (max - min)) * 100);
  const cur = pos(current), med = pos(median);
  const verdict = percentile == null ? null : percentile <= 0.25 ? 'cheap vs its history' : percentile >= 0.75 ? 'expensive vs its history' : 'around its usual range';
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{name}</span>
        <span className="text-xl font-semibold font-mono">{mult(current)}</span>
      </div>
      {cur != null ? (
        <>
          <div className="relative mt-4 h-1.5 rounded-full bg-gradient-to-r from-emerald-200 via-zinc-200 to-rose-200 dark:from-emerald-900 dark:via-zinc-700 dark:to-rose-900">
            {med != null && <div className="absolute -top-1 h-3.5 w-0.5 bg-zinc-500" style={{ left: `${med}%` }} title={`5-year median ${mult(median)}`} />}
            <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-900 dark:bg-white border-2 border-white dark:border-zinc-900" style={{ left: `${cur}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] font-mono text-zinc-400">
            <span>{mult(min)}</span><span>median {mult(median)}</span><span>{mult(max)}</span>
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            Higher than {Math.round((percentile ?? 0) * 100)}% of the last 5 years{verdict ? ` - ${verdict}` : ''}.
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">Not meaningful - {name === 'P/E' ? 'earnings' : name === 'P/FCF' ? 'free cash flow' : 'revenue'} wasn't positive.</p>
      )}
    </div>
  );
}

export function CompanyFundamentals({ ticker, onSource }: Props) {
  const [data, setData] = useState<any>(null);
  const [market, setMarket] = useState<(MarketData & { earnings: any[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'annual' | 'quarterly'>('annual');
  const [range, setRange] = useState<Range>('10');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setData(null); setMarket(null); onSource?.(null);
    Promise.all([
      authedFetch('GET', `/api/fundamentals/${encodeURIComponent(ticker)}`),
      fetch(`/api/company-market-data?symbol=${encodeURIComponent(ticker)}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([f, m]) => {
      if (cancelled) return;
      setData(f); setMarket(m); onSource?.(f?.source === 'sec' ? 'sec' : 'none');
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err)); onSource?.('error');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  const annual: FundPeriod[] = data?.annual ?? [];
  const quarterly: FundPeriod[] = data?.quarterly ?? [];
  const series = mode === 'annual' ? annual : quarterly;
  const shown = range === 'all' ? series : series.slice(-(Number(range) * (mode === 'annual' ? 1 : 4)));
  const ccy = [...annual, ...quarterly].reverse().find(p => p.values.revenue)?.values.revenue?.currency ?? null;
  const mixedCurrency = shown.some(p => p.values.revenue && p.values.revenue.currency !== ccy);

  const rows = useMemo(() => shown.map(p => ({
    period: mode === 'annual' ? p.key : p.key.replace(' FY', ' ’').replace(/’(\d{2})(\d{2})/, '’$2'),
    revenue: p.values.revenue?.currency === ccy ? p.values.revenue?.value ?? null : null,
    netIncome: p.values.netIncome?.currency === ccy ? p.values.netIncome?.value ?? null : null,
    fcf: p.derived.freeCashFlow,
    sbc: p.values.stockComp?.value ?? null,
    shares: p.values.dilutedShares?.value ?? null,
    grossMargin: p.derived.grossMargin, operatingMargin: p.derived.operatingMargin, netMargin: p.derived.netMargin, fcfMargin: p.derived.fcfMargin,
    roic: p.derived.roic, revenueGrowth: p.derived.revenueGrowth,
  })), [shown, mode, ccy]);

  const valuation = useMemo(() => (market && data?.source === 'sec' ? computeValuation(annual, quarterly, market) : null), [market, data]);

  if (loading) return <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (data?.source !== 'sec') {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 p-4 text-sm text-zinc-600 dark:text-zinc-400 flex gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>No SEC-reported financials for {ticker}. {data?.reason}</span>
      </div>
    );
  }

  const latest = annual[annual.length - 1];
  const d = latest?.derived ?? {};
  const pctAxis = (v: number) => `${Math.round(v * 100)}%`;
  const moneyAxis = (v: number) => money(v, ccy);
  const tooltipMoney = (v: any) => money(Number(v), ccy);
  const tooltipPct = (v: any) => pct(Number(v));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-500">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{data.entityName}</span>
          {' · '}reported figures from SEC EDGAR{data.latestFiled ? `, latest filing ${data.latestFiled}` : ''}
          {' · '}
          <a href={data.filingsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline">
            filings <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg">
            {(['annual', 'quarterly'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} disabled={m === 'quarterly' && quarterly.length === 0}
                className={clsx('px-2.5 py-1 text-xs font-medium rounded-md capitalize disabled:opacity-40', mode === m ? 'bg-white dark:bg-zinc-900 shadow-sm' : 'text-zinc-500')}>{m}</button>
            ))}
          </div>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg">
            {([['5', '5Y'], ['10', '10Y'], ['all', 'All']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setRange(v)} className={clsx('px-2.5 py-1 text-xs font-medium rounded-md', range === v ? 'bg-white dark:bg-zinc-900 shadow-sm' : 'text-zinc-500')}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={`Revenue ${latest.key}`} value={money(latest.values.revenue?.value, ccy)} sub={`${signedPct(d.revenueGrowth)} YoY`} />
          <Stat label="Revenue growth / yr" value={pct(d.revenueCagr5y ?? d.revenueCagr3y)} sub={d.revenueCagr5y != null ? `5y · 3y ${pct(d.revenueCagr3y)}` : '3y'} />
          <Stat label="Operating margin" value={pct(d.operatingMargin)} sub={`gross ${pct(d.grossMargin)}`} className={tone(d.operatingMargin)} />
          <Stat label="FCF margin" value={pct(d.fcfMargin)} sub={`stock comp ${pct(d.stockCompToRevenue)} of revenue`} className={tone(d.fcfMargin)} />
          <Stat label="Net income" value={money(latest.values.netIncome?.value, ccy)} sub={`${pct(d.netMargin)} margin`} className={tone(latest.values.netIncome?.value)} />
          <Stat label="ROIC (approx.)" value={pct(d.roic)} sub={d.roic == null ? 'not meaningful' : 'after-tax, on invested capital'} />
          <Stat label="Share count" value={signedPct(d.shareCountChange)} sub={d.shareCountChange != null ? (d.shareCountChange > 0 ? 'dilution YoY' : 'buybacks YoY') : 'diluted, YoY'} className={d.shareCountChange != null ? (d.shareCountChange > 0 ? 'text-rose-600' : 'text-emerald-600') : ''} />
          <Stat label="Net cash" value={money((latest.values.cash?.value ?? 0) - (latest.derived.debt ?? 0), ccy)} sub="cash minus long-term debt" />
        </div>
      )}

      {mixedCurrency && <p className="text-xs text-amber-700">Some earlier periods were reported in a different currency and are left out of the charts.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Revenue & net income">
          <div className="h-56"><ResponsiveContainer><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" /><XAxis dataKey="period" fontSize={11} /><YAxis tickFormatter={moneyAxis} fontSize={11} width={60} /><Tooltip formatter={tooltipMoney} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="revenue" name="Revenue" fill={COLORS.revenue} radius={[3, 3, 0, 0]} /><Bar dataKey="netIncome" name="Net income" fill={COLORS.netIncome} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
        <Card title="Margins">
          <div className="h-56"><ResponsiveContainer><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" /><XAxis dataKey="period" fontSize={11} /><YAxis tickFormatter={pctAxis} fontSize={11} width={45} /><Tooltip formatter={tooltipPct} /><Legend wrapperStyle={{ fontSize: 12 }} /><Line dataKey="grossMargin" name="Gross" stroke={COLORS.gross} dot={false} strokeWidth={2} /><Line dataKey="operatingMargin" name="Operating" stroke={COLORS.operating} dot={false} strokeWidth={2} /><Line dataKey="netMargin" name="Net" stroke={COLORS.net} dot={false} strokeWidth={2} /><Line dataKey="fcfMargin" name="FCF" stroke={COLORS.fcf} dot={false} strokeWidth={2} strokeDasharray="4 3" /></LineChart></ResponsiveContainer></div>
        </Card>
        <Card title="Free cash flow vs stock-based compensation" note="Stock comp is a real cost paid in shares; FCF well above it is higher-quality cash generation.">
          <div className="h-56"><ResponsiveContainer><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" /><XAxis dataKey="period" fontSize={11} /><YAxis tickFormatter={moneyAxis} fontSize={11} width={60} /><Tooltip formatter={tooltipMoney} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="fcf" name="Free cash flow" fill={COLORS.fcf} radius={[3, 3, 0, 0]} /><Bar dataKey="sbc" name="Stock comp" fill={COLORS.sbc} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
        <Card title="Diluted share count" note="Rising = dilution for existing holders; falling = buybacks. Step changes can be stock splits.">
          <div className="h-56"><ResponsiveContainer><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" /><XAxis dataKey="period" fontSize={11} /><YAxis tickFormatter={(v: number) => `${(v / 1e6).toFixed(0)}M`} fontSize={11} width={55} domain={['auto', 'auto']} /><Tooltip formatter={(v: any) => `${(Number(v) / 1e6).toFixed(1)}M shares`} /><Line dataKey="shares" name="Diluted shares" stroke={COLORS.shares} dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div>
        </Card>
        <Card title="Return on invested capital (approx.)" note="After-tax operating income ÷ (equity + debt − cash). Blank where invested capital isn't positive.">
          <div className="h-56"><ResponsiveContainer><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" /><XAxis dataKey="period" fontSize={11} /><YAxis tickFormatter={pctAxis} fontSize={11} width={45} /><Tooltip formatter={tooltipPct} /><Line dataKey="roic" name="ROIC" stroke={COLORS.roic} dot={false} strokeWidth={2} connectNulls={false} /></LineChart></ResponsiveContainer></div>
        </Card>
        <Card title="Revenue growth (year over year)">
          <div className="h-56"><ResponsiveContainer><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" /><XAxis dataKey="period" fontSize={11} /><YAxis tickFormatter={pctAxis} fontSize={11} width={45} /><Tooltip formatter={tooltipPct} /><Bar dataKey="revenueGrowth" name="Revenue growth" fill={COLORS.revenue} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">Valuation vs its own history</h4>
        <p className="text-xs text-zinc-500 mb-3">Trailing 12 months, using only figures filed at each point in time. Range and median cover the last 5 years.</p>
        {valuation?.unavailable || !valuation ? (
          <p className="text-sm text-zinc-500">{valuation?.unavailable ?? 'Price history unavailable.'}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MultipleCard name="P/E" stats={valuation.stats.pe} />
            <MultipleCard name="EV/Sales" stats={valuation.stats.evSales} />
            <MultipleCard name="P/FCF" stats={valuation.stats.pFcf} />
          </div>
        )}
      </div>

      {market?.earnings && market.earnings.length > 0 && (
        <Card title="Recent earnings vs estimates">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400"><th className="py-1">Quarter ended</th><th className="py-1 text-right">EPS estimate</th><th className="py-1 text-right">EPS actual</th><th className="py-1 text-right">Surprise</th></tr></thead>
            <tbody>
              {market.earnings.map((e: any) => (
                <tr key={e.quarterEnd} className="border-t border-zinc-100 dark:border-zinc-800 font-mono">
                  <td className="py-1.5 font-sans">{e.quarterEnd}</td>
                  <td className="py-1.5 text-right">{e.epsEstimate?.toFixed(2) ?? '—'}</td>
                  <td className="py-1.5 text-right">{e.epsActual?.toFixed(2) ?? '—'}</td>
                  <td className={clsx('py-1.5 text-right', tone(e.surprisePercent))}>{signedPct(e.surprisePercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {quarterly.length === 0 && <p className="text-xs text-zinc-400">This company files annual reports only in structured form, so quarterly figures aren't available.</p>}
    </div>
  );
}
