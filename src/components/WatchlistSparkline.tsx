import React, { useEffect, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface WatchlistSparklineProps {
  ticker: string;
}

// Every visible sparkline wants the same 30-day window. Requests made in the same
// moment are combined into one /api/historical-bulk call, and results are kept for
// a while so re-renders, remounts and duplicate rows don't refetch.
const SPARKLINE_TTL_MS = 15 * 60 * 1000;
const sparklineCache = new Map<string, { at: number; closes: Promise<number[]> }>();
let pendingBatch: Map<string, { resolve: (c: number[]) => void; reject: (e: unknown) => void }> | null = null;

function loadSparklineCloses(ticker: string): Promise<number[]> {
  const cached = sparklineCache.get(ticker);
  if (cached && Date.now() - cached.at < SPARKLINE_TTL_MS) return cached.closes;

  const closes = new Promise<number[]>((resolve, reject) => {
    if (!pendingBatch) {
      pendingBatch = new Map();
      setTimeout(flushSparklineBatch, 50);
    }
    pendingBatch.set(ticker, { resolve, reject });
  });
  sparklineCache.set(ticker, { at: Date.now(), closes });
  // Don't cache failures.
  closes.catch(() => sparklineCache.delete(ticker));
  return closes;
}

async function flushSparklineBatch() {
  const batch = pendingBatch!;
  pendingBatch = null;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromStr = thirtyDaysAgo.toISOString().split('T')[0];
  try {
    const symbols = [...batch.keys()].map(encodeURIComponent).join(',');
    const res = await fetch(`/api/historical-bulk?symbols=${symbols}&from=${fromStr}`);
    if (!res.ok) throw new Error('Failed to fetch sparkline data');
    const result = await res.json();
    for (const [ticker, { resolve }] of batch) {
      resolve((result[ticker] || []).map((d: any) => d.close));
    }
  } catch (err) {
    for (const { reject } of batch.values()) reject(err);
  }
}

export const WatchlistSparkline: React.FC<WatchlistSparklineProps> = ({ ticker }) => {
  const [data, setData] = useState<{ price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPositive, setIsPositive] = useState(true);

  useEffect(() => {
    if (ticker === 'CASH') {
      setData([{ price: 1 }, { price: 1 }]);
      setIsPositive(true);
      setLoading(false);
      return;
    }

    let isMounted = true;
    const fetchData = async () => {
      try {
        const closes = await loadSparklineCloses(ticker);
        if (!isMounted) return;

        if (closes.length > 1) {
          const formatted = closes.map(close => ({ price: close }));
          setData(formatted);
          setIsPositive(closes[closes.length - 1] >= closes[0]);
        } else {
          // Fallback if no data
          setData([{ price: 1 }, { price: 1 }]);
        }
      } catch (err) {
        console.warn(`Error loading sparkline for ${ticker}:`, err);
        if (isMounted) {
          setData([{ price: 1 }, { price: 1 }]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => { isMounted = false; };
  }, [ticker]);

  if (loading) {
    return (
      <div className="w-24 h-8 bg-zinc-100 animate-pulse rounded-md" />
    );
  }

  // Sanitize ticker name for valid SVG ID attribute
  const safeId = ticker.replace(/[^a-zA-Z0-9]/g, '_');
  const strokeColor = isPositive ? '#10b981' : '#ef4444';

  return (
    <div className="w-24 h-8 select-none pointer-events-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={`gradient-${safeId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.15} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="price"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill={`url(#gradient-${safeId})`}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
