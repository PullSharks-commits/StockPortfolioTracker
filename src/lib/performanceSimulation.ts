// Daily portfolio and benchmark values from a tab's trades and price history, with a
// time-weighted index (cash flows split the periods) and money-weighted totals.
// Pure: the Performance chart feeds it, and it can be checked against real data.

import { format, addDays, startOfDay } from 'date-fns';

export interface SimTransaction { id: string; holdingId: string; ticker: string; type: string; shares: number; price: number; date: string }
export interface SimHolding { ticker: string; avg_price: number }

// Currency a Yahoo symbol is priced in (by exchange suffix); trades are in the tab's currency.
const SUFFIX_CURRENCY: Record<string, string> = { AX: 'AUD', NZ: 'NZD', TO: 'CAD', V: 'CAD', NS: 'INR', BO: 'INR', HK: 'HKD', T: 'JPY', SI: 'SGD', DE: 'EUR', PA: 'EUR', AS: 'EUR' };
export function symbolCurrency(sym: string): string {
  if (sym === '^AXJO' || sym === '^AORD') return 'AUD';
  const dot = sym.lastIndexOf('.');
  return (dot > 0 && SUFFIX_CURRENCY[sym.slice(dot + 1).toUpperCase()]) || 'USD';
}

export function simulatePerformance({ transactions, historicalData, holdings, allSymbols, earliestDate, benchmarks, activeCurrency, today = startOfDay(new Date()) }: {
  transactions: SimTransaction[];
  historicalData: Record<string, { date: string; close: number }[]>;
  holdings: SimHolding[];
  allSymbols: string[];
  earliestDate: Date;
  benchmarks: Record<string, string>;
  activeCurrency: string;
  today?: Date;
}) {
  const BENCHMARKS = benchmarks;
  // Convert historical data into a fast map: historical[symbol][date_string_yyyy_mm_dd] = price
  const priceMap: Record<string, Record<string, number>> = {};
  allSymbols.forEach(sym => {
    priceMap[sym] = {};
    const prices = historicalData[sym] || [];
    prices.forEach((p: any) => {
      if (p.date && p.close) {
        const d = p.date.split('T')[0];
        priceMap[sym][d] = p.close;
      }
    });
  });

  // Group transactions by date string (yyyy-mm-dd)
  const txByDate: Record<string, SimTransaction[]> = {};
  transactions.forEach(tx => {
    const d = tx.date.split('T')[0];
    if (!txByDate[d]) txByDate[d] = [];
    txByDate[d].push(tx);
  });

  const chartData = [];
  let currentDate = startOfDay(earliestDate);
  
  const currentHoldings: Record<string, number> = {};
  const currentBenchmarkHoldings: Record<string, number> = {};
  
  let portfolioIndex = 100;
  const benchmarkIndices: Record<string, number> = {};
  Object.keys(BENCHMARKS).forEach(idx => benchmarkIndices[idx] = 100);

  const lastKnownPrices: Record<string, number> = {};
  allSymbols.forEach(sym => {
    const datePrices = priceMap[sym] ? Object.values(priceMap[sym]) : [];
    if (datePrices.length > 0) {
      lastKnownPrices[sym] = datePrices[0];
    } else {
      const tx = transactions.filter(t => t.ticker === sym && t.price > 0).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (tx) {
        lastKnownPrices[sym] = tx.price;
      } else {
        const h = holdings.find(h => h.ticker === sym);
        if (h) {
          lastKnownPrices[sym] = h.avg_price || 0;
        } else {
          lastKnownPrices[sym] = 0;
        }
      }
    }
  });

  // Symbols with no market history (cash, managed funds like Spaceship Voyager):
  // their own trade prices are the price history.
  const hasHistory = new Set(allSymbols.filter(sym => Object.keys(priceMap[sym] || {}).length > 0));
  const fxRate = (cur: string) => (cur === 'USD' ? 1 : lastKnownPrices[`${cur}=X`] || 0);
  // Last known price of `sym`, in the tab's currency.
  const px = (sym: string) => {
    const raw = lastKnownPrices[sym] || 0;
    if (!hasHistory.has(sym)) return raw; // trade prices are already in the tab's currency
    const from = symbolCurrency(sym);
    if (from === activeCurrency) return raw;
    const rFrom = fxRate(from), rTo = fxRate(activeCurrency);
    return rFrom > 0 && rTo > 0 ? (raw / rFrom) * rTo : raw;
  };

  // Between their trades, unpriced assets follow a smooth (geometric) path from one
  // traded price to the next, so a fund's gains don't all land on the days you traded.
  const tradePoints: Record<string, { t: number; p: number }[]> = {};
  transactions.forEach(tx => {
    if (hasHistory.has(tx.ticker) || !(tx.price > 0)) return;
    (tradePoints[tx.ticker] ??= []).push({ t: Date.parse(tx.date.split('T')[0]), p: tx.price });
  });
  Object.values(tradePoints).forEach(pts => pts.sort((a, b) => a.t - b.t));
  const interpolated = (sym: string, t: number): number | undefined => {
    const pts = tradePoints[sym];
    if (!pts?.length) return undefined;
    if (t <= pts[0].t) return pts[0].p;
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        const a = pts[i - 1], b = pts[i];
        const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return a.p * Math.pow(b.p / a.p, f);
      }
    }
    return pts[pts.length - 1].p;
  };

  let prevPortfolioBase = 0;
  const prevBenchmarkBases: Record<string, number> = {};
  let grossInvested = 0;
  let cumulativeWithdrawn = 0;

  while (currentDate <= today) {
    const dateStr = format(currentDate, 'yyyy-MM-dd');

    // Update last known prices for today if available
    allSymbols.forEach(sym => {
      if (priceMap[sym] && priceMap[sym][dateStr] !== undefined) {
        lastKnownPrices[sym] = priceMap[sym][dateStr];
      } else if (!hasHistory.has(sym)) {
        const p = interpolated(sym, Date.parse(dateStr));
        if (p !== undefined) lastKnownPrices[sym] = p;
      }
    });

    // Process intra-day transactions (cash flows) as sub-period boundaries
    const dailyTxs = txByDate[dateStr] || [];
    if (dailyTxs.length > 0) {
      dailyTxs.forEach(tx => {
        const sym = tx.ticker;
        if (!sym) return;
        if (!hasHistory.has(sym) && tx.price > 0) lastKnownPrices[sym] = tx.price;

        // Value of portfolio immediately before this transaction
        let valBeforeTx = 0;
        Object.keys(currentHoldings).forEach(s => {
          valBeforeTx += currentHoldings[s] * px(s);
        });

        // Benchmark values immediately before this transaction
        const benchValBeforeTx: Record<string, number> = {};
        Object.keys(currentBenchmarkHoldings).forEach(idx => {
          benchValBeforeTx[idx] = currentBenchmarkHoldings[idx] * px(idx);
        });

        // Complete sub-period return right before this transaction if base > 0
        if (prevPortfolioBase > 0 && valBeforeTx > 0) {
          const subHpr = (valBeforeTx - prevPortfolioBase) / prevPortfolioBase;
          portfolioIndex *= (1 + subHpr);
        }

        Object.keys(benchmarkIndices).forEach(idx => {
          if ((prevBenchmarkBases[idx] || 0) > 0 && (benchValBeforeTx[idx] || 0) > 0) {
            const benchHpr = (benchValBeforeTx[idx] - prevBenchmarkBases[idx]) / prevBenchmarkBases[idx];
            benchmarkIndices[idx] *= (1 + benchHpr);
          }
        });

        // Cash flow for this transaction. Money-weighted totals use what was actually
        // paid; TWR values the flow at the day's market price, so entries recorded at
        // an average cost (or transfers in) don't show up as a jump in performance.
        // Units received for free (price 0, e.g. a referral bonus) are a gain, not a flow.
        const txValue = tx.price * tx.shares;
        const isBuy = tx.type.toLowerCase() === 'buy';
        const marketValue = tx.price > 0 ? tx.shares * (hasHistory.has(sym) ? px(sym) : tx.price) : 0;
        const flow = isBuy ? marketValue : -marketValue;

        if (isBuy) {
          currentHoldings[sym] = (currentHoldings[sym] || 0) + tx.shares;
          grossInvested += txValue;
        } else {
          currentHoldings[sym] = Math.max(0, (currentHoldings[sym] || 0) - tx.shares);
          cumulativeWithdrawn += txValue;
        }

        // Adjust benchmark holdings by cash flow
        Object.keys(BENCHMARKS).forEach(idx => {
          const benchPrice = px(idx) || 1;
          if (isBuy) {
            currentBenchmarkHoldings[idx] = (currentBenchmarkHoldings[idx] || 0) + (marketValue / benchPrice);
          } else {
            currentBenchmarkHoldings[idx] = Math.max(0, (currentBenchmarkHoldings[idx] || 0) - (marketValue / benchPrice));
          }
        });

        // Establish new beginning base value immediately after the cash flow
        prevPortfolioBase = valBeforeTx + flow;
        Object.keys(BENCHMARKS).forEach(idx => {
          prevBenchmarkBases[idx] = (benchValBeforeTx[idx] || 0) + flow;
        });
      });
    }

    // Calculate end-of-day market values
    let endOfDayPortfolioValue = 0;
    Object.keys(currentHoldings).forEach(sym => {
      endOfDayPortfolioValue += currentHoldings[sym] * px(sym);
    });

    const endOfDayBenchmarkValues: Record<string, number> = {};
    Object.keys(currentBenchmarkHoldings).forEach(idx => {
      endOfDayBenchmarkValues[idx] = currentBenchmarkHoldings[idx] * px(idx);
    });

    // End-of-day sub-period return (from last cash flow / start of day to market close)
    if (prevPortfolioBase > 0 && endOfDayPortfolioValue > 0) {
      const subHpr = (endOfDayPortfolioValue - prevPortfolioBase) / prevPortfolioBase;
      portfolioIndex *= (1 + subHpr);
    }

    Object.keys(benchmarkIndices).forEach(idx => {
      if ((prevBenchmarkBases[idx] || 0) > 0 && (endOfDayBenchmarkValues[idx] || 0) > 0) {
        const benchHpr = (endOfDayBenchmarkValues[idx] - prevBenchmarkBases[idx]) / prevBenchmarkBases[idx];
        benchmarkIndices[idx] *= (1 + benchHpr);
      }
    });

    // Save point to chart data
    if (endOfDayPortfolioValue > 0 || chartData.length > 0) {
      chartData.push({
        date: dateStr,
        displayDate: format(currentDate, 'MMM d, yy'),
        timestamp: currentDate.getTime(),
        Portfolio: Number(endOfDayPortfolioValue.toFixed(2)),
        PortfolioIndex: portfolioIndex,
        grossInvested: grossInvested,
        cumulativeWithdrawn: cumulativeWithdrawn,
        ...Object.keys(BENCHMARKS).reduce((acc, idx) => {
          const name = BENCHMARKS[idx as keyof typeof BENCHMARKS];
          return { 
            ...acc, 
            [name]: Number((endOfDayBenchmarkValues[idx] || 0).toFixed(2)),
            [`${name}Index`]: benchmarkIndices[idx]
          };
        }, {})
      });
    }

    // Set beginning base value for next sub-period
    prevPortfolioBase = endOfDayPortfolioValue;
    Object.keys(endOfDayBenchmarkValues).forEach(idx => {
      prevBenchmarkBases[idx] = endOfDayBenchmarkValues[idx];
    });

    currentDate = addDays(currentDate, 1);
  }


  return chartData;
}
