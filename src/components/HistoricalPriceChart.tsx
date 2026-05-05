import React, { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import { format, subYears } from 'date-fns';
import { Loader2, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../lib/currency';

interface HistoricalPriceChartProps {
  ticker: string;
  activeCurrency: string;
}

export const HistoricalPriceChart: React.FC<HistoricalPriceChartProps> = ({ ticker, activeCurrency }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const fiveYearsAgo = subYears(new Date(), 5);
        const fromStr = format(fiveYearsAgo, 'yyyy-MM-dd');
        
        const res = await fetch(`/api/historical-bulk?symbols=${ticker}&from=${fromStr}`);
        if (!res.ok) throw new Error('Failed to fetch historical data');
        
        const result = await res.json();
        const tickerData = result[ticker] || [];
        
        if (isMounted) {
          if (tickerData.length === 0) {
            setError('No historical data available for this ticker.');
          } else {
            setData(tickerData.map((d: any) => ({
              date: d.date.split('T')[0],
              displayDate: format(new Date(d.date), 'MMM dd, yyyy'),
              price: d.close
            })));
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Error loading historical prices');
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
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <p className="text-sm font-medium">Loading 5-year price history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500 px-6 text-center">
        <AlertCircle className="w-10 h-10 text-rose-500 mb-2" />
        <p className="text-zinc-900 font-semibold">{error}</p>
        <p className="text-sm">This could be due to a temporary API issue or the ticker symbol being invalid.</p>
      </div>
    );
  }

  const firstPrice = data[0]?.price || 0;
  const lastPrice = data[data.length - 1]?.price || 0;
  const totalChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  const isPositive = totalChange >= 0;

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-1">5 Year Price History</h4>
          <div className="flex items-baseline gap-3">
             <span className="text-3xl font-bold text-zinc-900">{formatCurrency(lastPrice, activeCurrency)}</span>
             <span className={`text-sm font-bold ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                {isPositive ? '+' : ''}{totalChange.toFixed(2)}%
             </span>
          </div>
        </div>
        <div className="text-right">
           <span className="text-xs font-bold text-zinc-400 uppercase block">Data Period</span>
           <span className="text-sm font-medium text-zinc-600">{data[0]?.displayDate} - {data[data.length-1]?.displayDate}</span>
        </div>
      </div>

      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.1}/>
                <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
            <XAxis 
              dataKey="date" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#a1a1aa' }} 
              minTickGap={60}
              tickFormatter={(val) => format(new Date(val), 'MMM yyyy')}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#a1a1aa' }}
              domain={['auto', 'auto']}
              orientation="right"
              tickFormatter={(val) => formatCurrency(val, activeCurrency, true)}
            />
            <RechartsTooltip 
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white p-3 rounded-xl shadow-xl border border-zinc-100">
                      <p className="text-xs font-bold text-zinc-400 uppercase mb-1">{payload[0].payload.displayDate}</p>
                      <p className="text-lg font-bold text-zinc-900">{formatCurrency(payload[0].value as number, activeCurrency)}</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area 
              type="monotone" 
              dataKey="price" 
              stroke={isPositive ? '#10b981' : '#ef4444'} 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorPrice)" 
              animationDuration={1500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
