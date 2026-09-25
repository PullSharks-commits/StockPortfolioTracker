import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Plus, 
  Search, 
  ArrowUpDown, 
  Filter, 
  Trash2, 
  Check, 
  X, 
  FileText, 
  Undo2, 
  Calendar as CalendarIcon, 
  DollarSign, 
  Activity, 
  Loader2, 
  AlertCircle,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  Globe,
  Download,
  ChevronDown
} from 'lucide-react';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { 
  db, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp 
} from '../backend';
import { formatCurrency, getCurrencySymbol } from '../lib/currency';

interface Transaction {
  id: string;
  holdingId: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  date: string;
  userId: string;
}

interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  avgPriceCurrency?: string;
  userId: string;
  portfolioType?: 'global' | 'australia';
}

interface TransactionsWidgetProps {
  user: any;
  allHoldings: Holding[];
  allTransactions: Transaction[];
  quotes?: Record<string, { price: number; [key: string]: any }>;
  activeTab: string;
  activeCurrency: string;
  onToastSuccess: (msg: string) => void;
  onToastError: (msg: string) => void;
}

export default function TransactionsWidget({
  user,
  allHoldings,
  allTransactions,
  quotes,
  activeTab,
  activeCurrency,
  onToastSuccess,
  onToastError
}: TransactionsWidgetProps) {
  // Form State
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [txType, setTxType] = useState<'buy' | 'sell'>('buy');
  const [portfolioType, setPortfolioType] = useState<'global' | 'australia'>('global');
  const [formCurrency, setFormCurrency] = useState('USD');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Table Filtration / Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [tabFilter, setTabFilter] = useState<string>('active'); // 'active' (matches activeTab), 'all', or specific ('global', 'india', etc.)

  // Sorting State
  const [sortField, setSortField] = useState<'date' | 'ticker' | 'type' | 'shares' | 'price' | 'total' | 'profitLoss'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Deletion Confirmation State
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  // Export State
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportTransactions = (formatType: 'csv' | 'json', scope: 'all' | 'filtered' = 'all') => {
    setShowExportMenu(false);
    const sourceList = scope === 'all' ? enrichedTransactions : sortedTransactions;
    if (!sourceList || sourceList.length === 0) {
      onToastError('No transactions available to export.');
      return;
    }

    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const exportData = sourceList.map(tx => ({
      date: tx.date || '',
      ticker: tx.ticker || 'UNKNOWN',
      type: (tx.type || 'buy').toUpperCase(),
      shares: Number(tx.shares) || 0,
      price: Number(tx.price) || 0,
      total: Number(((tx.shares || 0) * (tx.price || 0)).toFixed(4)),
      currency: tx.currency || 'USD',
      portfolio: tx.portfolio || 'global',
      holdingId: tx.holdingId || '',
      transactionId: tx.id || ''
    }));

    if (formatType === 'json') {
      const dataStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions_${scope === 'all' ? 'whole_history' : 'filtered'}_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onToastSuccess(`Exported ${exportData.length} transactions as JSON!`);
    } else {
      const csv = Papa.unparse(exportData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions_${scope === 'all' ? 'whole_history' : 'filtered'}_${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onToastSuccess(`Exported ${exportData.length} transactions as CSV!`);
    }
  };

  // Sync state currency selection when tab changes
  useEffect(() => {
    if (activeTab) {
      setPortfolioType(activeTab as any);
      setTabFilter('active');
    }
  }, [activeTab]);

  useEffect(() => {
    setFormCurrency(activeCurrency);
  }, [activeCurrency]);

  // Denormalize Transactions (find ticker symbol & portfolio tab for each transaction)
  const enrichedTransactions = useMemo(() => {
    return allTransactions.map(tx => {
      const holding = allHoldings.find(h => h.id === tx.holdingId);
      const ticker = holding ? holding.ticker : 'UNKNOWN';
      const portfolio = holding ? (holding.portfolioType || 'global') : 'global';
      const currency = holding ? (holding.avgPriceCurrency || 'USD') : 'USD';

      // Current market price for this ticker
      const currentPrice = quotes && quotes[ticker]?.price !== undefined
        ? quotes[ticker].price
        : (holding ? holding.avg_price : 0);

      let profitLoss = 0;
      let profitLossPercent = 0;
      let plType: 'unrealized' | 'realized' = 'unrealized';

      if (tx.type === 'buy') {
        if (currentPrice > 0 && tx.price > 0) {
          profitLoss = (currentPrice - tx.price) * tx.shares;
          profitLossPercent = ((currentPrice - tx.price) / tx.price) * 100;
        }
        plType = 'unrealized';
      } else if (tx.type === 'sell') {
        let costPrice = holding ? holding.avg_price : 0;
        if ((tx as any).lotId) {
          const buyLot = allTransactions.find(t => t.id === (tx as any).lotId);
          if (buyLot && buyLot.price > 0) {
            costPrice = buyLot.price;
          }
        }
        if (costPrice > 0 && tx.price > 0) {
          profitLoss = (tx.price - costPrice) * tx.shares;
          profitLossPercent = ((tx.price - costPrice) / costPrice) * 100;
        }
        plType = 'realized';
      }

      return {
        ...tx,
        ticker,
        portfolio,
        currency,
        currentPrice,
        profitLoss,
        profitLossPercent,
        plType
      };
    });
  }, [allTransactions, allHoldings, quotes]);

  // Filters
  const filteredTransactions = useMemo(() => {
    return enrichedTransactions.filter(tx => {
      // 1. Search Query Ticker Filter
      const matchesSearch = tx.ticker.toLowerCase().includes(searchQuery.trim().toLowerCase());
      
      // 2. Transacton Type Filter
      const matchesType = typeFilter === 'all' || tx.type === typeFilter;
      
      // 3. Portfolio Tab Filter
      let matchesPortfolio = true;
      if (tabFilter === 'active') {
        matchesPortfolio = tx.portfolio === activeTab;
      } else if (tabFilter !== 'all') {
        matchesPortfolio = tx.portfolio === tabFilter;
      }

      return matchesSearch && matchesType && matchesPortfolio;
    });
  }, [enrichedTransactions, searchQuery, typeFilter, tabFilter, activeTab]);

  // Sorting
  const sortedTransactions = useMemo(() => {
    const list = [...filteredTransactions];
    list.sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (sortField) {
        case 'date':
          valA = new Date(a.date).getTime();
          valB = new Date(b.date).getTime();
          break;
        case 'ticker':
          valA = a.ticker;
          valB = b.ticker;
          break;
        case 'type':
          valA = a.type;
          valB = b.type;
          break;
        case 'shares':
          valA = a.shares;
          valB = b.shares;
          break;
        case 'price':
          valA = a.price;
          valB = b.price;
          break;
        case 'total':
          valA = a.shares * a.price;
          valB = b.shares * b.price;
          break;
        case 'profitLoss':
          valA = a.profitLoss;
          valB = b.profitLoss;
          break;
        default:
          valA = a.date;
          valB = b.date;
      }

      if (typeof valA === 'string') {
        return sortDirection === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        return sortDirection === 'asc'
          ? (valA > valB ? 1 : -1)
          : (valA < valB ? 1 : -1);
      }
    });

    return list;
  }, [filteredTransactions, sortField, sortDirection]);

  // Handle Recording a New Transaction
  const handleRecordTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onToastError('Please log in to record transactions.');
      return;
    }

    let inputTicker = ticker.trim().toUpperCase();
    if (!inputTicker || !shares || !price) {
      onToastError('Please fill in all transaction requirements.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Automatic suffixes for index types
      if (portfolioType === 'australia' && !inputTicker.includes('.') && inputTicker !== 'CASH') {
        inputTicker = `${inputTicker}.AX`;
      }

      const finalTicker = inputTicker;
      const isCash = finalTicker === 'CASH';
      const numShares = parseFloat(shares.replace(/,/g, '.'));
      const numPrice = isCash ? 1 : parseFloat(price.replace(/,/g, '.'));
      const isSell = txType === 'sell';

      if (isNaN(numShares) || isNaN(numPrice) || numShares <= 0 || numPrice < 0) {
        throw new Error('Valid numeric inputs are required for quantity and price.');
      }

      // Check if holding already exists for the User in this Tab
      const existingHolding = allHoldings.find(h => 
        h.ticker === finalTicker && 
        (h.portfolioType || 'global') === portfolioType
      );

      let holdingId = '';

      if (existingHolding) {
        holdingId = existingHolding.id;
        let newShares = isSell ? existingHolding.shares - numShares : existingHolding.shares + numShares;
        
        let newAvgPrice = existingHolding.avg_price;
        if (!isSell) {
          // Average Cost Basis Update Logic: (existingTotalCost + newCost) / newShares
          const totalCost = (existingHolding.shares * existingHolding.avg_price) + (numShares * numPrice);
          newAvgPrice = newShares > 0 ? (totalCost / newShares) : 0;
        }

        await updateDoc(doc(db, 'holdings', existingHolding.id), {
          shares: newShares,
          avg_price: newAvgPrice,
          updatedAt: serverTimestamp()
        });
      } else {
        // Create a new holding
        const newHolding = {
          ticker: finalTicker,
          shares: isSell ? -numShares : numShares,
          avg_price: numPrice,
          avgPriceCurrency: formCurrency,
          userId: user.uid,
          portfolioType: portfolioType,
          updatedAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(db, 'holdings'), newHolding);
        holdingId = docRef.id;
      }

      // Record the transaction document
      await addDoc(collection(db, 'transactions'), {
        holdingId: holdingId,
        type: txType,
        shares: numShares,
        price: numPrice,
        date: new Date(date).toISOString(),
        userId: user.uid
      });

      // Handle CASHLOG balancing automatically (Except for manual cash operations)
      if (!isCash) {
        const cashValue = numShares * numPrice;
        const cashHolding = allHoldings.find(h => 
          h.ticker === 'CASH' && 
          (h.portfolioType || 'global') === portfolioType
        );

        if (cashHolding) {
          // Spend cash if buy stock (-), get cash if sell stock (+)
          const newCashShares = isSell ? cashHolding.shares + cashValue : cashHolding.shares - cashValue;
          await updateDoc(doc(db, 'holdings', cashHolding.id), {
            shares: newCashShares,
            updatedAt: serverTimestamp()
          });

          await addDoc(collection(db, 'transactions'), {
            holdingId: cashHolding.id,
            type: isSell ? 'buy' : 'sell', // buy cash if selling stock, sell cash if buying stock
            shares: cashValue,
            price: 1,
            date: new Date(date).toISOString(),
            userId: user.uid
          });
        } else {
          // Create cash holding
          const cashHoldingRef = await addDoc(collection(db, 'holdings'), {
            ticker: 'CASH',
            shares: isSell ? cashValue : -cashValue,
            avg_price: 1,
            avgPriceCurrency: formCurrency,
            userId: user.uid,
            portfolioType: portfolioType,
            updatedAt: serverTimestamp()
          });

          await addDoc(collection(db, 'transactions'), {
            holdingId: cashHoldingRef.id,
            type: isSell ? 'buy' : 'sell',
            shares: cashValue,
            price: 1,
            date: new Date(date).toISOString(),
            userId: user.uid
          });
        }
      }

      onToastSuccess(`Successfully recorded transaction: ${txType.toUpperCase()} ${numShares} ${finalTicker}`);
      
      // Reset input fields
      setTicker('');
      setShares('');
      setPrice('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setTxType('buy');
    } catch (err: any) {
      console.error('Error recording transaction:', err);
      onToastError(err instanceof Error ? err.message : 'Error experienced recording stock transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Revert/Delete Transaction (Undo Transaction)
  const handleUndoTransaction = async (tx: any) => {
    if (!user) return;
    setIsUndoing(true);

    try {
      const isBuy = tx.type === 'buy';
      const numShares = tx.shares;
      const numPrice = tx.price;

      // Find original holding
      const matchedHolding = allHoldings.find(h => h.id === tx.holdingId);
      if (!matchedHolding) {
        throw new Error("Associated holding has catalog issues or has been deleted.");
      }

      // Recalculate back
      let newShares = isBuy ? matchedHolding.shares - numShares : matchedHolding.shares + numShares;

      if (newShares < 0) {
        throw new Error("Undoing this transaction leaves stock balance negative. Please fix downstream entries first.");
      }

      let newAvgPrice = matchedHolding.avg_price;
      if (isBuy) {
        if (newShares > 0) {
          const currentTotalCost = matchedHolding.shares * matchedHolding.avg_price;
          const txTotalCost = numShares * numPrice;
          newAvgPrice = (currentTotalCost - txTotalCost) / newShares;
        } else {
          newAvgPrice = 0;
        }
      }

      // Update Holding in Firestore
      await updateDoc(doc(db, 'holdings', matchedHolding.id), {
        shares: newShares,
        avg_price: newAvgPrice,
        updatedAt: serverTimestamp()
      });

      // Remove transaction doc
      await deleteDoc(doc(db, 'transactions', tx.id));

      // Handle Cash holding reversal backwards as well
      if (matchedHolding.ticker !== 'CASH') {
        const cashValue = numShares * numPrice;
        const cashHolding = allHoldings.find(h => 
          h.ticker === 'CASH' && 
          (h.portfolioType || 'global') === matchedHolding.portfolioType
        );

        if (cashHolding) {
          // If buy was undone, return cash balance (+), if sell undone, withdraw cash (-)
          const newCashShares = isBuy ? cashHolding.shares + cashValue : cashHolding.shares - cashValue;
          await updateDoc(doc(db, 'holdings', cashHolding.id), {
            shares: newCashShares,
            updatedAt: serverTimestamp()
          });

          // Add compensatory cash log
          await addDoc(collection(db, 'transactions'), {
            holdingId: cashHolding.id,
            type: isBuy ? 'buy' : 'sell',
            shares: cashValue,
            price: 1,
            date: new Date().toISOString(),
            userId: user.uid
          });
        }
      }

      onToastSuccess("Transaction reversed successfully.");
      setConfirmUndoId(null);
    } catch (err: any) {
      console.error(err);
      onToastError(err instanceof Error ? err.message : "Reversing transaction failed.");
    } finally {
      setIsUndoing(false);
    }
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  return (
    <div className="overflow-hidden flex flex-col h-full" id="root-transactions-widget">
      {/* Header section */}
      <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3 bg-zinc-50/50">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-500" />
          <div>
            <h3 className="font-semibold text-zinc-900 text-sm md:text-base">Transactions Registry</h3>
            <p className="text-xs text-zinc-500">Record transactions, export whole history, and filter archives</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Export Dropdown */}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu(prev => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
              title="Export Transactions"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export History</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl shadow-xl border border-zinc-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3 py-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  Whole History ({enrichedTransactions.length})
                </div>
                <button
                  type="button"
                  onClick={() => handleExportTransactions('csv', 'all')}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Export Whole History (CSV)</span>
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400">.csv</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportTransactions('json', 'all')}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-indigo-50 hover:text-indigo-800 flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Export Whole History (JSON)</span>
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400">.json</span>
                </button>

                {sortedTransactions.length !== enrichedTransactions.length && (
                  <>
                    <div className="my-1 border-t border-zinc-100" />
                    <div className="px-3 py-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      Filtered View ({sortedTransactions.length})
                    </div>
                    <button
                      type="button"
                      onClick={() => handleExportTransactions('csv', 'filtered')}
                      className="w-full text-left px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 flex items-center gap-2 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Export Filtered (CSV)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportTransactions('json', 'filtered')}
                      className="w-full text-left px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 flex items-center gap-2 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Export Filtered (JSON)</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddForm(prev => !prev)}
            className="flex items-center gap-1 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAddForm ? 'Close Form' : 'New Transaction'}
          </button>
        </div>
      </div>

      {/* Transaction Entry Form */}
      {showAddForm && (
        <form onSubmit={handleRecordTransaction} className="p-6 bg-zinc-50 border-b border-zinc-200 space-y-4 animate-in fade-in slide-in-from-top duration-200">
          <div className="font-semibold text-xs text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-zinc-400" />
            Record Stock Transaction
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Portfolio Segment</label>
              <select
                className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={portfolioType}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setPortfolioType(val);
                  
                  // Adjust currencies based on selected portfolio segments
                  if (val === 'australia') setFormCurrency('AUD');
                  else setFormCurrency('USD');
                }}
              >
                <option value="global">Global Portfolio (USD)</option>
                <option value="australia">Australia Portfolio (AUD)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Action Type</label>
              <div className="flex bg-zinc-200/50 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setTxType('buy')}
                  className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all ${txType === 'buy' ? 'bg-white text-emerald-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('sell')}
                  className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all ${txType === 'sell' ? 'bg-white text-rose-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  SELL
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Ticker / Stock symbol</label>
              <input
                type="text"
                required
                placeholder="e.g. AAPL, Reliance, MSFT"
                className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Transaction Date</label>
              <input
                type="date"
                required
                className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Quantity (Shares)</label>
              <input
                type="text"
                inputMode="decimal"
                required
                placeholder="0.00"
                className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Price per share</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-mono text-sm leading-none">
                  {getCurrencySymbol(formCurrency)}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  className="w-full bg-white border border-zinc-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold text-sm py-2 px-4 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Recording...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Record Transaction
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filtering Bar */}
      <div className="px-6 py-4 bg-zinc-50/50 border-b border-zinc-200 flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search by stock symbol..."
            className="w-full bg-white border border-zinc-200 rounded-xl pl-9 pr-4 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-zinc-900"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Filters Selects */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center gap-1 text-xs text-zinc-500">
            <Filter className="w-3 h-3" />
            <span>Type:</span>
          </div>
          <select
            className="bg-white border border-zinc-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="all">All Types</option>
            <option value="buy">Buys</option>
            <option value="sell">Sells</option>
          </select>

          <div className="flex items-center gap-1 text-xs text-zinc-500 ml-1.5">
            <Globe className="w-3 h-3" />
            <span>Portfolio:</span>
          </div>
          <select
            className="bg-white border border-zinc-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none"
            value={tabFilter}
            onChange={(e) => setTabFilter(e.target.value)}
          >
            <option value="active">Active Tab ({(activeTab || '').toUpperCase()})</option>
            <option value="all">All Combined</option>
            <option value="global">Global Segment</option>
            <option value="australia">Australia Segment</option>
          </select>
        </div>
      </div>

      {/* Table Section */}
      <div className="flex-1 overflow-x-auto">
        {sortedTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-500 h-64">
            <FileText className="w-12 h-12 text-zinc-300 mb-3" />
            <p className="font-medium text-sm">No recorded transactions match the filter criteria.</p>
            <p className="text-xs text-zinc-400 mt-1">Try resetting the search filter or add a new transaction.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">
                <th className="px-6 py-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort('date')}>
                  <div className="flex items-center gap-1">
                    Date
                    <ArrowUpDown className="w-3 h-3 text-zinc-400" />
                  </div>
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort('ticker')}>
                  <div className="flex items-center gap-1">
                    Asset / Ticker
                    <ArrowUpDown className="w-3 h-3 text-zinc-400" />
                  </div>
                </th>
                <th className="px-6 py-3 text-left">Segment</th>
                <th className="px-6 py-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort('type')}>
                  <div className="flex items-center gap-1">
                    Type
                    <ArrowUpDown className="w-3 h-3 text-zinc-400" />
                  </div>
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-zinc-100 text-right" onClick={() => toggleSort('shares')}>
                  <div className="flex items-center justify-end gap-1">
                    Shares
                    <ArrowUpDown className="w-3 h-3 text-zinc-400" />
                  </div>
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-zinc-100 text-right" onClick={() => toggleSort('price')}>
                  <div className="flex items-center justify-end gap-1">
                    Price
                    <ArrowUpDown className="w-3 h-3 text-zinc-400" />
                  </div>
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-zinc-100 text-right" onClick={() => toggleSort('total')}>
                  <div className="flex items-center justify-end gap-1">
                    Total Amount
                    <ArrowUpDown className="w-3 h-3 text-zinc-400" />
                  </div>
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-zinc-100 text-right" onClick={() => toggleSort('profitLoss')}>
                  <div className="flex items-center justify-end gap-1">
                    Profit / Loss
                    <ArrowUpDown className="w-3 h-3 text-zinc-400" />
                  </div>
                </th>
                <th className="px-6 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 text-xs">
              {sortedTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-zinc-50/50 transition-all group">
                  <td className="px-6 py-3.5 text-zinc-900 whitespace-nowrap">
                    {new Date(tx.date).toLocaleDateString(undefined, { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </td>
                  <td className="px-6 py-3.5 font-bold text-zinc-900 uppercase">
                    {tx.ticker}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      tx.portfolio === 'australia' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                      'bg-slate-50 text-slate-700 border border-slate-100'
                    }`}>
                      {tx.portfolio}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex items-center gap-1 font-semibold ${tx.type === 'buy' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tx.type === 'buy' ? (
                        <>
                          <TrendingUp className="w-3.5 h-3.5 stroke-[2.5px]" />
                          <span>BUY</span>
                        </>
                      ) : (
                        <>
                          <TrendingDown className="w-3.5 h-3.5 stroke-[2.5px]" />
                          <span>SELL</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono font-medium text-zinc-900">
                    {tx.shares.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono text-zinc-900">
                    {formatCurrency(tx.price, tx.currency)}
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono font-semibold text-zinc-950">
                    {formatCurrency(tx.shares * tx.price, tx.currency)}
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono">
                    <div className={`inline-flex items-center justify-end gap-1 font-semibold text-xs ${tx.profitLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tx.profitLoss >= 0 ? <TrendingUp className="w-3.5 h-3.5 stroke-[2.5px]" /> : <TrendingDown className="w-3.5 h-3.5 stroke-[2.5px]" />}
                      <span>{tx.profitLoss >= 0 ? '+' : '-'}{formatCurrency(Math.abs(tx.profitLoss), tx.currency)}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[10px] mt-0.5">
                      <span className="text-zinc-400 font-sans">{tx.plType === 'realized' ? 'Realized' : 'Unrealized'}</span>
                      <span className={`font-medium ${tx.profitLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ({tx.profitLoss >= 0 ? '+' : ''}{tx.profitLossPercent.toFixed(2)}%)
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-center">
                    {confirmUndoId === tx.id ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleUndoTransaction(tx)}
                          disabled={isUndoing}
                          className="bg-emerald-50 text-emerald-700 p-1 rounded-md hover:bg-emerald-100 transition-colors"
                          title="Confirm Reversal"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmUndoId(null)}
                          disabled={isUndoing}
                          className="bg-rose-50 text-rose-700 p-1 rounded-md hover:bg-rose-100 transition-colors"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmUndoId(tx.id)}
                        className="text-zinc-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Delete / Undo Stock Transaction"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer statistics segment mapping inside the table */}
      <div className="border-t border-zinc-200 px-6 py-3.5 bg-zinc-50/70 text-zinc-500 font-mono text-[10px] flex justify-between items-center whitespace-nowrap">
        <div>
          Showing <strong>{sortedTransactions.length}</strong> transactions
        </div>
        <div>
          Filtered by Tab: <strong className="uppercase">{tabFilter === 'active' ? activeTab : tabFilter}</strong>
        </div>
      </div>
    </div>
  );
}
