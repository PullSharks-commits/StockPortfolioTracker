import React, { useEffect, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface WatchlistSparklineProps {
  ticker: string;
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
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const fromStr = thirtyDaysAgo.toISOString().split('T')[0];

        const res = await fetch(`/api/historical-bulk?symbols=${encodeURIComponent(ticker)}&from=${fromStr}`);
        if (!res.ok) throw new Error('Failed to fetch sparkline data');
        
        const result = await res.json();
        if (!isMounted) return;

        const tickerData = result[ticker] || [];
        if (tickerData.length > 1) {
          const formatted = tickerData.map((d: any) => ({ price: d.close }));
          setData(formatted);
          
          const first = formatted[0].price;
          const last = formatted[formatted.length - 1].price;
          setIsPositive(last >= first);
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
