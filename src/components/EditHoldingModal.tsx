import React, { useState, useEffect, useMemo } from 'react';
import { X, AlertCircle, Check, RotateCcw, Trash2, Coins, ArrowRight, ShieldAlert } from 'lucide-react';
import { CompanyLogo } from './CompanyLogo';
import { computeHoldingFromTransactions, TransactionItem } from '../utils/portfolioCalculations';

interface EditHoldingModalProps {
  isOpen: boolean;
  holding: any | null;
  onClose: () => void;
  onSave: (id: string, ticker: string, shares: number, avgPrice: number, currency: string) => Promise<void>;
  onDelete?: (id: string) => void;
  onSyncWithLedger?: (holdingToSync: any, customComputed?: any) => Promise<void>;
  transactions?: any[];
  activeCurrency: string;
  metadata?: Record<string, any>;
}

export const EditHoldingModal: React.FC<EditHoldingModalProps> = ({
  isOpen,
  holding,
  onClose,
  onSave,
  onDelete,
  onSyncWithLedger,
  transactions = [],
  activeCurrency,
  metadata = {}
}) => {
  if (!isOpen || !holding) return null;

  const [ticker, setTicker] = useState(holding.ticker || '');
  const [shares, setShares] = useState(holding.shares?.toString() ?? '0');
  const [avgPrice, setAvgPrice] = useState(Math.max(0, holding.avg_price ?? 0).toString());
  const [currency, setCurrency] = useState(holding.avgPriceCurrency || activeCurrency || 'USD');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const holdingTransactions = useMemo(() => {
    return transactions.filter(t => t.holdingId === holding.id);
  }, [transactions, holding.id]);

  const ledgerStats = useMemo(() => {
    return computeHoldingFromTransactions(holdingTransactions as TransactionItem[]);
  }, [holdingTransactions]);

  const isCorrupted = (holding.avg_price < 0 || holding.shares < 0);
  const hasLedgerDiscrepancy = ledgerStats.totalBuys > 0 && (
    isCorrupted ||
    Math.abs(holding.shares - ledgerStats.shares) > 0.001 ||
    Math.abs(holding.avg_price - ledgerStats.avg_price) > 0.01
  );

  useEffect(() => {
    if (holding) {
      setTicker(holding.ticker || '');
      setShares(holding.shares?.toString() ?? '0');
      // If avg_price is negative, default the field to 0 or ledger value
      if (holding.avg_price < 0 && ledgerStats.totalBuys > 0 && ledgerStats.shares > 0) {
        setAvgPrice(ledgerStats.avg_price.toString());
        setShares(ledgerStats.shares.toString());
      } else {
        setAvgPrice(Math.max(0, holding.avg_price ?? 0).toString());
      }
      setCurrency(holding.avgPriceCurrency || activeCurrency || 'USD');
      setErrorMsg(null);
    }
  }, [holding, ledgerStats]);

  const handleSyncFromLedger = async () => {
    if (ledgerStats.totalBuys === 0) return;
    setShares(ledgerStats.shares.toString());
    setAvgPrice(ledgerStats.avg_price.toFixed(4).replace(/\.?0+$/, ''));
    setErrorMsg(null);
    if (onSyncWithLedger) {
      setIsSubmitting(true);
      try {
        await onSyncWithLedger(holding, ledgerStats);
        onClose();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to sync with ledger');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanTicker = ticker.trim().toUpperCase();
    if (!cleanTicker) {
      setErrorMsg('Ticker symbol is required.');
      return;
    }

    const cleanShares = parseFloat(shares.toString().replace(/,/g, '.'));
    if (isNaN(cleanShares) || cleanShares < 0) {
      setErrorMsg('Shares must be a valid non-negative number.');
      return;
    }

    const isCash = cleanTicker === 'CASH';
    const cleanAvgPrice = isCash ? 1 : parseFloat(avgPrice.toString().replace(/,/g, '.'));
    if (isNaN(cleanAvgPrice) || cleanAvgPrice < 0) {
      setErrorMsg('Average purchase price cannot be negative.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(holding.id, cleanTicker, cleanShares, cleanAvgPrice, currency);
      onClose();
    } catch (err: any) {
      console.error('Error saving position in modal:', err);
      setErrorMsg(err?.message || 'Failed to save position.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCash = ticker.toUpperCase() === 'CASH';

  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-zinc-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <CompanyLogo ticker={holding.ticker} logo={metadata[holding.ticker]?.logo} size="md" />
            <div>
              <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                Edit Position: {holding.ticker}
              </h3>
              <p className="text-xs text-zinc-500">
                Update shares, cost basis, or sync directly with transactions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-rose-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Negative / Corrupted Warning Banner */}
          {isCorrupted && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-900">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                Negative Value Detected
              </div>
              <p>
                This position previously recorded negative values (Shares: {holding.shares}, Avg Cost: ${holding.avg_price?.toFixed(2)}).
                {ledgerStats.totalBuys > 0 && " Use 'Sync with Ledger' below to restore your actual holdings based on verified transaction history."}
              </p>
            </div>
          )}

          {/* Ledger Discrepancy Card */}
          {hasLedgerDiscrepancy && (
            <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-xl text-amber-900 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold flex items-center gap-1.5 text-amber-950">
                  <Coins className="w-4 h-4 text-amber-600" />
                  Transaction Ledger Discrepancy
                </div>
                <button
                  type="button"
                  onClick={handleSyncFromLedger}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-[11px] shadow-sm transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Sync with Ledger
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                <div className="bg-white/80 p-2 rounded border border-amber-100">
                  <div className="text-zinc-500">Current Position:</div>
                  <div className="font-semibold text-zinc-900">
                    {holding.shares} shares @ {holding.avgPriceCurrency || 'USD'} {holding.avg_price?.toFixed(2)}
                  </div>
                </div>
                <div className="bg-white/80 p-2 rounded border border-amber-100">
                  <div className="text-amber-700 font-medium">Ledger Calculation:</div>
                  <div className="font-bold text-amber-900">
                    {ledgerStats.shares} shares @ {currency} {ledgerStats.avg_price?.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Ticker Input */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1.5">
              Ticker Symbol
            </label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. SOXL, AAPL, MSFT"
              className="w-full px-3.5 py-2.5 border border-zinc-200 rounded-xl font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all"
              required
            />
          </div>

          {/* Shares Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                Total Shares / Quantity
              </label>
              {ledgerStats.totalBuys > 0 && (
                <button
                  type="button"
                  onClick={() => setShares(ledgerStats.shares.toString())}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Use Ledger: {ledgerStats.shares}
                </button>
              )}
            </div>
            <input
              type="number"
              step="any"
              min="0"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="0"
              className="w-full px-3.5 py-2.5 border border-zinc-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all"
              required
            />
          </div>

          {/* Average Cost / Price */}
          {!isCash && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                  Average Cost Basis per Share
                </label>
                {ledgerStats.totalBuys > 0 && ledgerStats.avg_price > 0 && (
                  <button
                    type="button"
                    onClick={() => setAvgPrice(ledgerStats.avg_price.toFixed(4).replace(/\.?0+$/, ''))}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    Use Ledger: ${ledgerStats.avg_price.toFixed(2)}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="px-3 py-2.5 border border-zinc-200 rounded-xl text-xs font-semibold bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="AUD">AUD</option>
                  <option value="CAD">CAD</option>
                  <option value="INR">INR</option>
                  <option value="SGD">SGD</option>
                </select>
                <div className="relative flex-1">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={avgPrice}
                    onChange={(e) => setAvgPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3.5 py-2.5 border border-zinc-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all"
                    required
                  />
                </div>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                Cost basis cannot be negative. This represents the average amount spent per unit.
              </p>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-zinc-100 flex items-center justify-between gap-3">
            {onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete ${holding.ticker}?`)) {
                    onDelete(holding.id);
                    onClose();
                  }
                }}
                className="px-3 py-2 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save Position
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
