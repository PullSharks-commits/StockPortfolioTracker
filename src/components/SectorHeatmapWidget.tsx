import React, { useState, useMemo } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Grid, Eye, BarChart3, ListCollapse, Info, PieChart, Landmark, Cpu, Stethoscope, ShoppingBag, Truck, MessageSquare, Flame, Home, Wrench, Coins, ArrowUpRight, ArrowDownRight, Activity } from 'lucide-react';
import { formatCurrency } from '../lib/currency';
import { calculateGroupFearGreed } from '../lib/fearGreed';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Icon mapper helper
const getSectorIcon = (sectorName: string) => {
  const name = (sectorName || '').toLowerCase();
  if (name.includes('tech') || name.includes('it')) return <Cpu className="w-4 h-4" />;
  if (name.includes('financial') || name.includes('bank')) return <Landmark className="w-4 h-4" />;
  if (name.includes('health') || name.includes('pharma')) return <Stethoscope className="w-4 h-4" />;
  if (name.includes('consumer defensive') || name.includes('staples') || name.includes('fmcg')) return <ShoppingBag className="w-4 h-4 text-emerald-500" />;
  if (name.includes('consumer cyclical') || name.includes('discretionary')) return <ShoppingBag className="w-4 h-4 text-amber-500" />;
  if (name.includes('industrial')) return <Truck className="w-4 h-4" />;
  if (name.includes('communication')) return <MessageSquare className="w-4 h-4" />;
  if (name.includes('energy')) return <Flame className="w-4 h-4 text-orange-500" />;
  if (name.includes('real estate')) return <Home className="w-4 h-4" />;
  if (name.includes('utilities')) return <Wrench className="w-4 h-4" />;
  if (name.includes('materials') || name.includes('resource')) return <Coins className="w-4 h-4" />;
  return <Grid className="w-4 h-4 text-zinc-400" />;
};

// Returns Tailwind classes based on daily performance percentage
const getPerformanceStyles = (pct: number) => {
  if (pct >= 2.0) {
    return {
      bg: 'bg-emerald-600 hover:bg-emerald-750 text-white border-emerald-500 shadow-sm shadow-emerald-100',
      text: 'text-white',
      badge: 'bg-emerald-800 text-emerald-100 border-emerald-500/30'
    };
  }
  if (pct >= 0.5) {
    return {
      bg: 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-400 shadow-sm shadow-emerald-50/50',
      text: 'text-white',
      badge: 'bg-emerald-700 text-emerald-100 border-emerald-400/30'
    };
  }
  if (pct > 0) {
    return {
      bg: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-850 border-emerald-200/80',
      text: 'text-emerald-900',
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-300/40'
    };
  }
  if (pct === 0) {
    return {
      bg: 'bg-zinc-50 hover:bg-zinc-100 text-zinc-800 border-zinc-200',
      text: 'text-zinc-950',
      badge: 'bg-zinc-200/60 text-zinc-700 border-zinc-300/40'
    };
  }
  if (pct >= -0.5) {
    return {
      bg: 'bg-rose-50 hover:bg-rose-100 text-rose-850 border-rose-200/80',
      text: 'text-rose-900',
      badge: 'bg-rose-100 text-rose-800 border-rose-300/40'
    };
  }
  if (pct >= -2.0) {
    return {
      bg: 'bg-rose-500 hover:bg-rose-600 text-white border-rose-400 shadow-sm shadow-rose-50/50',
      text: 'text-white',
      badge: 'bg-rose-700 text-rose-100 border-rose-400/30'
    };
  }
  return {
    bg: 'bg-rose-600 hover:bg-rose-750 text-white border-rose-500 shadow-sm shadow-rose-105/50',
    text: 'text-white',
    badge: 'bg-rose-800 text-rose-105 border-rose-500/30'
  };
};

// Map global market representative tickers and their display labels
const GLOBAL_SECTOR_DEF = [
  { name: 'Technology', ticker: 'XLK' },
  { name: 'Financial Services', ticker: 'XLF' },
  { name: 'Healthcare', ticker: 'XLV' },
  { name: 'Consumer Cyclical', ticker: 'XLY' },
  { name: 'Industrials', ticker: 'XLI' },
  { name: 'Communication Services', ticker: 'XLC' },
  { name: 'Consumer Defensive', ticker: 'XLP' },
  { name: 'Energy', ticker: 'XLE' },
  { name: 'Real Estate', ticker: 'XLRE' },
  { name: 'Utilities', ticker: 'XLU' },
  { name: 'Basic Materials', ticker: 'XLB' },
];

export default function SectorHeatmapWidget({
  holdings = [],
  quotes = {},
  metadata = {},
  activeCurrency,
  activeTab,
  fearGreedData
}: {
  holdings: any[];
  quotes: any;
  metadata: Record<string, { sector: string, industry: string }>;
  activeCurrency: string;
  activeTab: 'global' | 'australia';
  fearGreedData?: any;
}) {
  const [viewMode, setViewMode] = useState<'my-portfolio' | 'market-indices'>('my-portfolio');
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  // 1. Calculate sector performances for the user's portfolio holdings in the active tab
  const mySectorData = useMemo(() => {
    const sectorsMap: Record<string, {
      name: string;
      totalValue: number;
      totalPrevValue: number;
      holdingsCount: number;
      tickerHoldings: any[];
    }> = {};

    holdings.forEach((h: any) => {
      if (h.ticker === 'CASH') return; // Cash is ex-sector in typical day performance analysis
      
      const sector = metadata[h.ticker]?.sector || 'Unknown/Other';
      if (!sectorsMap[sector]) {
        sectorsMap[sector] = {
          name: sector,
          totalValue: 0,
          totalPrevValue: 0,
          holdingsCount: 0,
          tickerHoldings: []
        };
      }

      const val = h.currentValue || 0;
      const dayChg = h.dayChange || 0;
      const prevVal = val - dayChg;

      sectorsMap[sector].totalValue += val;
      sectorsMap[sector].totalPrevValue += prevVal;
      sectorsMap[sector].holdingsCount += 1;
      sectorsMap[sector].tickerHoldings.push(h);
    });

    return Object.values(sectorsMap).map(sec => {
      const dayChangePercent = sec.totalPrevValue > 0 
        ? ((sec.totalValue - sec.totalPrevValue) / sec.totalPrevValue) * 100 
        : 0;
      const fearGreed = calculateGroupFearGreed(sec.tickerHoldings, fearGreedData);

      return {
        ...sec,
        dayChangePercent,
        fearGreed
      };
    }).sort((a, b) => b.totalValue - a.totalValue);
  }, [holdings, metadata, fearGreedData]);

  // 2. Map standard global index sector performances
  const marketSectorData = useMemo(() => {
    return GLOBAL_SECTOR_DEF.map(sec => {
      const q = quotes[sec.ticker];
      let dayChangePercent = 0;
      let currentPrice = 0;
      
      if (q) {
        if (q.changePercent != null) {
          dayChangePercent = q.changePercent;
        } else if (q.previousClose > 0) {
          dayChangePercent = ((q.price - q.previousClose) / q.previousClose) * 100;
        }
        currentPrice = q.price || 0;
      }

      return {
        name: sec.name,
        ticker: sec.ticker,
        dayChangePercent,
        currentPrice,
        q
      };
    });
  }, [quotes]);

  // Handle fallback if user doesn't have holdings
  const hasPortfolioSectors = mySectorData.length > 0;

  // Render list of holdings for selected sector details
  const selectedSectorHoldings = useMemo(() => {
    if (!selectedSector) return [];
    const secObj = mySectorData.find(s => s.name === selectedSector);
    return secObj ? secObj.tickerHoldings : [];
  }, [selectedSector, mySectorData]);

  // Active items based on viewMode
  const activeHeatmapItems = viewMode === 'my-portfolio' && hasPortfolioSectors ? mySectorData : marketSectorData;

  const handleSelectCard = (name: string) => {
    if (viewMode === 'my-portfolio') {
      setSelectedSector(selectedSector === name ? null : name);
    }
  };

  return (
    <div className="flex-1 flex flex-col font-sans">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-3 border-b border-zinc-100">
        <div className="flex items-center gap-1.5 p-0.5 bg-zinc-100 rounded-lg border border-zinc-200">
          <button
            onClick={() => {
              setViewMode('my-portfolio');
              setSelectedSector(null);
            }}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 leading-normal",
              viewMode === 'my-portfolio' 
                ? "bg-white text-zinc-950 shadow-xs border border-zinc-205" 
                : "text-zinc-550 hover:text-zinc-900"
            )}
          >
            <PieChart className="w-3.5 h-3.5" />
            My Portfolio
          </button>
          <button
            onClick={() => {
              setViewMode('market-indices');
              setSelectedSector(null);
            }}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 leading-normal",
              viewMode === 'market-indices' 
                ? "bg-white text-zinc-950 shadow-xs border border-zinc-205" 
                : "text-zinc-550 hover:text-zinc-900"
            )}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            US Industry Benchmarks ({activeCurrency})
          </button>
        </div>

        <div className="text-[10px] text-zinc-500 font-bold bg-zinc-50 border border-zinc-200 px-2 py-1 rounded-md uppercase tracking-wider flex items-center gap-1 font-mono">
          <Info size={11} className="text-zinc-400" />
          Color reflects daily % return
        </div>
      </div>

      {viewMode === 'my-portfolio' && !hasPortfolioSectors ? (
        <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 flex flex-col items-center justify-center">
          <Grid className="w-10 h-10 text-zinc-300 mb-3 animate-pulse" />
          <h3 className="text-xs font-black text-zinc-700 uppercase tracking-wide">No Sector Data Found</h3>
          <p className="text-[10px] text-zinc-500 max-w-sm mt-1 leading-relaxed">
            Your currently active tab has no holdings. Turn on benchmarks to view broader market prices.
          </p>
          <button
            onClick={() => setViewMode('market-indices')}
            className="mt-4 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-zinc-905 text-white hover:bg-zinc-800 rounded-lg transition-colors border-none"
          >
            Switch to Benchmarks
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {activeHeatmapItems.map((item) => {
              const styles = getPerformanceStyles(item.dayChangePercent);
              const isSelected = selectedSector === item.name;

              return (
                <div
                  key={item.name}
                  onClick={() => handleSelectCard(item.name)}
                  className={cn(
                    "relative p-4 rounded-xl border transition-all duration-200 group overflow-hidden select-none",
                    styles.bg,
                    viewMode === 'my-portfolio' ? "cursor-pointer" : "cursor-default",
                    isSelected ? "ring-2 ring-zinc-950 ring-offset-2 scale-[1.01]" : ""
                  )}
                >
                  {/* Subtle Vector Background Accent */}
                  <div className="absolute right-0 bottom-0 opacity-10 group-hover:opacity-15 transition-opacity translate-x-2 translate-y-2 pointer-events-none">
                    <div className="scale-[2.5]">
                      {getSectorIcon(item.name)}
                    </div>
                  </div>

                  <div className="flex justify-between items-start mb-2 relative z-10 gap-2">
                    <span className="text-[9px] font-black tracking-widest uppercase truncate max-w-[85%] block pr-1">
                      {item.name}
                    </span>
                    <span className="p-1 rounded bg-black/5 dark:bg-white/5 border border-black/5">
                      {getSectorIcon(item.name)}
                    </span>
                  </div>

                  <div className="mt-4 flex items-baseline justify-between relative z-10">
                    <div className="text-lg font-extrabold tracking-tight font-mono">
                      {item.dayChangePercent > 0 ? '+' : ''}{item.dayChangePercent.toFixed(2)}%
                    </div>

                    <div className="text-[9px] font-semibold opacity-85 leading-none">
                      {viewMode === 'my-portfolio' ? (
                        <span>{(item as any).holdingsCount} stocks</span>
                      ) : (
                        <span className="font-mono">{(item as any).ticker}</span>
                      )}
                    </div>
                  </div>

                  {viewMode === 'my-portfolio' && (
                    <div className="mt-2.5 pt-2 border-t border-black/5 dark:border-white/5 flex justify-between items-center text-[9px] font-medium opacity-90">
                      {(item as any).fearGreed ? (
                        <span 
                          className={cn(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase border shadow-2xs",
                            (item as any).fearGreed.badgeBgClass,
                            (item as any).fearGreed.colorClass,
                            (item as any).fearGreed.borderClass
                          )}
                          title={`Sector Fear & Greed: ${(item as any).fearGreed.rating} (${(item as any).fearGreed.score})`}
                        >
                          <Activity size={9} />
                          F&G {(item as any).fearGreed.score}
                        </span>
                      ) : (
                        <span className="text-zinc-400 font-mono text-[8px]">F&G --</span>
                      )}
                      <span className="font-extrabold font-mono">
                        {formatCurrency((item as any).totalValue, activeCurrency)}
                      </span>
                    </div>
                  )}

                  {viewMode === 'my-portfolio' && isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-zinc-950 border border-white animate-ping" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Connected Holdings Breakdown Drawer */}
          {selectedSector && viewMode === 'my-portfolio' && (
            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 md:p-5 animate-in slide-in-from-top duration-200">
              <div className="flex items-center justify-between mb-3 border-b border-zinc-200/60 pb-2">
                <div className="flex items-center gap-1.5">
                  <span className="p-1.5 rounded-lg bg-zinc-900 text-white">
                    {getSectorIcon(selectedSector)}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-black uppercase text-zinc-900 tracking-wider">
                        {selectedSector} Holdings
                      </h4>
                      {(() => {
                        const secData = mySectorData.find(s => s.name === selectedSector);
                        if (secData && secData.fearGreed) {
                          return (
                            <span 
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase border shadow-2xs",
                                secData.fearGreed.badgeBgClass,
                                secData.fearGreed.colorClass,
                                secData.fearGreed.borderClass
                              )}
                              title={`Sector Fear & Greed: ${secData.fearGreed.rating} (${secData.fearGreed.score})`}
                            >
                              <Activity size={9} />
                              {secData.fearGreed.rating} ({secData.fearGreed.score})
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <p className="text-[9px] text-zinc-500 font-medium">
                      Active components in currently selected sector
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedSector(null)}
                  className="px-2.5 py-1 text-[9px] font-bold bg-white text-zinc-650 hover:text-zinc-950 border border-zinc-205 hover:bg-zinc-100/60 rounded-md transition-all uppercase tracking-wider"
                >
                  Close Details
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {selectedSectorHoldings.map((h: any) => {
                  const hDayPct = quotes[h.ticker]?.changePercent != null 
                    ? quotes[h.ticker].changePercent 
                    : h.dayChangePercent;

                  return (
                    <div key={h.key || h.ticker} className="bg-white border border-zinc-200/80 p-3.5 rounded-xl hover:border-zinc-300 transition-all shadow-xs flex justify-between items-center">
                      <div className="space-y-0.5 max-w-[65%]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-zinc-950 font-mono">{h.ticker}</span>
                          <span className="text-[10px] text-zinc-450 font-medium truncate max-w-[100px]" title={h.companyName || ''}>
                            {h.companyName}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider leading-none font-mono">
                          Shares: <span className="text-zinc-600">{h.shares}</span>
                        </div>
                      </div>

                      <div className="text-right space-y-0.5">
                        <div className="text-xs font-bold text-zinc-900 font-mono">
                          {formatCurrency(h.currentValue, activeCurrency)}
                        </div>
                        <div className={cn(
                          "text-[9px] font-black flex items-center justify-end gap-1 font-mono",
                          hDayPct > 0 ? "text-emerald-600" : hDayPct < 0 ? "text-rose-600" : "text-zinc-500"
                        )}>
                          {hDayPct > 0 ? <ArrowUpRight size={10} /> : hDayPct < 0 ? <ArrowDownRight size={10} /> : null}
                          {hDayPct > 0 ? '+' : ''}{hDayPct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
