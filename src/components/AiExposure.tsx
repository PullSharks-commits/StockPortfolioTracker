// AI / data-centre build-out exposure of the current tab: how much sits with the
// companies selling the build-out, the hyperscalers paying for it, AI-adjacent
// software, and the rest. Leveraged funds also shown at their effective size.

import React, { useMemo } from 'react';
import { getCurrencySymbol } from '../lib/currency';
import { AI_BUCKETS, aiBreakdown, type AiRow } from '../lib/aiExposure';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function money(v: number, currency: string) {
  const a = Math.abs(v), sym = getCurrencySymbol(currency);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${v < 0 ? '-' : ''}${sym}${s}`;
}

export function AiExposure({ rows, currency }: { rows: AiRow[]; currency: string }) {
  const b = useMemo(() => aiBreakdown(rows), [rows]);
  if (!b.total) return <p className="text-sm text-zinc-500">No holdings to classify.</p>;
  const shown = b.buckets.filter(x => x.value > 0);
  const levered = b.buildOutEffectiveShare - b.buildOutShare > 0.0005;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <span className="text-3xl font-semibold font-mono text-zinc-900 dark:text-zinc-100">{pct(b.buildOutShare)}</span>
          <span className="ml-2 text-sm text-zinc-500">tied to the AI build-out (chips &amp; hardware + hyperscalers)</span>
        </div>
        {levered && (
          <div className="text-sm text-zinc-500" title="Leveraged funds counted at their multiple (SOXL 3×, FBL 2×, ...)">
            <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">{pct(b.buildOutEffectiveShare)}</span> counting leverage
          </div>
        )}
      </div>

      <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {shown.map(x => {
          const meta = AI_BUCKETS.find(m => m.id === x.id)!;
          return <div key={x.id} className={meta.color} style={{ width: `${x.share * 100}%` }} title={`${meta.label}: ${pct(x.share)}`} />;
        })}
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {shown.map(x => {
          const meta = AI_BUCKETS.find(m => m.id === x.id)!;
          return (
            <div key={x.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="sm:w-64 shrink-0" title={meta.hint}>
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${meta.color}`} />
                  {meta.short}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 pl-[18px]">
                  <span className="font-mono">{pct(x.share)}</span> · {money(x.value, currency)}
                  {Math.abs(x.effectiveShare - x.share) > 0.0005 && <> · <span className="font-mono">{pct(x.effectiveShare)}</span> w/ leverage</>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {x.holdings.map(h => (
                  <span key={h.ticker} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-1.5 py-0.5 text-xs">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">{h.ticker}</span>
                    {h.leverage !== 1 && <span className="text-[10px] text-amber-600">{h.leverage}×</span>}
                    <span className="font-mono text-zinc-500">{pct(h.share)}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500 leading-relaxed">
        If AI spending slows because enough has been built and demand holds, chips &amp; hardware lose revenue while the
        hyperscalers' cash flow improves, so the two partly offset. If it slows because AI disappointed, both tend to fall together.
        Classification is a curated list plus Yahoo's industry; hover a group for what it means.
      </p>
    </div>
  );
}
