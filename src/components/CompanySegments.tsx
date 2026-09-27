// Segment, product and geography revenue (and segment operating income) from the
// XBRL data companies tag in their 10-Q/10-K filings (/api/company-segments).

import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { ExternalLink, Loader2 } from 'lucide-react';
import { authedFetch } from '../backend';

interface SegmentPoint {
  start: string; end: string; type: 'quarter' | 'annual';
  value: number; currency: string | null; form: string; filed: string; url: string; derived?: boolean;
}
interface SegmentSeries { key: string; label: string; category: string; points: SegmentPoint[] }
interface SegmentsResponse { status: 'ready' | 'none' | 'unsupported'; series: SegmentSeries[] }

const CATEGORY_TITLES: Record<string, string> = {
  segment_revenue: 'Revenue by segment',
  segment_operating_income: 'Operating income by segment',
  product_revenue: 'Revenue by product',
  geographic_revenue: 'Revenue by geography',
};
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ', AUD: 'A$', CAD: 'C$', JPY: '¥', INR: '₹', BRL: 'R$', CNY: '¥', HKD: 'HK$', SGD: 'S$' };

function formatMoney(value: number, currency: string | null) {
  const a = Math.abs(value);
  const compact = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${a}`;
  return `${value < 0 ? '-' : ''}${(currency && SYMBOLS[currency]) ?? (currency ? currency + ' ' : '')}${compact}`;
}

const periodLabel = (p: SegmentPoint) => {
  const dt = new Date(p.end + 'T00:00:00Z');
  return p.type === 'annual'
    ? `FY ${dt.getUTCFullYear()}`
    : `${dt.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ’${String(dt.getUTCFullYear()).slice(2)}`;
};

// Same period one year earlier (period ends within ~3 weeks of a year apart).
function yoy(points: SegmentPoint[], p: SegmentPoint): number | null {
  const target = Date.parse(p.end) - 365 * 86_400_000;
  const prev = points.find(q => q !== p && q.currency === p.currency && Math.abs(Date.parse(q.end) - target) < 21 * 86_400_000);
  if (!prev || prev.value === 0 || prev.value < 0 || p.value < 0) return null;
  return (p.value / prev.value - 1) * 100;
}

export function CompanySegments({ ticker }: { ticker: string }) {
  const [data, setData] = useState<SegmentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'quarter' | 'annual'>('quarter');

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    authedFetch('GET', `/api/company-segments/${encodeURIComponent(ticker)}`)
      .then((res: SegmentsResponse) => { if (!cancelled) setData(res); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [ticker]);

  const groups = useMemo(() => {
    const rows = (data?.series ?? [])
      .map(s => ({ ...s, shown: s.points.filter(p => p.type === period) }))
      .filter(s => s.shown.length > 0);
    return Object.keys(CATEGORY_TITLES)
      .map(category => ({
        category,
        // Largest first by the latest value.
        series: rows.filter(s => s.category === category).sort((a, b) => Math.abs(b.shown[b.shown.length - 1].value) - Math.abs(a.shown[a.shown.length - 1].value)),
      }))
      .filter(g => g.series.length > 0);
  }, [data, period]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Segments</h4>
        {data?.status === 'ready' && (
          <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 text-xs">
            {(['quarter', 'annual'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded-md ${period === p ? 'bg-indigo-600 text-white' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                {p === 'quarter' ? 'Quarterly' : 'Annual'}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        As tagged by the company in its 10-Q/10-K filings with the SEC. Q4 figures (marked *) are the fiscal year minus the first nine months.
      </p>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!data && !error && <p className="inline-flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 text-indigo-600 animate-spin" /> Reading recent filings…</p>}
      {data?.status === 'unsupported' && <p className="text-sm text-zinc-500">Only available for companies filing with the SEC.</p>}
      {data && data.status !== 'unsupported' && groups.length === 0 && (
        <p className="text-sm text-zinc-500">This company doesn't break down its {period === 'quarter' ? 'quarterly' : 'annual'} revenue by segment, product or geography in its filings.</p>
      )}

      <div className="space-y-5">
        {groups.map(g => (
          <div key={g.category}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">{CATEGORY_TITLES[g.category]}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.series.map(s => {
                const pts = s.shown.slice(period === 'quarter' ? -12 : -6);
                const latest = pts[pts.length - 1];
                const growth = yoy(s.shown, latest);
                return (
                  <div key={s.key} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate" title={s.label}>{s.label}</span>
                      <span className="text-xs text-zinc-400 whitespace-nowrap">{periodLabel(latest)}{latest.derived ? '*' : ''}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-lg font-semibold font-mono">{formatMoney(latest.value, latest.currency)}</span>
                      {growth != null && <span className={growth >= 0 ? 'text-xs text-emerald-600' : 'text-xs text-rose-600'}>{growth >= 0 ? '+' : ''}{growth.toFixed(1)}% YoY</span>}
                    </div>
                    {pts.length >= 2 && (
                      <div className="h-16 mt-1">
                        <ResponsiveContainer>
                          <BarChart data={pts.map(p => ({ period: periodLabel(p) + (p.derived ? '*' : ''), value: p.value, label: formatMoney(p.value, p.currency) }))}>
                            <XAxis dataKey="period" hide />
                            <Tooltip formatter={(_v: any, _n: any, item: any) => [item.payload.label, s.label]} />
                            <Bar dataKey="value" fill={g.category === 'segment_operating_income' ? '#10b981' : '#6366f1'} radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <a href={latest.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:underline">
                      {latest.form} filed {latest.filed} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
