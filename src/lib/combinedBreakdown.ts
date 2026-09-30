// Per-holding breakdown behind the combined summary cards (Combined Value / Return,
// Realized Return, Day Change, Total Gain 6M / YTD / 1Y), across every portfolio
// tab, in one display currency. The cards are sums of these rows, so a card's detail
// panel always adds up to the card. Pure functions, no I/O.
//
// Conventions (unchanged from the cards' original calculation):
// - Value / cost / day change: live quote (else the average price), previous close
//   (else the live price); cash counts at face value in value and cost.
// - Realized gains replay each holding's buys and sells oldest-first (FIFO).
// - A period's gain = gains realized in the period + unrealized gain on shares
//   bought in the period, over the cost of both.
// - Holdings on the Australia tab bought in another currency carry a 0.7% FX fee.

export interface BreakdownHolding {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  avgPriceCurrency?: string;
  portfolioType?: string;
}
export interface BreakdownTransaction { id: string; type: 'buy' | 'sell'; shares: number; price: number; date: string }
type Quote = { price?: number; previousClose?: number; currency?: string } | number | undefined;

export type PeriodKey = 'sixMonths' | 'ytd' | 'oneYear';
export interface PeriodPart { realized: number; unrealized: number; costBasis: number }

export interface Sale {
  holdingId: string; ticker: string; tab: string;
  date: string; shares: number; proceeds: number; cost: number; gain: number;
}

export interface HoldingBreakdown {
  id: string; ticker: string; tab: string; isCash: boolean;
  shares: number; price: number | null; value: number; cost: number; dayChange: number;
  realized: number;
  periods: Record<PeriodKey, PeriodPart>;
}

export interface CombinedBreakdown {
  rows: HoldingBreakdown[];
  sales: Sale[]; // newest first
  totals: {
    totalValue: number; totalCost: number; totalProfitLoss: number; totalProfitLossPercent: number;
    totalDayChange: number; totalDayChangePercent: number;
  };
  periodStats: {
    allTimeRealized: number;
  } & Record<PeriodKey, PeriodPart & { total: number; percent: number }>;
}

export function periodStarts(now = new Date()): Record<PeriodKey, Date> {
  const sixMonths = new Date(); sixMonths.setMonth(now.getMonth() - 6);
  const oneYear = new Date(); oneYear.setFullYear(now.getFullYear() - 1);
  return { sixMonths, ytd: new Date(now.getFullYear(), 0, 1), oneYear };
}

const emptyPeriods = (): Record<PeriodKey, PeriodPart> => ({
  sixMonths: { realized: 0, unrealized: 0, costBasis: 0 },
  ytd: { realized: 0, unrealized: 0, costBasis: 0 },
  oneYear: { realized: 0, unrealized: 0, costBasis: 0 },
});

export function computeCombinedBreakdown(args: {
  holdings: BreakdownHolding[];
  sortedTransactionsByHolding: Map<string, BreakdownTransaction[]>;
  hasTransactions: boolean; // any transactions at all (periods are skipped without)
  quotes: Record<string, Quote>;
  targetCurrency: string;
  fx: (from: string, to: string) => number;
  now?: Date;
}): CombinedBreakdown {
  const { holdings, sortedTransactionsByHolding, hasTransactions, quotes, targetCurrency, fx } = args;
  const starts = periodStarts(args.now);
  const PERIODS: PeriodKey[] = ['sixMonths', 'ytd', 'oneYear'];
  const rows: HoldingBreakdown[] = [];
  const sales: Sale[] = [];

  for (const h of holdings) {
    const tab = h.portfolioType || 'global';
    const periods = emptyPeriods();

    if (h.ticker === 'CASH') {
      const sourceCurrency = h.avgPriceCurrency || (h.portfolioType === 'australia' ? 'AUD' : 'USD');
      const value = h.shares * (sourceCurrency !== targetCurrency ? fx(sourceCurrency, targetCurrency) : 1);
      rows.push({ id: h.id, ticker: h.ticker, tab, isCash: true, shares: h.shares, price: null, value, cost: value, dayChange: 0, realized: 0, periods });
      continue;
    }

    const quote = quotes[h.ticker] as any;
    const currentPrice = quote?.price != null ? quote.price : (typeof quote === 'number' ? quote : h.avg_price);
    const previousClose = quote?.previousClose != null ? quote.previousClose : currentPrice;
    const sourceCurrency = quote?.currency || (h.portfolioType === 'australia' ? 'AUD' : 'USD');
    const storedCurrency = h.avgPriceCurrency || sourceCurrency;

    let convertedAvgPrice = h.avg_price;
    if (storedCurrency && storedCurrency !== targetCurrency) {
      convertedAvgPrice = h.avg_price * fx(storedCurrency, targetCurrency);
      if (h.portfolioType === 'australia' && storedCurrency !== 'AUD') convertedAvgPrice *= 1.007; // FX fee
    }
    const priceRate = sourceCurrency && sourceCurrency !== targetCurrency ? fx(sourceCurrency, targetCurrency) : 1;
    const currentPriceVal = currentPrice * priceRate;
    const previousCloseVal = previousClose * priceRate;

    const row: HoldingBreakdown = {
      id: h.id, ticker: h.ticker, tab, isCash: false, shares: h.shares, price: currentPriceVal,
      value: currentPriceVal * h.shares, cost: convertedAvgPrice * h.shares,
      dayChange: (currentPriceVal - previousCloseVal) * h.shares, realized: 0, periods,
    };
    rows.push(row);

    // Realized gains and period parts from the transaction history (FIFO).
    const txs = sortedTransactionsByHolding.get(h.id) ?? [];
    if (!hasTransactions || txs.length === 0) continue;
    const periodPrice = (quote?.price != null ? quote.price : h.avg_price) * priceRate;
    let conversionRate = 1;
    if (storedCurrency && storedCurrency !== targetCurrency) {
      conversionRate = fx(storedCurrency, targetCurrency);
      if (h.portfolioType === 'australia' && storedCurrency !== 'AUD') conversionRate *= 1.007;
    }
    const buyPool: { date: Date; shares: number; priceInTarget: number }[] = [];
    for (const tx of txs) {
      const txDate = new Date(tx.date);
      const txPrice = tx.price * conversionRate;
      if (tx.type === 'buy') {
        buyPool.push({ date: txDate, shares: tx.shares, priceInTarget: txPrice });
        continue;
      }
      if (tx.type !== 'sell') continue;
      let toSell = tx.shares, saleCost = 0, saleProceeds = 0, sold = 0;
      while (toSell > 0 && buyPool.length > 0) {
        const lot = buyPool[0];
        const n = Math.min(lot.shares, toSell);
        const cost = n * lot.priceInTarget, proceeds = n * txPrice;
        row.realized += proceeds - cost;
        for (const k of PERIODS) {
          if (txDate >= starts[k]) { periods[k].realized += proceeds - cost; periods[k].costBasis += cost; }
        }
        saleCost += cost; saleProceeds += proceeds; sold += n;
        lot.shares -= n; toSell -= n;
        if (lot.shares <= 0) buyPool.shift();
      }
      if (sold > 0) sales.push({ holdingId: h.id, ticker: h.ticker, tab, date: tx.date, shares: sold, proceeds: saleProceeds, cost: saleCost, gain: saleProceeds - saleCost });
    }
    for (const lot of buyPool) {
      const lotCost = lot.shares * lot.priceInTarget;
      const lotUnrealized = lot.shares * periodPrice - lotCost;
      for (const k of PERIODS) {
        if (lot.date >= starts[k]) { periods[k].unrealized += lotUnrealized; periods[k].costBasis += lotCost; }
      }
    }
  }

  const sum = (f: (r: HoldingBreakdown) => number) => rows.reduce((a, r) => a + f(r), 0);
  const totalValue = sum(r => r.value), totalCost = sum(r => r.cost), totalDayChange = sum(r => r.dayChange);
  const totalProfitLoss = totalValue - totalCost;
  const totalPreviousValue = totalValue - totalDayChange;
  const totals = {
    totalValue, totalCost, totalProfitLoss,
    totalProfitLossPercent: totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0,
    totalDayChange,
    totalDayChangePercent: totalPreviousValue > 0 ? (totalDayChange / totalPreviousValue) * 100 : 0,
  };

  const period = (k: PeriodKey) => {
    const p = { realized: sum(r => r.periods[k].realized), unrealized: sum(r => r.periods[k].unrealized), costBasis: sum(r => r.periods[k].costBasis) };
    const total = p.realized + p.unrealized;
    const percent = p.costBasis > 0 ? (total / p.costBasis) * 100
      : totalCost > 0 ? (total / totalCost) * 100
      : totalValue > 0 ? (total / totalValue) * 100 : 0;
    return { ...p, total, percent };
  };

  return {
    rows,
    sales: sales.sort((a, b) => b.date.localeCompare(a.date)),
    totals,
    periodStats: {
      allTimeRealized: sum(r => r.realized),
      sixMonths: period('sixMonths'), ytd: period('ytd'), oneYear: period('oneYear'),
    },
  };
}
