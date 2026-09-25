import React, { useState, useEffect, useRef } from 'react';
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import { Loader2, TrendingUp, BarChart2, Activity, AlertCircle } from 'lucide-react';

interface TradingViewChartWithSkeletonProps {
  symbol: string;
  showRsi?: boolean;
  studies?: string[];
  theme?: "light" | "dark";
  autosize?: boolean;
  hide_side_toolbar?: boolean;
  isMutualFund?: boolean;
}

export const TradingViewChartWithSkeleton: React.FC<TradingViewChartWithSkeletonProps> = ({
  symbol,
  showRsi = false,
  studies,
  theme = "light",
  autosize = true,
  hide_side_toolbar = false,
  isMutualFund = false,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset loading state when symbol or RSI toggles
    setIsLoading(true);

    let isMounted = true;

    // Minimum display duration for a smooth visual transition (1.5s)
    const timer = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    }, 1500);

    // Also observe iframe injection inside container for faster loading when ready
    const container = containerRef.current;
    let observer: MutationObserver | null = null;

    if (container) {
      observer = new MutationObserver(() => {
        const iframe = container.querySelector('iframe');
        if (iframe) {
          // Once iframe is injected, give it 600ms to parse and render canvas
          setTimeout(() => {
            if (isMounted) setIsLoading(false);
          }, 600);
        }
      });

      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (observer) observer.disconnect();
    };
  }, [symbol, showRsi]);

  const cleanSymbol = symbol.includes('-') ? `CRYPTO:${symbol.replace('-', '')}` : symbol;

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[500px] bg-zinc-50 overflow-hidden flex flex-col">
      {/* Skeleton Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-xs flex flex-col justify-between p-6 animate-fade-in transition-opacity duration-300">
          {/* Skeleton Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="w-20 h-7 bg-zinc-200/80 rounded-md animate-pulse" />
              <div className="w-32 h-6 bg-zinc-100 rounded-md animate-pulse hidden sm:block" />
              <div className="flex items-center gap-1.5 ml-2">
                <div className="w-12 h-6 bg-indigo-50 border border-indigo-100 rounded-md animate-pulse" />
                <div className="w-12 h-6 bg-zinc-100 rounded-md animate-pulse" />
              </div>
            </div>

            {/* Timeframe skeleton pills */}
            <div className="flex items-center gap-1 bg-zinc-100/80 p-1 rounded-lg">
              {['1D', '1W', '1M', '1Y', '5Y', 'ALL'].map((tf, i) => (
                <div
                  key={tf}
                  className={`w-8 h-6 rounded-md animate-pulse ${
                    i === 0 ? 'bg-white shadow-2xs' : 'bg-transparent'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Skeleton Middle Body: Grid & Simulated Candlestick Waves */}
          <div className="flex-1 relative my-4 rounded-xl border border-dashed border-zinc-200/80 bg-gradient-to-b from-zinc-50/50 to-zinc-100/30 overflow-hidden flex flex-col justify-between p-4">
            {/* Grid lines */}
            <div className="absolute inset-0 grid grid-rows-6 grid-cols-8 gap-0 pointer-events-none opacity-40">
              {Array.from({ length: 48 }).map((_, i) => (
                <div key={i} className="border-r border-b border-zinc-200/60 border-dashed" />
              ))}
            </div>

            {/* Simulated Candle/Wave Shimmer */}
            <div className="absolute inset-x-8 top-12 bottom-16 flex items-end justify-between gap-2 opacity-60">
              {[40, 55, 35, 65, 80, 50, 75, 90, 60, 70, 85, 95, 68, 52, 78, 88].map((height, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  {/* Wick */}
                  <div className="w-0.5 bg-indigo-200/60 rounded-full h-full max-h-[80%]" />
                  {/* Body */}
                  <div
                    className={`w-full rounded-xs animate-pulse ${
                      idx % 2 === 0 ? 'bg-emerald-200/70' : 'bg-rose-200/70'
                    }`}
                    style={{
                      height: `${height}%`,
                      animationDelay: `${idx * 80}ms`,
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Center Loading Badge */}
            <div className="relative z-10 m-auto bg-white/90 backdrop-blur-md px-5 py-3 rounded-2xl border border-indigo-100 shadow-md flex items-center gap-3 text-zinc-800">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <div className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-indigo-500" />
                  Initializing TradingView Interactive Chart
                </div>
                <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                  Loading real-time market data for <span className="font-bold text-indigo-600">{symbol}</span>...
                </div>
              </div>
            </div>

            {/* Skeleton Sub-Pane / Volume Chart */}
            <div className="h-16 w-full pt-2 border-t border-zinc-200/60 flex items-end gap-1 opacity-40">
              {[30, 45, 60, 25, 75, 50, 80, 40, 90, 65, 35, 70, 55, 85, 45, 60, 75, 90, 50, 65].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 bg-indigo-200/60 rounded-t-xs animate-pulse"
                  style={{ height: `${h}%`, animationDelay: `${i * 50}ms` }}
                />
              ))}
            </div>
          </div>

          {/* Skeleton Footer Toolbar */}
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-mono text-[11px]">Connecting to TradingView WebSocket...</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-16 h-4 bg-zinc-200/70 rounded animate-pulse" />
              <div className="w-12 h-4 bg-zinc-200/70 rounded animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* Actual TradingView Widget */}
      <div className="w-full h-full flex-1">
        <AdvancedRealTimeChart
          key={`${cleanSymbol}-${showRsi}`}
          symbol={cleanSymbol}
          theme={theme}
          autosize={autosize}
          hide_side_toolbar={hide_side_toolbar}
          studies={studies as any}
        />
      </div>

      {/* Mutual Fund Warning Notice if applicable */}
      {isMutualFund && (
        <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-sm p-3 rounded-lg border border-amber-200 shadow-sm text-sm text-amber-800 flex items-start gap-2 z-10">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <p>
            <strong>Note:</strong> Mutual funds ({symbol}) may not have intraday chart data available on TradingView. Try changing the timeframe to Daily (D) or Weekly (W) if the chart doesn't load.
          </p>
        </div>
      )}
    </div>
  );
};
