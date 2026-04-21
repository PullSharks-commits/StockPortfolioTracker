import React, { memo, useState } from 'react';
import { TrendingUp, DollarSign, Briefcase, Zap, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import ThreeDBarChart from './ThreeDBarChart';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { formatCurrency } from '../lib/currency';

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
  activeCurrency,
  onCurrencyChange,
  riskProfile,
  targetReturn
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
  activeCurrency: string;
  onCurrencyChange: (currency: string) => void;
  riskProfile?: string;
  targetReturn?: number;
}) => {
  const [performanceView, setPerformanceView] = useState<'absolute' | 'relative'>('absolute');
  const isRelative = performanceView === 'relative';

  const displayTotalReturnPercent = isRelative && benchmarkYtdReturn != null 
    ? totalProfitLossPercent - benchmarkYtdReturn 
    : totalProfitLossPercent;
    
  const displayDayChangePercent = isRelative 
    ? dayChangePercent - benchmarkDayChangePercent 
    : dayChangePercent;

  const isProfit = displayTotalReturnPercent >= 0;
  const isDayProfit = displayDayChangePercent >= 0;

  return (
    <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-8 md:p-10 lg:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-zinc-500 mb-2">
            <Briefcase className="w-5 h-5" />
            <span className="text-sm font-semibold uppercase tracking-widest">Total Portfolio Value</span>
          </div>
          <div className="flex items-center gap-4 text-5xl md:text-6xl lg:text-7xl font-light tracking-tight text-zinc-900 group">
            <span>{formatCurrency(totalValue, activeCurrency)}</span>
            <select
              value={activeCurrency}
              onChange={(e) => onCurrencyChange(e.target.value)}
              className="text-xs font-bold bg-zinc-100 border border-zinc-200 rounded-md px-1.5 py-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200"
              title="Change display currency"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="AUD">AUD</option>
              <option value="CAD">CAD</option>
              <option value="INR">INR</option>
              <option value="SGD">SGD</option>
            </select>
          </div>
          {(riskProfile || targetReturn) && (
            <div className="flex flex-wrap gap-3 mt-4">
              {riskProfile && (
                <div className="px-3 py-1 bg-zinc-100 rounded-full text-[10px] font-bold text-zinc-600 uppercase tracking-widest border border-zinc-200">
                  Risk: {riskProfile}
                </div>
              )}
              {targetReturn && (
                <div className="px-3 py-1 bg-indigo-50 rounded-full text-[10px] font-bold text-indigo-600 uppercase tracking-widest border border-indigo-100">
                  Target: {targetReturn}%
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6 w-full md:w-auto">
          <div className="flex bg-zinc-100 p-1 rounded-xl self-start">
            <button
              onClick={() => setPerformanceView('absolute')}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
                performanceView === 'absolute' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              Absolute
            </button>
            <button
              onClick={() => setPerformanceView('relative')}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
                performanceView === 'relative' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              vs {benchmarkTicker}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-6 md:gap-12">
            <div className="space-y-1">
              <div className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
                {isRelative ? 'Relative Return' : 'Total Return'}
              </div>
              <div className={cn("text-2xl md:text-3xl font-medium flex items-center gap-2", isProfit ? "text-emerald-600" : "text-rose-600")}>
                {isRelative ? (
                  `${displayTotalReturnPercent >= 0 ? '+' : ''}${displayTotalReturnPercent.toFixed(2)}%`
                ) : (
                  formatCurrency(totalProfitLoss, activeCurrency, true)
                )}
              </div>
              <div className={cn("text-sm font-medium flex items-center gap-1", isProfit ? "text-emerald-600" : "text-rose-600")}>
                {isProfit ? <TrendingUp className="w-4 h-4" /> : <TrendingUp className="w-4 h-4 rotate-180" />}
                {isRelative ? 'vs Benchmark (YTD)' : `${Math.abs(totalProfitLossPercent).toFixed(2)}% All Time`}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
                {isRelative ? 'Relative Day Change' : 'Day Change'}
              </div>
              <div className={cn("text-2xl md:text-3xl font-medium flex items-center gap-2", isDayProfit ? "text-emerald-600" : "text-rose-600")}>
                {isRelative ? (
                  `${displayDayChangePercent >= 0 ? '+' : ''}${displayDayChangePercent.toFixed(2)}%`
                ) : (
                  formatCurrency(dayChange, activeCurrency, true)
                )}
              </div>
              <div className={cn("text-sm font-medium flex items-center gap-1", isDayProfit ? "text-emerald-600" : "text-rose-600")}>
                {isDayProfit ? <TrendingUp className="w-4 h-4" /> : <TrendingUp className="w-4 h-4 rotate-180" />}
                {isRelative ? 'vs Benchmark' : `${Math.abs(dayChangePercent).toFixed(2)}% Today`}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-zinc-50 border-t border-zinc-100 px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Total Cost Basis:</span>
            <span className="font-medium text-zinc-900">{formatCurrency(totalCost, activeCurrency)}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Compare to:</span>
            <select 
              value={benchmarkTicker} 
              onChange={(e) => onBenchmarkChange(e.target.value)}
              className="text-xs font-bold bg-white border border-zinc-200 rounded-md px-2 py-1 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="SPY">S&P 500</option>
              <option value="QQQ">NASDAQ</option>
              <option value="DIA">DOW</option>
              <option value="IWM">RUSSELL</option>
            </select>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-zinc-400 text-xs uppercase">Day</span>
              <span className={cn("font-medium", benchmarkDayChangePercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                {benchmarkDayChangePercent >= 0 ? '+' : ''}{benchmarkDayChangePercent.toFixed(2)}%
              </span>
            </div>
            {benchmarkYtdReturn != null && (
              <div className="flex items-center gap-1">
                <span className="text-zinc-400 text-xs uppercase">YTD</span>
                <span className={cn("font-medium", benchmarkYtdReturn >= 0 ? "text-emerald-600" : "text-rose-600")}>
                  {benchmarkYtdReturn >= 0 ? '+' : ''}{benchmarkYtdReturn.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
PortfolioSummary.displayName = 'PortfolioSummary';

export const AllocationChart = memo(({ data, view, onViewChange, colors, tooltip, activeCurrency }: { data: any[], view: string, onViewChange: (v: any) => void, colors: string[], tooltip: any, activeCurrency: string }) => {
  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-indigo-500" />
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
          activeCurrency={activeCurrency}
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
