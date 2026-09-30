// Per-holding fundamentals for the whole portfolio in one request: trailing-twelve-
// month figures (for table columns and the "portfolio as one company" view) and
// return attribution - how much of a share's price move came from business growth,
// share count change and the valuation multiple.
//
// Attribution identity, with MC = price x shares and P/S = MC / revenue:
//   price1/price0 = (revenue1/revenue0) x (shares0/shares1) x (PS1/PS0)
// so in logs the three parts add up exactly to the price return. Revenue is used
// rather than earnings so unprofitable companies can be decomposed too. Every input
// is point-in-time (only figures filed by each date), from the valuation module.

import type { Express, Request, Response } from 'express';
import { authEnabled, requireUser } from './server-auth';
import { computeValuation, type FundPeriod, type MarketData, type ValuationPoint } from './src/lib/valuation';
import type { Attribution, HoldingFundamentals } from './src/lib/portfolioFundamentals';

const MAX_TICKERS = 80;
const CACHE_TTL_MS = 3600_000;

export interface Trailing { now: number | null; prev: number | null; end: string | null }

// Adds free cash flow and gross profit (derived, when not reported) as values so the
// trailing sums below can treat every item alike.
function withDerived(periods: FundPeriod[]): FundPeriod[] {
  return periods.map(p => {
    const values = { ...p.values };
    const ocf = p.values.operatingCashFlow, rev = p.values.revenue;
    if (p.derived.freeCashFlow != null && ocf) values.freeCashFlow = { ...ocf, value: p.derived.freeCashFlow };
    if (!values.grossProfit && p.derived.grossProfit != null && rev) values.grossProfit = { ...rev, value: p.derived.grossProfit };
    return { ...p, values };
  });
}

const consecutive = (qs: FundPeriod[]) => qs.every((q, i) => i === 0 || (Date.parse(q.end) - Date.parse(qs[i - 1].end)) / 86_400_000 < 110);

// Latest twelve months and the twelve months before: the last 8 consecutive quarters
// when available (and newer than the last annual report), otherwise the last two years.
export function trailing(key: string, quarterly: FundPeriod[], annual: FundPeriod[], currency: string): Trailing {
  const qs = quarterly.filter(q => q.values[key]?.currency === currency);
  const ys = annual.filter(a => a.values[key]?.currency === currency);
  const lastYear = ys[ys.length - 1];
  const sum = (ps: FundPeriod[]) => ps.reduce((s, p) => s + p.values[key]!.value, 0);
  const last4 = qs.slice(-4);
  if (last4.length === 4 && consecutive(last4) && (!lastYear || last4[3].end > lastYear.end)) {
    const prev4 = qs.slice(-8, -4);
    const prev = prev4.length === 4 && consecutive([...prev4, ...last4]) ? sum(prev4) : null;
    return { now: sum(last4), prev, end: last4[3].end };
  }
  if (!lastYear) return { now: null, prev: null, end: null };
  const prevYear = ys[ys.length - 2];
  return { now: lastYear.values[key]!.value, prev: prevYear ? prevYear.values[key]!.value : null, end: lastYear.end };
}

export function attribution(points: ValuationPoint[], years: number): Attribution | null {
  const to = points[points.length - 1];
  if (!to) return null;
  const target = Date.parse(to.date) - years * 365.25 * 86_400_000;
  // Closest month-end to exactly `years` before, within a month.
  let from: ValuationPoint | null = null;
  for (const p of points) if (!from || Math.abs(Date.parse(p.date) - target) < Math.abs(Date.parse(from.date) - target)) from = p;
  if (!from || Math.abs(Date.parse(from.date) - target) > 31 * 86_400_000) return null;
  const ok = (p: ValuationPoint) => p.price > 0 && p.shares && p.shares > 0 && p.revenue && p.revenue > 0;
  if (!ok(from) || !ok(to)) return null;

  const priceRatio = to.price / from.price;
  const revenueRatio = to.revenue! / from.revenue!;
  const shareRatio = to.shares! / from.shares!;
  const psFrom = (from.price * from.shares!) / from.revenue!, psTo = (to.price * to.shares!) / to.revenue!;
  const multipleRatio = psTo / psFrom;
  const total = Math.log(priceRatio);
  const priceReturn = priceRatio - 1;
  // Split the return in proportion to each driver's log contribution.
  const part = (l: number) => (Math.abs(total) < 1e-9 ? 0 : priceReturn * (l / total));
  return {
    years, from: from.date, to: to.date,
    priceReturn, revenueGrowth: revenueRatio - 1, shareChange: shareRatio - 1, multipleChange: multipleRatio - 1,
    fromRevenue: part(Math.log(revenueRatio)), fromShares: part(-Math.log(shareRatio)), fromMultiple: part(Math.log(multipleRatio)),
    psFrom, psTo,
  };
}

export function summarize(ticker: string, fundamentals: any, market: MarketData | null): HoldingFundamentals {
  if (!fundamentals || fundamentals.source !== 'sec') return { ticker, status: 'none', reason: fundamentals?.reason ?? 'No SEC financials' };
  const annual = withDerived(fundamentals.annual ?? []);
  const quarterly = withDerived(fundamentals.quarterly ?? []);
  const currency = [...annual, ...quarterly].sort((a, b) => a.end.localeCompare(b.end)).reverse().find(p => p.values.revenue)?.values.revenue?.currency ?? null;
  if (!currency) return { ticker, status: 'none', reason: 'No revenue reported' };

  const t = (k: string) => trailing(k, quarterly, annual, currency);
  const revenue = t('revenue'), gross = t('grossProfit'), op = t('operatingIncome'), net = t('netIncome'), fcf = t('freeCashFlow');
  // Margins only when the item covers the same twelve months as revenue.
  const margin = (x: Trailing) => (x.now != null && revenue.now && revenue.now > 0 && x.end === revenue.end ? x.now / revenue.now : null);
  const same = (x: Trailing) => (x.end === revenue.end ? x.now : null);

  // Treasury and holding companies (e.g. a crypto treasury) report tiny revenue next
  // to large investment gains/losses; revenue-based figures would describe nothing.
  const dominated = (x: Trailing) => x.now != null && x.end === revenue.end && revenue.now != null && Math.abs(x.now) > 2 * Math.abs(revenue.now);
  if (revenue.now == null || revenue.now <= 0 || dominated(op) || dominated(net)) {
    return { ticker, status: 'none', currency, asOf: revenue.end, reason: 'Results are driven by investment gains/losses rather than revenue, so revenue-based figures would mislead' };
  }

  // Lenders (revenue net of interest expense): loan originations run through operating
  // cash flow and there is no cost of revenue, so FCF and gross margin mean nothing.
  const latestRevenue = [...quarterly, ...annual].filter(p => p.values.revenue).sort((a, b) => a.end.localeCompare(b.end)).pop()?.values.revenue;
  const lender = latestRevenue?.tag === 'RevenuesNetOfInterestExpense';

  let attr: Attribution[] = [];
  if (market?.monthly?.length) {
    const v = computeValuation(fundamentals.annual ?? [], fundamentals.quarterly ?? [], market);
    if (!v.unavailable) attr = [1, 3].map(y => attribution(v.points, y)).filter((a): a is Attribution => !!a);
  }

  return {
    ticker, status: 'ok', currency, asOf: revenue.end,
    revenue: revenue.now, revenuePrev: revenue.prev,
    revenueGrowth: revenue.now != null && revenue.prev && revenue.prev > 0 ? revenue.now / revenue.prev - 1 : null,
    grossProfit: lender ? null : same(gross), operatingIncome: same(op), netIncome: same(net), freeCashFlow: lender ? null : same(fcf),
    grossMargin: lender ? null : margin(gross), operatingMargin: margin(op), netMargin: margin(net), fcfMargin: lender ? null : margin(fcf),
    attribution: attr,
  };
}

export function registerPortfolioFundamentalsRoutes(
  app: Express,
  loadFundamentals: ((ticker: string) => Promise<any>) | null,
  loadMarketData: (symbol: string) => Promise<MarketData>,
  loadFxToUsd: (currency: string) => Promise<number | null>,
) {
  if (!loadFundamentals || !authEnabled()) return;
  const cache = new Map<string, { at: number; data: HoldingFundamentals }>();

  async function one(ticker: string): Promise<HoldingFundamentals> {
    const hit = cache.get(ticker);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
    const fundamentals = await loadFundamentals!(ticker);
    const market = fundamentals?.source === 'sec' ? await loadMarketData(ticker).catch(() => null) : null;
    const data = summarize(ticker, fundamentals, market);
    if (data.currency) data.fxToUsd = await loadFxToUsd(data.currency).catch(() => null);
    cache.set(ticker, { at: Date.now(), data });
    return data;
  }

  app.post('/api/portfolio-fundamentals', requireUser, async (req: Request, res: Response) => {
    const tickers = [...new Set<string>((Array.isArray(req.body?.tickers) ? req.body.tickers : []).map((t: unknown) => String(t).trim().toUpperCase()))]
      .filter(t => /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(t))
      .slice(0, MAX_TICKERS);
    const results: Record<string, HoldingFundamentals> = {};
    // One at a time: uncached tickers hit the SEC, which allows ~10 requests/second.
    for (const ticker of tickers) {
      try {
        results[ticker] = await one(ticker);
      } catch (err: any) {
        console.error(`[portfolio-fundamentals] ${ticker}:`, err?.message || err);
        results[ticker] = { ticker, status: 'none', reason: 'Could not load' };
      }
    }
    res.json({ results });
  });
}
