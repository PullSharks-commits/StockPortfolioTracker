// Historical valuation multiples (P/E, EV/Sales, P/FCF) from SEC fundamentals and
// monthly prices. Pure functions, no I/O.
//
// Point-in-time: at each month-end only figures already filed by then are used, so
// history isn't flattered by numbers nobody knew yet.
// Splits: prices are split-adjusted, but older filings report pre-split share
// counts. A share count filed before a split is scaled by that split's ratio; one
// filed after it is already restated by the company and is left alone.

// filed: latest filing the value came from; firstFiled: when it was first reported.
export interface FundValue { value: number; currency: string | null; filed: string; firstFiled?: string; tag?: string }
export interface FundPeriod {
  key: string;
  fiscalYear: number;
  fiscalQuarter: number | null;
  start: string | null;
  end: string;
  values: Record<string, FundValue | undefined>;
  derived: Record<string, number | null>;
}
export interface MarketData {
  currency: string | null;
  monthly: { date: string; close: number }[];
  splits: { date: string; ratio: number }[];
}

export interface ValuationPoint {
  date: string;
  price: number;
  marketCap: number | null;
  enterpriseValue: number | null;
  // Point-in-time inputs: split-adjusted diluted shares and TTM revenue known at `date`.
  shares: number | null;
  revenue: number | null;
  pe: number | null;
  evSales: number | null;
  pFcf: number | null;
}

export interface MultipleStats { current: number | null; median: number | null; min: number | null; max: number | null; percentile: number | null }

export interface ValuationResult {
  unavailable?: string;
  points: ValuationPoint[];
  stats: { pe: MultipleStats; evSales: MultipleStats; pFcf: MultipleStats };
}

// When a figure became public (first report), for point-in-time lookups.
const knownFrom = (p: FundPeriod, key: string) => p.values[key]?.firstFiled ?? p.values[key]?.filed ?? null;

function splitAdjustedShares(p: FundPeriod, splits: MarketData['splits']): number | null {
  const v = p.values.dilutedShares;
  if (!v) return null;
  let factor = 1;
  for (const s of splits) {
    if (s.date > p.end && s.date > v.filed) factor *= s.ratio;
  }
  return v.value * factor;
}

// Trailing twelve months of a flow item as known at `asOf`: the latest four
// consecutive quarters filed by then, or else the latest filed annual figure.
function ttm(key: string, asOf: string, quarters: FundPeriod[], annual: FundPeriod[], currency: string): number | null {
  const known = quarters.filter(q => q.values[key] && (knownFrom(q, key) ?? '9999') <= asOf && q.values[key]!.currency === currency);
  const lastAnnual = [...annual].reverse().find(a => a.values[key] && (knownFrom(a, key) ?? '9999') <= asOf && a.values[key]!.currency === currency);
  if (known.length >= 4) {
    const last4 = known.slice(-4);
    // Consecutive: each quarter ends ~3 months after the previous one.
    const consecutive = last4.every((q, i) => i === 0 || (Date.parse(q.end) - Date.parse(last4[i - 1].end)) / 86_400_000 < 110);
    const newerThanAnnual = !lastAnnual || last4[3].end > lastAnnual.end;
    if (consecutive && newerThanAnnual) return last4.reduce((s, q) => s + q.values[key]!.value, 0);
  }
  return lastAnnual ? lastAnnual.values[key]!.value : null;
}

function latestInstant(key: string, asOf: string, periods: FundPeriod[], currency: string): number | null {
  const hit = [...periods].reverse().find(p => p.values[key] && (knownFrom(p, key) ?? '9999') <= asOf && p.values[key]!.currency === currency);
  return hit ? hit.values[key]!.value : null;
}

function stats(values: (number | null)[]): MultipleStats {
  const current = values[values.length - 1] ?? null;
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return { current, median: null, min: null, max: null, percentile: null };
  const median = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  const percentile = current != null ? xs.filter(x => x <= current).length / xs.length : null;
  return { current, median, min: xs[0], max: xs[xs.length - 1], percentile };
}

export function computeValuation(annual: FundPeriod[], quarterly: FundPeriod[], market: MarketData, statsYears = 5): ValuationResult {
  const empty = { points: [], stats: { pe: stats([]), evSales: stats([]), pFcf: stats([]) } };
  const statementCurrency = [...annual, ...quarterly].reverse().find(p => p.values.revenue)?.values.revenue?.currency ?? null;
  if (!statementCurrency || !market.currency) return { ...empty, unavailable: 'Not enough data to value this company.' };
  if (statementCurrency !== market.currency) {
    return { ...empty, unavailable: `Financials are reported in ${statementCurrency} but the share trades in ${market.currency}, so multiples would need currency conversion.` };
  }

  // FCF per period, as a value with the operating cash flow's filing date.
  const withFcf = (ps: FundPeriod[]) => ps.map(p => {
    const fcf = p.derived.freeCashFlow;
    return fcf == null || !p.values.operatingCashFlow ? p : { ...p, values: { ...p.values, freeCashFlow: { value: fcf, currency: p.values.operatingCashFlow.currency, filed: p.values.operatingCashFlow.filed, firstFiled: p.values.operatingCashFlow.firstFiled } } };
  });
  const q = withFcf(quarterly), a = withFcf(annual);
  const all = [...a, ...q].sort((x, y) => x.end.localeCompare(y.end));

  const points: ValuationPoint[] = market.monthly.map(({ date, close }) => {
    const sharesPeriod = [...all].reverse().find(p => p.values.dilutedShares && (knownFrom(p, 'dilutedShares') ?? '9999') <= date);
    const shares = sharesPeriod ? splitAdjustedShares(sharesPeriod, market.splits) : null;
    const marketCap = shares ? close * shares : null;
    const cash = latestInstant('cash', date, all, statementCurrency);
    const debtPeriod = [...all].reverse().find(p => p.derived.debt != null && p.values.equity && (knownFrom(p, 'equity') ?? '9999') <= date);
    const enterpriseValue = marketCap != null ? marketCap + (debtPeriod?.derived.debt ?? 0) - (cash ?? 0) : null;
    const revenue = ttm('revenue', date, q, a, statementCurrency);
    const netIncome = ttm('netIncome', date, q, a, statementCurrency);
    const fcf = ttm('freeCashFlow', date, q, a, statementCurrency);
    return {
      date, price: close, marketCap, enterpriseValue, shares, revenue,
      pe: marketCap != null && netIncome && netIncome > 0 ? marketCap / netIncome : null,
      evSales: enterpriseValue != null && revenue && revenue > 0 ? enterpriseValue / revenue : null,
      pFcf: marketCap != null && fcf && fcf > 0 ? marketCap / fcf : null,
    };
  });

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - statsYears);
  const recent = points.filter(p => p.date >= cutoff.toISOString().slice(0, 10));
  return {
    points,
    stats: {
      pe: stats(recent.map(p => p.pe)),
      evSales: stats(recent.map(p => p.evSales)),
      pFcf: stats(recent.map(p => p.pFcf)),
    },
  };
}
