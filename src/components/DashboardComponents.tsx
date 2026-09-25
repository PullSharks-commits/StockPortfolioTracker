import React, { memo, useState, useEffect, useRef, useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Briefcase, Zap, Loader2, ChevronUp, ChevronDown, RefreshCw, Activity, ShieldAlert, ShieldCheck, Sliders, Info } from 'lucide-react';
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import ThreeDBarChart from './ThreeDBarChart';
import { CompanyLogo } from './CompanyLogo';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { formatCurrency } from '../lib/currency';
import { calculateGroupFearGreed } from '../lib/fearGreed';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StatCardProps {
  title: string;
  value: string;
  subValue?: string;
  subValueColor?: string;
  icon: React.ReactNode;
  trend?: {
    label: string;
    value: string;
    color: string;
  };
  benchmark?: {
    label: string;
    value: string;
    color: string;
  };
  extra?: React.ReactNode;
}

export const StatCard = memo(({ title, value, subValue, subValueColor, icon, trend, benchmark, extra }: StatCardProps) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between text-zinc-500 mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium uppercase tracking-wider">{title}</span>
        </div>
        {extra}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className={cn("text-3xl lg:text-4xl font-light tracking-tight truncate", subValueColor)}>
          {value}
        </div>
        {subValue && (
          <div className={cn("text-base lg:text-lg font-medium whitespace-nowrap", subValueColor)}>
            {subValue}
          </div>
        )}
      </div>
      {(trend || benchmark) && (
        <div className="mt-3 pt-3 border-t border-zinc-50 flex items-center justify-between">
          {trend && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{trend.label}</span>
              <span className={cn("text-xs font-bold", trend.color)}>{trend.value}</span>
            </div>
          )}
          {benchmark && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{benchmark.label}</span>
              <span className={cn("text-xs font-bold", benchmark.color)}>{benchmark.value}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

StatCard.displayName = 'StatCard';

interface AnimatedCountUpProps {
  value: number;
  currency?: string;
  includeSign?: boolean;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export const AnimatedCountUp = ({ 
  value, 
  currency, 
  includeSign = false, 
  prefix = '', 
  suffix = '', 
  decimals = 2 
}: AnimatedCountUpProps) => {
  const safeValue = isNaN(value) || typeof value !== 'number' ? 0 : value;
  const count = useMotionValue(0);
  const formatted = useTransform(count, (latest: number) => {
    if (currency) {
      return formatCurrency(latest, currency, includeSign);
    }
    const isNegative = latest < 0;
    const sign = isNegative ? '-' : (includeSign && latest > 0 ? '+' : '');
    const absFormatted = Math.abs(latest).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return `${sign}${prefix}${absFormatted}${suffix}`;
  });

  useEffect(() => {
    const controls = animate(count, safeValue, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1], // beautiful smooth expo easeOut
    });
    return () => controls.stop();
  }, [safeValue, count]);

  return <motion.span>{formatted}</motion.span>;
};

export const PortfolioSummary = memo(({
  totalValue,
  totalProfitLoss,
  totalProfitLossPercent,
  dayChange,
  dayChangePercent,
  totalCost,
  benchmarkTicker,
  benchmarkDayChangePercent,
  benchmarkYtdReturn,
  onBenchmarkChange,
  onSyncHistory,
  isSyncing,
  activeCurrency,
  riskProfile,
  targetReturn,
  fearGreed,
  periodStats,
  holdings = [],
  metadata = {}
}: {
  totalValue: number;
  totalProfitLoss: number;
  totalProfitLossPercent: number;
  dayChange: number;
  dayChangePercent: number;
  totalCost: number;
  benchmarkTicker: string;
  benchmarkDayChangePercent: number;
  benchmarkYtdReturn?: number;
  onBenchmarkChange: (ticker: string) => void;
  onSyncHistory?: () => void;
  isSyncing?: boolean;
  activeCurrency: string;
  riskProfile?: string;
  targetReturn?: number;
  fearGreed?: {
    score: number;
    rating: string;
    details: any[];
  };
  periodStats?: {
    sixMonths: { realized: number; unrealized: number };
    ytd: { realized: number; unrealized: number };
    oneYear: { realized: number; unrealized: number };
  };
  holdings?: any[];
  metadata?: Record<string, { sector: string; industry: string }>;
}) => {
  const [showFearDetails, setShowFearDetails] = useState(false);
  const [fearViewTab, setFearViewTab] = useState<'groups' | 'assets'>('groups');
  const isProfit = totalProfitLossPercent >= 0;
  const isDayProfit = dayChangePercent >= 0;

  // Group Fear & Greed calculation for sectors
  const sectorGroupFearGreed = useMemo(() => {
    if (!fearGreed || !fearGreed.details || !holdings || holdings.length === 0) return [];
    const sectors: Record<string, any[]> = {};
    holdings.forEach((h: any) => {
      if (h.ticker === 'CASH') return;
      const sec = metadata?.[h.ticker]?.sector || 'Other/Unclassified';
      if (!sectors[sec]) sectors[sec] = [];
      sectors[sec].push(h);
    });
    return Object.entries(sectors).map(([secName, secHoldings]) => {
      const fg = calculateGroupFearGreed(secHoldings, fearGreed);
      return {
        sector: secName,
        fg,
        count: secHoldings.length
      };
    }).filter(item => item.fg !== null).sort((a, b) => (b.fg?.score || 0) - (a.fg?.score || 0));
  }, [holdings, metadata, fearGreed]);

  // Stress Test State
  const [showStressTest, setShowStressTest] = useState(false);
  const [crashPercent, setCrashPercent] = useState(10); // Default 10%

  // Calculate cash vs equities
  const cashHoldings = (holdings || []).filter((h: any) => h.ticker === 'CASH');
  const equityHoldings = (holdings || []).filter((h: any) => h.ticker !== 'CASH');

  const cashValue = cashHoldings.reduce((sum: number, h: any) => sum + (h.currentValue || 0), 0);
  const equityValue = equityHoldings.reduce((sum: number, h: any) => sum + (h.currentValue || 0), 0);

  // A safe computed total value that matches the sum of cash & equity (or totalValue fallback if no holdings)
  const safeTotalValue = (holdings || []).length > 0 ? (cashValue + equityValue) : totalValue;
  const effectiveEquityValue = (holdings || []).length > 0 ? equityValue : totalValue;

  const projectedLoss = effectiveEquityValue * (crashPercent / 100);
  const projectedValue = safeTotalValue - projectedLoss;
  const actualPortfolioCrashPercent = safeTotalValue > 0 ? (projectedLoss / safeTotalValue) * 100 : 0;
  const cashCushionPercent = safeTotalValue > 0 ? (cashValue / safeTotalValue) * 100 : 0;

  // Top Gainer & Top Loser calculation for the day (Relative to Portfolio Weightage)
  const { topGainer, topLoser } = useMemo(() => {
    if (!holdings || holdings.length === 0) return { topGainer: null, topLoser: null };

    const validHoldings = (holdings || []).filter((h: any) =>
      h &&
      h.ticker !== 'CASH' &&
      typeof h.dayChangePercent === 'number' &&
      !isNaN(h.dayChangePercent)
    );

    if (validHoldings.length === 0) return { topGainer: null, topLoser: null };

    // Calculate weight and weighted portfolio return impact for each holding
    const weightedHoldings = validHoldings.map((h: any) => {
      const val = typeof h.currentValue === 'number' ? h.currentValue : (h.shares * (h.currentPrice || h.avg_price || 0));
      const weight = safeTotalValue > 0 ? (val / safeTotalValue) : (1 / validHoldings.length);
      const weightPercent = weight * 100;
      // Portfolio impact percentage = contribution of this holding to total portfolio return
      const portfolioImpactPercent = safeTotalValue > 0 && typeof h.dayChange === 'number'
        ? (h.dayChange / safeTotalValue) * 100
        : (weight * h.dayChangePercent);

      return {
        ...h,
        weightPercent,
        portfolioImpactPercent,
      };
    });

    if (weightedHoldings.length === 1) {
      const single = weightedHoldings[0];
      if (single.dayChangePercent >= 0) {
        return { topGainer: single, topLoser: null };
      } else {
        return { topGainer: null, topLoser: single };
      }
    }

    // Gainers: positive portfolio impact / day change, sorted descending by weighted portfolio impact
    const gainers = weightedHoldings
      .filter((h: any) => h.portfolioImpactPercent > 0 || (h.portfolioImpactPercent === 0 && h.dayChangePercent > 0))
      .sort((a: any, b: any) => b.portfolioImpactPercent - a.portfolioImpactPercent);

    // Losers: negative portfolio impact / day change, sorted ascending by weighted portfolio impact (most negative first)
    const losers = weightedHoldings
      .filter((h: any) => h.portfolioImpactPercent < 0 || (h.portfolioImpactPercent === 0 && h.dayChangePercent < 0))
      .sort((a: any, b: any) => a.portfolioImpactPercent - b.portfolioImpactPercent);

    const gainer = gainers.length > 0 ? gainers[0] : null;
    const loser = losers.length > 0 ? losers[0] : null;

    return { topGainer: gainer, topLoser: loser };
  }, [holdings, safeTotalValue]);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-center gap-1.5 text-zinc-500">
              <Briefcase size={14} />
              <span className="text-[10px] font-bold uppercase tracking-widest">Total Portfolio Value</span>
            </div>
            {fearGreed && (
              <div className="relative group/fear">
                <button 
                  onMouseEnter={() => setShowFearDetails(true)}
                  onMouseLeave={() => setShowFearDetails(false)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter border transition-all hover:shadow-sm",
                    fearGreed.score <= 25 ? "text-rose-600 bg-rose-50 border-rose-100" :
                    fearGreed.score <= 45 ? "text-orange-600 bg-orange-50 border-orange-100" :
                    fearGreed.score <= 55 ? "text-zinc-600 bg-zinc-50 border-zinc-100" :
                    fearGreed.score <= 75 ? "text-emerald-600 bg-emerald-50 border-emerald-100" :
                    "text-blue-600 bg-blue-50 border-blue-100"
                  )}
                >
                  <Activity size={10} />
                  {fearGreed.rating} ({fearGreed.score})
                </button>
                
                {showFearDetails && (
                  <div className="absolute top-full left-0 mt-3 z-[100] w-80 bg-white rounded-2xl shadow-2xl border border-zinc-100 p-4 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between mb-3 border-b border-zinc-100 pb-2.5">
                      <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sentiment Drivers</div>
                      <div className="flex items-center gap-1 bg-zinc-100 p-0.5 rounded-lg border border-zinc-200">
                        <button
                          onClick={() => setFearViewTab('groups')}
                          className={cn(
                            "px-2 py-0.5 text-[9px] font-bold rounded transition-all uppercase",
                            fearViewTab === 'groups' ? "bg-white text-zinc-900 shadow-2xs" : "text-zinc-500 hover:text-zinc-800"
                          )}
                        >
                          Groups
                        </button>
                        <button
                          onClick={() => setFearViewTab('assets')}
                          className={cn(
                            "px-2 py-0.5 text-[9px] font-bold rounded transition-all uppercase",
                            fearViewTab === 'assets' ? "bg-white text-zinc-900 shadow-2xs" : "text-zinc-500 hover:text-zinc-800"
                          )}
                        >
                          Assets
                        </button>
                      </div>
                    </div>

                    {fearViewTab === 'groups' ? (
                      <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                        {sectorGroupFearGreed.length > 0 ? (
                          sectorGroupFearGreed.map(({ sector, fg, count }) => (
                            <div key={sector} className="flex items-center justify-between p-2 rounded-xl bg-zinc-50 border border-zinc-100 hover:bg-zinc-100/50 transition-colors">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-xs font-bold text-zinc-900 truncate max-w-[150px]">{sector}</span>
                                <span className="text-[9px] text-zinc-400 font-medium">{count} holdings • Weighted F&G</span>
                              </div>
                              {fg && (
                                <div className={cn(
                                  "px-2 py-1 rounded-lg text-[10px] font-extrabold uppercase flex items-center gap-1 border shadow-2xs",
                                  fg.badgeBgClass,
                                  fg.colorClass,
                                  fg.borderClass
                                )}>
                                  <Activity size={9} />
                                  {fg.score} ({fg.rating})
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-6 text-xs text-zinc-400">No group data available</div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                        {fearGreed.details.map((d) => (
                          <div key={d.symbol} className="flex items-center justify-between">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-bold text-zinc-900">{d.symbol}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-medium text-zinc-400 uppercase">RSI {Math.round(d.rsi)}</span>
                                <div className="w-1 h-1 rounded-full bg-zinc-200" />
                                <span className="text-[9px] font-medium text-zinc-400 uppercase">Mom {d.momentum > 0 ? '+' : ''}{d.momentum.toFixed(1)}%</span>
                              </div>
                            </div>
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                              d.score > 55 ? "bg-emerald-50 text-emerald-600" : d.score < 45 ? "bg-rose-50 text-rose-600" : "bg-zinc-50 text-zinc-600"
                            )}>
                              {Math.round(d.score)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between">
                      <div className="flex-1 text-[9px] text-zinc-400 font-medium leading-relaxed pr-4">
                        Weighted index combining 14-day RSI & 30-day price momentum across holdings and groups.
                      </div>
                      <div className="flex -space-x-2 shrink-0">
                         {fearGreed.details.slice(0, 3).map(d => (
                           <div key={d.symbol} className="w-5 h-5 rounded-full border-2 border-white bg-zinc-100 flex items-center justify-center text-[7px] font-black text-zinc-400">
                             {d.symbol.slice(0, 1)}
                           </div>
                         ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 flex items-end gap-3">
            <AnimatedCountUp value={totalValue} currency={activeCurrency} />
            <div className="text-xs font-medium text-zinc-500 mb-1.5 flex items-center gap-1 border-l pl-3 border-zinc-200">
              <span className="uppercase tracking-wide text-[9px]">Cost:</span> {formatCurrency(totalCost, activeCurrency)}
            </div>
          </div>
           {(riskProfile || targetReturn || onSyncHistory) && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {riskProfile && (
                <div className="px-2 py-0.5 bg-zinc-100 rounded text-[9px] font-bold text-zinc-600 uppercase tracking-widest border border-zinc-200">
                  Risk: {riskProfile}
                </div>
              )}
              {targetReturn && (
                <div className="px-2 py-0.5 bg-indigo-50 rounded text-[9px] font-bold text-indigo-600 uppercase tracking-widest border border-indigo-100">
                  Target: {targetReturn}%
                </div>
              )}
              {onSyncHistory && (
                <button
                  onClick={onSyncHistory}
                  disabled={isSyncing}
                  className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded transition-all bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1 border border-indigo-100"
                  title="Fetch and store 5-year historical price data for all portfolio holdings"
                >
                  {isSyncing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  {isSyncing ? 'Syncing...' : 'Sync 5Y History'}
                </button>
              )}
              <button
                onClick={() => setShowStressTest(!showStressTest)}
                className={cn(
                  "px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded transition-all flex items-center gap-1.5 border leading-none h-[18px]",
                  showStressTest 
                    ? "bg-rose-50 text-rose-600 border-rose-200 shadow-sm" 
                    : "bg-zinc-50 text-zinc-650 hover:bg-zinc-100 border-zinc-200 hover:text-zinc-900"
                )}
                title="Simulate market correction scenarios on current holdings and check defense strength"
              >
                <ShieldAlert size={10} />
                {showStressTest ? "Close Stress Test" : "Stress Test"}
              </button>
            </div>
          )}

          {(topGainer || topLoser) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-zinc-100 max-w-lg">
              {topGainer ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50/90 border border-emerald-200/70 text-emerald-950 shadow-2xs">
                  <TrendingUp size={14} className="text-emerald-600 shrink-0" />
                  <div className="flex items-center gap-2 min-w-0">
                    <CompanyLogo ticker={topGainer.ticker} size="sm" />
                    <div className="flex flex-col min-w-0 leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-700 shrink-0">Top Gainer</span>
                        <span className="text-xs font-bold text-zinc-900 truncate">{topGainer.ticker}</span>
                        {topGainer.weightPercent !== undefined && (
                          <span className="text-[9px] font-medium text-emerald-700/90 bg-emerald-100/70 px-1 py-0.5 rounded leading-none shrink-0" title="Portfolio Weight">
                            {topGainer.weightPercent.toFixed(1)}% wt
                          </span>
                        )}
                      </div>
                      <div className="flex items-center flex-wrap gap-x-1 gap-y-0.5 text-[11px] font-bold text-emerald-600 font-mono">
                        <span>+{topGainer.dayChangePercent.toFixed(2)}%</span>
                        {topGainer.dayChange !== undefined && topGainer.dayChange !== 0 && (
                          <span className="text-[10px] font-medium text-emerald-700/80">
                            ({formatCurrency(topGainer.dayChange, activeCurrency, true)})
                          </span>
                        )}
                        {topGainer.portfolioImpactPercent !== undefined && (
                          <span className="text-[9px] font-semibold text-emerald-800" title="Portfolio Return Contribution">
                            • +{topGainer.portfolioImpactPercent.toFixed(2)}% impact
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-50 border border-zinc-200/50 text-zinc-400 text-xs italic">
                  No Top Gainer
                </div>
              )}

              {topLoser ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-50/90 border border-rose-200/70 text-rose-950 shadow-2xs">
                  <TrendingDown size={14} className="text-rose-600 shrink-0" />
                  <div className="flex items-center gap-2 min-w-0">
                    <CompanyLogo ticker={topLoser.ticker} size="sm" />
                    <div className="flex flex-col min-w-0 leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-extrabold uppercase tracking-wider text-rose-700 shrink-0">Top Loser</span>
                        <span className="text-xs font-bold text-zinc-900 truncate">{topLoser.ticker}</span>
                        {topLoser.weightPercent !== undefined && (
                          <span className="text-[9px] font-medium text-rose-700/90 bg-rose-100/70 px-1 py-0.5 rounded leading-none shrink-0" title="Portfolio Weight">
                            {topLoser.weightPercent.toFixed(1)}% wt
                          </span>
                        )}
                      </div>
                      <div className={cn("flex items-center flex-wrap gap-x-1 gap-y-0.5 text-[11px] font-bold font-mono", topLoser.dayChangePercent < 0 ? "text-rose-600" : "text-emerald-600")}>
                        <span>{topLoser.dayChangePercent >= 0 ? '+' : ''}{topLoser.dayChangePercent.toFixed(2)}%</span>
                        {topLoser.dayChange !== undefined && topLoser.dayChange !== 0 && (
                          <span className="text-[10px] font-medium text-rose-700/80">
                            ({formatCurrency(topLoser.dayChange, activeCurrency, true)})
                          </span>
                        )}
                        {topLoser.portfolioImpactPercent !== undefined && (
                          <span className="text-[9px] font-semibold text-rose-800" title="Portfolio Return Contribution">
                            • {topLoser.portfolioImpactPercent >= 0 ? '+' : ''}{topLoser.portfolioImpactPercent.toFixed(2)}% impact
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-50 border border-zinc-200/50 text-zinc-400 text-xs italic">
                  No Top Loser
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-row flex-wrap md:flex-nowrap items-center gap-4 md:gap-6 w-full md:w-auto">
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Total Return
            </div>
            <div className={cn("text-lg md:text-xl font-semibold flex items-center gap-1", isProfit ? "text-emerald-600" : "text-rose-600")}>
              <AnimatedCountUp value={totalProfitLoss} currency={activeCurrency} includeSign={true} />
            </div>
            <div className={cn("text-[10px] font-medium flex items-center gap-1", isProfit ? "text-emerald-600" : "text-rose-600")}>
              {isProfit ? <TrendingUp size={12} /> : <TrendingUp size={12} className="rotate-180" />}
              <AnimatedCountUp value={Math.abs(totalProfitLossPercent)} suffix="% All Time" />
            </div>
          </div>

          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Day Change
            </div>
            <div className={cn("text-lg md:text-xl font-semibold flex items-center gap-1", isDayProfit ? "text-emerald-600" : "text-rose-600")}>
              <AnimatedCountUp value={dayChange} currency={activeCurrency} includeSign={true} />
            </div>
            <div className={cn("text-[10px] font-medium flex items-center gap-1", isDayProfit ? "text-emerald-600" : "text-rose-600")}>
              {isDayProfit ? <TrendingUp size={12} /> : <TrendingUp size={12} className="rotate-180" />}
              <AnimatedCountUp value={Math.abs(dayChangePercent)} suffix="% Today" />
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Stress Test Simulation Panel */}
      <AnimatePresence>
        {showStressTest && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="border-t border-rose-100 bg-rose-50/15 overflow-hidden"
          >
            <div className="p-4 md:p-5 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h3 className="text-xs font-black text-rose-700 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-rose-600 animate-pulse" />
                    Portfolio Crash Stress Tester
                  </h3>
                  <p className="text-[10px] text-zinc-500">
                    Simulate how systemic market downturns affect your current portfolio. Non-equity CASH assets act as stable safety shields.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-rose-600 bg-rose-100/60 border border-rose-200/50 px-2 py-0.5 rounded uppercase tracking-wider">
                    Tab: {activeCurrency} Active
                  </span>
                </div>
              </div>

              {safeTotalValue <= 0 ? (
                <div className="py-4 text-center rounded-xl border border-dashed border-rose-200 bg-rose-50/30">
                  <p className="text-xs font-bold text-rose-700">No Portfolio Value Found</p>
                  <p className="text-[10px] text-zinc-500 mt-1">Add stock or cash holdings transactions to this tab first to simulate crash scenarios.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Controls Column */}
                  <div className="lg:col-span-5 space-y-4 bg-white border border-rose-100/80 rounded-2xl p-4 shadow-sm">
                    <div>
                      <div className="flex justify-between items-center mb-1 bg-rose-50/40 p-2 rounded-lg">
                        <span className="text-xs font-bold text-zinc-800 uppercase tracking-wider flex items-center gap-1">
                          <Sliders size={12} className="text-rose-600" />
                          Simulate stock crashed by:
                        </span>
                        <span className="text-sm font-black text-rose-600 font-mono">
                          -{crashPercent}%
                        </span>
                      </div>
                      <input
                        id="stress-test-slider"
                        type="range"
                        min="0"
                        max="80"
                        step="1"
                        value={crashPercent}
                        onChange={(e) => setCrashPercent(Number(e.target.value))}
                        className="w-full mt-3 h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-rose-600 focus:outline-none"
                      />
                      <div className="flex justify-between text-[9px] font-extrabold text-zinc-400 mt-1.5 uppercase font-mono">
                        <span>0% (Steady)</span>
                        <span>25% (Correction)</span>
                        <span>50% (Crash)</span>
                        <span>80% (Extreme)</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-zinc-100">
                      <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">Preset Scenarios</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { percent: 10, label: 'Correction (-10%)', desc: 'Standard pull-back' },
                          { percent: 20, label: 'Bear Market (-20%)', desc: 'Sustained stock decline' },
                          { percent: 35, label: 'Gravely Deep (-35%)', desc: 'Economic recession scale' },
                          { percent: 50, label: 'Systemic GFC (-50%)', desc: 'Great Financial Crisis level' },
                        ].map((scenario) => (
                          <button
                            key={scenario.percent}
                            style={{ contentVisibility: 'auto' }}
                            onClick={() => setCrashPercent(scenario.percent)}
                            className={cn(
                              "text-left p-2 rounded-xl border text-xs transition-all flex flex-col justify-between hover:shadow-xs",
                              crashPercent === scenario.percent
                                ? "border-rose-300 bg-rose-50/50 text-rose-700 font-bold ring-1 ring-rose-200"
                                : "border-zinc-200 bg-zinc-50/50 hover:bg-zinc-100/60 text-zinc-700"
                            )}
                          >
                            <span className="font-bold text-[10px] uppercase block tracking-tight">{scenario.label}</span>
                            <span className="text-[8px] font-medium text-zinc-400 block mt-0.5">{scenario.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Impact Column */}
                  <div className="lg:col-span-7 space-y-4 flex flex-col justify-between">
                    {/* Visual bar container */}
                    <div className="bg-white border border-rose-150 rounded-2xl p-4 shadow-sm space-y-4 font-sans">
                      <div>
                        <div className="flex justify-between items-center text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-2">
                          <span>Portfolio Allocation Under Stress</span>
                          <span className="text-zinc-650 font-bold">
                            {(holdings || []).length > 0 ? `${cashHoldings.length} Cash | ${equityHoldings.length} Equity Items` : 'Simulated Equity'}
                          </span>
                        </div>
                        
                        <div className="h-3 w-full rounded-full bg-zinc-100 overflow-hidden flex mb-3 border border-zinc-200">
                          {cashCushionPercent > 0 && (
                            <div 
                              className="bg-emerald-500 h-full transition-all duration-300"
                              style={{ width: `${cashCushionPercent}%` }}
                              title={`Safe Cash Cushion: ${cashCushionPercent.toFixed(1)}%`}
                            />
                          )}
                          <div 
                            className="bg-indigo-500 h-full transition-all duration-300"
                            style={{ width: `${(100 - cashCushionPercent) * (1 - crashPercent / 100)}%` }}
                            title={`Remaining Equities: ${((100 - cashCushionPercent) * (1 - crashPercent / 100)).toFixed(1)}%`}
                          />
                          {crashPercent > 0 && (
                            <div 
                              className="bg-rose-500 h-full transition-all duration-300"
                              style={{ width: `${(100 - cashCushionPercent) * (crashPercent / 100)}%` }}
                              title={`Projected Simulated Loss: ${((100 - cashCushionPercent) * (crashPercent / 100)).toFixed(1)}%`}
                            />
                          )}
                        </div>

                        <div className="flex flex-wrap gap-4 text-[9px] font-extrabold uppercase font-mono text-zinc-500">
                          {cashValue > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded bg-emerald-500 block" />
                              <span>Safe Cash: {cashCushionPercent.toFixed(1)}%</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded bg-indigo-500 block" />
                            <span>Equities after stress: {((100 - cashCushionPercent) * (1 - crashPercent / 100)).toFixed(1)}%</span>
                          </div>
                          {crashPercent > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded bg-rose-500 block" />
                              <span>Projected Drop: {((100 - cashCushionPercent) * (crashPercent / 100)).toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Numeric breakdown grids */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-zinc-100">
                        <div className="space-y-1 bg-zinc-50/60 p-3 rounded-xl border border-zinc-100">
                          <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block font-mono">Current Status</span>
                          <div className="text-sm font-semibold text-zinc-800 font-mono">
                            {formatCurrency(safeTotalValue, activeCurrency)}
                          </div>
                          <div className="text-[8px] text-zinc-500 font-medium leading-normal">
                            Equities: {formatCurrency(effectiveEquityValue, activeCurrency)} <br/>
                            Cash cushion: {formatCurrency(cashValue, activeCurrency)}
                          </div>
                        </div>

                        <div className="space-y-1 bg-rose-50/30 p-3 rounded-xl border border-rose-100">
                          <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest block font-mono">Stress Simulated Status</span>
                          <div className="text-sm font-black text-rose-700 font-mono">
                            {formatCurrency(projectedValue, activeCurrency)}
                          </div>
                          <div className="text-[8px] text-rose-600 font-semibold leading-normal">
                            Simulated Loss: -{formatCurrency(projectedLoss, activeCurrency)} <br/>
                            Overall Drop: <span className="underline">-{(actualPortfolioCrashPercent).toFixed(1)}%</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Advice Card */}
                    <div className="bg-gradient-to-r from-rose-50/50 to-amber-50/30 border border-rose-100 rounded-2xl p-4 flex gap-3 items-start shadow-inner">
                      <div className="mt-0.5 text-rose-600">
                        {cashCushionPercent >= 30 ? (
                          <ShieldCheck size={18} className="text-emerald-500" />
                        ) : (
                          <Info size={18} className="text-rose-600" />
                        )}
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-[10px] font-black uppercase text-rose-800 tracking-wider">
                          Portfolio Defense analysis
                        </h4>
                        <p className="text-[10px] text-zinc-650 leading-normal font-semibold">
                          {cashCushionPercent >= 30 ? (
                            `Excellent Defense Position. You currently hold a fortress-like cash cushion of ${cashCushionPercent.toFixed(1)}%. In a -${crashPercent}% equity crisis, your overall portfolio decline is cushioned down to only -${actualPortfolioCrashPercent.toFixed(1)}%, leaving substantial dry powder to go bargain hunting!`
                          ) : cashCushionPercent >= 10 ? (
                            `Reasonable Defense Position. With ${cashCushionPercent.toFixed(1)}% cash reserves, a -${crashPercent}% market crash will experience an effective -${actualPortfolioCrashPercent.toFixed(1)}% overall value drop. Your dry powder offers moderate shield protection.`
                          ) : (
                            `High Volatility Risk. You hold only ${cashCushionPercent.toFixed(1)}% cash cushion, exposing your assets directly to downturns (${actualPortfolioCrashPercent.toFixed(1)}% estimated total decline). Consider taking partial profits or banking CASH to form defensive reserves if you anticipate a bearish phase.`
                          )}
                        </p>
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Realized & Unrealized P&L Breakdown Panel */}
      <div className="border-t border-zinc-200 bg-zinc-50/50 p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              Period Performance (Realized & Unrealized)
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">FIFO lot-based profit/loss tracking calculated from transactions in this tab</p>
          </div>
          <div className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border border-indigo-100 self-start md:self-auto">
            Portfolio Tab Breakdown
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Last 6 Months', data: periodStats?.sixMonths },
            { label: 'Year to Date (YTD)', data: periodStats?.ytd },
            { label: 'Last 1 Year', data: periodStats?.oneYear }
          ].map(({ label, data }) => {
            const realizedVal = data?.realized ?? 0;
            const unrealizedVal = data?.unrealized ?? 0;
            const totalVal = realizedVal + unrealizedVal;

            return (
              <div key={label} className="bg-white border border-zinc-200/80 rounded-xl p-3.5 hover:shadow-sm hover:border-zinc-300 transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-1.5 mb-2.5">
                  <span className="text-xs font-extrabold text-zinc-700 uppercase tracking-wider">{label}</span>
                  <span className={cn(
                    "text-[10px] font-black uppercase px-2 py-0.5 rounded",
                    totalVal >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  )}>
                    {totalVal >= 0 ? '+' : ''}{formatCurrency(totalVal, activeCurrency)}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Realized</div>
                    <div className={cn("text-xs font-semibold flex items-center gap-0.5", realizedVal >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {realizedVal >= 0 ? '+' : '-'}{formatCurrency(Math.abs(realizedVal), activeCurrency)}
                    </div>
                  </div>
                  <div className="space-y-0.5 border-l border-zinc-100 pl-3">
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Unrealized</div>
                    <div className={cn("text-xs font-semibold flex items-center gap-0.5", unrealizedVal >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {unrealizedVal >= 0 ? '+' : '-'}{formatCurrency(Math.abs(unrealizedVal), activeCurrency)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
PortfolioSummary.displayName = 'PortfolioSummary';

interface AllocationChartProps {
  data: any[];
  view: 'asset' | 'industry' | 'sector';
  onViewChange: (view: 'asset' | 'industry' | 'sector') => void;
  colors: string[];
  tooltip: React.ReactNode;
}

export const AllocationChart = memo(({ data, view, onViewChange, colors, tooltip }: AllocationChartProps) => {
  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
            <Briefcase size={24} className="text-indigo-500" />
            Portfolio Allocation
          </h2>
          <p className="text-sm text-zinc-500 mt-1">Distribution of your assets by value</p>
        </div>
        
        <div className="flex items-center gap-2 self-start sm:self-center">
          <div className="flex bg-zinc-100 p-1 rounded-xl">
            {(['asset', 'industry', 'sector'] as const).map((v) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                className={cn(
                  "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all capitalize",
                  view === v 
                    ? "bg-white text-zinc-900 shadow-sm" 
                    : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-[400px] w-full">
        <ThreeDBarChart
          data={data.map((entry, index) => ({
            name: entry.name,
            value: entry.value,
            color: colors[index % colors.length]
          }))}
          activeTab="USD"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-8">
        {data.slice(0, 8).map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-2 group cursor-default">
            <div 
              className="w-3 h-3 rounded-full shrink-0 shadow-sm group-hover:scale-110 transition-transform" 
              style={{ backgroundColor: colors[index % colors.length] }} 
            />
            <div className="min-w-0">
              <div className="text-xs font-bold text-zinc-900 truncate">{entry.name}</div>
              <div className="text-[10px] font-medium text-zinc-500">{entry.percent.toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

AllocationChart.displayName = 'AllocationChart';
