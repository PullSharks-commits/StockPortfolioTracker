// Daily portfolio and benchmark values from a tab's trades and price history, with a
// time-weighted index (cash flows split the periods) and money-weighted totals.
// Pure: the Performance chart feeds it, and it can be checked against real data.

import { format, addDays, startOfDay } from 'date-fns';

// `currency`: what the trade's price is in, when it isn't activeCurrency (the combined
// view mixes tabs); converted at that day's rate. `benchmark`: the index this trade's
// money goes into for the BLEND benchmark (each tab's own market).
export interface SimTransaction { id: string; holdingId: string; ticker: string; type: string; shares: number; price: number; date: string; currency?: string; benchmark?: string }
export interface SimHolding { ticker: string; avg_price: number }

// Currency a Yahoo symbol is priced in (by exchange suffix); trades are in the tab's currency.
const SUFFIX_CURRENCY: Record<string, string> = { AX: 'AUD', NZ: 'NZD', TO: 'CAD', V: 'CAD', NS: 'INR', BO: 'INR', HK: 'HKD', T: 'JPY', SI: 'SGD', DE: 'EUR', PA: 'EUR', AS: 'EUR' };
export function symbolCurrency(sym: string): string {
  if (sym === '^AXJO' || sym === '^AORD') return 'AUD';
  const dot = sym.lastIndexOf('.');
  return (dot > 0 && SUFFIX_CURRENCY[sym.slice(dot + 1).toUpperCase()]) || 'USD';
}

// A benchmarks key: the money each trade moves goes into that trade's own `benchmark`.
export const BLEND = '@blend';

export function simulatePerformance({ transactions: rawTransactions, historicalData, holdings, allSymbols: symbolList, earliestDate, benchmarks, activeCurrency, today = startOfDay(new Date()) }: {
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
  symbolList.forEach(sym => {
    priceMap[sym] = {};
    const prices = historicalData[sym] || [];
    prices.forEach((p: any) => {
      if (p.date && p.close) {
        const d = p.date.split('T')[0];
        priceMap[sym][d] = p.close;
      }
    });
  });

  // "<CUR>=X" (currency per US dollar) on a day, or the nearest earlier/later close.
  const fxDates: Record<string, string[]> = {};
  const fxAt = (cur: string, d: string): number => {
    if (cur === 'USD') return 1;
    const sym = `${cur}=X`, m = priceMap[sym] || {};
    if (m[d]) return m[d];
    const ds = (fxDates[sym] ??= Object.keys(m).sort());
    let lo = 0, hi = ds.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ds[mid] <= d) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    const k = best >= 0 ? ds[best] : ds[0];
    return k ? m[k] : 0;
  };
  // Symbols with no market history (cash, managed funds like Spaceship Voyager):
  // their own trade prices are the price history.
  const priced = new Set(symbolList.filter(sym => Object.keys(priceMap[sym] || {}).length > 0));
  // Trades in another currency: price converted at the trade date. An unpriced asset is
  // kept apart per currency (CASH in USD and in AUD are different things).
  const transactions = rawTransactions.map(tx => {
    if (!tx.currency || tx.currency === activeCurrency) return tx;
    const d = tx.date.split('T')[0];
    const from = fxAt(tx.currency, d), to = fxAt(activeCurrency, d);
    const price = from > 0 && to > 0 ? (tx.price / from) * to : tx.price;
    return { ...tx, price, ticker: priced.has(tx.ticker) ? tx.ticker : `${tx.ticker}@${tx.currency}` };
  });
  const allSymbols = Array.from(new Set([...symbolList, ...transactions.map(tx => tx.ticker)]));
  allSymbols.forEach(sym => { priceMap[sym] ??= {}; });

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
  // Units of each benchmark's index (or indices, for BLEND) held.
  const currentBenchmarkHoldings: Record<string, Record<string, number>> = {};
  // Same benchmarks bought/sold with the cash actually paid/received (for the
  // money-weighted comparison: "the same deposits and withdrawals in the index").
  const cashBenchmarkHoldings: Record<string, Record<string, number>> = {};
  const benchSymbol = (idx: string, tx: SimTransaction) => (idx === BLEND ? tx.benchmark || '^GSPC' : idx);
  const benchValue = (units?: Record<string, number>) => Object.entries(units || {}).reduce((a, [sym, n]) => a + n * px(sym), 0);
  const addUnits = (book: Record<string, Record<string, number>>, idx: string, sym: string, n: number) => {
    const units = (book[idx] ??= {});
    units[sym] = Math.max(0, (units[sym] || 0) + n);
  };
  
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

  const hasHistory = priced;
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
    // Trades carry a date but no time: take a day's buys before its sells, so a same-day
    // round trip never sells shares not yet bought (which would leave the bought share held).
    const dailyTxs = [...(txByDate[dateStr] || [])].sort((a, b) => Number(a.type.toLowerCase() === 'sell') - Number(b.type.toLowerCase() === 'sell'));
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
          benchValBeforeTx[idx] = benchValue(currentBenchmarkHoldings[idx]);
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

        // Adjust benchmark holdings by the cash flow
        Object.keys(BENCHMARKS).forEach(idx => {
          const bsym = benchSymbol(idx, tx);
          const benchPrice = px(bsym) || 1;
          const sign = isBuy ? 1 : -1;
          addUnits(cashBenchmarkHoldings, idx, bsym, sign * (txValue / benchPrice));
          addUnits(currentBenchmarkHoldings, idx, bsym, sign * (marketValue / benchPrice));
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
      endOfDayBenchmarkValues[idx] = benchValue(currentBenchmarkHoldings[idx]);
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
            [`${name}Index`]: benchmarkIndices[idx],
            [`${name}Cash`]: Number(benchValue(cashBenchmarkHoldings[idx]).toFixed(2))
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

// Money-weighted return (IRR) over a run of daily points from simulatePerformance:
// the first point's value counts as money in at the start, each day's net trades
// (grossInvested / cumulativeWithdrawn changes) as flows, the last value as money out.
// Returns the annual rate and the cumulative return it implies over the period.
export function moneyWeightedReturn(points: { date: string; grossInvested: number; cumulativeWithdrawn: number; [k: string]: any }[], valueKey: string) {
  if (points.length < 2) return null;
  const day = 864e5, t0 = Date.parse(points[0].date);
  const flows: { d: number; v: number }[] = [];
  const startValue = Number(points[0][valueKey]) || 0;
  if (startValue > 0) flows.push({ d: 0, v: -startValue });
  for (let i = 1; i < points.length; i++) {
    const net = (points[i].grossInvested - points[i - 1].grossInvested) - (points[i].cumulativeWithdrawn - points[i - 1].cumulativeWithdrawn);
    if (Math.abs(net) > 1e-9) flows.push({ d: (Date.parse(points[i].date) - t0) / day, v: -net });
  }
  const days = (Date.parse(points[points.length - 1].date) - t0) / day;
  flows.push({ d: days, v: Number(points[points.length - 1][valueKey]) || 0 });
  if (days <= 0 || !flows.some(f => f.v < 0) || !flows.some(f => f.v > 0)) return null;
  // Solve for a daily rate (stable for short periods), then scale.
  const npv = (r: number) => flows.reduce((a, f) => a + f.v / Math.pow(1 + r, f.d), 0);
  let lo = -0.2, hi = 0.2;
  let flo = npv(lo), fhi = npv(hi);
  if (!(flo * fhi < 0)) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (fm * flo > 0) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
  }
  const r = (lo + hi) / 2;
  return { annual: Math.pow(1 + r, 365.25) - 1, cumulative: Math.pow(1 + r, days) - 1, days };
}
