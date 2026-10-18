import React, { useEffect, useState, useMemo, memo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Brush
} from 'recharts';
import { format, addDays, startOfDay, startOfWeek, startOfMonth, startOfYear, subYears } from 'date-fns';
import { Loader2, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../lib/currency';
import { db, collection, query, where, getDocs } from '../backend';
import type { User } from '../backend';
import { moneyWeightedReturn, simulatePerformance, symbolCurrency } from '../lib/performanceSimulation';

interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  portfolioType?: string;
}

interface Transaction {
  id: string;
  holdingId: string;
  ticker: string;
  type: string;
  shares: number;
  price: number;
  date: string;
}

interface PerformanceChartProps {
  user: User;
  holdings: Holding[];
  activeCurrency?: string;
}

const BENCHMARKS = {
  '^GSPC': 'S&P 500',
  '^RUT': 'Russell 2000',
  '^IXIC': 'Nasdaq',
  '^DJI': 'Dow Jones'
};

const COLORS = {
  portfolio: '#6366f1', // Indigo 500
  '^GSPC': '#10b981', // Emerald 500
  '^RUT': '#f59e0b', // Amber 500
  '^IXIC': '#06b6d4', // Cyan 500
  '^DJI': '#ef4444', // Red 500
};

export const PerformanceChart: React.FC<PerformanceChartProps> = memo(({ user, holdings, activeCurrency = 'USD' }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<string>(() => {
    return localStorage.getItem('portfolio_perf_timerange') || '1Y';
  });
  const [displayMode, setDisplayMode] = useState<'value' | 'percent'>(() => {
    return (localStorage.getItem('portfolio_perf_displaymode') as 'value' | 'percent') || 'percent';
  });
  const [weightingMethod, setWeightingMethod] = useState<'time' | 'money'>(() => {
    return (localStorage.getItem('portfolio_perf_weighting') as 'time' | 'money') || 'time';
  });
  const [visibleBenchmarks, setVisibleBenchmarks] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('portfolio_perf_benchmarks');
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch (e) {
        return new Set(['^GSPC', '^IXIC']);
      }
    }
    return new Set(['^GSPC', '^IXIC']);
  });

  useEffect(() => {
    localStorage.setItem('portfolio_perf_timerange', timeRange);
  }, [timeRange]);

  useEffect(() => {
    localStorage.setItem('portfolio_perf_displaymode', displayMode);
  }, [displayMode]);

  useEffect(() => {
    localStorage.setItem('portfolio_perf_weighting', weightingMethod);
  }, [weightingMethod]);

  useEffect(() => {
    localStorage.setItem('portfolio_perf_benchmarks', JSON.stringify(Array.from(visibleBenchmarks)));
  }, [visibleBenchmarks]);

  const toggleBenchmark = (symbol: string) => {
    setVisibleBenchmarks(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  // Stable dependency key for the heavy simulation
  // We only re-simulate if the specific set of assets or their counts change
  // We don't want to re-simulate just because real-time quotes updated in the dashboard
  const simulationKey = useMemo(() => {
    const assetString = holdings
      .map(h => `${h.id}:${h.ticker}`)
      .sort()
      .join('|');
    return `${user.uid}:${assetString}`;
  }, [holdings, user.uid]);

  useEffect(() => {
    let isMounted = true;
    
    // We only care about holdings currently visible in the tabs
    const currentHoldingIds = new Set(holdings.map(h => h.id));
    const holdingsMap = Object.fromEntries(holdings.map(h => [h.id, h.ticker]));

    const loadData = async () => {
      if (holdings.length === 0) {
        if (isMounted) {
          setData([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Fetch all transactions for this user
        const txQ = query(collection(db, 'transactions'), where('userId', '==', user.uid));
        const txSnapshot = await getDocs(txQ);
        const transactions: Transaction[] = txSnapshot.docs
          .map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              holdingId: data.holdingId,
              ticker: holdingsMap[data.holdingId] || '',
              type: data.type,
              shares: data.shares,
              price: data.price,
              date: data.date
            };
          })
          .filter(tx => currentHoldingIds.has(tx.holdingId) && tx.ticker); // Only for current tab holdings

        if (transactions.length === 0) {
          if (isMounted) {
            setData([]);
            setLoading(false);
          }
          return;
        }

        // Collect all tickers needed
        const tickers = Array.from(new Set(transactions.map(t => t.ticker).filter(Boolean)));
        // Yahoo prices come in each listing's currency; trades on this tab are in the
        // tab's currency. "<CUR>=X" is that currency per US dollar.
        const fxSymbols = Array.from(new Set([...tickers, ...Object.keys(BENCHMARKS)].map(symbolCurrency).concat(activeCurrency)))
          .filter(c => c !== 'USD').map(c => `${c}=X`);
        const allSymbols = Array.from(new Set([...tickers, ...Object.keys(BENCHMARKS), ...fxSymbols]));

        // Find the earliest transaction date
        const sortedDates = transactions
          .map(t => new Date(t.date).getTime())
          .filter(t => !isNaN(t))
          .sort((a, b) => a - b);
        
        if (sortedDates.length === 0) throw new Error('No valid transaction dates found.');
        
        const earliestDate = new Date(sortedDates[0]);
        const fromStr = format(earliestDate, 'yyyy-MM-dd');
        // Fetch up to today + 1 (exclusive) to ensure we get today's data
        const toStr = format(addDays(new Date(), 2), 'yyyy-MM-dd'); 

        const params = new URLSearchParams({
          symbols: allSymbols.join(','),
          from: fromStr,
          to: toStr
        });

        let res: Response | undefined;
        let retries = 5;
        let lastError = null;
        let historicalData: any = null;

        while (retries > 0 && isMounted) {
          try {
            res = await fetch(`/api/historical-bulk?${params.toString()}`);
            
            const text = await res.text();
            const contentType = res.headers.get('content-type');
            const isJson = (contentType && contentType.includes('application/json')) || 
                           (text.trim().startsWith('{') || text.trim().startsWith('['));

            if (res.ok && isJson) {
              try {
                historicalData = JSON.parse(text);
                break;
              } catch (parseErr) {
                console.warn('JSON parsing failed, treating as invalid: ', parseErr);
              }
            }

            // If we got a 200 but it's not JSON, it's likely the "Starting Server" HTML or a fallback
            const textLower = text.toLowerCase();
            const isHtml = textLower.includes('starting server') || 
                           textLower.includes('<doctype') || 
                           textLower.includes('<html');

            if (res.ok && isHtml) {
              console.warn(`Fetch attempt ${6-retries}: Received HTML instead of JSON. Server might be warming up. Waiting...`);
              await new Promise(r => setTimeout(r, 2000 * (6 - retries)));
              retries--;
              continue;
            }

            if (res.status === 503 || res.status === 429) {
              // Service unavailable or rate limited, wait and retry
              console.warn(`Fetch attempt ${6-retries}: Status ${res.status}. Retrying...`);
              await new Promise(r => setTimeout(r, 2000 * (6 - retries)));
              retries--;
              continue;
            }

            // Other errors
            console.error(`API Error (${res.status}):`, text.slice(0, 200));
            throw new Error(`Failed to fetch historical data: ${res.status} ${res.statusText}. Response: ${text.slice(0, 100)}`);
          } catch (fetchErr: any) {
            if (!isMounted) return;
            lastError = fetchErr;
            console.warn(`Fetch attempt failed (${retries - 1} left):`, fetchErr);
            retries--;
            if (retries === 0) {
              console.warn('Failed to fetch historical data, using fallback map instead of crashing:', fetchErr);
              historicalData = {};
              break;
            }
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        
        if (!isMounted) return;
        if (!historicalData) {
          historicalData = {};
        }

        const chartData = simulatePerformance({ transactions, historicalData, holdings, allSymbols, earliestDate, benchmarks: BENCHMARKS, activeCurrency });

        if (isMounted) {
          setData(chartData);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error computing performance:', err);
          setError(err.message || 'Failed to compute performance graph.');
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [simulationKey, activeCurrency]); // Use simulationKey instead of raw holdings

  const visibleData = useMemo(() => {
    if (data.length === 0) return [];
    if (timeRange === 'All') return data;

    const now = new Date();
    let startDate: Date;
    
    switch (timeRange) {
      case 'Today': startDate = startOfDay(now); break;
      case 'This Week': startDate = startOfWeek(now); break;
      case 'This Month': startDate = startOfMonth(now); break;
      case 'YTD': startDate = startOfYear(now); break;
      case '1Y': startDate = subYears(now, 1); break;
      case '5Y': startDate = subYears(now, 5); break;
      default: startDate = new Date(0);
    }
    
    const startTimestamp = startDate.getTime();
    const startIndex = data.findIndex(d => d.timestamp >= startTimestamp);
    if (startIndex > 0) {
      return data.slice(startIndex - 1);
    } else if (startIndex === 0) {
      return data;
    }
    return [];
  }, [data, timeRange]);

  const filteredData = useMemo(() => {
    if (visibleData.length === 0) return [];
    if (displayMode === 'value') return visibleData;

    if (visibleData.length === 0) return [];
    
    const base = visibleData[0];
    const benchmarkNames = Object.values(BENCHMARKS);
    
    if (weightingMethod === 'money') {
      // Cumulative money-weighted return (IRR) from the range start to each point;
      // benchmarks get the same deposits/withdrawals on the same days. Sampled, as
      // each point solves its own IRR.
      const step = Math.max(1, Math.ceil(visibleData.length / 160));
      const rows = [];
      for (let i = step; i < visibleData.length + step - 1; i += step) {
        const j = Math.min(i, visibleData.length - 1);
        const slice = visibleData.slice(0, j + 1);
        const result: any = { ...visibleData[j] };
        result.Portfolio = (moneyWeightedReturn(slice, 'Portfolio')?.cumulative ?? 0) * 100;
        benchmarkNames.forEach(name => { result[name] = (moneyWeightedReturn(slice, `${name}Cash`)?.cumulative ?? 0) * 100; });
        rows.push(result);
        if (j === visibleData.length - 1) break;
      }
      return [{ ...base, Portfolio: 0, ...Object.fromEntries(benchmarkNames.map(n => [n, 0])) }, ...rows];
    }

    // Time-weighted
    return visibleData.map(d => {
      const result = { ...d };
      result.Portfolio = ((d.PortfolioIndex / (base.PortfolioIndex || 100)) - 1) * 100;
      benchmarkNames.forEach(name => {
        const baseIdx = base[`${name}Index`] || 100;
        const currentIdx = d[`${name}Index`] || 100;
        result[name] = ((currentIdx / baseIdx) - 1) * 100;
      });
      return result;
    });
  }, [data, timeRange, displayMode, weightingMethod]);

  const summary = useMemo(() => {
    if (visibleData.length === 0) return null;
    if (visibleData.length === 1) {
      return {
        portfolio: 0,
        benchmarks: Object.entries(BENCHMARKS).reduce((acc, [symbol, name]) => {
          acc[name] = 0;
          return acc;
        }, {} as Record<string, number>)
      };
    }
    const start = visibleData[0];
    const end = visibleData[visibleData.length - 1];
    
    if (weightingMethod === 'money') {
      // Annual IRR for a year or more; shorter ranges show the actual return, as
      // annualising a few weeks or months exaggerates it.
      const pick = (key: string) => {
        const m = moneyWeightedReturn(visibleData, key);
        if (!m) return 0;
        return (m.days >= 365 ? m.annual : m.cumulative) * 100;
      };
      const span = (Date.parse(end.date) - Date.parse(start.date)) / 864e5;
      return {
        portfolio: pick('Portfolio'),
        perYear: span >= 365,
        benchmarks: Object.entries(BENCHMARKS).reduce((acc, [symbol, name]) => {
          acc[name] = pick(`${name}Cash`);
          return acc;
        }, {} as Record<string, number>)
      };
    }

    // Time-weighted return calculation
    const calculateReturn = (currentIdx: number, baseIdx: number) => {
      if (!baseIdx) return 0;
      return ((currentIdx / baseIdx) - 1) * 100;
    };

    return {
      portfolio: calculateReturn(end.PortfolioIndex, start.PortfolioIndex),
      benchmarks: Object.entries(BENCHMARKS).reduce((acc, [symbol, name]) => {
        acc[name] = calculateReturn(end[`${name}Index`], start[`${name}Index`]);
        return acc;
      }, {} as Record<string, number>)
    };
  }, [filteredData, weightingMethod]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 h-64 bg-white rounded-xl border border-zinc-200">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
        <p className="text-zinc-500 font-medium">Computing performance...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-12 h-64 bg-rose-50 rounded-xl border border-rose-100">
        <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
        <p className="text-rose-700 font-medium">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 h-64 bg-white rounded-xl border border-zinc-200">
        <p className="text-zinc-500">No transaction history available.</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      // Only show visible lines in tooltip
      const visiblePayload = payload.filter((entry: any) => {
        if (entry.dataKey === 'Portfolio') return true;
        const benchmarkSymbol = Object.keys(BENCHMARKS).find(
          key => BENCHMARKS[key as keyof typeof BENCHMARKS] === entry.name
        );
        return benchmarkSymbol ? visibleBenchmarks.has(benchmarkSymbol) : true;
      });

      if (visiblePayload.length === 0) return null;

      return (
        <div className="bg-white p-4 border border-zinc-200 shadow-xl rounded-lg text-sm">
          <p className="font-bold text-zinc-900 mb-2 border-b border-zinc-100 pb-2">{label}</p>
          {visiblePayload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between items-center mb-1 gap-6">
              <span style={{ color: entry.color }} className="font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                {entry.name}
              </span>
              <span className="font-bold tabular-nums">
                {displayMode === 'percent' 
                  ? `${entry.value > 0 ? '+' : ''}${entry.value.toFixed(2)}%`
                  : (
                    <div className="flex flex-col items-end">
                      <span>{formatCurrency(entry.value, activeCurrency)}</span>
                      {filteredData.length > 0 && (
                        <span className={`text-[10px] ${
                          (() => {
                            const base = filteredData[0];
                            const current = payload[0].payload;
                            let ret = 0;
                            
                            if (weightingMethod === 'money') {
                              const drawnSinceBase = current.cumulativeWithdrawn - base.cumulativeWithdrawn;
                              const investedSinceBase = current.grossInvested - base.grossInvested;
                              const startVal = entry.name === 'Portfolio' ? base.Portfolio : base[entry.name];
                              const totalBasis = (startVal || 1) + investedSinceBase;
                              const val = entry.name === 'Portfolio' ? current.Portfolio : current[entry.name];
                              ret = (((val + drawnSinceBase) / totalBasis) - 1) * 100;
                            } else {
                              const baseIdx = entry.name === 'Portfolio' ? base.PortfolioIndex : base[`${entry.name}Index`];
                              const currentIdx = entry.name === 'Portfolio' ? current.PortfolioIndex : current[`${entry.name}Index`];
                              ret = ((currentIdx / (baseIdx || 100)) - 1) * 100;
                            }
                            
                            return ret >= 0 ? 'text-emerald-500' : 'text-rose-500';
                          })()
                        }`}>
                          {(() => {
                            const base = filteredData[0];
                            const current = payload[0].payload;
                            let ret = 0;

                            if (weightingMethod === 'money') {
                              const drawnSinceBase = current.cumulativeWithdrawn - base.cumulativeWithdrawn;
                              const investedSinceBase = current.grossInvested - base.grossInvested;
                              const startVal = entry.name === 'Portfolio' ? base.Portfolio : base[entry.name];
                              const totalBasis = (startVal || 1) + investedSinceBase;
                              const val = entry.name === 'Portfolio' ? current.Portfolio : current[entry.name];
                              ret = (((val + drawnSinceBase) / totalBasis) - 1) * 100;
                            } else {
                              const baseIdx = entry.name === 'Portfolio' ? base.PortfolioIndex : base[`${entry.name}Index`];
                              const currentIdx = entry.name === 'Portfolio' ? current.PortfolioIndex : current[`${entry.name}Index`];
                              ret = ((currentIdx / (baseIdx || 100)) - 1) * 100;
                            }

                            return `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`;
                          })()}
                        </span>
                      )}
                    </div>
                  )
                }
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const isDark = document.documentElement.classList.contains('dark');
  const chartStroke = isDark ? '#27272a' : '#E5E7EB';
  const chartText = isDark ? '#a1a1aa' : '#6B7280';
  const chartBrushFill = isDark ? '#18181b' : '#F9FAFB';

  return (
    <div className="w-full h-full min-h-[350px] flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex bg-zinc-100 p-1 rounded-xl">
            <button onClick={() => setDisplayMode('value')} className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${displayMode === 'value' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>Value ({activeCurrency})</button>
            <button onClick={() => setDisplayMode('percent')} className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${displayMode === 'percent' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>% Gain</button>
          </div>

          {displayMode === 'percent' && (
            <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-xl pl-3">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Calculation:</span>
              <div className="flex">
                <button onClick={() => setWeightingMethod('time')} className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${weightingMethod === 'time' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`} title="Time-Weighted Return">TWR</button>
                <button onClick={() => setWeightingMethod('money')} className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${weightingMethod === 'money' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`} title="Money-Weighted Return (IRR): your actual return given when money went in and out; benchmarks get the same deposits and withdrawals">MWR</button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {Object.entries(BENCHMARKS).map(([symbol, name]) => {
              const isVisible = visibleBenchmarks.has(symbol);
              const color = COLORS[symbol as keyof typeof COLORS];
              return (
                <button
                  key={symbol}
                  onClick={() => toggleBenchmark(symbol)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all ${
                    isVisible 
                      ? 'bg-white border-zinc-200 text-zinc-700 shadow-sm' 
                      : 'bg-zinc-50 border-zinc-100 text-zinc-300 grayscale'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isVisible ? color : '#e4e4e7' }}></span>
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex bg-zinc-100 p-1 rounded-xl">
          {['Today', 'This Week', 'This Month', 'YTD', '1Y', '5Y', 'All'].map(range => (
            <button key={range} onClick={() => setTimeRange(range)} className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${timeRange === range ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>{range}</button>
          ))}
        </div>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-zinc-50/50 rounded-xl border border-zinc-100">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">{weightingMethod === 'time' ? 'Time-Weighted' : 'Money-Weighted (IRR)'} Portfolio Return ({timeRange}){weightingMethod === 'money' ? ((summary as any).perYear ? ' · per year' : ' · actual') : ''}</span>
            <div className={`text-xl font-black tabular-nums ${summary.portfolio >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {summary.portfolio >= 0 ? '+' : ''}{summary.portfolio.toFixed(2)}%
            </div>
          </div>
          <div className="w-px h-8 bg-zinc-200 mx-2 hidden sm:block"></div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(BENCHMARKS).map(([symbol, name]) => {
              if (!visibleBenchmarks.has(symbol)) return null;
              const ret = summary.benchmarks[name];
              return (
                <div key={symbol} className="flex flex-col">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">{name}</span>
                  <div className={`text-sm font-bold tabular-nums ${ret >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 w-full min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filteredData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartStroke} />
            <XAxis dataKey="displayDate" tick={{ fontSize: 11, fill: chartText }} tickMargin={10} minTickGap={30} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(value) => displayMode === 'percent' ? `${value.toFixed(0)}%` : formatCurrency(value, activeCurrency, true)} tick={{ fontSize: 11, fill: chartText }} domain={['auto', 'auto']} axisLine={false} tickLine={false} width={displayMode === 'percent' ? 60 : 70} />
            <RechartsTooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} iconType="circle" />
            <Brush 
              dataKey="displayDate" 
              height={30} 
              stroke={chartStroke}
              fill={chartBrushFill}
              travellerWidth={10}
              gap={5}
            >
              <LineChart>
                <Line type="monotone" dataKey="Portfolio" stroke="#6366f1" strokeWidth={1} dot={false} />
              </LineChart>
            </Brush>
            <Line type="monotone" dataKey="Portfolio" stroke={COLORS.portfolio} strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
            {Object.entries(BENCHMARKS).map(([symbol, name]) => (
              visibleBenchmarks.has(symbol) && (
                <Line 
                  key={symbol} 
                  type="monotone" 
                  dataKey={name} 
                  stroke={COLORS[symbol as keyof typeof COLORS]} 
                  strokeWidth={1.5} 
                  dot={false} 
                  strokeOpacity={0.7} 
                  activeDot={{ r: 4, strokeWidth: 0 }} 
                />
              )
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
