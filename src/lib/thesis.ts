// Investment thesis tracking: measurable rules per holding, checked against the
// company's latest filed figures. Pure functions, no I/O.
//
// Status:
// - Broken:   a core rule fails
// - At risk:  a supporting rule fails
// - On track: every rule with data passes
// - No data:  rules exist but none can be checked yet
// Without rules, the status is whatever the user set by hand (or none).

import type { HoldingFundamentals } from './portfolioFundamentals';

export type ThesisStatus = 'on_track' | 'at_risk' | 'broken' | 'no_data';
export type RuleOp = '>=' | '<=';

export interface ThesisRule {
  id: string;
  metric: string;        // key in METRICS, or `segment:<series key>`
  op: RuleOp;
  value: number;         // percent metrics in percent (15 = 15%), multiples as-is
  core: boolean;
  label?: string;        // segment rules: the segment's name when the rule was made
}

export interface Thesis {
  id: string;
  ticker: string;
  portfolioType: string;
  summary: string;
  rules: ThesisRule[];
  manualStatus?: ThesisStatus | null;
  lastStatus?: ThesisStatus | null;
  statusChangedAt?: string | null;
  lastLoggedAt?: string | null;   // last history entry
}

// One logged check: the status and each rule as it stood at the time. Rules are
// copied (label, threshold) so the entry still reads correctly after edits.
export interface HistoryRule { ruleId: string; label: string; op: RuleOp; threshold: number; unit: string; value: number | null; pass: boolean | null; core: boolean }
export interface HistoryEntry { id: string; thesisId: string; ticker: string; status: ThesisStatus; results: HistoryRule[]; evaluatedAt: string }

export function historySnapshot(results: RuleResult[], segments?: SegmentSeriesLite[]): HistoryRule[] {
  return results.map(({ rule, value, pass }) => ({
    ruleId: rule.id, label: ruleLabel(rule, segments), op: rule.op, threshold: rule.value, unit: ruleUnit(rule),
    value: value == null ? null : Math.round(value * 100) / 100, pass, core: rule.core,
  }));
}

// Log when the status changes, otherwise at most once per calendar day.
export function shouldLog(thesis: Pick<Thesis, 'lastStatus' | 'lastLoggedAt'>, status: ThesisStatus, now = new Date()) {
  if (status !== thesis.lastStatus || !thesis.lastLoggedAt) return true;
  return new Date(thesis.lastLoggedAt).toDateString() !== now.toDateString();
}

export interface MetricDef { label: string; unit: '%' | '×'; group: string; hint: string }

export const METRICS: Record<string, MetricDef> = {
  revenueGrowth: { label: 'Revenue growth', unit: '%', group: 'Growth', hint: 'Last twelve months vs the twelve before' },
  grossMargin: { label: 'Gross margin', unit: '%', group: 'Profitability', hint: 'Last twelve months' },
  operatingMargin: { label: 'Operating margin', unit: '%', group: 'Profitability', hint: 'Last twelve months' },
  netMargin: { label: 'Net margin', unit: '%', group: 'Profitability', hint: 'Last twelve months' },
  fcfMargin: { label: 'FCF margin', unit: '%', group: 'Profitability', hint: 'Free cash flow ÷ revenue, last twelve months' },
  shareCountChange: { label: 'Share count change (1y)', unit: '%', group: 'Capital', hint: 'Diluted shares vs a year ago; negative = buybacks' },
  ps: { label: 'P/S', unit: '×', group: 'Valuation', hint: 'Market cap ÷ revenue, last twelve months' },
  pe: { label: 'P/E', unit: '×', group: 'Valuation', hint: 'Market cap ÷ net income, last twelve months (none if loss-making)' },
  fcfYield: { label: 'FCF yield', unit: '%', group: 'Valuation', hint: 'Free cash flow ÷ market cap' },
};

// A segment/product/geography series from /api/company-segments.
export interface SegmentSeriesLite {
  key: string; label: string; category: string;
  points: { end: string; type: 'quarter' | 'annual'; value: number; currency: string | null }[];
}

export const segmentMetricKey = (seriesKey: string) => `segment:${seriesKey}`;
export const isSegmentMetric = (metric: string) => metric.startsWith('segment:');

// Latest quarter's growth on the same quarter a year earlier, in percent.
export function segmentGrowth(series: SegmentSeriesLite): { value: number; asOf: string } | null {
  const qs = series.points.filter(p => p.type === 'quarter');
  const last = qs[qs.length - 1];
  if (!last) return null;
  const target = Date.parse(last.end) - 365 * 86_400_000;
  const prev = qs.find(p => p.currency === last.currency && Math.abs(Date.parse(p.end) - target) < 21 * 86_400_000);
  if (!prev || prev.value <= 0) return null;
  return { value: (last.value / prev.value - 1) * 100, asOf: last.end };
}

export interface MetricInputs {
  fundamentals?: HoldingFundamentals;
  ps?: number | null;
  pe?: number | null;
  fcfYield?: number | null;
  segments?: SegmentSeriesLite[];
}

// Current value of a metric, in the rule's units (percent or multiple).
export function metricValue(metric: string, x: MetricInputs): number | null {
  if (isSegmentMetric(metric)) {
    const s = x.segments?.find(s => segmentMetricKey(s.key) === metric);
    return s ? segmentGrowth(s)?.value ?? null : null;
  }
  const f = x.fundamentals;
  const pct = (v: number | null | undefined) => (v == null ? null : v * 100);
  switch (metric) {
    case 'revenueGrowth': return pct(f?.revenueGrowth);
    case 'grossMargin': return pct(f?.grossMargin);
    case 'operatingMargin': return pct(f?.operatingMargin);
    case 'netMargin': return pct(f?.netMargin);
    case 'fcfMargin': return pct(f?.fcfMargin);
    case 'shareCountChange': return pct(f?.attribution?.find(a => a.years === 1)?.shareChange);
    case 'ps': return x.ps ?? null;
    case 'pe': return x.pe ?? null;
    case 'fcfYield': return pct(x.fcfYield);
    default: return null;
  }
}

export interface RuleResult { rule: ThesisRule; value: number | null; pass: boolean | null }

export function evaluateRules(rules: ThesisRule[], x: MetricInputs): RuleResult[] {
  return rules.map(rule => {
    const value = metricValue(rule.metric, x);
    const pass = value == null ? null : rule.op === '>=' ? value >= rule.value : value <= rule.value;
    return { rule, value, pass };
  });
}

export function thesisStatus(thesis: Pick<Thesis, 'rules' | 'manualStatus'>, results: RuleResult[]): ThesisStatus | null {
  if (thesis.rules.length === 0) return thesis.manualStatus ?? null;
  if (results.some(r => r.rule.core && r.pass === false)) return 'broken';
  if (results.some(r => !r.rule.core && r.pass === false)) return 'at_risk';
  if (results.every(r => r.pass === null)) return 'no_data';
  return 'on_track';
}

const SEVERITY: Record<ThesisStatus, number> = { no_data: 0, on_track: 1, at_risk: 2, broken: 3 };
export const isWorse = (next: ThesisStatus | null, prev: ThesisStatus | null | undefined) =>
  !!next && !!prev && SEVERITY[next] > SEVERITY[prev] && next !== 'no_data';

export const STATUS_LABEL: Record<ThesisStatus, string> = { on_track: 'On track', at_risk: 'At risk', broken: 'Broken', no_data: 'No data' };

export function ruleLabel(rule: ThesisRule, segments?: SegmentSeriesLite[]) {
  if (isSegmentMetric(rule.metric)) {
    const name = segments?.find(s => segmentMetricKey(s.key) === rule.metric)?.label ?? rule.label ?? 'Segment';
    return `${name} growth`;
  }
  return METRICS[rule.metric]?.label ?? rule.metric;
}
export const ruleUnit = (rule: ThesisRule) => (isSegmentMetric(rule.metric) ? '%' : METRICS[rule.metric]?.unit ?? '');
export const formatRuleValue = (v: number, unit: string) => (unit === '×' ? `${v.toFixed(1)}×` : `${v.toFixed(1)}%`);
