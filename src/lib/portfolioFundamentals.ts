// Portfolio-level fundamentals from per-holding data (/api/portfolio-fundamentals).
// Pure functions, no I/O.
//
// "Portfolio as one company": each holding contributes its share of the company -
// position value / market cap - of the company's trailing-twelve-month figures, so
// owning 0.001% of Microsoft adds 0.001% of Microsoft's revenue and profit. Using
// market cap (rather than shares held / shares outstanding) keeps ADRs right.

export interface Attribution {
  years: number; from: string; to: string;
  priceReturn: number; revenueGrowth: number; shareChange: number; multipleChange: number;
  fromRevenue: number; fromShares: number; fromMultiple: number;
  psFrom: number; psTo: number;
}
export interface HoldingFundamentals {
  ticker: string;
  status: 'ok' | 'none';
  reason?: string;
  currency?: string | null;
  fxToUsd?: number | null;
  asOf?: string | null;
  revenue?: number | null; revenuePrev?: number | null; revenueGrowth?: number | null;
  grossProfit?: number | null; operatingIncome?: number | null; netIncome?: number | null; freeCashFlow?: number | null;
  grossMargin?: number | null; operatingMargin?: number | null; netMargin?: number | null; fcfMargin?: number | null;
  attribution?: Attribution[];
}

export interface HoldingInput {
  ticker: string;
  value: number;               // position value, display currency
  marketCap: number | null;    // company market cap, display currency
  fundamentals?: HoldingFundamentals;
  usdToDisplay: number;        // USD -> display currency
}

// Statement currency -> display currency, or null when no rate is known.
const statementFx = (h: HoldingInput) => (h.fundamentals?.fxToUsd ? h.fundamentals.fxToUsd * h.usdToDisplay : null);

export function holdingMultiples(h: HoldingInput) {
  const f = h.fundamentals, fx = statementFx(h);
  if (!f || f.status !== 'ok' || !fx || !h.marketCap) return { ps: null, pe: null, fcfYield: null };
  const rev = f.revenue != null ? f.revenue * fx : null;
  const net = f.netIncome != null ? f.netIncome * fx : null;
  const fcf = f.freeCashFlow != null ? f.freeCashFlow * fx : null;
  return {
    ps: rev && rev > 0 ? h.marketCap / rev : null,
    pe: net && net > 0 ? h.marketCap / net : null,
    fcfYield: fcf != null ? fcf / h.marketCap : null,
  };
}

export interface LookThrough {
  totalValue: number;
  coveredValue: number;
  included: string[];
  excluded: { ticker: string; reason: string }[];
  revenue: number; revenueGrowth: number | null;
  operatingIncome: number | null; netIncome: number; freeCashFlow: number | null;
  grossMargin: number | null; operatingMargin: number | null; netMargin: number | null; fcfMargin: number | null;
  pe: number | null; ps: number | null; earningsYield: number | null; fcfYield: number | null;
}

export function lookThrough(holdings: HoldingInput[]): LookThrough {
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const included: string[] = [];
  const excluded: { ticker: string; reason: string }[] = [];
  let coveredValue = 0, revenue = 0, netIncome = 0;
  // Growth, margins and yields use only holdings that report that item, over the
  // matching revenue/value, so a missing figure doesn't read as zero.
  const acc = { growthNow: 0, growthPrev: 0, gp: 0, gpRev: 0, op: 0, opRev: 0, fcf: 0, fcfRev: 0, fcfValue: 0 };

  for (const h of holdings) {
    const f = h.fundamentals, fx = statementFx(h);
    if (!f || f.status !== 'ok' || f.revenue == null || f.netIncome == null) { excluded.push({ ticker: h.ticker, reason: f?.reason ?? 'No company financials (fund, ETF or non-US listing)' }); continue; }
    if (!h.marketCap) { excluded.push({ ticker: h.ticker, reason: 'Market cap unavailable' }); continue; }
    if (!fx) { excluded.push({ ticker: h.ticker, reason: `No exchange rate for ${f.currency}` }); continue; }
    const own = (h.value / h.marketCap) * fx; // share of the company, in display currency per statement unit
    included.push(h.ticker);
    coveredValue += h.value;
    const rev = f.revenue * own;
    revenue += rev;
    netIncome += f.netIncome * own;
    if (f.revenuePrev && f.revenuePrev > 0) { acc.growthNow += rev; acc.growthPrev += f.revenuePrev * own; }
    if (f.grossProfit != null) { acc.gp += f.grossProfit * own; acc.gpRev += rev; }
    if (f.operatingIncome != null) { acc.op += f.operatingIncome * own; acc.opRev += rev; }
    if (f.freeCashFlow != null) { acc.fcf += f.freeCashFlow * own; acc.fcfRev += rev; acc.fcfValue += h.value; }
  }

  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    totalValue, coveredValue, included, excluded,
    revenue,
    revenueGrowth: acc.growthPrev > 0 ? acc.growthNow / acc.growthPrev - 1 : null,
    operatingIncome: acc.opRev > 0 ? acc.op : null,
    netIncome,
    freeCashFlow: acc.fcfRev > 0 ? acc.fcf : null,
    grossMargin: ratio(acc.gp, acc.gpRev),
    operatingMargin: ratio(acc.op, acc.opRev),
    netMargin: ratio(netIncome, revenue),
    fcfMargin: ratio(acc.fcf, acc.fcfRev),
    pe: netIncome > 0 ? coveredValue / netIncome : null,
    ps: revenue > 0 ? coveredValue / revenue : null,
    earningsYield: coveredValue > 0 ? netIncome / coveredValue : null,
    fcfYield: acc.fcfValue > 0 ? acc.fcf / acc.fcfValue : null,
  };
}

export interface PortfolioAttribution {
  years: number;
  coveredValue: number;
  priceReturn: number; fromRevenue: number; fromShares: number; fromMultiple: number;
  rows: (Attribution & { ticker: string; weight: number })[];
}

// Value-weighted average of each holding's own attribution over the window. This
// describes the current holdings, not the portfolio's actual past (it ignores trades).
export function portfolioAttribution(holdings: HoldingInput[], years: number): PortfolioAttribution | null {
  const rows = holdings.flatMap(h => {
    const a = h.fundamentals?.attribution?.find(x => x.years === years);
    return a && h.value > 0 ? [{ ...a, ticker: h.ticker, weight: h.value }] : [];
  });
  const covered = rows.reduce((s, r) => s + r.weight, 0);
  if (!rows.length || covered <= 0) return null;
  const avg = (k: 'priceReturn' | 'fromRevenue' | 'fromShares' | 'fromMultiple') => rows.reduce((s, r) => s + r[k] * r.weight, 0) / covered;
  return {
    years, coveredValue: covered,
    priceReturn: avg('priceReturn'), fromRevenue: avg('fromRevenue'), fromShares: avg('fromShares'), fromMultiple: avg('fromMultiple'),
    rows: rows.map(r => ({ ...r, weight: r.weight / covered })).sort((a, b) => b.weight - a.weight),
  };
}
