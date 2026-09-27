// Editor for a holding's investment thesis: why you own it, plus measurable rules
// ("revenue growth ≥ 15%") checked against the company's latest filings.

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleHelp, Plus, Trash2, X, XCircle } from 'lucide-react';
import { authedFetch } from '../backend';
import {
  METRICS, STATUS_LABEL, evaluateRules, formatRuleValue, isSegmentMetric, ruleLabel, ruleUnit, segmentGrowth,
  segmentMetricKey, thesisStatus, type MetricInputs, type SegmentSeriesLite, type Thesis, type ThesisRule, type ThesisStatus,
} from '../lib/thesis';
import { ThesisBadge } from './ThesisBadge';

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

const STARTERS: Omit<ThesisRule, 'id'>[] = [
  { metric: 'revenueGrowth', op: '>=', value: 15, core: true },
  { metric: 'operatingMargin', op: '>=', value: 15, core: false },
  { metric: 'shareCountChange', op: '<=', value: 3, core: false },
  { metric: 'ps', op: '<=', value: 15, core: false },
];

const CATEGORY_NAMES: Record<string, string> = {
  segment_revenue: 'Segments', product_revenue: 'Products', geographic_revenue: 'Regions',
};

export function ThesisEditor({ ticker, thesis, inputs, onClose, onSave, onDelete }: {
  ticker: string;
  thesis: Thesis | null;
  inputs: MetricInputs;
  onClose: () => void;
  onSave: (data: Pick<Thesis, 'summary' | 'rules' | 'manualStatus'>) => Promise<void>;
  onDelete?: () => Promise<boolean>;
}) {
  const [summary, setSummary] = useState(thesis?.summary ?? '');
  const [rules, setRules] = useState<ThesisRule[]>(thesis?.rules ?? []);
  const [manualStatus, setManualStatus] = useState<ThesisStatus | null>(thesis?.manualStatus ?? null);
  const [segments, setSegments] = useState<SegmentSeriesLite[]>([]);
  const [saving, setSaving] = useState(false);
  const secFiler = ticker !== 'CASH' && !ticker.includes('.');

  useEffect(() => {
    if (!secFiler) return;
    let cancelled = false;
    authedFetch('GET', `/api/company-segments/${encodeURIComponent(ticker)}`)
      .then((res: { series?: SegmentSeriesLite[] }) => {
        if (!cancelled) setSegments((res.series ?? []).filter(s => s.category !== 'segment_operating_income' && segmentGrowth(s)));
      })
      .catch(() => { /* segment rules just won't be offered */ });
    return () => { cancelled = true; };
  }, [ticker, secFiler]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allInputs = useMemo(() => ({ ...inputs, segments }), [inputs, segments]);
  const results = useMemo(() => evaluateRules(rules, allInputs), [rules, allInputs]);
  const status = thesisStatus({ rules, manualStatus }, results);

  const update = (id: string, patch: Partial<ThesisRule>) => setRules(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const add = (r: Omit<ThesisRule, 'id'>) => setRules(rs => [...rs, { ...r, id: newId() }]);
  const setMetric = (id: string, metric: string) => {
    const seg = segments.find(s => segmentMetricKey(s.key) === metric);
    update(id, { metric, label: seg?.label, op: METRICS[metric]?.unit === '×' ? '<=' : '>=' });
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ summary: summary.trim(), rules, manualStatus: rules.length ? null : manualStatus });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Suggest the largest business segment (else the largest product line).
  const latestValue = (s: SegmentSeriesLite) => s.points[s.points.length - 1]?.value ?? 0;
  const starterSegment = [...segments].sort((a, b) =>
    Number(b.category === 'segment_revenue') - Number(a.category === 'segment_revenue') || latestValue(b) - latestValue(a))[0];

  const groups = Object.entries(METRICS).reduce<Record<string, [string, string][]>>((g, [k, m]) => {
    (g[m.group] ??= []).push([k, m.label]);
    return g;
  }, {});
  const segmentGroups = segments.reduce<Record<string, SegmentSeriesLite[]>>((g, s) => {
    (g[CATEGORY_NAMES[s.category] ?? 'Segments'] ??= []).push(s);
    return g;
  }, {});

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-xl" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={`Thesis for ${ticker}`}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-lg font-semibold truncate">Thesis · {ticker}</h3>
            {status && <ThesisBadge status={status} />}
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="thesis-summary">Why I own it</label>
            <textarea id="thesis-summary" value={summary} onChange={e => setSummary(e.target.value)} rows={3}
              placeholder="e.g. Azure keeps growing 30%+ as AI workloads move to the cloud, while Office funds buybacks."
              className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">What must stay true</span>
              <span className="text-xs text-zinc-500">A failing <b>core</b> rule means Broken; any other failing rule means At risk.</span>
            </div>

            {!secFiler && <p className="mt-2 text-sm text-zinc-500">Rules need SEC financials, which this holding doesn't have. You can still write the thesis and set its status by hand.</p>}

            <div className="mt-2 space-y-2">
              {results.map(({ rule, value, pass }) => {
                const unit = ruleUnit(rule);
                return (
                  <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-2">
                    <select value={rule.metric} onChange={e => setMetric(rule.id, e.target.value)} aria-label="Metric"
                      className="min-w-0 flex-1 basis-40 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm">
                      {Object.entries(groups).map(([g, items]) => (
                        <optgroup key={g} label={g}>{items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
                      ))}
                      {Object.entries(segmentGroups).map(([g, items]) => (
                        <optgroup key={g} label={`${g} (YoY growth, latest quarter)`}>
                          {items.map(s => <option key={s.key} value={segmentMetricKey(s.key)}>{s.label} growth</option>)}
                        </optgroup>
                      ))}
                      {isSegmentMetric(rule.metric) && !segments.some(s => segmentMetricKey(s.key) === rule.metric) && (
                        <option value={rule.metric}>{ruleLabel(rule)} (no longer reported)</option>
                      )}
                    </select>
                    <select value={rule.op} onChange={e => update(rule.id, { op: e.target.value as ThesisRule['op'] })} aria-label="Condition"
                      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm">
                      <option value=">=">at least</option>
                      <option value="<=">at most</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <input type="number" step="any" value={Number.isFinite(rule.value) ? rule.value : ''} aria-label="Threshold"
                        onChange={e => update(rule.id, { value: e.target.value === '' ? NaN : Number(e.target.value) })}
                        className="w-20 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm font-mono text-right" />
                      <span className="text-sm text-zinc-500 w-3">{unit}</span>
                    </div>
                    <label className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                      <input type="checkbox" checked={rule.core} onChange={e => update(rule.id, { core: e.target.checked })} /> Core
                    </label>
                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-mono whitespace-nowrap" title={isSegmentMetric(rule.metric) ? 'Latest quarter vs a year earlier' : METRICS[rule.metric]?.hint}>
                      {pass === true && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                      {pass === false && <XCircle className={`w-4 h-4 ${rule.core ? 'text-rose-600' : 'text-amber-500'}`} />}
                      {pass === null && <CircleHelp className="w-4 h-4 text-zinc-400" />}
                      {value == null ? 'no data' : formatRuleValue(value, unit)}
                    </span>
                    <button onClick={() => setRules(rs => rs.filter(r => r.id !== rule.id))} className="p-1 text-zinc-400 hover:text-rose-600 rounded" aria-label="Remove rule"><Trash2 className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>

            {secFiler && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => add({ metric: 'revenueGrowth', op: '>=', value: 10, core: false })}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <Plus className="w-3.5 h-3.5" /> Add rule
                </button>
                {rules.length === 0 && STARTERS.map(r => (
                  <button key={r.metric} onClick={() => add(r)} className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-indigo-50 hover:text-indigo-700">
                    {METRICS[r.metric].label} {r.op === '>=' ? '≥' : '≤'} {r.value}{METRICS[r.metric].unit}
                  </button>
                ))}
                {rules.length === 0 && starterSegment && (
                  <button onClick={() => add({ metric: segmentMetricKey(starterSegment.key), label: starterSegment.label, op: '>=', value: 15, core: true })}
                    className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-indigo-50 hover:text-indigo-700">
                    {starterSegment.label} growth ≥ 15%
                  </button>
                )}
              </div>
            )}
          </div>

          {rules.length === 0 && (
            <div>
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Status (set by hand while there are no rules)</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {([null, 'on_track', 'at_risk', 'broken'] as (ThesisStatus | null)[]).map(s => (
                  <button key={s ?? 'none'} onClick={() => setManualStatus(s)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${manualStatus === s ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>
                    {s ? STATUS_LABEL[s] : 'No status'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 sticky bottom-0 bg-white dark:bg-zinc-900">
          <div>
            {thesis && onDelete && (
              <button onClick={async () => { if (await onDelete()) onClose(); }} className="text-sm text-rose-600 hover:underline">Delete thesis</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
            <button onClick={save} disabled={saving || rules.some(r => !Number.isFinite(r.value))}
              className="rounded-lg bg-zinc-900 dark:bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save thesis'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
