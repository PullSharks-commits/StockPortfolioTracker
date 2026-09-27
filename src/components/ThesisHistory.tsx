// A thesis's logged checks, newest first: a status strip over time, then each check
// with its rules' values as they stood then.

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authedFetch } from '../backend';
import { STATUS_LABEL, formatRuleValue, type HistoryEntry, type ThesisStatus } from '../lib/thesis';
import { ThesisBadge } from './ThesisBadge';

const DOT: Record<ThesisStatus, string> = { on_track: 'bg-emerald-500', at_risk: 'bg-amber-400', broken: 'bg-rose-500', no_data: 'bg-zinc-300' };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function ThesisHistory({ thesisId }: { thesisId: string }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authedFetch('GET', `/api/data/thesisHistory?thesisId=${encodeURIComponent(thesisId)}`)
      .then((rows: { id: string; data: Omit<HistoryEntry, 'id'> }[]) => {
        if (cancelled) return;
        setEntries(rows.map(r => ({ ...r.data, id: r.id, results: Array.isArray(r.data.results) ? r.data.results : [] }))
          .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt)));
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [thesisId]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!entries) return <p className="inline-flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading history…</p>;
  if (entries.length === 0) return <p className="text-sm text-zinc-500">No checks logged yet. The first is recorded the next time the app evaluates this thesis.</p>;

  const strip = entries.slice(0, 90).reverse();
  const shown = showAll ? entries : entries.slice(0, 15);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex gap-0.5 flex-wrap" aria-label="Status over time">
          {strip.map(e => <span key={e.id} title={`${fmtDate(e.evaluatedAt)}: ${STATUS_LABEL[e.status]}`} className={`h-3 w-2 rounded-sm ${DOT[e.status] ?? DOT.no_data}`} />)}
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">{entries.length} check{entries.length === 1 ? '' : 's'} since {fmtDate(entries[entries.length - 1].evaluatedAt)} · logged when the status changes, otherwise once a day while the app is open</p>
      </div>

      <ol className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800">
        {shown.map(e => {
          const older = entries[entries.indexOf(e) + 1];
          const changed = older && older.status !== e.status;
          return (
            <li key={e.id} className={`px-3 py-2 ${changed ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}`}>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-500 w-24 shrink-0">{fmtDate(e.evaluatedAt)}</span>
                <ThesisBadge status={e.status} />
                {changed && <span className="text-zinc-500">from {STATUS_LABEL[older.status]}</span>}
              </div>
              {e.results.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-0 sm:pl-[6.5rem] text-[11px] font-mono">
                  {e.results.map(r => (
                    <span key={r.ruleId} className={r.pass === false ? (r.core ? 'text-rose-600' : 'text-amber-600') : r.pass ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-400'}
                      title={`${r.label} ${r.op === '>=' ? '≥' : '≤'} ${formatRuleValue(r.threshold, r.unit)}${r.core ? ' (core)' : ''}`}>
                      <span className="font-sans">{r.label}</span> {r.value == null ? '—' : formatRuleValue(r.value, r.unit)} {r.pass === true ? '✓' : r.pass === false ? '✗' : '?'}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {entries.length > 15 && (
        <button onClick={() => setShowAll(v => !v)} className="text-xs text-indigo-600 hover:underline">{showAll ? 'Show fewer' : `Show all ${entries.length}`}</button>
      )}
    </div>
  );
}
