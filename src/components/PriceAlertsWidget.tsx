import React, { useState } from 'react';
import { Bell, Plus, Trash2, TrendingUp, TrendingDown, Target } from 'lucide-react';
import { formatCurrency } from '../lib/currency';
import { doc, deleteDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface PriceAlert {
  id: string;
  userId: string;
  ticker: string;
  targetPrice: number;
  condition: 'above' | 'below';
  isTriggered: boolean;
  createdAt: string;
}

export default function PriceAlertsWidget({
  alerts,
  quotes,
  user,
  activeCurrency
}: {
  alerts: PriceAlert[];
  quotes: any;
  user: any;
  activeCurrency: string;
}) {
  const [ticker, setTicker] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !targetPrice || !user) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'alerts'), {
        userId: user.uid,
        ticker: ticker.toUpperCase().trim(),
        targetPrice: parseFloat(targetPrice),
        condition,
        isTriggered: false,
        createdAt: serverTimestamp()
      });
      setTicker('');
      setTargetPrice('');
    } catch (err) {
      console.error('Error adding alert', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'alerts', id));
    } catch (err) {
      console.error('Error deleting alert', err);
    }
  };

  return (
    <div className="h-full flex flex-col relative z-20">
      <form onSubmit={handleAddAlert} className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Ticker</label>
            <input
              type="text"
              required
              placeholder="e.g. AAPL"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent uppercase placeholder:normal-case font-mono"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Target Price</label>
            <input
              type="number"
              step="any"
              required
              placeholder="150.00"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent font-mono"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
            />
          </div>
        </div>
        <div className="flex bg-zinc-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setCondition('above')}
            className={cn(
              "flex-1 py-1.5 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-1.5",
              condition === 'above' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <TrendingUp className="w-4 h-4" /> Goes Above
          </button>
          <button
            type="button"
            onClick={() => setCondition('below')}
            className={cn(
              "flex-1 py-1.5 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-1.5",
              condition === 'below' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <TrendingDown className="w-4 h-4" /> Goes Below
          </button>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSubmitting ? 'Adding...' : 'Add Alert'}
        </button>
      </form>

      <div className="flex-1 overflow-y-auto">
        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Active Alerts</h3>
        {alerts.length === 0 ? (
          <div className="text-center py-6 text-zinc-500 text-sm">
            No price alerts set.
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => {
              const currentPrice = quotes[alert.ticker]?.price;
              // Format Currency should be available or just format locally
              return (
                <div key={alert.id} className={cn("flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border", alert.isTriggered ? "bg-green-50 border-green-200" : "bg-white border-zinc-200")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg shrink-0", alert.condition === 'above' ? "bg-indigo-50 text-indigo-600" : "bg-rose-50 text-rose-600")}>
                      {alert.condition === 'above' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="font-bold text-zinc-900 flex items-center gap-2">
                        {alert.ticker}
                        {alert.isTriggered && <span className="text-[10px] bg-green-200 text-green-800 px-1.5 rounded-full uppercase tracking-tighter">Triggered</span>}
                      </div>
                      <div className="text-xs text-zinc-500 flex items-center gap-1.5">
                        <Target className="w-3 h-3" />
                        Target: {formatCurrency(alert.targetPrice, activeCurrency)}
                        {currentPrice && (
                          <>
                            <span className="text-zinc-300">|</span>
                            <span className="font-mono">Current: {formatCurrency(currentPrice, activeCurrency)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(alert.id)} className="p-2 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors mt-2 sm:mt-0 self-end sm:self-auto shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}