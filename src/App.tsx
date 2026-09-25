import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ScatterChart, Scatter, ZAxis, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Plus, Trash2, AlertCircle, AlertTriangle, DollarSign, PieChart as PieChartIcon, Briefcase, UploadCloud, FileText, Loader2, Edit2, Check, X, BarChart2, Save, ChevronUp, ChevronDown, LineChart, Zap, ExternalLink, Calendar as CalendarIcon, ChevronLeft, ChevronRight, ScatterChart as ScatterChartIcon, Maximize2, Minimize2, GripHorizontal, RefreshCw, Settings, User as UserIcon, PlusCircle, Undo2, Download, Upload, History, Activity, Bell, Sun, Moon, Grid, Eye, Globe, Key, Cpu, Sparkles, Lock, Sliders, EyeOff, RotateCcw } from 'lucide-react';
import { format, isSameMonth, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, addMonths, subMonths, subYears, parseISO } from 'date-fns';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Chart } from "react-google-charts";
import { motion, useAnimation } from 'motion/react';
import Papa from 'papaparse';
import { 
  AIProvider, 
  AIUserConfig, 
  DEFAULT_AI_CONFIG, 
  POPULAR_AI_MODELS, 
  PROVIDER_INFO 
} from './types';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  addDoc, 
  addDocs,
  withBatchedUpdates,
  updateDoc,
  serverTimestamp,
  User,
  handleFirestoreError,
  OperationType
} from './backend';
import { StatCard, AllocationChart, PortfolioSummary, AnimatedCountUp } from './components/DashboardComponents';
import { PerformanceChart } from './components/PerformanceChart';
import { HistoricalPriceChart } from './components/HistoricalPriceChart';
import { WatchlistSparkline } from './components/WatchlistSparkline';
import { StockSearch } from './components/StockSearch';
import { CompanyLogo } from './components/CompanyLogo';
import { CorporateLogoScatterPoint } from './components/CorporateLogoScatterPoint';
import PriceAlertsWidget, { PriceAlert } from './components/PriceAlertsWidget';
import SectorHeatmapWidget from './components/SectorHeatmapWidget';
import TransactionsWidget from './components/TransactionsWidget';
import { TradingViewChartWithSkeleton } from './components/TradingViewChartWithSkeleton';
import { EditHoldingModal } from './components/EditHoldingModal';
import { computeHoldingFromTransactions } from './utils/portfolioCalculations';
import { Toaster, toast } from 'sonner';
import { BotStatus, clearBotPortfolio, closeBotPosition, onBotStatus, refreshBotPortfolio, runBotHousekeeping } from './botPortfolio';
import { BotPortfolioView } from './components/BotPortfolioView';
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import { formatCurrency, getCurrencySymbol } from './lib/currency';
import { calculateGroupFearGreed } from './lib/fearGreed';

const getExchangeRate = (fromCurrency: string, toCurrency: string, quotes: any) => {
  if (fromCurrency === toCurrency) return 1;
  
  const getRateToUSD = (currency: string) => {
    if (currency === 'USD') return 1;
    
    // Handle GBp (pence)
    if (currency === 'GBp') {
      const gbpRate = quotes['GBP=X']?.price || (1 / 0.79);
      return (1 / gbpRate) / 100; // Convert pence to GBP, then to USD
    }

    const rate = quotes[`${currency}=X`]?.price;
    if (rate) return 1 / rate;
    
    if (currency === 'AUD') return 1 / 1.5;
    if (currency === 'INR') return 1 / 83.0;
    if (currency === 'EUR') return 1 / 0.92;
    if (currency === 'GBP') return 1 / 0.79;
    if (currency === 'CAD') return 1 / 1.35;
    if (currency === 'SGD') return 1 / 1.34;
    return 1;
  };

  return getRateToUSD(fromCurrency) * (1 / getRateToUSD(toCurrency));
};


// A helper component to wrap cell contents and pulse on value change
function PulseCell({ value, children, className }: { value: number; children: React.ReactNode; className?: string }) {
  const prevValueRef = useRef<number | null>(null);
  const controls = useAnimation();

  useEffect(() => {
    if (value != null && !isNaN(value) && prevValueRef.current !== null && !isNaN(prevValueRef.current) && value !== prevValueRef.current) {
      const isIncrease = value > prevValueRef.current;
      
      // Determine glow/flash color
      const highlightColor = isIncrease 
        ? "rgba(16, 185, 129, 0.2)" // emerald (green)
        : "rgba(239, 68, 68, 0.2)"; // rose (red)

      controls.start({
        backgroundColor: [
          "rgba(0, 0, 0, 0)",
          highlightColor,
          "rgba(0, 0, 0, 0)"
        ],
        scale: [1, 1.05, 1],
        transition: { duration: 0.6, ease: "easeInOut" }
      });
    }
    if (value != null && !isNaN(value)) {
      prevValueRef.current = value;
    }
  }, [value, controls]);

  return (
    <motion.div
      animate={controls}
      className={cn("inline-flex flex-col items-end px-1.5 py-0.5 rounded transition-colors duration-150", className)}
    >
      {children}
    </motion.div>
  );
}


// Memoized Holding Row Component
const HoldingRow = React.memo(({ 
  holding, 
  metadata, 
  editingId, 
  editTicker,
  editShares, 
  editAvgPrice,
  editAvgPriceCurrency,
  setEditTicker,
  setEditShares,
  setEditAvgPrice,
  setEditAvgPriceCurrency,
  handleSaveEdit,
  handleCancelEdit,
  handleEditClick,
  promptAnalysisStrategy,
  setSelectedChartTicker,
  handleViewHistory,
  handleDelete,
  handleQuickAddClick,
  getMarketStateBadge,
  CompanyLogo,
  activeCurrency
}: any) => {
  return (
    <tr 
      className="hover:bg-zinc-100/50 hover:shadow-sm transition-all duration-200 cursor-pointer group/row"
      onClick={() => setSelectedChartTicker(holding.ticker)}
    >
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <CompanyLogo ticker={holding.ticker} logo={metadata[holding.ticker]?.logo} />
          {editingId === holding.id ? (
            <input
              type="text"
              value={editTicker}
              onChange={(e) => setEditTicker(e.target.value)}
              className="w-24 px-2 py-1 border border-zinc-300 rounded focus:outline-none focus:ring-1 focus:ring-zinc-900 uppercase"
              placeholder="Ticker"
            />
          ) : (
            <div className="font-semibold text-zinc-900 group-hover/row:text-indigo-600 transition-colors">{holding.ticker}</div>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-right font-mono text-sm" onClick={(e) => e.stopPropagation()}>
        {editingId === holding.id ? (
          <input
            type="text"
            inputMode="decimal"
            value={editShares}
            onChange={(e) => setEditShares(e.target.value)}
            className="w-24 px-2 py-1 border border-zinc-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-zinc-900"
            min="0.00001"
            step="any"
          />
        ) : (
          holding.ticker === 'CASH' ? formatCurrency(holding.shares, holding.avgPriceCurrency || activeCurrency) : holding.shares.toLocaleString()
        )}
      </td>
      <td className="px-6 py-4 text-right font-mono text-sm" onClick={(e) => e.stopPropagation()}>
        {editingId === holding.id ? (
          <div className="flex items-center justify-end gap-1">
            <select
              value={editAvgPriceCurrency}
              onChange={(e) => setEditAvgPriceCurrency(e.target.value)}
              className="px-1 py-1 border border-zinc-300 rounded focus:outline-none focus:ring-1 focus:ring-zinc-900 bg-white"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="AUD">AUD</option>
              <option value="CAD">CAD</option>
              <option value="INR">INR</option>
              <option value="SGD">SGD</option>
            </select>
            {editTicker?.toUpperCase() !== 'CASH' && (
              <input
                type="text"
                inputMode="decimal"
                value={editAvgPrice}
                onChange={(e) => setEditAvgPrice(e.target.value)}
                className="w-24 px-2 py-1 border border-zinc-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-zinc-900"
                min="0.01"
                step="any"
              />
            )}
          </div>
        ) : (
          holding.ticker === 'CASH' ? '-' : formatCurrency(holding.displayAvgPrice, activeCurrency)
        )}
      </td>
      <td className="px-6 py-4 text-right font-mono text-sm">
        {formatCurrency(holding.costBasis, activeCurrency)}
      </td>
      <td className="px-6 py-4 text-right font-mono text-sm font-medium">
        <div className="flex items-center justify-end">
          {holding.ticker === 'CASH' ? '-' : formatCurrency(holding.currentPrice, activeCurrency)}
          {getMarketStateBadge((holding as any).marketState)}
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        {holding.ticker === 'CASH' ? (
          <span className="text-zinc-400">-</span>
        ) : (
          <PulseCell value={holding.dayChange} className="items-end">
            <div className={cn(
              "inline-flex items-center gap-1 font-medium text-sm",
              holding.dayChange >= 0 ? "text-emerald-600" : "text-rose-600"
            )}>
              {holding.dayChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {holding.dayChange >= 0 ? '+' : '-'}{Math.abs(holding.dayChangePercent).toFixed(2)}%
            </div>
            <div className={cn(
              "text-xs mt-0.5 font-mono",
              holding.dayChange >= 0 ? "text-emerald-600/70" : "text-rose-600/70"
            )}>
              {formatCurrency(holding.dayChange, activeCurrency, true)}
            </div>
          </PulseCell>
        )}
      </td>
      <td className="px-6 py-4 text-right font-mono text-sm font-medium">
        {formatCurrency(holding.currentValue, activeCurrency)}
      </td>
      <td className="px-6 py-4 text-right">
        {holding.ticker === 'CASH' ? (
          <span className="text-zinc-400">-</span>
        ) : (
          <PulseCell value={holding.profitLoss} className="items-end">
            <div className={cn(
              "inline-flex items-center gap-1 font-medium text-sm",
              holding.profitLoss >= 0 ? "text-emerald-600" : "text-rose-600"
            )}>
              {holding.profitLoss >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {holding.profitLoss >= 0 ? '+' : '-'}{Math.abs(holding.profitLossPercent).toFixed(2)}%
            </div>
            <div className={cn(
              "text-xs mt-0.5 font-mono",
              holding.profitLoss >= 0 ? "text-emerald-600/70" : "text-rose-600/70"
            )}>
              {formatCurrency(holding.profitLoss, activeCurrency, true)}
            </div>
          </PulseCell>
        )}
      </td>
      <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        {editingId === holding.id ? (
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => handleSaveEdit(holding.id)}
              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Save changes"
            >
              <Check size={16} />
            </button>
            <button
              onClick={handleCancelEdit}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              title="Cancel edit"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                promptAnalysisStrategy(holding.ticker);
              }}
              className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Analyze Stock"
            >
              <Zap size={16} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleQuickAddClick(holding);
              }}
              className="p-1.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Add More Quantity"
            >
              <PlusCircle size={16} />
            </button>
            <button
              onClick={() => handleEditClick(holding)}
              className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
              title="Edit holding"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => setSelectedChartTicker(holding.ticker)}
              className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="View Chart"
            >
              <LineChart size={16} />
            </button>
            <button
              onClick={() => handleViewHistory(holding)}
              className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="View History"
            >
              <FileText size={16} />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Are you sure you want to delete ${holding.ticker}?`)) {
                  handleDelete(holding.id);
                }
              }}
              className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              title="Delete stock"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
});

HoldingRow.displayName = 'HoldingRow';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type SortKey = 'ticker' | 'shares' | 'avg_price' | 'displayAvgPrice' | 'costBasis' | 'currentPrice' | 'dayChange' | 'currentValue' | 'profitLoss' | 'growthMultiple' | 'realizedProfitLoss' | 'marketCap' | 'allocation' | 'manual';

interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  avgPriceCurrency?: string;
  userId: string;
  portfolioType?: 'global' | 'australia' | 'bot';
  updatedAt?: any;
  order?: number;
  // Enriched properties
  displayAvgPrice?: number;
  currentPrice?: number;
  currentValue?: number;
  costBasis?: number;
  profitLoss?: number;
  profitLossPercent?: number;
  dayChange?: number;
  dayChangePercent?: number;
  marketState?: string;
}

interface Quotes {
  [ticker: string]: {
    price: number;
    previousClose: number;
    marketState?: string;
    changePercent?: number;
    ytdReturn?: number;
    currency?: string;
  };
}

interface Transaction {
  id: string;
  holdingId: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  date: string;
  userId: string;
  lotId?: string;
  avgPriceCurrency?: string;
}

interface EarningsEvent {
  symbol: string;
  date: string;
  estimate?: number;
  high?: number;
  low?: number;
}

interface DividendEvent {
  symbol: string;
  dividendRate?: number;
  dividendYield?: number;
  exDividendDate?: string;
  dividendDate?: string;
  payoutRatio?: number;
  fiveYearAvgDividendYield?: number;
}

const CustomTooltip = ({ active, payload, label, activeCurrency, metadata }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const value = data.value || 0;
    const profitLoss = data.profitLoss || 0;
    const cost = data.cost ?? (value - profitLoss);
    const name = data.name || label;
    const ticker = (name || '').toString().toUpperCase();
    const logoUrl = metadata?.[ticker]?.logo || metadata?.[name]?.logo || (ticker && ticker !== 'CASH' ? `/api/logo/${ticker}` : undefined);
    
    return (
      <div className="bg-white dark:bg-zinc-900 p-4 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-xl min-w-[210px] z-50">
        <div className="flex items-center gap-2.5 mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
          {ticker !== 'CASH' && (
            <CompanyLogo ticker={ticker} logo={logoUrl} size="sm" />
          )}
          <div className="overflow-hidden">
            <p className="font-bold text-zinc-900 dark:text-zinc-100 leading-tight truncate">{name}</p>
            {metadata?.[ticker]?.industry && metadata[ticker].industry !== 'Unknown' && (
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight mt-0.5 truncate">{metadata[ticker].industry}</p>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-500" />
              <span className="text-zinc-500">Cost:</span>
            </div>
            <span className="font-mono font-bold text-zinc-900">
              {formatCurrency(cost, activeCurrency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-zinc-500">Value:</span>
            </div>
            <span className="font-mono font-bold text-zinc-900">
              {formatCurrency(value, activeCurrency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", profitLoss >= 0 ? 'bg-emerald-500' : 'bg-rose-500')} />
              <span className="text-zinc-500">Profit/Loss:</span>
            </div>
            <span className={cn("font-mono font-bold", profitLoss >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {formatCurrency(profitLoss, activeCurrency, true)}
            </span>
          </div>
          <div className="pt-2 border-t border-zinc-50 mt-1">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold">
              <span className="text-zinc-400">Return %:</span>
              <span className={profitLoss >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                {cost > 0 ? ((profitLoss / cost) * 100).toFixed(2) : '0.00'}%
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

const hasExactTime = (dateStr: string | undefined): boolean => {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  } catch (e) {
    return false;
  }
};

const formatEarningsTime = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    
    // Format in Melbourne Time (AEST / AEDT)
    const melbourneFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Australia/Melbourne',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
    const melbourneTimeStr = melbourneFormatter.format(d); // e.g. "6:00 AM AEST" or "6:00 AM AEDT"
    
    // Convert to US Eastern Time to determine US market session (BMO or AMC)
    const estTimeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const estParts = estTimeFormatter.formatToParts(d);
    const estHour = parseInt(estParts.find(p => p.type === 'hour')?.value || '0');
    const estMinute = parseInt(estParts.find(p => p.type === 'minute')?.value || '0');
    
    let session = '';
    if (estHour < 9 || (estHour === 9 && estMinute <= 30)) {
      session = ' (BMO)'; // Before Market Open
    } else if (estHour >= 16) {
      session = ' (AMC)'; // After Market Close
    } else {
      session = ' (During Market)';
    }

    return `${melbourneTimeStr}${session}`;
  } catch (e) {
    return '';
  }
};

const getEventDateKey = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  if (typeof dateStr === 'string' && dateStr.includes('T')) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const melbourneDateFormatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Australia/Melbourne',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        return melbourneDateFormatter.format(d); // YYYY-MM-DD in Melbourne
      }
    } catch (e) {
      // fallback
    }
  }
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  try {
    const d = parseISO(dateStr);
    if (!isNaN(d.getTime())) {
      const melbourneDateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return melbourneDateFormatter.format(d);
    }
    return format(d, 'yyyy-MM-dd');
  } catch (e) {
    return dateStr;
  }
};

const formatEventDateStr = (dateStr: string | undefined, formatPattern: string = 'MMMM d, yyyy'): string => {
  if (!dateStr) return '';
  const dateKey = getEventDateKey(dateStr);
  const parts = dateKey.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    const localD = new Date(parts[0], parts[1] - 1, parts[2]);
    return format(localD, formatPattern);
  }
  try {
    return format(parseISO(dateStr), formatPattern);
  } catch (e) {
    return dateStr;
  }
};

const EditEarningsEventModal = ({
  isOpen,
  onClose,
  initialEvent,
  holdings,
  onSave,
  onReset
}: {
  isOpen: boolean;
  onClose: () => void;
  initialEvent: Partial<EarningsEvent> | null;
  holdings: Holding[];
  onSave: (event: EarningsEvent) => void;
  onReset?: (symbol: string) => void;
}) => {
  const [symbol, setSymbol] = useState('');
  const [date, setDate] = useState('');
  const [session, setSession] = useState<'AMC' | 'BMO' | 'CUSTOM'>('AMC');
  const [customTime, setCustomTime] = useState('20:00');
  const [estimate, setEstimate] = useState('');

  useEffect(() => {
    if (initialEvent) {
      setSymbol(initialEvent.symbol || '');
      const rawDate = initialEvent.date ? getEventDateKey(initialEvent.date) : format(new Date(), 'yyyy-MM-dd');
      setDate(rawDate);
      setEstimate(initialEvent.estimate !== undefined && initialEvent.estimate !== null ? String(initialEvent.estimate) : '');
      if (initialEvent.date && initialEvent.date.includes('T')) {
        const timePart = initialEvent.date.split('T')[1]?.substring(0, 5);
        if (timePart === '20:00') setSession('AMC');
        else if (timePart === '11:00' || timePart === '12:00') setSession('BMO');
        else {
          setSession('CUSTOM');
          setCustomTime(timePart || '16:00');
        }
      } else {
        setSession('AMC');
      }
    }
  }, [initialEvent, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !date) return;

    let isoDate = date;
    if (session === 'AMC') {
      isoDate = `${date}T20:00:00.000Z`; // 4:00 PM EDT / 8:00 PM UTC
    } else if (session === 'BMO') {
      isoDate = `${date}T11:00:00.000Z`; // 7:00 AM EDT / 11:00 AM UTC
    } else if (customTime) {
      isoDate = `${date}T${customTime}:00.000Z`;
    }

    onSave({
      symbol: symbol.toUpperCase().trim(),
      date: isoDate,
      estimate: estimate ? parseFloat(estimate) : undefined,
      high: initialEvent?.high,
      low: initialEvent?.low
    });
    onClose();
  };

  const tickerOptions = Array.from(new Set(holdings.map(h => h.ticker).filter(t => t !== 'CASH')));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-zinc-100">
        <div className="p-5 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <CalendarIcon size={18} />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Set / Correct Earnings Date</h3>
              <p className="text-xs text-zinc-500">Override calendar date for any holding</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-100">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Ticker Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. GOOGL, AAPL, MSFT"
              required
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
            />
            {tickerOptions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-[10px] text-zinc-400 self-center">Holdings:</span>
                {tickerOptions.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSymbol(t)}
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded-md font-semibold transition-colors",
                      symbol === t ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Earnings Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Timing / Market Session</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSession('AMC')}
                className={cn(
                  "py-2 px-2 text-xs rounded-xl font-semibold border text-center transition-all",
                  session === 'AMC' ? "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                )}
              >
                After Market (AMC)
              </button>
              <button
                type="button"
                onClick={() => setSession('BMO')}
                className={cn(
                  "py-2 px-2 text-xs rounded-xl font-semibold border text-center transition-all",
                  session === 'BMO' ? "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                )}
              >
                Before Open (BMO)
              </button>
              <button
                type="button"
                onClick={() => setSession('CUSTOM')}
                className={cn(
                  "py-2 px-2 text-xs rounded-xl font-semibold border text-center transition-all",
                  session === 'CUSTOM' ? "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                )}
              >
                Specific Time
              </button>
            </div>
            {session === 'CUSTOM' && (
              <input
                type="time"
                value={customTime}
                onChange={e => setCustomTime(e.target.value)}
                className="mt-2 w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">EPS Estimate (Optional)</label>
            <input
              type="number"
              step="0.01"
              value={estimate}
              onChange={e => setEstimate(e.target.value)}
              placeholder="e.g. 3.01"
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="pt-3 flex items-center justify-between border-t border-zinc-100">
            {onReset && initialEvent?.symbol ? (
              <button
                type="button"
                onClick={() => {
                  if (initialEvent.symbol) {
                    onReset(initialEvent.symbol);
                    onClose();
                  }
                }}
                className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
              >
                Reset Default
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-100 transition-all flex items-center gap-1.5"
              >
                <Check size={14} />
                Save Event
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

const FinancialCalendar = ({ 
  earningsEvents, 
  metadata, 
  className, 
  onResize, 
  onRemove, 
  size, 
  activeCurrency, 
  onEarningsClick,
  onRemoveEvent,
  onEditEvent,
  hasHiddenEvents,
  onRestoreEvents
}: { 
  earningsEvents: EarningsEvent[], 
  metadata: any, 
  className?: string, 
  onResize?: () => void, 
  onRemove?: () => void, 
  size?: number, 
  activeCurrency: string, 
  onEarningsClick?: (event: EarningsEvent) => void,
  onRemoveEvent?: (symbol: string, date: string) => void,
  onEditEvent?: (event: Partial<EarningsEvent>) => void,
  hasHiddenEvents?: boolean,
  onRestoreEvents?: () => void
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const earningsByDate = useMemo(() => {
    const map: Record<string, EarningsEvent[]> = {};
    earningsEvents.forEach(event => {
      const dateKey = getEventDateKey(event.date);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(event);
    });
    return map;
  }, [earningsEvents]);

  const handleExport = () => {
    if (earningsEvents.length === 0) return;
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Stock Portfolio Tracker//Earnings Calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Earnings Calendar\r\nX-WR-TIMEZONE:UTC\r\n';
    earningsEvents.forEach(event => {
      if (!event.date) return;
      const dateKey = getEventDateKey(event.date);
      const date = new Date(event.date);
      const dateStr = dateKey.replace(/-/g, '');
      const dtstamp = new Date().toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:${event.symbol}-earnings-${dateStr}@stocktracker\r\n`;
      ics += `DTSTAMP:${dtstamp}\r\n`;
      
      if (hasExactTime(event.date)) {
        const dateTimeStr = date.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        ics += `DTSTART:${dateTimeStr}\r\n`;
        const endDate = new Date(date.getTime() + 60 * 60 * 1000); // 1 hour duration
        const endDateTimeStr = endDate.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        ics += `DTEND:${endDateTimeStr}\r\n`;
      } else {
        ics += `DTSTART;VALUE=DATE:${dateStr}\r\n`;
      }
      
      ics += `SUMMARY:${event.symbol} Earnings\r\n`;
      ics += `DESCRIPTION:Estimated EPS: ${event.estimate || 'N/A'}\\nHigh: ${event.high || 'N/A'}\\nLow: ${event.low || 'N/A'}\r\n`;
      ics += 'END:VEVENT\r\n';
    });
    ics += 'END:VCALENDAR\r\n';
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'earnings.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("flex flex-col flex-1 h-full", className)}>
      <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg transition-colors bg-indigo-600 shadow-indigo-100">
              <CalendarIcon size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Financial Calendar</h2>
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <span>Corporate Earnings</span>
                <span className="text-zinc-300">•</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200/50">
                  <Globe size={11} />
                  Melbourne Time (AEST/AEDT)
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onEditEvent && (
            <button
              onClick={() => onEditEvent({ symbol: '', date: format(new Date(), 'yyyy-MM-dd') })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
              title="Add or correct earnings date"
            >
              <Edit2 className="w-4 h-4" />
              <span>Correct Date</span>
            </button>
          )}

          {hasHiddenEvents && onRestoreEvents && (
            <button
              onClick={onRestoreEvents}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
              title="Restore all hidden calendar events"
            >
              <Undo2 className="w-4 h-4" />
              <span>Restore Removed</span>
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={earningsEvents.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
            title="Export to Calendar (.ics)"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export Calendar</span>
          </button>

          {onResize && (
            <button 
              onClick={onResize} 
              className="p-2 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity relative z-20"
              title="Resize Widget"
            >
              {size === 3 ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {onRemove && (
            <button 
              onClick={onRemove} 
              className="p-2 text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-opacity relative z-20"
              title="Remove Widget"
            >
              <X size={16} />
            </button>
          )}

          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-zinc-200 shadow-sm">
            <button onClick={prevMonth} className="p-2 hover:bg-zinc-50 rounded-lg transition-colors text-zinc-600">
              <ChevronLeft size={20} />
            </button>
            <span className="px-4 font-bold text-zinc-900 min-w-[140px] text-center">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <button onClick={nextMonth} className="p-2 hover:bg-zinc-50 rounded-lg transition-colors text-zinc-600">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto resize-y min-h-[400px]">
        <div className="grid grid-cols-7 border-b border-zinc-100 bg-zinc-50/30">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="py-3 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {calendarDays.map((day, i) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const eEvents = earningsByDate[dateKey] || [];
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());

            const todayColor = "bg-indigo-50/30";
            const badgeColor = isToday ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" : "text-zinc-500";

            return (
              <div 
                key={i} 
                className={cn(
                  "min-h-[140px] p-2 border-r border-b border-zinc-100 transition-colors relative group/cell",
                  !isCurrentMonth && "bg-zinc-50/30",
                  isToday && todayColor
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={cn(
                    "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full",
                    badgeColor,
                    !isCurrentMonth && "opacity-30"
                  )}>
                    {format(day, 'd')}
                  </span>
                  {onEditEvent && (
                    <button
                      onClick={() => onEditEvent({ symbol: '', date: dateKey })}
                      className="opacity-0 group-hover/cell:opacity-100 transition-opacity p-1 hover:bg-indigo-50 rounded text-zinc-400 hover:text-indigo-600 text-[10px]"
                      title={`Add event on ${dateKey}`}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {eEvents.map((event, idx) => (
                    <div 
                      key={`earn-${idx}`}
                      onClick={() => onEarningsClick && onEarningsClick(event)}
                      className={cn(
                        "group relative flex items-center gap-1.5 p-1.5 rounded-lg bg-white border border-zinc-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all pr-12",
                        onEarningsClick ? "cursor-pointer" : "cursor-default"
                      )}
                      title={`${event.symbol} Earnings Announcement\nDate: ${formatEventDateStr(event.date)}${hasExactTime(event.date) ? `\nTime: ${formatEarningsTime(event.date)}` : ''}`}
                    >
                      <CompanyLogo ticker={event.symbol} logo={metadata[event.symbol]?.logo} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-[10px] font-bold text-zinc-900 truncate">{event.symbol}</div>
                          {hasExactTime(event.date) && (
                            <span className="text-[8px] px-1 py-0.5 bg-indigo-50 text-indigo-600 rounded font-semibold font-sans whitespace-nowrap">
                              {formatEarningsTime(event.date).split(' ').slice(0, 2).join(' ')}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          {hasExactTime(event.date) && (
                            <div className="text-[8px] text-indigo-500 font-medium font-sans">
                              {formatEarningsTime(event.date).split(' ').slice(2).join(' ')}
                            </div>
                          )}
                          {event.estimate && (
                            <div className="text-[8px] text-zinc-500 font-mono">
                              EST: {getCurrencySymbol(activeCurrency)}{event.estimate.toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        {onEditEvent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditEvent(event);
                            }}
                            className="bg-white hover:bg-indigo-50 hover:text-indigo-600 p-1 rounded-full text-zinc-400 border border-zinc-150 shadow-sm"
                            title={`Edit ${event.symbol} earnings date`}
                          >
                            <Edit2 size={10} className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {onRemoveEvent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveEvent(event.symbol, event.date);
                            }}
                            className="bg-white hover:bg-rose-50 hover:text-rose-600 p-1 rounded-full text-zinc-400 border border-zinc-150 shadow-sm"
                            title={`Remove ${event.symbol} from calendar`}
                          >
                            <Trash2 size={10} className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const TRADINGVIEW_STUDIES = [
  "Volume@tv-basicstudies",
  "VbPFixed@tv-volumebyprice" as any,
  "VbPVisible@tv-volumebyprice" as any
];

const getInvestingTheme = (holding: any, metadata: Record<string, any>): string => {
  const ticker = (holding?.ticker || '').toUpperCase().trim();
  if (ticker === 'CASH' || ticker.startsWith('CASH')) {
    return 'Cash & Liquid Reserves';
  }

  const meta = metadata[holding?.ticker] || metadata[ticker] || {};
  const sector = (meta.sector || '').toLowerCase();
  const industry = (meta.industry || '').toLowerCase();
  const name = (holding?.name || meta.name || '').toLowerCase();

  // 1. Crypto & Web3 Ecosystem
  if (
    (holding as any)?.isCrypto ||
    ticker.endsWith('-USD') ||
    sector === 'cryptocurrency' ||
    ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'COIN', 'BMNR', 'MSTR', 'MARA', 'RIOT', 'BITO', 'SUI', 'PEPE', 'SHIB', 'NEAR'].includes(ticker)
  ) {
    return 'Crypto & Web3 Ecosystem';
  }

  // 2. Semiconductors & AI Hardware
  if (
    ['NVDA', 'AMD', 'TSM', 'INTC', 'AVGO', 'ARM', 'ASML', 'QCOM', 'MU', 'LRCX', 'AMAT', 'SMCI', 'ON', 'MRVL', 'TXN', 'ADI', 'MPWR', 'KLAC'].includes(ticker) ||
    industry.includes('semiconductor') ||
    industry.includes('chip')
  ) {
    return 'Semiconductors & AI Hardware';
  }

  // 3. Artificial Intelligence & Big Tech
  if (
    ['MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'AAPL', 'PLTR', 'PATH', 'AI', 'CRWD', 'PANW', 'SNOW', 'ORCL', 'CRM', 'ADBE', 'NOW', 'IBM', 'DELL', 'HPE'].includes(ticker) ||
    industry.includes('software') ||
    industry.includes('cloud') ||
    industry.includes('artificial intelligence') ||
    name.includes('cloud') ||
    name.includes('software')
  ) {
    return 'Artificial Intelligence & Big Tech';
  }

  // 4. Clean Energy & Autonomous Mobility
  if (
    ['TSLA', 'RIVN', 'LCID', 'NIO', 'XPEV', 'BYD', 'ENPH', 'SEDG', 'FSLR', 'RUN', 'PLUG', 'NEST', 'BE', 'BLNK', 'CHPT'].includes(ticker) ||
    industry.includes('electric vehicle') ||
    industry.includes('solar') ||
    industry.includes('clean energy') ||
    industry.includes('renewable')
  ) {
    return 'Clean Energy & Autonomous Mobility';
  }

  // 5. Defense, Aerospace & Security
  if (
    ['LMT', 'RTX', 'NOC', 'GD', 'BA', 'ITA', 'XAR', 'PPA', 'KTOS', 'HWM', 'RHM', 'LHX'].includes(ticker) ||
    industry.includes('aerospace') ||
    industry.includes('defense')
  ) {
    return 'Defense, Aerospace & Security';
  }

  // 6. Healthcare, Biotech & Longevity
  if (
    ['JNJ', 'PFE', 'UNH', 'LLY', 'NVO', 'ABBV', 'MRK', 'AMGN', 'GILD', 'ISRG', 'MODA', 'VRTX', 'REGN', 'AZN', 'BMY'].includes(ticker) ||
    sector.includes('health') ||
    industry.includes('biotech') ||
    industry.includes('pharmaceutical') ||
    industry.includes('medical')
  ) {
    return 'Healthcare, Biotech & Longevity';
  }

  // 7. Banking, Payments & Fintech
  if (
    ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'V', 'MA', 'PYPL', 'SQ', 'HOOD', 'AXP', 'BLK', 'FINN', 'NU'].includes(ticker) ||
    sector.includes('financial') ||
    industry.includes('bank') ||
    industry.includes('fintech') ||
    industry.includes('credit')
  ) {
    return 'Banking, Payments & Fintech';
  }

  // 8. Energy & Hard Assets
  if (
    ['XOM', 'CVX', 'SHEL', 'TTE', 'COP', 'SLB', 'HAL', 'OXY', 'EQNR', 'GLD', 'SLV', 'IAU', 'USO', 'DBA', 'RIO', 'BHP', 'VALE', 'FCX', 'NEM'].includes(ticker) ||
    sector.includes('energy') ||
    sector.includes('basic materials') ||
    industry.includes('oil') ||
    industry.includes('mining') ||
    industry.includes('gold') ||
    industry.includes('metal')
  ) {
    return 'Energy & Hard Assets';
  }

  // 9. Real Estate & Infrastructure
  if (
    ['O', 'AMT', 'CCI', 'PLD', 'EQIX', 'SPG', 'WY', 'DLR', 'VNQ', 'IYR'].includes(ticker) ||
    sector.includes('real estate') ||
    industry.includes('reit')
  ) {
    return 'Real Estate & Infrastructure';
  }

  // 10. Consumer Brands & Retail
  if (
    ['WMT', 'COST', 'TGT', 'PG', 'KO', 'PEP', 'DIS', 'NFLX', 'SBUX', 'NKE', 'MCD', 'HD', 'LOW', 'CMG', 'BKNG', 'ABNB', 'MELI'].includes(ticker) ||
    sector.includes('consumer') ||
    industry.includes('retail') ||
    industry.includes('beverage') ||
    industry.includes('restaurant')
  ) {
    return 'Consumer Brands & Retail';
  }

  // 11. ETFs & Index Funds
  if (
    ['SPY', 'QQQ', 'IVV', 'VOO', 'VTI', 'IWM', 'EFA', 'VEA', 'VWO', 'SCHD', 'JEPI', 'XYLD', 'VYM', 'VT', 'SPLG', 'DIA', 'NIFTY50', '^NSEI'].includes(ticker) ||
    industry.includes('etf') ||
    sector.includes('etf') ||
    sector.includes('index')
  ) {
    return 'ETFs & Index Funds';
  }

  if (meta.sector && meta.sector !== 'Unknown') {
    return meta.sector;
  }

  return 'Global Growth & Diversified';
};

const SortableHeader = ({ id, label, sortKey, align, sortConfig, onSort }: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  const isActive = sortConfig?.key === sortKey;

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={cn("px-6 py-4 font-medium select-none group relative bg-zinc-50/50", align === 'right' ? "text-right" : "text-left")}
    >
      <div className={cn("flex items-center gap-1", align === 'right' ? "justify-end" : "justify-start")}>
        <div 
          {...attributes} 
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-zinc-400 hover:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripHorizontal className="w-3 h-3" />
        </div>
        <div className="cursor-pointer flex items-center gap-1" onClick={() => onSort(sortKey)}>
          {label}
          {isActive ? (
            sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4 opacity-0 group-hover:opacity-20 transition-opacity" />
          )}
        </div>
      </div>
    </th>
  );
};

const SortableHoldingRow = ({ 
  holding, 
  columnOrder, 
  renderCell, 
  editingId, 
  setSelectedChartTicker, 
  handleSaveEdit, 
  handleCancelEdit, 
  promptAnalysisStrategy, 
  handleEditClick, 
  handleViewHistory, 
  handleDelete,
  isSortable = true
}: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: holding.id, disabled: !isSortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr 
      ref={setNodeRef}
      style={style}
      className={cn(
        "hover:bg-zinc-100/50 hover:shadow-sm transition-all duration-200 group/row relative",
        editingId === holding.id ? "cursor-default" : "cursor-pointer",
        isDragging && "bg-white shadow-xl ring-1 ring-zinc-200"
      )}
      onClick={() => {
        if (editingId !== holding.id) {
          setSelectedChartTicker(holding.ticker);
        }
      }}
    >
      {isSortable && (
        <td className="w-8 px-2 py-4">
          <div 
            {...attributes} 
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 text-zinc-300 hover:text-zinc-500 opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <GripHorizontal className="w-4 h-4" />
          </div>
        </td>
      )}
      {columnOrder.map((colId: string) => renderCell(colId, holding))}
      <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        {editingId === holding.id ? (
          <div className="flex items-center justify-center gap-1 relative z-20">
            <button
              onClick={() => handleSaveEdit(holding.id)}
              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Save changes"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={handleCancelEdit}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              title="Cancel edit"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1 relative z-20">
            <button
              onClick={(e) => {
                e.stopPropagation();
                promptAnalysisStrategy(holding.ticker);
              }}
              className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Analyze Stock"
            >
              <Zap className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleEditClick(holding)}
              className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
              title="Edit holding"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectedChartTicker(holding.ticker)}
              className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="View Chart"
            >
              <LineChart className="w-4 h-4" />
            </button>
            {holding.ticker !== 'CASH' && holding.shares > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewHistory(holding);
                }}
                className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                title="Sell Specific Lot"
              >
                <TrendingDown className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => handleViewHistory(holding)}
              className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="View History"
            >
              <FileText className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(holding.id)}
              className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              title="Remove holding"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
};

const SortableWidget = ({ id, className, children, onDoubleClick }: { id: string, className?: string, children: React.ReactNode, onDoubleClick?: () => void }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 110 : 'auto',
    opacity: isDragging ? 0.5 : 1,
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as Element;
    // Don't trigger if clicking interactive elements or table rows
    if (
      !target.closest?.('button') && 
      !target.closest?.('input') && 
      !target.closest?.('select') && 
      !target.closest?.('textarea') && 
      !target.closest?.('label') && 
      !target.closest?.('a') && 
      !target.closest?.('tr') &&
      !target.closest?.('.recharts-wrapper')
    ) {
      onDoubleClick?.();
    }
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={cn(
        "bg-white rounded-2xl border border-zinc-200 shadow-sm flex flex-col relative group", 
        className
      )}
      onDoubleClick={handleDoubleClick}
      {...attributes}
    >
      <div 
        className="absolute top-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-zinc-400 hover:text-zinc-600 z-20 p-1 bg-white/90 backdrop-blur-sm rounded-md shadow-sm border border-zinc-100" 
        {...attributes} 
        {...listeners}
      >
        <GripHorizontal className="w-4 h-4" />
      </div>
      {children}
    </div>
  );
};

const SettingsModal = ({ 
  isOpen, 
  onClose, 
  tabSettings, 
  userSettings, 
  activeTab, 
  onSave, 
  isSaving,
  initialTab = 'profile'
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  tabSettings: any, 
  userSettings: any, 
  activeTab: string, 
  onSave: (tabs: any, user: any, autoClose?: boolean) => Promise<void>, 
  isSaving: boolean,
  initialTab?: 'profile' | 'ai' | 'portfolios'
}) => {
  const [activeModalTab, setActiveModalTab] = useState<'profile' | 'ai' | 'portfolios'>(initialTab);
  const [localTabSettings, setLocalTabSettings] = useState(tabSettings);
  const [localUserSettings, setLocalUserSettings] = useState(userSettings);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});

  const syncedTabsRef = useRef(JSON.stringify(tabSettings));
  const syncedUserRef = useRef(JSON.stringify(userSettings));
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (isOpen) {
      setActiveModalTab(initialTab);
      const initialUser = {
        displayName: '',
        avatarUrl: '',
        showCombinedSummary: true,
        combinedCurrency: 'USD',
        combinedBenchmark: 'SPY',
        autoSave: false,
        darkMode: false,
        aiConfig: {
          ...DEFAULT_AI_CONFIG,
          ...(userSettings?.aiConfig || {})
        },
        ...userSettings
      };
      setLocalTabSettings(tabSettings);
      setLocalUserSettings(initialUser);
      setSyncStatus('idle');

      syncedTabsRef.current = JSON.stringify(tabSettings);
      syncedUserRef.current = JSON.stringify(initialUser);
    }
  }, [tabSettings, userSettings, isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;

    const localTabsStr = JSON.stringify(localTabSettings);
    const localUserStr = JSON.stringify(localUserSettings);

    const tabsChanged = localTabsStr !== syncedTabsRef.current;
    const userChanged = localUserStr !== syncedUserRef.current;

    if (tabsChanged || userChanged) {
      if (localUserSettings.autoSave) {
        setSyncStatus('saving');
        const timer = setTimeout(async () => {
          try {
            await onSaveRef.current(localTabSettings, localUserSettings, false);
            syncedTabsRef.current = localTabsStr;
            syncedUserRef.current = localUserStr;
            setSyncStatus('saved');
          } catch (err) {
            console.error('Auto-save failed:', err);
            setSyncStatus('error');
          }
        }, 1200);
        return () => clearTimeout(timer);
      } else {
        setSyncStatus('idle');
      }
    } else {
      if (syncStatus !== 'saved' && syncStatus !== 'saving') {
        setSyncStatus('idle');
      }
    }
  }, [localTabSettings, localUserSettings, isOpen, syncStatus]);

  if (!isOpen) return null;

  const handleTabSettingChange = (tab: string, key: string, value: any) => {
    setLocalTabSettings((prev: any) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        [key]: value
      }
    }));
  };

  const handleUserSettingChange = (key: string, value: any) => {
    setLocalUserSettings((prev: any) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleAiConfigChange = (key: keyof AIUserConfig, value: any) => {
    setLocalUserSettings((prev: any) => {
      const currentAi = prev.aiConfig || DEFAULT_AI_CONFIG;
      const updatedAi = {
        ...currentAi,
        [key]: value
      };

      // If provider changes and current model doesn't match new provider, auto-pick default model for that provider
      if (key === 'provider') {
        const matchingModels = POPULAR_AI_MODELS.filter(m => m.provider === value);
        if (matchingModels.length > 0) {
          updatedAi.model = matchingModels[0].id;
        } else if (value === 'custom') {
          updatedAi.model = updatedAi.customModelName || 'gpt-4o';
        }
      }

      return {
        ...prev,
        aiConfig: updatedAi
      };
    });
  };

  const toggleShowKey = (field: string) => {
    setShowKeys(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const currentAi = localUserSettings.aiConfig || DEFAULT_AI_CONFIG;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] border border-zinc-100 dark:border-zinc-800">
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 shadow-sm">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Preferences & Configuration</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage profile, AI models, and portfolios</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} className="text-zinc-400" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex border-b border-zinc-100 dark:border-zinc-800 px-6 pt-3 bg-zinc-50/30 dark:bg-zinc-900/50 gap-2">
          <button
            onClick={() => setActiveModalTab('profile')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition-all",
              activeModalTab === 'profile'
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            <UserIcon size={15} />
            Profile & Display
          </button>
          <button
            onClick={() => setActiveModalTab('ai')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition-all",
              activeModalTab === 'ai'
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            <Sparkles size={15} className="text-amber-500" />
            AI Intelligence & Models
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 uppercase font-extrabold tracking-tight">
              Claude / Gemini
            </span>
          </button>
          <button
            onClick={() => setActiveModalTab('portfolios')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition-all",
              activeModalTab === 'portfolios'
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            <Briefcase size={15} />
            Portfolios
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* TAB 1: User Profile & Display */}
          {activeModalTab === 'profile' && (
            <section className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Display Name</label>
                  <input 
                    type="text" 
                    value={localUserSettings.displayName}
                    onChange={(e) => handleUserSettingChange('displayName', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="Your name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Avatar URL</label>
                  <input 
                    type="text" 
                    value={localUserSettings.avatarUrl}
                    onChange={(e) => handleUserSettingChange('avatarUrl', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-2 flex items-center gap-3 pt-4">
                  <button
                    onClick={() => handleUserSettingChange('showCombinedSummary', !localUserSettings.showCombinedSummary)}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative flex-shrink-0",
                      localUserSettings.showCombinedSummary ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 bg-white rounded-full absolute top-1 transition-all",
                      localUserSettings.showCombinedSummary ? "left-7" : "left-1"
                    )} />
                  </button>
                  <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Show Combined Portfolio Summary</span>
                </div>
                <div className="space-y-2 flex items-center gap-3 pt-4">
                  <button
                    onClick={() => handleUserSettingChange('autoSave', !localUserSettings.autoSave)}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative flex-shrink-0",
                      localUserSettings.autoSave ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 bg-white rounded-full absolute top-1 transition-all",
                      localUserSettings.autoSave ? "left-7" : "left-1"
                    )} />
                  </button>
                  <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300 flex flex-col">
                    <span>Auto-save changes</span>
                    <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">Persist preferences instantly</span>
                  </span>
                </div>
                <div className="space-y-2 flex items-center gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => handleUserSettingChange('darkMode', !localUserSettings.darkMode)}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative flex-shrink-0",
                      localUserSettings.darkMode ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 bg-white rounded-full absolute top-1 transition-all",
                      localUserSettings.darkMode ? "left-7" : "left-1"
                    )} />
                  </button>
                  <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300 flex flex-col">
                    <span>Dark Mode Theme</span>
                    <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">Enable modern dark canvas theme</span>
                  </span>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Combined Portfolio Currency</label>
                  <select 
                    value={localUserSettings.combinedCurrency || 'USD'}
                    onChange={(e) => handleUserSettingChange('combinedCurrency', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="INR">INR (₹)</option>
                    <option value="AUD">AUD (A$)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="CAD">CAD (C$)</option>
                    <option value="SGD">SGD (S$)</option>
                  </select>
                </div>
              </div>
            </section>
          )}

          {/* TAB 2: AI Intelligence & Model Configuration */}
          {activeModalTab === 'ai' && (
            <section className="space-y-8">
              {/* Provider Selection */}
              <div>
                <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-3">
                  Default AI Provider
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(['anthropic', 'gemini', 'openai', 'deepseek', 'custom'] as AIProvider[]).map((p) => {
                    const info = PROVIDER_INFO[p];
                    const isSelected = currentAi.provider === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleAiConfigChange('provider', p)}
                        className={cn(
                          "p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all relative",
                          isSelected 
                            ? "border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20" 
                            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600"
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={cn("text-xs font-bold tracking-tight", info.color)}>
                            {info.name}
                          </span>
                          {isSelected && (
                            <div className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                              <Check size={10} strokeWidth={3} />
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                          {p === 'anthropic' && 'Claude 3.7 / 3.5 Sonnet'}
                          {p === 'gemini' && 'Gemini 3.1 Pro / 2.5'}
                          {p === 'openai' && 'GPT-4o / o3-mini'}
                          {p === 'deepseek' && 'DeepSeek V3 / R1'}
                          {p === 'custom' && 'Ollama / OpenRouter'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Model Selection */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                  Active Model
                </label>
                <div className="space-y-2">
                  <select
                    value={currentAi.model}
                    onChange={(e) => handleAiConfigChange('model', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  >
                    <optgroup label="Anthropic (Claude)">
                      {POPULAR_AI_MODELS.filter(m => m.provider === 'anthropic').map(m => (
                        <option key={m.id} value={m.id}>{m.name} {m.badge ? `— ${m.badge}` : ''}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Google Gemini">
                      {POPULAR_AI_MODELS.filter(m => m.provider === 'gemini').map(m => (
                        <option key={m.id} value={m.id}>{m.name} {m.badge ? `— ${m.badge}` : ''}</option>
                      ))}
                    </optgroup>
                    <optgroup label="OpenAI">
                      {POPULAR_AI_MODELS.filter(m => m.provider === 'openai').map(m => (
                        <option key={m.id} value={m.id}>{m.name} {m.badge ? `— ${m.badge}` : ''}</option>
                      ))}
                    </optgroup>
                    <optgroup label="DeepSeek">
                      {POPULAR_AI_MODELS.filter(m => m.provider === 'deepseek').map(m => (
                        <option key={m.id} value={m.id}>{m.name} {m.badge ? `— ${m.badge}` : ''}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Custom ID">
                      <option value="custom_model_id">Custom Model ID...</option>
                    </optgroup>
                  </select>

                  {/* If custom or selected custom ID */}
                  {(currentAi.provider === 'custom' || currentAi.model === 'custom_model_id') && (
                    <div className="mt-2 space-y-2">
                      <label className="text-[11px] font-semibold text-zinc-500">Custom Model Identifier</label>
                      <input
                        type="text"
                        value={currentAi.customModelName || ''}
                        onChange={(e) => {
                          handleAiConfigChange('customModelName', e.target.value);
                          if (currentAi.model === 'custom_model_id') {
                            handleAiConfigChange('model', e.target.value);
                          }
                        }}
                        placeholder="e.g. claude-3-7-sonnet-latest, mistral-large, llama3.3"
                        className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-mono"
                      />
                    </div>
                  )}

                  {/* Model Description Box */}
                  {(() => {
                    const matched = POPULAR_AI_MODELS.find(m => m.id === currentAi.model);
                    if (!matched) return null;
                    return (
                      <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                        <span>{matched.description}</span>
                        {matched.badge && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-semibold text-[10px] whitespace-nowrap ml-2">
                            {matched.badge}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* API Keys Configuration */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key size={16} className="text-indigo-600" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                      User API Keys (Stored Privately in your Profile)
                    </h4>
                  </div>
                  <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                    <Lock size={12} /> Encrypted & Private
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Anthropic Claude Key */}
                  <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        Anthropic API Key (Claude)
                      </label>
                      <span className="text-[10px] text-zinc-400">Optional user key</span>
                    </div>
                    <div className="relative">
                      <input
                        type={showKeys['anthropic'] ? 'text' : 'password'}
                        value={currentAi.anthropicApiKey || ''}
                        onChange={(e) => handleAiConfigChange('anthropicApiKey', e.target.value)}
                        placeholder="sk-ant-api03-..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-mono pr-10 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey('anthropic')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                      >
                        {showKeys['anthropic'] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="text-[10px] text-zinc-400">
                      Used when selecting Claude models. If empty, falls back to server environment variable if configured.
                    </p>
                  </div>

                  {/* OpenAI Key */}
                  <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        OpenAI API Key (ChatGPT / GPT-4o / o3-mini)
                      </label>
                      <span className="text-[10px] text-zinc-400">Optional user key</span>
                    </div>
                    <div className="relative">
                      <input
                        type={showKeys['openai'] ? 'text' : 'password'}
                        value={currentAi.openaiApiKey || ''}
                        onChange={(e) => handleAiConfigChange('openaiApiKey', e.target.value)}
                        placeholder="sk-proj-..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-mono pr-10 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey('openai')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                      >
                        {showKeys['openai'] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Google Gemini Key */}
                  <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
                        Google Gemini API Key
                      </label>
                      <span className="text-[10px] text-zinc-400">Optional override</span>
                    </div>
                    <div className="relative">
                      <input
                        type={showKeys['gemini'] ? 'text' : 'password'}
                        value={currentAi.geminiApiKey || ''}
                        onChange={(e) => handleAiConfigChange('geminiApiKey', e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-mono pr-10 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey('gemini')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                      >
                        {showKeys['gemini'] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Custom Endpoint (if custom is chosen) */}
                  {currentAi.provider === 'custom' && (
                    <div className="p-4 rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50/20 dark:bg-purple-950/20 space-y-3">
                      <label className="text-xs font-bold text-purple-700 dark:text-purple-400">
                        Custom OpenAI-Compatible Endpoint URL
                      </label>
                      <input
                        type="text"
                        value={currentAi.customEndpoint || ''}
                        onChange={(e) => handleAiConfigChange('customEndpoint', e.target.value)}
                        placeholder="https://api.openai.com/v1/chat/completions or http://localhost:11434/v1/chat/completions"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono"
                      />
                      <input
                        type={showKeys['custom'] ? 'text' : 'password'}
                        value={currentAi.customApiKey || ''}
                        onChange={(e) => handleAiConfigChange('customApiKey', e.target.value)}
                        placeholder="Custom API Key (optional for local Ollama)"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Analysis Preferences */}
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
                <div className="flex items-center gap-2">
                  <Sliders size={16} className="text-indigo-600" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                    Analysis Depth & Preferences
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'comprehensive', label: 'Comprehensive', desc: 'Deep macro, moat, valuation & risk analysis' },
                    { id: 'concise', label: 'Concise', desc: 'Fast, bulleted executive takeaway & actions' },
                    { id: 'technical', label: 'Valuation & Technical', desc: 'Financial multiples, levels, support & resistance' }
                  ].map(style => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => handleAiConfigChange('analysisStyle', style.id)}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all",
                        currentAi.analysisStyle === style.id
                          ? "border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200"
                          : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 text-zinc-700 dark:text-zinc-300"
                      )}
                    >
                      <div className="text-xs font-bold mb-1">{style.label}</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{style.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* TAB 3: Investment Portfolios */}
          {activeModalTab === 'portfolios' && (
            <section className="space-y-8">
              <div className="space-y-6">
                {['global', 'australia', 'bot'].map((tab) => (
                  <div key={tab} className={cn(
                    "p-6 rounded-2xl border transition-all",
                    activeTab === tab 
                      ? "bg-indigo-50/30 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-800 ring-1 ring-indigo-100 dark:ring-indigo-800" 
                      : "bg-white dark:bg-zinc-800/60 border-zinc-100 dark:border-zinc-700"
                  )}>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold text-zinc-900 dark:text-zinc-100 capitalize">{tab} Portfolio</h4>
                      {activeTab === tab && <span className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase tracking-tighter">Active</span>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Currency</label>
                        <select 
                          value={localTabSettings[tab]?.currency || (tab === 'australia' ? 'AUD' : 'USD')}
                          onChange={(e) => handleTabSettingChange(tab, 'currency', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                        >
                          <option value="USD">USD ($)</option>
                          <option value="INR">INR (₹)</option>
                          <option value="AUD">AUD (A$)</option>
                          <option value="EUR">EUR (€)</option>
                          <option value="GBP">GBP (£)</option>
                          <option value="CAD">CAD (C$)</option>
                          <option value="SGD">SGD (S$)</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Benchmark</label>
                        <input 
                          type="text" 
                          value={localTabSettings[tab]?.benchmark}
                          onChange={(e) => handleTabSettingChange(tab, 'benchmark', e.target.value.toUpperCase())}
                          className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Risk Profile</label>
                        <select 
                          value={localTabSettings[tab]?.riskProfile}
                          onChange={(e) => handleTabSettingChange(tab, 'riskProfile', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        >
                          <option value="conservative">Conservative</option>
                          <option value="moderate">Moderate</option>
                          <option value="aggressive">Aggressive</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Target Return (%)</label>
                        <input 
                          type="number" 
                          value={localTabSettings[tab]?.targetReturn}
                          onChange={(e) => handleTabSettingChange(tab, 'targetReturn', parseFloat(e.target.value))}
                          className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center min-h-[36px]">
            {localUserSettings.autoSave && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700 text-xs font-semibold shadow-sm transition-all duration-300">
                {syncStatus === 'saving' && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                    <span>Syncing changes...</span>
                  </>
                )}
                {syncStatus === 'saved' && (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 font-extrabold" />
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">All changes saved to cloud</span>
                  </>
                )}
                {syncStatus === 'error' && (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                    <span className="text-rose-700 dark:text-rose-400 font-bold">Error syncing changes</span>
                  </>
                )}
                {syncStatus === 'idle' && (
                  <>
                    <Check className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-zinc-500">Synced</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 justify-end">
            {localUserSettings.autoSave ? (
              <button 
                onClick={onClose}
                className="px-8 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center gap-2 shadow-lg shadow-zinc-200 dark:shadow-none text-sm"
              >
                <Check size={16} />
                Done
              </button>
            ) : (
              <>
                <button 
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => onSave(localTabSettings, localUserSettings, true)}
                  disabled={isSaving}
                  className="px-8 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center gap-2 shadow-lg shadow-zinc-200 dark:shadow-none disabled:opacity-50 text-sm"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save Settings
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const NO_TRANSACTIONS: never[] = [];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [allHoldings, setAllHoldings] = useState<Holding[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [txLoaded, setTxLoaded] = useState(false);

  // Transactions grouped by holding - once per transaction change, rather than
  // re-filtering the whole list per holding on every live price tick. Arrays keep
  // the original order; the sorted variant is ordered by date (stable). Treat both
  // as read-only: they are shared between the stats calculations.
  const { transactionsByHolding, sortedTransactionsByHolding } = useMemo(() => {
    const byHolding = new Map<string, typeof allTransactions>();
    for (const tx of allTransactions) {
      const list = byHolding.get(tx.holdingId);
      if (list) list.push(tx);
      else byHolding.set(tx.holdingId, [tx]);
    }
    const sorted = new Map<string, typeof allTransactions>();
    for (const [id, list] of byHolding) {
      const time = new Map(list.map(tx => [tx, new Date(tx.date).getTime()]));
      sorted.set(id, [...list].sort((a, b) => time.get(a)! - time.get(b)!));
    }
    return { transactionsByHolding: byHolding, sortedTransactionsByHolding: sorted };
  }, [allTransactions]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [activeTab, setActiveTab] = useState<'global' | 'australia' | 'bot'>('global');
  
  const holdings = useMemo(() => {
    return allHoldings.filter(h => (h.portfolioType || 'global') === activeTab);
  }, [allHoldings, activeTab]);

  const [quotes, setQuotes] = useState<Quotes>({});
  const [metadata, setMetadata] = useState<Record<string, { sector: string, industry: string, logo?: string, website?: string }>>({});
  const [earningsEvents, setEarningsEvents] = useState<EarningsEvent[]>([]);
  const [hiddenCalendarEvents, setHiddenCalendarEvents] = useState<string[]>([]);

  const [dividendEvents, setDividendEvents] = useState<DividendEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [formCurrency, setFormCurrency] = useState('');
  const [transactionDate, setTransactionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [transactionType, setTransactionType] = useState<'buy' | 'sell'>('buy');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Reset state
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTicker, setEditTicker] = useState('');
  const [editShares, setEditShares] = useState('');
  const [editAvgPrice, setEditAvgPrice] = useState('');
  const [editAvgPriceCurrency, setEditAvgPriceCurrency] = useState('');
  const [editField, setEditField] = useState<string | null>(null);
  const [editModalHolding, setEditModalHolding] = useState<Holding | null>(null);
  const [selectedChartTicker, setSelectedChartTicker] = useState<string | null>(null);
  const [chartModalTab, setChartModalTab] = useState<'chart' | 'kpis' | 'history'>('chart');
  const [showRsi, setShowRsi] = useState(false);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [kpiTimeScale, setKpiTimeScale] = useState<'5y' | '10y' | 'all_y' | '8q' | '12q' | '20q'>('5y');
  const [financialsData, setFinancialsData] = useState<any>(null);
  const [isFinancialsLoading, setIsFinancialsLoading] = useState(false);
  const [businessKpisData, setBusinessKpisData] = useState<any>(null);
  const [isBusinessKpisLoading, setIsBusinessKpisLoading] = useState(false);
  const [fearGreedData, setFearGreedData] = useState<any>(null);

  // History state
  const [historyHolding, setHistoryHolding] = useState<Holding | null>(null);
  const [historyTransactions, setHistoryTransactions] = useState<Transaction[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [sellingLot, setSellingLot] = useState<Transaction | null>(null);
  const [sellLotShares, setSellLotShares] = useState<number>(0);
  const [sellLotPrice, setSellLotPrice] = useState<number>(0);
  const [sellLotDate, setSellLotDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Portfolio Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string>('');
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddHolding, setQuickAddHolding] = useState<Holding | null>(null);
  const [quickAddShares, setQuickAddShares] = useState('');
  const [quickAddPrice, setQuickAddPrice] = useState('');
  const [quickAddDate, setQuickAddDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [analysisTicker, setAnalysisTicker] = useState<string | null>(null);
  const [analysisSources, setAnalysisSources] = useState<{uri: string, title: string}[]>([]);
  const [analysisSentiment, setAnalysisSentiment] = useState<string>('neutral');
  const [isSavingAnalysis, setIsSavingAnalysis] = useState(false);
  const [analysisSaved, setAnalysisSaved] = useState(false);
  const [analysisModelName, setAnalysisModelName] = useState<string>('');
  const [analysisProviderName, setAnalysisProviderName] = useState<AIProvider>('gemini');
  const [analysisErrorCode, setAnalysisErrorCode] = useState<string | null>(null);
  const [analysisErrorProvider, setAnalysisErrorProvider] = useState<string | null>(null);
  const [analysisFallbackNotice, setAnalysisFallbackNotice] = useState<string | null>(null);
  
  // Earnings Analysis state
  const [selectedEarningsEvent, setSelectedEarningsEvent] = useState<EarningsEvent | null>(null);
  const [isAnalyzingEarnings, setIsAnalyzingEarnings] = useState(false);
  const [earningsAnalysisResult, setEarningsAnalysisResult] = useState('');
  const [showEarningsAnalysisModal, setShowEarningsAnalysisModal] = useState(false);
  const [isSavingEarningsAnalysis, setIsSavingEarningsAnalysis] = useState(false);
  const [earningsAnalysisSaved, setEarningsAnalysisSaved] = useState(false);
  const [earningsAnalysisModelName, setEarningsAnalysisModelName] = useState<string>('');
  const [earningsAnalysisProviderName, setEarningsAnalysisProviderName] = useState<AIProvider>('gemini');
  const [earningsAnalysisErrorCode, setEarningsAnalysisErrorCode] = useState<string | null>(null);
  const [earningsAnalysisErrorProvider, setEarningsAnalysisErrorProvider] = useState<string | null>(null);
  const [earningsAnalysisFallbackNotice, setEarningsAnalysisFallbackNotice] = useState<string | null>(null);

  const [showEarningsAnalysisStrategyModal, setShowEarningsAnalysisStrategyModal] = useState(false);
  const [strategyEarningsEvent, setStrategyEarningsEvent] = useState<EarningsEvent | null>(null);
  const [selectedStrategyModel, setSelectedStrategyModel] = useState<string>('');
  const [selectedEarningsStrategyModel, setSelectedEarningsStrategyModel] = useState<string>('');
  const [settingsInitialTab, setSettingsInitialTab] = useState<'profile' | 'ai' | 'portfolios'>('profile');

  // Custom Earnings Events & Overrides state
  const [customCalendarEvents, setCustomCalendarEvents] = useState<EarningsEvent[]>([]);
  const [showEditEarningsModal, setShowEditEarningsModal] = useState(false);
  const [editingEarningsEvent, setEditingEarningsEvent] = useState<Partial<EarningsEvent> | null>(null);

  const promptEarningsAnalysisStrategy = (event: EarningsEvent) => {
    setStrategyEarningsEvent(event);
    setShowEarningsAnalysisStrategyModal(true);
  };

  // Chart state
  const [chartType, setChartType] = useState<'pie' | 'bar' | 'scatter'>('pie');
  const [chartView, setChartView] = useState<'asset' | 'industry'>('asset');
  const [showAllAllocation, setShowAllAllocation] = useState(false);
  const [hoveredScatterTicker, setHoveredScatterTicker] = useState<string | null>(null);
  const [deconflictScatter, setDeconflictScatter] = useState<boolean>(true);

  // Widget sizes state (1, 2, or 3 columns)
  const [widgetSizes, setWidgetSizes] = useState<Record<string, number>>(() => {
    const defaults = {
      allocation: 2,
      calendar: 2,
      holdings: 3,
      dividends: 3,
      addPosition: 1,
      transactions: 3,
      upload: 1,
      sectorHeatmap: 3,
    };
    const saved = localStorage.getItem('widgetSizes');
    if (saved) {
      try {
        return { ...defaults, ...JSON.parse(saved) };
      } catch (e) {
        console.error('Failed to parse widgetSizes from localStorage', e);
      }
    }
    return defaults;
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);

  useEffect(() => {
    const checkFullscreen = () => {
      // Check if window is approximately the size of the screen (fullscreen mode)
      const isFull = window.innerWidth >= window.screen.width - 10 && window.innerHeight >= window.screen.height - 10;
      
      if (isFull !== isFullscreenRef.current) {
        isFullscreenRef.current = isFull;
        setIsFullscreen(isFull);
        
        if (isFull) {
          // Automatically maximize all widgets in fullscreen
          setWidgetSizes({
            allocation: 3,
            calendar: 3,
            holdings: 3,
            addPosition: 3,
            upload: 3,
          });
        } else {
          // Restore from localStorage when exiting fullscreen
          const saved = localStorage.getItem('widgetSizes');
          if (saved) {
            try {
              setWidgetSizes(JSON.parse(saved));
            } catch (e) {}
          }
        }
      }
    };

    window.addEventListener('resize', checkFullscreen);
    // Initial check
    checkFullscreen();

    return () => window.removeEventListener('resize', checkFullscreen);
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      localStorage.setItem('widgetSizes', JSON.stringify(widgetSizes));
    }
  }, [widgetSizes, isFullscreen]);

  const [widgetOrder, setWidgetOrder] = useState(() => {
    const saved = localStorage.getItem('widgetOrder');
    const defaultOrder = [
      'performance',
      'allocation',
      'calendar',
      'holdings',
      'watchlist',
      'dividends',
      'addPosition',
      'transactions',
      'priceAlerts',
      'sectorHeatmap',
    ];
    let order = [...defaultOrder];
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Ensure mandatory widgets are present
          if (!parsed.includes('performance')) parsed.unshift('performance');
          if (!parsed.includes('holdings')) parsed.push('holdings');
          if (!parsed.includes('watchlist')) {
            const hIdx = parsed.indexOf('holdings');
            parsed.splice(hIdx + 1, 0, 'watchlist');
          }
          order = parsed;
        }
      } catch (e) {
        console.error('Failed to parse widgetOrder from localStorage', e);
      }
    }
    return order;
  });

  useEffect(() => {
    localStorage.setItem('widgetOrder', JSON.stringify(widgetOrder));
  }, [widgetOrder]);

  const [showAddWidget, setShowAddWidget] = useState(false);
  const addWidgetRef = useRef<HTMLDivElement>(null);
  const addWidgetBtnRef = useRef<HTMLButtonElement>(null);
  // Statement import (AI extraction from a broker PDF/CSV) lives in a toolbar dropdown.
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const importBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        addWidgetRef.current && 
        !addWidgetRef.current.contains(event.target as Node) &&
        addWidgetBtnRef.current &&
        !addWidgetBtnRef.current.contains(event.target as Node)
      ) {
        setShowAddWidget(false);
      }
      if (
        importMenuRef.current &&
        !importMenuRef.current.contains(event.target as Node) &&
        importBtnRef.current &&
        !importBtnRef.current.contains(event.target as Node)
      ) {
        setShowImportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const ALL_WIDGETS = [
    { id: 'performance', label: 'Performance vs Benchmarks' },
    { id: 'allocation', label: 'Portfolio Allocation' },
    { id: 'calendar', label: 'Financial Calendar' },
    { id: 'holdings', label: 'Current Holdings' },
    { id: 'watchlist', label: 'Watchlist' },
    { id: 'dividends', label: 'Dividends' },
    { id: 'addPosition', label: 'Add Position' },
    { id: 'transactions', label: 'Transactions Registry' },
    { id: 'priceAlerts', label: 'Price Alerts' },
    { id: 'sectorHeatmap', label: 'Sector Heatmap' },
  ];

  const removeWidget = (id: string) => {
    setWidgetOrder(prev => prev.filter(w => w !== id));
  };

  const handleSyncHistory = async () => {
    if (allHoldings.length === 0) return;
    
    setIsSyncingHistory(true);
    try {
      const tickers = Array.from(new Set(allHoldings.map(h => h.ticker)));
      const fiveYearsAgo = subYears(new Date(), 5);
      const fromStr = format(fiveYearsAgo, 'yyyy-MM-dd');
      
      const params = new URLSearchParams({
        symbols: tickers.join(','),
        from: fromStr,
        refresh: 'true'
      });
      
      const res = await fetch(`/api/historical-bulk?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to sync history');
      
      toast.success('Portfolio historical data (5Y) has been synced and cached locally.');
    } catch (err) {
      console.error('Error syncing history:', err);
      toast.error('Failed to sync historical data. Please try again later.');
    } finally {
      setIsSyncingHistory(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setWidgetOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const toggleWidgetSize = (widget: string) => {
    setWidgetSizes(prev => ({
      ...prev,
      [widget]: prev[widget as keyof typeof prev] === 3 ? 1 : (prev[widget as keyof typeof prev] || 3) + 1
    }));
  };

  const getWidgetClass = (id: string) => {
    const size = widgetSizes[id as keyof typeof widgetSizes] || 3;
    return cn(
      "flex flex-col relative group transition-all duration-300 ease-in-out",
      size === 1 ? "lg:col-span-1" : size === 2 ? "lg:col-span-2" : "lg:col-span-3"
    );
  };
  
  // Save state
  const [saveMessage, setSaveMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  // Sort state
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'currentValue', direction: 'desc' });
  const [tableGrouping, setTableGrouping] = useState<'none' | 'theme' | 'assetType' | 'sector' | 'industry' | 'marketCap'>('none');
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>([
    'ticker', 'fearGreed', 'shares', 'displayAvgPrice', 'costBasis', 'currentPrice', 'dayChange', 'currentValue', 'allocation', 'profitLoss', 'growthMultiple', 'realizedProfitLoss', 'marketCap'
  ]);

  // Settings state
  const [tabSettings, setTabSettings] = useState<Record<string, { benchmark: string, riskProfile: string, targetReturn: number, currency: string }>>({
    global: { benchmark: 'SPY', riskProfile: 'moderate', targetReturn: 8, currency: 'USD' },
    australia: { benchmark: '^AXJO', riskProfile: 'moderate', targetReturn: 7, currency: 'AUD' },
    bot: { benchmark: 'SPY', riskProfile: 'aggressive', targetReturn: 10, currency: 'USD' },
  });
  const [userSettings, setUserSettings] = useState<{ 
    displayName: string; 
    avatarUrl: string; 
    showCombinedSummary: boolean; 
    combinedCurrency: string; 
    combinedBenchmark: string; 
    autoSave?: boolean; 
    darkMode?: boolean;
    aiConfig?: AIUserConfig;
  }>({
    displayName: '',
    avatarUrl: '',
    showCombinedSummary: true,
    combinedCurrency: 'USD',
    combinedBenchmark: 'SPY',
    autoSave: false,
    darkMode: false,
    aiConfig: DEFAULT_AI_CONFIG
  });
  const [showSettings, setShowSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const resolveAiConfig = (modelOverride?: string, providerOverride?: AIProvider) => {
    const config: AIUserConfig = {
      ...DEFAULT_AI_CONFIG,
      ...(userSettings?.aiConfig || {})
    };

    let provider: AIProvider = providerOverride || config.provider || 'gemini';
    let model: string = modelOverride || config.model || 'gemini-2.5-flash';

    if (modelOverride && !providerOverride) {
      const matched = POPULAR_AI_MODELS.find(m => m.id === modelOverride);
      if (matched) {
        provider = matched.provider;
      } else if (modelOverride.startsWith('claude')) {
        provider = 'anthropic';
      } else if (modelOverride.startsWith('gpt') || modelOverride.startsWith('o1') || modelOverride.startsWith('o3')) {
        provider = 'openai';
      } else if (modelOverride.startsWith('deepseek')) {
        provider = 'deepseek';
      } else if (modelOverride.startsWith('gemini')) {
        provider = 'gemini';
      }
    }

    let apiKey = '';
    if (provider === 'anthropic') apiKey = config.anthropicApiKey || '';
    else if (provider === 'openai') apiKey = config.openaiApiKey || '';
    else if (provider === 'gemini') apiKey = config.geminiApiKey || '';
    else if (provider === 'deepseek') apiKey = config.deepseekApiKey || '';
    else if (provider === 'custom') apiKey = config.customApiKey || '';

    return {
      provider,
      model,
      apiKey,
      customEndpoint: config.customEndpoint || '',
      temperature: config.temperature ?? 0.7,
      analysisStyle: config.analysisStyle || 'comprehensive'
    };
  };

  const [showSavedAnalysesModal, setShowSavedAnalysesModal] = useState(false);
  const [savedAnalyses, setSavedAnalyses] = useState<any[]>([]);
  const [isFetchingAnalyses, setIsFetchingAnalyses] = useState(false);

  const [showAnalysisStrategyModal, setShowAnalysisStrategyModal] = useState(false);
  const [strategyTicker, setStrategyTicker] = useState<string | null>(null);

  const promptAnalysisStrategy = (ticker?: string) => {
    setStrategyTicker(ticker || null);
    setShowAnalysisStrategyModal(true);
  };

  const fetchSavedAnalyses = async (ticker?: string) => {
    setIsFetchingAnalyses(true);
    try {
      const url = ticker ? `/api/analyses?ticker=${encodeURIComponent(ticker)}` : '/api/analyses';
      const res = await fetch(url);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setSavedAnalyses(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingAnalyses(false);
    }
  };

  const deleteAnalysis = async (id: number) => {
    try {
      await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
      setSavedAnalyses(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const benchmarkTicker = tabSettings[activeTab]?.benchmark || 'SPY';
  const activeCurrency = tabSettings[activeTab]?.currency || (activeTab === 'australia' ? 'AUD' : 'USD');

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'settings', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.tabs) {
          const loadedTabs = { ...data.tabs };
          delete loadedTabs.india;
          delete loadedTabs.crypto;
          setTabSettings(loadedTabs);
        }
        setHiddenCalendarEvents(data.hiddenCalendarEvents || []);
        if (data.customCalendarEvents) setCustomCalendarEvents(data.customCalendarEvents);
        if (data.user) setUserSettings({
          displayName: data.user.displayName || '',
          avatarUrl: data.user.avatarUrl || '',
          showCombinedSummary: data.user.showCombinedSummary !== undefined ? data.user.showCombinedSummary : true,
          combinedCurrency: data.user.combinedCurrency || 'USD',
          combinedBenchmark: data.user.combinedBenchmark || 'SPY',
          autoSave: data.user.autoSave !== undefined ? data.user.autoSave : false,
          darkMode: data.user.darkMode !== undefined ? data.user.darkMode : false,
        });
        if (data.tableLayout) {
          if (data.tableLayout.columnOrder) {
            let loadedOrder = [...data.tableLayout.columnOrder];
            if (!loadedOrder.includes('growthMultiple')) {
              const pIdx = loadedOrder.indexOf('profitLoss');
              if (pIdx !== -1) {
                loadedOrder.splice(pIdx + 1, 0, 'growthMultiple');
              } else {
                loadedOrder.push('growthMultiple');
              }
            }
            setColumnOrder(loadedOrder);
          }
          if (data.tableLayout.tableGrouping) setTableGrouping(data.tableLayout.tableGrouping);
          if (data.tableLayout.sortConfig) setSortConfig(data.tableLayout.sortConfig);
        }
      } else {
        // Initialize default settings in Firestore
        setDoc(doc(db, 'settings', user.uid), {
          tabs: {
            global: { benchmark: 'SPY', riskProfile: 'moderate', targetReturn: 8, currency: 'USD' },
            australia: { benchmark: '^AXJO', riskProfile: 'moderate', targetReturn: 7, currency: 'AUD' },
            bot: { benchmark: 'SPY', riskProfile: 'aggressive', targetReturn: 10, currency: 'USD' }
          },
          hiddenCalendarEvents: [],
          user: {
            displayName: user.displayName || user.email?.split('@')[0] || 'Investor',
            avatarUrl: user.photoURL || '',
            showCombinedSummary: true,
            combinedCurrency: 'USD',
            combinedBenchmark: 'SPY',
            autoSave: false,
            darkMode: false,
          },
          tableLayout: {
            columnOrder: [
              'ticker', 'fearGreed', 'shares', 'displayAvgPrice', 'costBasis', 'currentPrice', 'dayChange', 'currentValue', 'allocation', 'profitLoss', 'growthMultiple', 'realizedProfitLoss', 'marketCap'
            ],
            tableGrouping: 'none',
            sortConfig: { key: 'currentValue', direction: 'desc' }
          }
        });
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (userSettings.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [userSettings.darkMode]);

  useEffect(() => {
    const fetchFearGreed = async () => {
      if (holdings.length === 0) return;
      
      const tickers = Array.from(new Set(holdings.map(h => h.ticker))).filter(t => t !== 'CASH');
      if (tickers.length === 0) return;

      try {
        const res = await fetch(`/api/fear-greed?symbols=${encodeURIComponent(tickers.join(','))}`);
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          setFearGreedData(data);
        }
      } catch (err) {
        console.error('Failed to fetch Fear & Greed index:', err);
      }
    };

    fetchFearGreed();
  }, [holdings.length, activeTab]);

  const toggleDarkMode = async () => {
    if (!user) {
      setUserSettings(prev => ({ ...prev, darkMode: !prev.darkMode }));
      return;
    }
    const updatedUserSettings = {
      ...userSettings,
      darkMode: !userSettings.darkMode
    };
    try {
      await setDoc(doc(db, 'settings', user.uid), {
        user: updatedUserSettings
      }, { merge: true });
      setUserSettings(updatedUserSettings);
    } catch (err) {
      console.error('Failed to toggle dark mode:', err);
    }
  };

  const handleSaveSettings = async (newTabSettings: any, newUserSettings: any, autoClose = true) => {
    if (!user) return;
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, 'settings', user.uid), {
        tabs: newTabSettings,
        user: newUserSettings
      }, { merge: true });
      
      setTabSettings(newTabSettings);
      setUserSettings(newUserSettings);

      if (autoClose) {
        setSaveMessage({ text: 'Settings saved', type: 'success' });
        setShowSettings(false);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      if (autoClose) {
        setSaveMessage({ text: 'Failed to save settings', type: 'error' });
      }
      throw error;
    } finally {
      setIsSavingSettings(false);
      if (autoClose) {
        setTimeout(() => setSaveMessage(null), 3000);
      }
    }
  };

  const [layoutSaveStatus, setLayoutSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const saveTableLayout = async (layout: { columnOrder?: string[], tableGrouping?: string, sortConfig?: any }) => {
    if (!user) return;
    setLayoutSaveStatus('saving');
    try {
      await setDoc(doc(db, 'settings', user.uid), {
        tableLayout: {
          columnOrder: layout.columnOrder !== undefined ? layout.columnOrder : columnOrder,
          tableGrouping: layout.tableGrouping !== undefined ? layout.tableGrouping : tableGrouping,
          sortConfig: layout.sortConfig !== undefined ? layout.sortConfig : sortConfig
        }
      }, { merge: true });
      setLayoutSaveStatus('saved');
      setTimeout(() => setLayoutSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save table layout:', err);
      setLayoutSaveStatus('error');
      setTimeout(() => setLayoutSaveStatus('idle'), 3000);
    }
  };

  const handleRemoveCalendarEvent = async (symbol: string, date: string) => {
    if (!user) return;
    try {
      const dateKey = getEventDateKey(date);
      const safeSym = (symbol || '').toUpperCase();
      const eventKey = `${safeSym}-${dateKey}`;
      const newHidden = [...hiddenCalendarEvents, eventKey];
      const newCustom = customCalendarEvents.filter(e => (e?.symbol || '').toUpperCase() !== safeSym);

      setHiddenCalendarEvents(newHidden);
      setCustomCalendarEvents(newCustom);

      await setDoc(doc(db, 'settings', user.uid), {
        hiddenCalendarEvents: newHidden,
        customCalendarEvents: newCustom
      }, { merge: true });
    } catch (err) {
      console.error('Failed to remove calendar event:', err);
    }
  };

  const handleSaveCustomCalendarEvent = async (event: EarningsEvent) => {
    if (!user) return;
    try {
      const cleanSymbol = (event?.symbol || '').toUpperCase().trim();
      const updatedEvent: EarningsEvent = {
        ...event,
        symbol: cleanSymbol,
      };

      const existingIndex = customCalendarEvents.findIndex(e => (e?.symbol || '').toUpperCase() === cleanSymbol);
      let newCustom: EarningsEvent[];
      if (existingIndex >= 0) {
        newCustom = [...customCalendarEvents];
        newCustom[existingIndex] = updatedEvent;
      } else {
        newCustom = [...customCalendarEvents, updatedEvent];
      }

      const dateKey = getEventDateKey(updatedEvent.date);
      const eventKey = `${cleanSymbol}-${dateKey}`;
      const newHidden = hiddenCalendarEvents.filter(k => k !== eventKey);

      setCustomCalendarEvents(newCustom);
      setHiddenCalendarEvents(newHidden);

      await setDoc(doc(db, 'settings', user.uid), {
        customCalendarEvents: newCustom,
        hiddenCalendarEvents: newHidden
      }, { merge: true });
    } catch (err) {
      console.error('Failed to save custom calendar event:', err);
    }
  };

  const handleResetCustomCalendarEvent = async (symbol: string) => {
    if (!user) return;
    try {
      const cleanSymbol = (symbol || '').toUpperCase().trim();
      const newCustom = customCalendarEvents.filter(e => (e?.symbol || '').toUpperCase() !== cleanSymbol);
      setCustomCalendarEvents(newCustom);

      await setDoc(doc(db, 'settings', user.uid), {
        customCalendarEvents: newCustom
      }, { merge: true });
    } catch (err) {
      console.error('Failed to reset custom calendar event:', err);
    }
  };

  const handleRestoreCalendarEvents = async () => {
    if (!user) return;
    try {
      setHiddenCalendarEvents([]);
      await setDoc(doc(db, 'settings', user.uid), {
        hiddenCalendarEvents: []
      }, { merge: true });
    } catch (err) {
      console.error('Failed to restore calendar events:', err);
    }
  };

  const filteredEarningsEvents = useMemo(() => {
    const result: EarningsEvent[] = [];
    const processedSymbols = new Set<string>();

    // Custom overrides first
    customCalendarEvents.forEach(ce => {
      if (!ce || !ce.symbol) return;
      const ceSym = ce.symbol.toUpperCase();
      const dateKey = getEventDateKey(ce.date);
      const eventKey = `${ceSym}-${dateKey}`;
      if (!hiddenCalendarEvents.includes(eventKey)) {
        result.push(ce);
        processedSymbols.add(ceSym);
      }
    });

    // API events for tickers without custom overrides
    earningsEvents.forEach(event => {
      if (!event || !event.symbol) return;
      const evSym = event.symbol.toUpperCase();
      if (processedSymbols.has(evSym)) return;
      const dateKey = getEventDateKey(event.date);
      const eventKey = `${evSym}-${dateKey}`;
      if (!hiddenCalendarEvents.includes(eventKey)) {
        result.push(event);
      }
    });

    return result;
  }, [earningsEvents, customCalendarEvents, hiddenCalendarEvents]);

  const [benchmarkData, setBenchmarkData] = useState<{ dayChangePercent: number, ytdReturn?: number } | null>(null);

  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    const newSortConfig = { key, direction };
    setSortConfig(newSortConfig);
    saveTableLayout({ sortConfig: newSortConfig });
  };

  const handleDownload = () => {
    const dataStr = JSON.stringify(holdings, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'portfolio.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleExportCSV = () => {
    const itemsToExport = sortedHoldings && sortedHoldings.length > 0 ? sortedHoldings : portfolioStats.enrichedHoldings;
    if (!itemsToExport || itemsToExport.length === 0) {
      toast.error("No holdings available to export");
      return;
    }

    const currSym = getCurrencySymbol(activeCurrency).trim();

    const headers = [
      'Ticker',
      'Asset Name',
      'Investing Theme',
      'Shares',
      `Avg Cost (${currSym})`,
      `Cost Basis (${currSym})`,
      `Current Price (${currSym})`,
      `Current Value (${currSym})`,
      `Day Change (${currSym})`,
      `Day Change %`,
      `Total Return (${currSym})`,
      `Total Return %`,
      `Growth Multiple`,
      `Allocation %`,
      `Realized P&L (${currSym})`
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = itemsToExport.map((hItem: any) => {
      const h = hItem;
      const theme = getInvestingTheme(h, metadata);
      const name = h.name || (metadata[h.ticker] as any)?.name || h.ticker;
      return [
        escapeCsv(h.ticker),
        escapeCsv(name),
        escapeCsv(theme),
        h.shares,
        (h.displayAvgPrice || 0).toFixed(2),
        (h.costBasis || 0).toFixed(2),
        (h.currentPrice || 0).toFixed(2),
        (h.currentValue || 0).toFixed(2),
        (h.dayChange || 0).toFixed(2),
        (h.dayChangePercent || 0).toFixed(2) + '%',
        (h.profitLoss || 0).toFixed(2),
        (h.profitLossPercent || 0).toFixed(2) + '%',
        (h.growthMultiple || 1).toFixed(2) + 'x',
        (h.allocation || 0).toFixed(2) + '%',
        (h.realizedProfitLoss || 0).toFixed(2)
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `portfolio_${activeTab}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Portfolio exported to CSV file successfully!");
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedHoldings = JSON.parse(event.target?.result as string);
        if (!Array.isArray(importedHoldings)) throw new Error('Invalid format');

        // A transactions export (buy/sell rows with a price, no avg_price) uploaded here
        // would otherwise become one zero-cost holding per transaction.
        const looksLikeTransactions = importedHoldings.length > 0 && importedHoldings.every(
          (r: any) => r && r.avg_price === undefined && r.price !== undefined && typeof r.type === 'string'
        );
        if (looksLikeTransactions) {
          handleImportTransactions(e);
          return;
        }
        
        if (!user) return;

        setIsSubmitting(true);
        await withBatchedUpdates(async () => {
          // Clear existing (optional, or merge)
          const q = query(collection(db, 'holdings'), where('userId', '==', user.uid));
          const snapshot = await getDocs(q);
          const docsToDelete = snapshot.docs.filter(d => (d.data().portfolioType || 'global') === activeTab);
          await Promise.all(docsToDelete.map(d => deleteDoc(d.ref)));

          for (const h of importedHoldings) {
            const holdingRef = await addDoc(collection(db, 'holdings'), {
              ticker: (h.ticker || '').toUpperCase(),
              shares: h.shares,
              avg_price: h.avg_price,
              avgPriceCurrency: h.avgPriceCurrency || activeCurrency,
              userId: user.uid,
              portfolioType: activeTab,
              updatedAt: serverTimestamp()
            });

            // Record an initial purchase transaction for the new holding!
            await addDoc(collection(db, 'transactions'), {
              holdingId: holdingRef.id,
              type: 'buy',
              shares: h.shares,
              price: h.avg_price,
              date: new Date().toISOString(),
              userId: user.uid
            });
          }
        });
        setSaveMessage({ text: 'Portfolio imported successfully', type: 'success' });
      } catch (err) {
        console.error('Import error:', err);
        toast.error('Failed to import portfolio. Please check the file format.');
      } finally {
        setIsSubmitting(false);
        setTimeout(() => setSaveMessage(null), 3000);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadTransactions = async (formatType: 'csv' | 'json' = 'csv', scope: 'all' | 'activeTab' = 'all') => {
    if (!user) {
      toast.error('Please sign in to export transactions.');
      return;
    }
    try {
      const q = query(collection(db, 'transactions'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      
      const holdingsMap = new Map(allHoldings.map(h => [h.id, h]));

      const rawTxs = snapshot.docs.map(docSnap => {
        const tx = docSnap.data();
        const holding = holdingsMap.get(tx.holdingId);
        const ticker = (tx as any).ticker || (tx as any).symbol || holding?.ticker || 'UNKNOWN';
        const portfolio = (tx as any).portfolioType || (tx as any).portfolio || holding?.portfolioType || 'global';
        const currency = (tx as any).currency || holding?.avgPriceCurrency || (portfolio === 'australia' ? 'AUD' : 'USD');
        const shares = Number(tx.shares) || 0;
        const price = Number(tx.price) || 0;
        const total = Number((shares * price).toFixed(4));
        const date = tx.date || (tx.createdAt?.toDate ? tx.createdAt.toDate().toISOString().slice(0, 10) : '');
        const type = (tx.type || 'buy').toUpperCase();

        return {
          id: docSnap.id,
          date,
          ticker,
          type,
          shares,
          price,
          total,
          currency,
          portfolio,
          holdingId: tx.holdingId || '',
          ...tx
        };
      });

      const filteredTxs = scope === 'activeTab'
        ? rawTxs.filter(t => t.portfolio === activeTab)
        : rawTxs;

      // Sort by date descending
      filteredTxs.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      if (filteredTxs.length === 0) {
        toast.info('No transactions found to export.');
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const filenameBase = `transactions_${scope === 'all' ? 'whole_history' : activeTab}_${dateStr}`;

      if (formatType === 'json') {
        const cleanJson = filteredTxs.map(t => ({
          date: t.date,
          ticker: t.ticker,
          type: t.type,
          shares: t.shares,
          price: t.price,
          total: t.total,
          currency: t.currency,
          portfolio: t.portfolio,
          holdingId: t.holdingId,
          id: t.id
        }));
        const blob = new Blob([JSON.stringify(cleanJson, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenameBase}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(`Exported ${filteredTxs.length} transactions as JSON!`);
      } else {
        const csvRows = filteredTxs.map(t => ({
          Date: t.date,
          Ticker: t.ticker,
          Type: t.type,
          Shares: t.shares,
          Price: t.price,
          Total: t.total,
          Currency: t.currency,
          Portfolio: t.portfolio,
          TransactionId: t.id,
          HoldingId: t.holdingId
        }));
        const csv = Papa.unparse(csvRows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenameBase}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(`Exported whole transaction history (${filteredTxs.length} records) as CSV!`);
      }
    } catch (error) {
      console.error('Export transactions error:', error);
      toast.error('Failed to export transactions');
    }
  };

  const handleImportTransactions = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        let rawData: any[] = [];

        if (content.trim().startsWith('[') || content.trim().startsWith('{')) {
          rawData = JSON.parse(content);
        } else {
          const results = Papa.parse(content, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true
          });
          rawData = results.data;
        }

        if (!Array.isArray(rawData)) throw new Error('Invalid format');
        
        if (!user) return;

        setIsSubmitting(true);
        setSaveMessage({ text: 'Processing transactions history...', type: 'success' });

        const parseFlexDate = (val: any): string => {
          if (!val) return new Date().toISOString();
          
          // Case 1: Already a Date object
          if (val instanceof Date) return isNaN(val.getTime()) ? new Date().toISOString() : val.toISOString();
          
          // Case 2: Number or numeric string (Timestamp)
          const num = Number(val);
          if (!isNaN(num) && val.toString().trim() !== '') {
            // If 10 digits, it's likely seconds. If 13+, likely milliseconds.
            const date = new Date(num < 10000000000 ? num * 1000 : num);
            if (!isNaN(date.getTime())) return date.toISOString();
          }

          // Case 3: String
          const str = val.toString().trim();
          
          // Try standard Date constructor
          let date = new Date(str);
          if (!isNaN(date.getTime())) return date.toISOString();

          // Try common manual fixes for exchange exports
          // 1. Remove bracketed timezones like [UTC]
          const cleaned = str.replace(/\[.*?\]/g, '').trim();
          date = new Date(cleaned);
          if (!isNaN(date.getTime())) return date.toISOString();

          // Last resort: Return current date to prevent crash, but maybe we should log it
          console.warn('Could not parse date:', val);
          return new Date().toISOString();
        };

        const importedTransactions = rawData.map((row: any, rowIndex: number) => {
          const normalized: any = {};
          const actualKeys = Object.keys(row);

          if (rowIndex === 0) {
            console.log('Import mapping debug - First row keys:', actualKeys);
          }

          const findField = (keywords: string[]) => {
            // First pass: look for exact match (case-insensitive)
            for (const kw of keywords) {
              const exactKey = actualKeys.find(ak => ak.toLowerCase() === kw.toLowerCase() || ak.toLowerCase().replace(/ /g, '_') === kw.toLowerCase());
              if (exactKey && row[exactKey] !== null && row[exactKey] !== undefined) return row[exactKey];
            }
            // Second pass: look for "contains" (case-insensitive)
            for (const kw of keywords) {
              const fuzzyKey = actualKeys.find(ak => ak.toLowerCase().includes(kw.toLowerCase()));
              if (fuzzyKey && row[fuzzyKey] !== null && row[fuzzyKey] !== undefined) return row[fuzzyKey];
            }
            return null;
          };

          normalized.ticker = (findField(['ticker', 'symbol', 'asset', 'coin', 'instrument', 'name', 'token', 'item', 'equity', 'stock', 'product', 'description', 'pair', 'security', 'holding', 'position']) || actualKeys[0] || '').toString().substring(0, 20);
          normalized.shares = findField(['shares', 'quantity', 'qty', 'amount', 'units', 'vol', 'volume', 'count', 'size', 'quantity transacted', 'amount transacted', 'executed', 'filled', 'bought', 'sold']) || 0;
          normalized.price = findField(['price', 'avg', 'rate', 'execution', 'cost', 'trade price', 'spot price', 'usd spot price', 'market price', 'value', 'price per share', 'avg_price']) || 0;
          normalized.type = (findField(['type', 'side', 'action', 'transaction', 'operation', 'direction', 'transaction type', 'activity']) || 'buy').toString().toLowerCase();
          normalized.date = parseFlexDate(findField(['date', 'time', 'timestamp', 'trade date', 'created', 'transacted at', 'transaction date', 'occurred', 'datetime', 'acquired']));
          normalized.currency = findField(['currency', 'base', 'quote', 'fiat', 'money']) || null;
          // Whole-history exports tag each row with the portfolio tab it belongs to.
          normalized.portfolio = (row.portfolio ?? row.portfolioType ?? row.Portfolio ?? '').toString().toLowerCase().trim() || null;
          
          return normalized;
        }).map(tx => {
          // Clean up ticker (handle cases like "Bitcoin BTC" or "BTC-USD")
          let ticker = (tx.ticker || '').toString().trim();
          if (ticker.includes(' ')) {
             // If there's a space, the last word is often the ticker in descriptions
             const parts = ticker.split(' ');
             const potentialTicker = parts[parts.length - 1].replace(/[\(\)]/g, '');
             if (potentialTicker.length <= 10 && potentialTicker === potentialTicker.toUpperCase()) {
               ticker = potentialTicker;
             }
          }
          tx.ticker = ticker;

          // Normalize numbers and detect sells from negative quantities
          let numShares = parseFloat((tx.shares || 0).toString().replace(/,/g, '.'));
          let numPrice = parseFloat((tx.price || 0).toString().replace(/,/g, '.'));
          
          if (isNaN(numShares)) numShares = 0;
          if (isNaN(numPrice)) numPrice = 0;

          tx.shares = Math.abs(numShares);
          tx.price = Math.abs(numPrice); // Handle platforms where price/subtotal might be negative for sells
          
          if (numShares < 0) {
            tx.type = 'sell';
          }
          return tx;
        }).filter(tx => tx.ticker && tx.shares > 0);

        if (importedTransactions.length === 0) {
          const sampleKeys = rawData.length > 0 ? Object.keys(rawData[0]).join(', ') : 'none';
          throw new Error(`No valid transactions found. The file headers don't match our recognized names. Found headers: ${sampleKeys}`);
        }

        // Group transactions by portfolio tab and ticker. Rows without a portfolio go to
        // the active tab; rows for tabs this app doesn't have are skipped.
        const knownTabs = ['global', 'australia'] as const;
        type Tab = typeof knownTabs[number];
        const groups = new Map<string, { tab: Tab; ticker: string; txs: any[] }>();
        const skippedPortfolios: Record<string, number> = {};
        for (const tx of importedTransactions) {
          const tab = (tx.portfolio || activeTab || 'global') as Tab;
          if (!knownTabs.includes(tab)) {
            skippedPortfolios[tx.portfolio] = (skippedPortfolios[tx.portfolio] || 0) + 1;
            continue;
          }

          let ticker = (tx.ticker || '').toString().toUpperCase().trim();
          if (!ticker) continue;

          if (ticker.includes('/') || ticker.includes('-') || ticker.includes('_')) {
            ticker = ticker.split(/[\/\-_]/)[0].trim();
          }

          const key = `${tab}|${ticker}`;
          if (!groups.has(key)) groups.set(key, { tab, ticker, txs: [] });
          groups.get(key)!.txs.push(tx);
        }

        let totalHoldingsCreated = 0;
        let totalTransactionsCreated = 0;

        await withBatchedUpdates(async () => {
          // Replace existing holdings (and, via cascade, their transactions) only for
          // the tab+ticker pairs present in the import.
          const holdingsSnapshot = await getDocs(query(collection(db, 'holdings'), where('userId', '==', user.uid)));
          for (const holdingDoc of holdingsSnapshot.docs) {
            const hData = holdingDoc.data();
            if (groups.has(`${hData.portfolioType || 'global'}|${hData.ticker}`)) {
              await deleteDoc(holdingDoc.ref);
            }
          }

          const isSellTx = (tx: any) => {
            const typeStr = tx.type.toLowerCase();
            return typeStr.includes('sell') || typeStr.includes('sale') || typeStr.includes('out') || typeStr.includes('short') || typeStr.includes('withdrawal');
          };

          // Re-create holdings and transactions from history
          for (const { tab, ticker, txs } of groups.values()) {
            // Robust date sorting
            txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          
            let currentShares = 0;
            let currentAvgPrice = 0;
            const tabCurrency = tabSettings[tab]?.currency || (tab === 'australia' ? 'AUD' : 'USD');
            let firstTxCurrency = txs[0].currency || tabCurrency;

            for (const tx of txs) {
              const numShares = tx.shares;
              const numPrice = tx.price;

              if (isSellTx(tx)) {
                currentShares -= numShares;
              } else {
                const totalCost = (currentShares * currentAvgPrice) + (numShares * numPrice);
                currentShares += numShares;
                currentAvgPrice = currentShares > 0 ? totalCost / currentShares : numPrice;
              }
            }

            // Create Holding
            const holdingData: any = {
              ticker: ticker.substring(0, 20),
              shares: Math.max(0, currentShares),
              avg_price: currentAvgPrice,
              userId: user.uid,
              portfolioType: tab,
              updatedAt: serverTimestamp()
            };

            if (firstTxCurrency) {
              holdingData.avgPriceCurrency = firstTxCurrency.toString().substring(0, 10);
            }

            const holdingRef = await addDoc(collection(db, 'holdings'), holdingData);
            totalHoldingsCreated++;

            // Create Transactions History in one request per holding
            await addDocs(collection(db, 'transactions'), txs.map(tx => ({
              holdingId: holdingRef.id,
              type: isSellTx(tx) ? 'sell' : 'buy',
              shares: tx.shares,
              price: tx.price,
              date: tx.date,
              userId: user.uid
            })));
            totalTransactionsCreated += txs.length;
          }
        });

        const skipped = Object.entries(skippedPortfolios);
        if (skipped.length > 0) {
          toast.warning(`Skipped ${skipped.map(([p, n]) => `${n} transaction(s) for portfolio "${p}"`).join(', ')}: this app only has Global and Australia tabs.`);
        }

        setSaveMessage({ 
          text: `Successfully imported ${totalTransactionsCreated} transactions for ${totalHoldingsCreated} assets.`, 
          type: 'success' 
        });
      } catch (err) {
        console.error('Import transactions error:', err);
        toast.error(`Failed to import transactions: ${err instanceof Error ? err.message : err}`);
      } finally {
        setIsSubmitting(false);
        setTimeout(() => setSaveMessage(null), 3000);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsText(file);
  };



  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleConnect = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('OAuth error:', error);
      toast.error('Failed to connect to Google');
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        user ? refreshBotPortfolio(user.uid) : Promise.resolve(),
        fetchQuotes(allHoldings),
        fetchMetadata(holdings),
        fetchEarnings(holdings),
        fetchDividends(holdings)
      ]);
      setSaveMessage({ text: 'Data refreshed', type: 'success' });
    } catch (error) {
      console.error('Error refreshing data:', error);
      setSaveMessage({ text: 'Failed to refresh data', type: 'error' });
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetPortfolio = async () => {
    if (!user) return;
    setIsResetting(true);
    try {
      // Find all holdings for the active tab
      const holdingsToDelete = allHoldings.filter(h => (h.portfolioType || 'global') === activeTab);
      const holdingIds = holdingsToDelete.map(h => h.id);
      
      // Fetch raw holdings to backup
      const holdingsSnapshot = await getDocs(query(collection(db, 'holdings'), where('userId', '==', user.uid)));
      const rawHoldingsToBackup = holdingsSnapshot.docs.filter(d => holdingIds.includes(d.id)).map(d => ({ id: d.id, data: d.data() }));

      // Fetch raw transactions to backup
      let rawTransactionsToBackup: any[] = [];
      let transactionsToDelete: any[] = [];
      if (holdingIds.length > 0) {
        const q = query(collection(db, 'transactions'), where('userId', '==', user.uid));
        const snapshot = await getDocs(q);
        transactionsToDelete = snapshot.docs.filter(d => holdingIds.includes(d.data().holdingId));
        rawTransactionsToBackup = transactionsToDelete.map(d => ({ id: d.id, data: d.data() }));
      }

      // Save backup
      await setDoc(doc(db, 'backups', user.uid), {
        holdings: rawHoldingsToBackup,
        transactions: rawTransactionsToBackup,
        tab: activeTab,
        timestamp: new Date().toISOString()
      });
      
      // Delete holdings
      await Promise.all(holdingsToDelete.map(h => deleteDoc(doc(db, 'holdings', h.id))));
      
      // Delete associated transactions
      if (transactionsToDelete.length > 0) {
        await Promise.all(transactionsToDelete.map(d => deleteDoc(d.ref)));
      }
      
      setSaveMessage({ text: 'Portfolio reset successfully', type: 'success' });
      setShowResetConfirm(false);
    } catch (error) {
      console.error('Error resetting portfolio:', error);
      setSaveMessage({ text: 'Failed to reset portfolio', type: 'error' });
    } finally {
      setIsResetting(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleRestorePortfolio = async () => {
    if (!user) return;
    setIsRestoring(true);
    try {
      const backupDoc = await getDoc(doc(db, 'backups', user.uid));
      if (backupDoc.exists()) {
        const backupData = backupDoc.data();
        
        // Restore holdings
        if (backupData.holdings && backupData.holdings.length > 0) {
          await Promise.all(backupData.holdings.map((h: any) => setDoc(doc(db, 'holdings', h.id), h.data)));
        }
        
        // Restore transactions
        if (backupData.transactions && backupData.transactions.length > 0) {
          await Promise.all(backupData.transactions.map((t: any) => setDoc(doc(db, 'transactions', t.id), t.data)));
        }
        
        // Delete backup
        await deleteDoc(doc(db, 'backups', user.uid));
        
        setSaveMessage({ text: 'Portfolio restored successfully', type: 'success' });
        setShowRestoreConfirm(false);
      } else {
        setSaveMessage({ text: 'No backup found to restore', type: 'error' });
      }
    } catch (error) {
      console.error('Error restoring portfolio:', error);
      setSaveMessage({ text: 'Failed to restore portfolio', type: 'error' });
    } finally {
      setIsRestoring(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const fetchPortfolio = async () => {
    // This is now handled by onSnapshot for real-time updates
    return holdings;
  };

  const fetchQuotes = async (currentHoldings: Holding[]) => {
    const allBenchmarks = [
      tabSettings['global']?.benchmark || 'SPY',
      tabSettings['australia']?.benchmark || '^AXJO',
      tabSettings['bot']?.benchmark || 'SPY'
    ];
    const sectorEtfs = [
      'XLK', 'XLV', 'XLF', 'XLY', 'XLI', 'XLC', 'XLP', 'XLE', 'XLRE', 'XLU', 'XLB'
    ];
    const symbolsToFetch = Array.from(new Set([
      ...currentHoldings.map(h => h.ticker), 
      ...allBenchmarks, 
      ...sectorEtfs, 
      'AUD=X', 'INR=X', 'EUR=X', 'GBP=X', 'CAD=X', 'SGD=X'
    ])).join(',');
    try {
      const res = await fetch(`/api/quotes?symbols=${symbolsToFetch}`);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setQuotes(prev => ({ ...prev, ...data }));
      }
    } catch (error) {
      console.error('Error fetching quotes:', error);
    }
  };

  const fetchMetadata = async (currentHoldings: Holding[]) => {
    if (currentHoldings.length === 0) return;
    
    const symbols = Array.from(new Set(currentHoldings.map(h => h.ticker))).join(',');
    try {
      const res = await fetch(`/api/metadata?symbols=${symbols}`);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        console.log('Fetched metadata:', data);
        setMetadata(data);
      }
    } catch (error) {
      console.error('Error fetching metadata:', error);
    }
  };

  const fetchEarnings = async (currentHoldings: Holding[]) => {
    if (currentHoldings.length === 0) return;
    
    const symbols = Array.from(new Set(currentHoldings.map(h => h.ticker))).join(',');
    try {
      const res = await fetch(`/api/earnings?symbols=${symbols}`);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setEarningsEvents(data);
      }
    } catch (error) {
      console.error('Error fetching earnings:', error);
    }
  };

  const fetchDividends = async (currentHoldings: Holding[]) => {
    if (currentHoldings.length === 0) return;
    
    const symbols = Array.from(new Set(currentHoldings.map(h => h.ticker))).join(',');
    try {
      const res = await fetch(`/api/dividends?symbols=${symbols}`);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setDividendEvents(data);
      }
    } catch (error) {
      console.error('Error fetching dividends:', error);
    }
  };

  // Debounced data fetching to prevent excessive API calls
  useEffect(() => {
    if (allHoldings.length === 0) return;

    const timer = setTimeout(() => {
      // Fetch all data in parallel
      // We fetch quotes for ALL holdings to keep the Combined Value accurate across tabs
      Promise.all([
        fetchQuotes(allHoldings),
        fetchMetadata(holdings),
        fetchEarnings(holdings),
        fetchDividends(holdings)
      ]);
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [allHoldings, holdings, tabSettings]);

  useEffect(() => {
    if (!user) {
      setAllHoldings([]);
      setLoading(false);
      setHasBackup(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'holdings'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Holding[];
      data.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setAllHoldings(data);
      setLoading(false);
    }, (error) => {
      console.error('Firestore Error:', error);
      setLoading(false);
    });

    const txQ = query(collection(db, 'transactions'), where('userId', '==', user.uid));
    const txUnsubscribe = onSnapshot(txQ, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      setAllTransactions(data);
      setTxLoaded(true);
    }, (error) => {
      console.error('Firestore Transactions Error:', error);
      setTxLoaded(true);
    });

    const backupUnsubscribe = onSnapshot(doc(db, 'backups', user.uid), (snapshot) => {
      setHasBackup(snapshot.exists());
    });

    const alertsQ = query(collection(db, 'alerts'), where('userId', '==', user.uid));
    const alertsUnsubscribe = onSnapshot(alertsQ, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PriceAlert[];
      setAlerts(data);
    });

    const settingsUnsubscribe = onSnapshot(doc(db, 'settings', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.tabs) {
          setTabSettings(prev => ({ ...prev, ...data.tabs }));
        }
        if (data.user) {
          setUserSettings(prev => ({
            ...prev,
            ...data.user,
            aiConfig: {
              ...DEFAULT_AI_CONFIG,
              ...(data.user.aiConfig || {})
            }
          }));
        }
      }
    });

    return () => {
      unsubscribe();
      txUnsubscribe();
      backupUnsubscribe();
      alertsUnsubscribe();
      settingsUnsubscribe();
    };
  }, [user]);

  // Trading Bot tab: the bot's positions/trades load on sign-in (so combined totals
  // include them), when the tab is opened, and every 5 minutes while it is open and
  // visible. Each load can cost the bot a Webull price call, so don't poll faster;
  // live prices between loads come from the quote stream like any other holding.
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  useEffect(() => onBotStatus(setBotStatus), []);
  useEffect(() => {
    if (!user) { clearBotPortfolio(); return; }
    refreshBotPortfolio(user.uid);
  }, [user]);
  useEffect(() => {
    if (!user || activeTab !== 'bot') return;
    refreshBotPortfolio(user.uid);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshBotPortfolio(user.uid);
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [user, activeTab]);

  // Close Position places a real market sell through the bot, so it is confirmed by
  // typing the symbol (same as the bot's own dashboard).
  const [botCloseSymbol, setBotCloseSymbol] = useState<string | null>(null);
  const [botCloseConfirm, setBotCloseConfirm] = useState('');
  const [isClosingBotPosition, setIsClosingBotPosition] = useState(false);
  const [isRunningHousekeeping, setIsRunningHousekeeping] = useState(false);
  const [isRefreshingBot, setIsRefreshingBot] = useState(false);
  const handleRefreshBot = async () => {
    if (!user) return;
    setIsRefreshingBot(true);
    try {
      await Promise.all([refreshBotPortfolio(user.uid), fetchQuotes(allHoldings)]);
    } finally {
      setIsRefreshingBot(false);
    }
  };

  const handleConfirmBotClose = async () => {
    if (!botCloseSymbol || botCloseConfirm.trim().toUpperCase() !== botCloseSymbol || !user) return;
    setIsClosingBotPosition(true);
    try {
      const result = await closeBotPosition(botCloseSymbol);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setBotCloseSymbol(null);
      await refreshBotPortfolio(user.uid);
    } catch (err) {
      toast.error(`Close failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsClosingBotPosition(false);
    }
  };

  const handleRunBotHousekeeping = async () => {
    if (!user || isRunningHousekeeping) return;
    if (!window.confirm('Run the trading bot\'s housekeeping job now? It can place or adjust real orders.')) return;
    setIsRunningHousekeeping(true);
    try {
      await runBotHousekeeping((result) => {
        setIsRunningHousekeeping(false);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
        refreshBotPortfolio(user.uid);
      });
      toast.info('Housekeeping started…');
    } catch (err) {
      setIsRunningHousekeeping(false);
      toast.error(`Housekeeping failed to start: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Automatic background transaction self-healing for imported portfolios
  const healingHoldingIds = useRef(new Set<string>());
  useEffect(() => {
    if (!user || !txLoaded || allHoldings.length === 0) return;

    const selfHeal = async () => {
      // Find holdings with positive shares that have 0 transactions (excluding CASH).
      // Skip holdings touched in the last minute: whatever created them (an import,
      // add-stock, a sale's cash leg...) may still be writing their transactions, and
      // the holdings list can refresh before the transactions list does.
      const HEAL_GRACE_MS = 60_000;
      const now = Date.now();
      const txHoldingIds = new Set(allTransactions.map(tx => tx.holdingId));
      const holdingsToHeal = allHoldings.filter(h =>
        h.shares > 0 && h.ticker !== 'CASH' && h.portfolioType !== 'bot' && !txHoldingIds.has(h.id) &&
        !healingHoldingIds.current.has(h.id) &&
        !(h.updatedAt?.toMillis && Math.abs(now - h.updatedAt.toMillis()) < HEAL_GRACE_MS)
      );

      if (holdingsToHeal.length === 0) return;

      console.log(`[Self-Heal] Found ${holdingsToHeal.length} holdings without transaction history. Healing...`);

      for (const holding of holdingsToHeal) {
        healingHoldingIds.current.add(holding.id);
        try {
          // Re-check the database: the local transactions list may be stale.
          const existing = await getDocs(query(collection(db, 'transactions'), where('holdingId', '==', holding.id), where('userId', '==', user.uid)));
          if (!existing.empty) continue;

          const initialTx = {
            holdingId: holding.id,
            type: 'buy' as const,
            shares: holding.shares,
            price: holding.avg_price || 0,
            date: holding.updatedAt 
              ? (holding.updatedAt as any).toDate?.()?.toISOString() || new Date().toISOString() 
              : new Date().toISOString(),
            userId: user.uid
          };
          await addDoc(collection(db, 'transactions'), initialTx);
          console.log(`[Self-Heal] Successfully created transaction for ${holding.ticker}`);
        } catch (err) {
          healingHoldingIds.current.delete(holding.id);
          console.error(`[Self-Heal] Failed to create transaction for ${holding.ticker}:`, err);
        }
      }
    };

    selfHeal();
  }, [allHoldings, allTransactions, txLoaded, user]);

  // Self-heal corrupted positions (e.g. negative avg_price or negative shares, reconciling with transactions ledger)
  useEffect(() => {
    if (!user || !txLoaded || allHoldings.length === 0) return;

    const healCorruptedHoldings = async () => {
      const corruptedHoldings = allHoldings.filter(h => (h.avg_price < 0 || h.shares < 0) && h.userId === user.uid);
      if (corruptedHoldings.length === 0) return;

      console.log(`[Self-Heal] Detected ${corruptedHoldings.length} corrupted holdings with negative values. Repairing...`);

      for (const corrupted of corruptedHoldings) {
        try {
          const hTxs = allTransactions.filter(tx => tx.holdingId === corrupted.id);
          const computed = computeHoldingFromTransactions(hTxs);

          let repairedShares = corrupted.shares;
          let repairedAvgPrice = Math.max(0, corrupted.avg_price);

          if (computed && computed.totalBuys > 0) {
            repairedShares = computed.shares;
            repairedAvgPrice = computed.avg_price;
          } else {
            repairedShares = Math.max(0, repairedShares);
            repairedAvgPrice = Math.max(0, repairedAvgPrice);
          }

          await updateDoc(doc(db, 'holdings', corrupted.id), {
            shares: repairedShares,
            avg_price: repairedAvgPrice,
            updatedAt: serverTimestamp()
          });

          console.log(`[Self-Heal] Repaired negative holding ${corrupted.ticker}: ${repairedShares} shares @ ${repairedAvgPrice}`);
          toast.success(`Repaired ${corrupted.ticker} position: ${repairedShares} shares @ ${formatCurrency(repairedAvgPrice, corrupted.avgPriceCurrency || activeCurrency)}`);
        } catch (err) {
          console.error(`[Self-Heal] Error repairing negative holding ${corrupted.ticker}:`, err);
        }
      }
    };

    healCorruptedHoldings();
  }, [allHoldings, allTransactions, txLoaded, user, activeCurrency]);

  // Check price alerts
  useEffect(() => {
    if (!alerts.length || Object.keys(quotes).length === 0) return;
    
    alerts.forEach(alert => {
      if (alert.isTriggered) return; // Only notify once
      
      const currentQuote = quotes[alert.ticker];
      if (!currentQuote || !currentQuote.price) return;
      
      const price = currentQuote.price;
      const conditionMet = 
        (alert.condition === 'above' && price >= alert.targetPrice) ||
        (alert.condition === 'below' && price <= alert.targetPrice);
        
      if (conditionMet) {
        toast.success(`Price Alert Triggered!`, {
          description: `${alert.ticker} has crossed your target limit of ${alert.targetPrice}. Current price is ${price}.`,
          duration: 10000,
        });
        
        if (user.email) {
          fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: user.email,
              subject: `Price Alert Triggered: ${alert.ticker}`,
              text: `Your price alert for ${alert.ticker} has been triggered.\n\nIt crossed your target limit of ${alert.targetPrice}.\nThe current price is ${price}.`
            })
          }).catch(err => console.error('Failed to send price alert email:', err));
        }

        // Update in firestore to prevent repeated triggering
        updateDoc(doc(db, 'alerts', alert.id), {
          isTriggered: true
        }).catch(err => console.error('Failed to update alert', err));
      }
    });
  }, [quotes, alerts]);

  useEffect(() => {
    if (selectedChartTicker && chartModalTab === 'kpis') {
      const fetchFinancials = async () => {
        setIsFinancialsLoading(true);
        try {
          const res = await fetch(`/api/financials?symbol=${selectedChartTicker}`);
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            const data = await res.json();
            setFinancialsData(data);
          } else {
            setFinancialsData(null);
          }
        } catch (error) {
          console.error('Error fetching financials:', error);
          setFinancialsData(null);
        } finally {
          setIsFinancialsLoading(false);
        }
      };

      const fetchBusinessKpis = async () => {
        setIsBusinessKpisLoading(true);
        try {
          const isQuarterly = kpiTimeScale.endsWith('q');
          const timeValue = kpiTimeScale.replace(/[yq]/, '').replace('all_', 'all ');
          const periodText = isQuarterly ? 'quarterly' : 'annual';
          const durationText = kpiTimeScale.startsWith('all') ? 'all available' : `the last ${timeValue}`;
          const durationUnit = isQuarterly ? 'quarters' : 'years';

          const res = await fetch('/api/gemini-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: "gemini-3.1-pro-preview",
              prompt: `Provide the historical and projected ${periodText} business KPIs (e.g., Daily Active Users, Monthly Active Users, Subscribers, Deliveries, or other relevant operational metrics) for the company with ticker symbol ${selectedChartTicker} over ${durationText} ${durationUnit}, plus the next 2-3 ${durationUnit} of analyst and company projections. If the company is not a tech/service company with users, provide their most relevant operational KPIs (e.g., vehicles delivered for TSLA, stores opened for SBUX). Return the data as a JSON array of objects, where each object has a 'period' (string, e.g., '2023' for annual or 'Q1 2023' for quarterly), a boolean 'isProjection' indicating if it's a future estimate, and 2-3 relevant KPI fields (numbers). Use short, camelCase keys for the KPI fields.`,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      period: { type: "string" },
                      isProjection: { type: "boolean", description: "True if this period is a future projection/estimate" },
                      kpi1Name: { type: "string", description: "Display name of the first KPI (e.g., 'Daily Active Users (Millions)')" },
                      kpi1Value: { type: "number" },
                      kpi2Name: { type: "string", description: "Display name of the second KPI" },
                      kpi2Value: { type: "number" },
                      kpi3Name: { type: "string", description: "Display name of the third KPI (optional)" },
                      kpi3Value: { type: "number" }
                    },
                    required: ["period", "isProjection", "kpi1Name", "kpi1Value", "kpi2Name", "kpi2Value"]
                  }
                }
              }
            })
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.details || err.error || 'Analysis failed');
          }
          const response = await res.json();
          const data = typeof response.text === 'string' ? JSON.parse(response.text.replace(/```json\n?|\n?```/g, '').trim()) : response.text;
          setBusinessKpisData(data);
        } catch (error) {
          console.error('Error fetching business KPIs:', error);
          setBusinessKpisData(null);
        } finally {
          setIsBusinessKpisLoading(false);
        }
      };

      fetchFinancials();
      fetchBusinessKpis();
    }
  }, [selectedChartTicker, chartModalTab, kpiTimeScale]);

  useEffect(() => {
    // Setup WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Trades arrive several times a second; applying each one re-renders the whole
    // app. Collect them and apply at most once per second instead. Per symbol, the
    // latest price wins and previous close / market state keep the latest value any
    // trade in the batch carried - the same result as applying them one by one.
    const pendingTrades = new Map<string, { p: number; pc?: number; ms?: string }>();

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'trade' && data.data) {
          data.data.forEach((trade: any) => {
            if (!trade.s || trade.p == null) return;
            const pending = pendingTrades.get(trade.s);
            pendingTrades.set(trade.s, {
              p: trade.p,
              pc: trade.pc != null ? trade.pc : pending?.pc,
              ms: trade.ms || pending?.ms,
            });
          });
        }
      } catch (e) {
        console.error('Error parsing WS message', e);
      }
    };

    const flushTrades = () => {
      if (pendingTrades.size === 0) return;
      const trades = [...pendingTrades.entries()];
      pendingTrades.clear();
      setQuotes(prev => {
        let next: typeof prev | null = null;
        for (const [symbol, trade] of trades) {
          // Only update if price actually changed or we don't have it
          if (prev[symbol] && prev[symbol].price === trade.p) continue;
          next ??= { ...prev };
          next[symbol] = {
            ...prev[symbol],
            price: trade.p,
            previousClose: trade.pc != null ? trade.pc : (prev[symbol]?.previousClose ?? trade.p),
            marketState: trade.ms || prev[symbol]?.marketState
          };
        }
        return next ?? prev;
      });
    };
    const flushTimer = setInterval(flushTrades, 1000);

    return () => {
      clearInterval(flushTimer);
      ws.close();
    };
  }, []);

  useEffect(() => {
    const allBenchmarks = [
      tabSettings['global']?.benchmark || 'SPY',
      tabSettings['australia']?.benchmark || '^AXJO',
      tabSettings['bot']?.benchmark || 'SPY'
    ];
    if (holdings.length > 0 || allBenchmarks.length > 0) {
      const symbols = Array.from(new Set([...holdings.map(h => h.ticker), ...allBenchmarks]))
        .filter(s => s && s.trim().toUpperCase() !== 'CASH');
      const subscribeMsg = JSON.stringify({ type: 'subscribe', symbols });
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(subscribeMsg);
      } else if (wsRef.current) {
        wsRef.current.addEventListener('open', () => {
          wsRef.current?.send(subscribeMsg);
        }, { once: true });
      }
    }
  }, [holdings, tabSettings]);

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    let rawTicker = ticker.trim().toUpperCase();
    if (activeTab === 'australia' && !rawTicker.includes('.') && rawTicker !== 'CASH') {
      rawTicker = `${rawTicker}.AX`;
    }
    const finalTicker = rawTicker;
    const isCash = finalTicker === 'CASH';
    
    if (!ticker || !shares || (!isCash && !avgPrice) || !user) return;

    setIsSubmitting(true);
    try {
      const numShares = parseFloat(shares.toString().replace(/,/g, '.'));
      const numPrice = isCash ? 1 : parseFloat(avgPrice.toString().replace(/,/g, '.'));
      const isSell = transactionType === 'sell';

      // Check for existing holding in the current portfolio
      const existingHolding = holdings.find(h => h.ticker === finalTicker);

      if (existingHolding) {
        // Update existing holding safely
        let newShares = existingHolding.shares;
        let newAvgPrice = Math.max(0, existingHolding.avg_price || 0);

        if (isSell) {
          newShares = Math.max(0, existingHolding.shares - numShares);
          if (newShares === 0) {
            newAvgPrice = 0;
          }
        } else {
          if (existingHolding.shares <= 0) {
            newShares = numShares;
            newAvgPrice = numPrice;
          } else {
            const currentCost = Math.max(0, existingHolding.shares) * Math.max(0, existingHolding.avg_price || 0);
            const additionalCost = numShares * numPrice;
            newShares = existingHolding.shares + numShares;
            newAvgPrice = newShares > 0 ? (currentCost + additionalCost) / newShares : numPrice;
          }
        }
        newAvgPrice = Math.max(0, newAvgPrice);

        await updateDoc(doc(db, 'holdings', existingHolding.id), {
          shares: newShares,
          avg_price: newAvgPrice,
          updatedAt: serverTimestamp()
        });

        // Add transaction
        await addDoc(collection(db, 'transactions'), {
          holdingId: existingHolding.id,
          type: transactionType,
          shares: numShares,
          price: numPrice,
          date: new Date(transactionDate).toISOString(),
          userId: user.uid
        });
      } else {
        // Create new holding
        const nextOrder = Math.max(...allHoldings.filter(h => (h.portfolioType || 'global') === activeTab).map(h => h.order ?? 0), -1) + 1;
        const holdingData = {
          ticker: finalTicker,
          shares: Math.max(0, isSell ? 0 : numShares),
          avg_price: Math.max(0, numPrice),
          avgPriceCurrency: formCurrency || activeCurrency,
          userId: user.uid,
          portfolioType: activeTab,
          updatedAt: serverTimestamp(),
          order: nextOrder
        };
        
        const docRef = await addDoc(collection(db, 'holdings'), holdingData);
        
        // Add transaction
        await addDoc(collection(db, 'transactions'), {
          holdingId: docRef.id,
          type: transactionType,
          shares: numShares,
          price: numPrice,
          date: new Date(transactionDate).toISOString(),
          userId: user.uid
        });
      }

      // Handle cash automatically
      if (!isCash) {
        const cashValue = numShares * numPrice;
        const cashHolding = holdings.find(h => h.ticker === 'CASH');
        if (cashHolding) {
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
            date: new Date(transactionDate).toISOString(),
            userId: user.uid
          });
        } else if (isSell) {
          // If selling an asset and no cash holding exists, create it instead
          const newCashHoldingRef = await addDoc(collection(db, 'holdings'), {
            ticker: 'CASH',
            shares: cashValue,
            avg_price: 1,
            avgPriceCurrency: formCurrency || activeCurrency,
            userId: user.uid,
            portfolioType: activeTab,
            updatedAt: serverTimestamp()
          });
          
          await addDoc(collection(db, 'transactions'), {
            holdingId: newCashHoldingRef.id,
            type: 'buy', // buying cash
            shares: cashValue,
            price: 1,
            date: new Date(transactionDate).toISOString(),
            userId: user.uid
          });
        } else if (!isSell) {
           // If buying an asset and no cash holding exists, create a negative cash balance
           const newCashHoldingRef = await addDoc(collection(db, 'holdings'), {
            ticker: 'CASH',
            shares: -cashValue,
            avg_price: 1,
            avgPriceCurrency: formCurrency || activeCurrency,
            userId: user.uid,
            portfolioType: activeTab,
            updatedAt: serverTimestamp()
          });
          
          await addDoc(collection(db, 'transactions'), {
            holdingId: newCashHoldingRef.id,
            type: 'sell', // spending cash
            shares: cashValue,
            price: 1,
            date: new Date(transactionDate).toISOString(),
            userId: user.uid
          });
        }
      }

      setTicker('');
      setShares('');
      setAvgPrice('');
      setFormCurrency('');
      setTransactionDate(format(new Date(), 'yyyy-MM-dd'));
      setTransactionType('buy');
    } catch (error) {
      console.error('Error adding stock:', error);
      handleFirestoreError(error, OperationType.WRITE, 'holdings_or_transactions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddToWatchlist = async (tickerSymbol: string) => {
    if (!tickerSymbol || !user) return;
    let formattedTicker = tickerSymbol.trim().toUpperCase();
    if (activeTab === 'australia' && !formattedTicker.includes('.') && formattedTicker !== 'CASH') {
      formattedTicker = `${formattedTicker}.AX`;
    }

    // Check if it already exists as an active holding or watchlist holding in the current tab
    const existingHolding = allHoldings.find(
      h => h.ticker === formattedTicker && (h.portfolioType || 'global') === activeTab
    );

    if (existingHolding) {
      if (existingHolding.shares === 0) {
        toast.info(`${formattedTicker} is already in your watchlist.`);
      } else {
        toast.info(`${formattedTicker} is already in your current holdings.`);
      }
      return;
    }

    try {
      const nextOrder = Math.max(...allHoldings.filter(h => (h.portfolioType || 'global') === activeTab).map(h => h.order ?? 0), -1) + 1;
      const holdingData = {
        ticker: formattedTicker,
        shares: 0,
        avg_price: 0,
        avgPriceCurrency: activeCurrency,
        userId: user.uid,
        portfolioType: activeTab,
        updatedAt: serverTimestamp(),
        order: nextOrder
      };

      await addDoc(collection(db, 'holdings'), holdingData);
      toast.success(`${formattedTicker} added to watchlist.`);
    } catch (error) {
      console.error('Error adding to watchlist:', error);
      handleFirestoreError(error, OperationType.WRITE, 'holdings');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'holdings', id));
      // Optionally delete associated transactions
      const q = query(collection(db, 'transactions'), where('holdingId', '==', id), where('userId', '==', user?.uid));
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)));
    } catch (error) {
      console.error('Error deleting stock:', error);
    }
  };

  const handleQuickAddClick = (holding: Holding) => {
    setQuickAddHolding(holding);
    setQuickAddPrice((holding.currentPrice || holding.avg_price).toString());
    setQuickAddShares('');
    setQuickAddDate(format(new Date(), 'yyyy-MM-dd'));
    setShowQuickAddModal(true);
  };

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddHolding || !user) return;
    const isCash = quickAddHolding.ticker === 'CASH';
    if (!quickAddShares || (!isCash && !quickAddPrice)) return;

    setIsQuickAdding(true);
    try {
      const numShares = parseFloat(quickAddShares.toString().replace(/,/g, '.'));
      const numPrice = isCash ? 1 : parseFloat(quickAddPrice.toString().replace(/,/g, '.'));

      const newShares = quickAddHolding.shares + numShares;
      const totalCost = (quickAddHolding.shares * quickAddHolding.avg_price) + (numShares * numPrice);
      const newAvgPrice = totalCost / newShares;

      await updateDoc(doc(db, 'holdings', quickAddHolding.id), {
        shares: newShares,
        avg_price: newAvgPrice,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'transactions'), {
        holdingId: quickAddHolding.id,
        type: 'buy',
        shares: numShares,
        price: numPrice,
        date: new Date(quickAddDate).toISOString(),
        userId: user.uid
      });

      // Handle cash automatically
      if (!isCash) {
        const cashValue = numShares * numPrice;
        const cashHolding = holdings.find(h => h.ticker === 'CASH');
        if (cashHolding) {
          await updateDoc(doc(db, 'holdings', cashHolding.id), {
            shares: cashHolding.shares - cashValue,
            updatedAt: serverTimestamp()
          });
          
          await addDoc(collection(db, 'transactions'), {
            holdingId: cashHolding.id,
            type: 'sell', // spend cash
            shares: cashValue,
            price: 1,
            date: new Date(quickAddDate).toISOString(),
            userId: user.uid
          });
        } else {
           // create negative cash balance
           const newCashHoldingRef = await addDoc(collection(db, 'holdings'), {
            ticker: 'CASH',
            shares: -cashValue,
            avg_price: 1,
            avgPriceCurrency: activeCurrency,
            userId: user.uid,
            portfolioType: activeTab,
            updatedAt: serverTimestamp()
          });
          
          await addDoc(collection(db, 'transactions'), {
            holdingId: newCashHoldingRef.id,
            type: 'sell',
            shares: cashValue,
            price: 1,
            date: new Date(quickAddDate).toISOString(),
            userId: user.uid
          });
        }
      }

      setShowQuickAddModal(false);
      setQuickAddHolding(null);
      setQuickAddShares('');
      setQuickAddPrice('');
    } catch (error) {
      console.error('Error in quick add:', error);
    } finally {
      setIsQuickAdding(false);
    }
  };

  const handleEditClick = (holding: Holding, field: string | null = null, forceModal: boolean = false) => {
    if (forceModal || field === null) {
      setEditModalHolding(holding);
      return;
    }
    setEditingId(holding.id);
    setEditTicker(holding.ticker);
    setEditShares(holding.shares.toString());
    setEditAvgPrice(Math.max(0, holding.avg_price ?? 0).toString());
    setEditAvgPriceCurrency(holding.avgPriceCurrency || activeCurrency);
    setEditField(field);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTicker('');
    setEditShares('');
    setEditAvgPrice('');
    setEditAvgPriceCurrency('');
    setEditField(null);
  };

  const handleSaveEdit = async (id: string) => {
    const finalTicker = editTicker.trim().toUpperCase();
    const isCash = finalTicker === 'CASH';
    if (!finalTicker || !editShares || (!isCash && !editAvgPrice) || !user) {
      toast.error('Please enter valid ticker and values.');
      return;
    }

    const cleanShares = parseFloat(editShares.toString().replace(/,/g, '.'));
    if (isNaN(cleanShares) || cleanShares < 0) {
      toast.error('Shares must be a valid non-negative number.');
      return;
    }

    const cleanAvgPrice = isCash ? 1 : parseFloat(editAvgPrice.toString().replace(/,/g, '.'));
    if (isNaN(cleanAvgPrice) || cleanAvgPrice < 0) {
      toast.error('Average purchase price cannot be negative.');
      return;
    }

    try {
      await updateDoc(doc(db, 'holdings', id), {
        ticker: finalTicker,
        shares: cleanShares,
        avg_price: cleanAvgPrice,
        avgPriceCurrency: editAvgPriceCurrency || activeCurrency,
        updatedAt: serverTimestamp()
      });
      
      setEditingId(null);
      setEditTicker('');
      setEditShares('');
      setEditAvgPrice('');
      setEditAvgPriceCurrency('');
      setEditField(null);
      toast.success(`${finalTicker} updated successfully!`);
    } catch (error: any) {
      console.error('Error updating stock:', error);
      toast.error(`Failed to update: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleSaveModalEdit = async (id: string, ticker: string, shares: number, avgPrice: number, currency: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'holdings', id), {
        ticker: ticker.trim().toUpperCase(),
        shares: Math.max(0, shares),
        avg_price: Math.max(0, avgPrice),
        avgPriceCurrency: currency,
        updatedAt: serverTimestamp()
      });
      toast.success(`${ticker} position updated successfully!`);
    } catch (error: any) {
      console.error('Error saving holding:', error);
      toast.error(`Failed to update position: ${error?.message || 'Unknown error'}`);
      throw error;
    }
  };

  const handleRepairCorruptedHoldings = async (holdingsToRepair: Holding[]) => {
    if (!user) return;
    for (const h of holdingsToRepair) {
      try {
        const txsForHolding = allTransactions.filter(t => t.holdingId === h.id);
        const computed = computeHoldingFromTransactions(txsForHolding);
        
        let newShares = h.shares;
        let newAvgPrice = Math.max(0, h.avg_price);

        if (computed && computed.totalBuys > 0) {
          newShares = computed.shares;
          newAvgPrice = computed.avg_price;
        } else {
          newShares = Math.max(0, newShares);
          newAvgPrice = Math.max(0, newAvgPrice);
        }

        await updateDoc(doc(db, 'holdings', h.id), {
          shares: newShares,
          avg_price: newAvgPrice,
          updatedAt: serverTimestamp()
        });

        toast.success(`Repaired ${h.ticker} position: ${newShares} shares @ ${formatCurrency(newAvgPrice, h.avgPriceCurrency || activeCurrency)}`);
      } catch (err: any) {
        console.error('Failed to repair holding:', h.ticker, err);
        toast.error(`Failed to repair ${h.ticker}: ${err?.message || 'Unknown error'}`);
      }
    }
  };

  const handleSyncHoldingWithLedger = async (holdingToSync: Holding, customComputed?: any) => {
    if (!user) return;
    try {
      const txs = allTransactions.filter(t => t.holdingId === holdingToSync.id);
      const computed = customComputed || computeHoldingFromTransactions(txs);
      if (!computed || computed.totalBuys === 0) {
        toast.error('No buy transactions found in ledger to sync from.');
        return;
      }
      await updateDoc(doc(db, 'holdings', holdingToSync.id), {
        shares: computed.shares,
        avg_price: computed.avg_price,
        updatedAt: serverTimestamp()
      });
      toast.success(`Successfully synced ${holdingToSync.ticker} to ${computed.shares} shares @ ${formatCurrency(computed.avg_price, holdingToSync.avgPriceCurrency || activeCurrency)}!`);
      if (historyHolding && historyHolding.id === holdingToSync.id) {
        setHistoryHolding(prev => prev ? { ...prev, shares: computed.shares, avg_price: computed.avg_price } : null);
      }
    } catch (err: any) {
      console.error('Error syncing holding with ledger:', err);
      toast.error(`Failed to sync: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleViewHistory = async (holding: Holding) => {
    setHistoryHolding(holding);
    setIsHistoryLoading(true);
    try {
      const q = query(collection(db, 'transactions'), where('holdingId', '==', holding.id), where('userId', '==', user?.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      
      if (data.length === 0 && holding.shares > 0) {
        // Self-heal: If no transactions are found for this holding but it has positive shares,
        // dynamically create an initial purchase transaction in Firestore!
        // This resolves the issue where imported portfolios (without transactions) have no transaction history.
        const initialTx = {
          holdingId: holding.id,
          type: 'buy' as const,
          shares: holding.shares,
          price: holding.avg_price,
          date: holding.updatedAt ? (holding.updatedAt as any).toDate?.()?.toISOString() || new Date().toISOString() : new Date().toISOString(),
          userId: user?.uid || ''
        };
        const docRef = await addDoc(collection(db, 'transactions'), initialTx);
        setHistoryTransactions([{ id: docRef.id, ...initialTx }]);
      } else {
        setHistoryTransactions(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const getRemainingSharesForLots = (txs: Transaction[]) => {
    const lotRemaining: Record<string, number> = {};
    const sorted = [...txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const buys = sorted.filter(tx => tx.type === 'buy');
    const sells = sorted.filter(tx => tx.type === 'sell');
    
    buys.forEach(tx => {
      lotRemaining[tx.id] = tx.shares;
    });
    
    const sellsWithRemaining = sells.map(tx => ({
      ...tx,
      remainingToMatch: tx.shares
    }));

    sellsWithRemaining.forEach(tx => {
      if (tx.lotId) {
        const targetBuy = buys.find(b => b.id === tx.lotId);
        if (targetBuy && lotRemaining[tx.lotId] !== undefined) {
          const consumed = Math.min(tx.remainingToMatch, lotRemaining[tx.lotId]);
          lotRemaining[tx.lotId] -= consumed;
          tx.remainingToMatch -= consumed;
        }
      }
    });
    
    sellsWithRemaining.forEach(tx => {
      let sharesToSell = tx.remainingToMatch;
      while (sharesToSell > 0) {
        const oldestBuy = buys.find(b => lotRemaining[b.id] > 0);
        if (!oldestBuy) break;
        
        if (lotRemaining[oldestBuy.id] <= sharesToSell) {
          sharesToSell -= lotRemaining[oldestBuy.id];
          lotRemaining[oldestBuy.id] = 0;
        } else {
          lotRemaining[oldestBuy.id] -= sharesToSell;
          sharesToSell = 0;
        }
      }
    });
    
    return lotRemaining;
  };

  const handleSellLot = async (sharesToSell: number, sellPrice: number, sellDate: string, lotTx: Transaction) => {
    if (!user || !historyHolding) return;
    
    setIsHistoryLoading(true);
    setUndoError(null);
    try {
      const existingHolding = holdings.find(h => h.id === historyHolding.id);
      if (!existingHolding) {
        throw new Error("Holding not found.");
      }

      const lotRemainingMap = getRemainingSharesForLots(historyTransactions);
      const remainingForThisLot = lotRemainingMap[lotTx.id] || 0;
      if (sharesToSell > remainingForThisLot) {
        throw new Error(`Cannot sell more than the remaining shares in this lot (${remainingForThisLot}).`);
      }

      let newShares = existingHolding.shares - sharesToSell;
      
      await updateDoc(doc(db, 'holdings', existingHolding.id), {
        shares: newShares,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'transactions'), {
        holdingId: existingHolding.id,
        type: 'sell',
        shares: sharesToSell,
        price: sellPrice,
        date: new Date(sellDate).toISOString(),
        userId: user.uid,
        lotId: lotTx.id
      });

      const cashValue = sharesToSell * sellPrice;
      const cashHolding = holdings.find(h => h.ticker === 'CASH');
      if (cashHolding) {
        const newCashShares = cashHolding.shares + cashValue;
        await updateDoc(doc(db, 'holdings', cashHolding.id), {
          shares: newCashShares,
          updatedAt: serverTimestamp()
        });
        
        await addDoc(collection(db, 'transactions'), {
          holdingId: cashHolding.id,
          type: 'buy',
          shares: cashValue,
          price: 1,
          date: new Date(sellDate).toISOString(),
          userId: user.uid
        });
      } else {
        const newCashHoldingRef = await addDoc(collection(db, 'holdings'), {
          ticker: 'CASH',
          shares: cashValue,
          avg_price: 1,
          avgPriceCurrency: lotTx.avgPriceCurrency || existingHolding.avgPriceCurrency || activeCurrency,
          userId: user.uid,
          portfolioType: activeTab,
          updatedAt: serverTimestamp()
        });
        
        await addDoc(collection(db, 'transactions'), {
          holdingId: newCashHoldingRef.id,
          type: 'buy',
          shares: cashValue,
          price: 1,
          date: new Date(sellDate).toISOString(),
          userId: user.uid
        });
      }

      const q = query(collection(db, 'transactions'), where('holdingId', '==', historyHolding.id), where('userId', '==', user?.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      setHistoryTransactions(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      
      setSaveMessage({ text: 'Lot shares sold successfully', type: 'success' });
      setSellingLot(null);
    } catch (error: any) {
      console.error('Error selling lot:', error);
      setUndoError(error?.message || 'Error occurred while selling lot.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleUndoTransaction = async (tx: Transaction) => {
    if (!user || !historyHolding) return;
    
    setUndoError(null);
    setIsHistoryLoading(true);
    try {
      const isBuy = tx.type === 'buy';
      const numShares = tx.shares;
      const numPrice = tx.price;

      // Use the latest holding data from the main holdings list
      const latestHolding = holdings.find(h => h.id === historyHolding.id);
      if (!latestHolding) throw new Error("Holding not found");

      let newShares = isBuy ? latestHolding.shares - numShares : latestHolding.shares + numShares;
      
      // Safety check: don't allow undoing a buy if it results in negative shares
      if (newShares < 0) {
        setUndoError("Cannot undo this transaction as it would result in negative shares. Please adjust your other transactions first.");
        setIsHistoryLoading(false);
        return;
      }
      
      // Recalculate average price only for undoing a buy
      let newAvgPrice = latestHolding.avg_price;
      if (isBuy) {
        if (newShares > 0) {
          const currentTotalCost = latestHolding.shares * latestHolding.avg_price;
          const txTotalCost = numShares * numPrice;
          newAvgPrice = (currentTotalCost - txTotalCost) / newShares;
        } else {
          newAvgPrice = 0;
        }
      }

      // Update holding
      await updateDoc(doc(db, 'holdings', latestHolding.id), {
        shares: newShares,
        avg_price: newAvgPrice,
        updatedAt: serverTimestamp()
      });

      // Delete transaction
      await deleteDoc(doc(db, 'transactions', tx.id));
      
      // Update cash backwards
      if (latestHolding.ticker !== 'CASH') {
        const cashValue = numShares * numPrice;
        const cashHolding = holdings.find(h => h.ticker === 'CASH');
        if (cashHolding) {
          const newCashShares = isBuy ? cashHolding.shares + cashValue : cashHolding.shares - cashValue;
          await updateDoc(doc(db, 'holdings', cashHolding.id), {
            shares: newCashShares,
            updatedAt: serverTimestamp()
          });
          
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

      // Refresh history
      await handleViewHistory(latestHolding);
      setConfirmUndoId(null);
      
      setSaveMessage({ text: 'Transaction undone successfully', type: 'success' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('Error undoing transaction:', error);
      setUndoError('Failed to undo transaction');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleSaveEarningsAnalysis = async () => {
    if (!earningsAnalysisResult || !selectedEarningsEvent) return;
    setIsSavingEarningsAnalysis(true);
    try {
      await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: selectedEarningsEvent.symbol,
          result: `## Earnings Analysis: ${selectedEarningsEvent.symbol} (${format(parseISO(selectedEarningsEvent.date), 'MMMM d, yyyy')})\n\n${earningsAnalysisResult}`,
        }),
      });
      setEarningsAnalysisSaved(true);
    } catch (err) {
      console.error('Failed to save earnings analysis');
    } finally {
      setIsSavingEarningsAnalysis(false);
    }
  };

  const handleAnalyzeEarnings = async (event: EarningsEvent, modelOverride?: string) => {
    setSelectedEarningsEvent(event);
    setShowEarningsAnalysisModal(true);
    setIsAnalyzingEarnings(true);
    setEarningsAnalysisResult('');
    setEarningsAnalysisSaved(false);
    setEarningsAnalysisErrorCode(null);
    setEarningsAnalysisErrorProvider(null);
    setEarningsAnalysisFallbackNotice(null);

    const activeAi = resolveAiConfig(modelOverride);
    setEarningsAnalysisModelName(activeAi.model);
    setEarningsAnalysisProviderName(activeAi.provider);

    try {
      const prompt = `You are a professional equity research analyst. Analyze the upcoming or recent earnings report for ${event.symbol}.

Company: ${event.symbol}
Earnings Date: ${event.date}
${event.estimate !== undefined ? `EPS Estimate: ${event.estimate}` : ''}

Please provide:
1. **Earnings Preview/Review**: What are the market expectations or reported figures vs consensus?
2. **Key Financial Metrics & Guidance**: Margins, revenue growth trajectory, and guidance outlook.
3. **Primary Catalysts & Risks**: What specific factors could drive an earnings surprise or sell-off?
4. **Strategic Takeaway**: Actionable commentary for an investor holding this position.

Use professional Markdown formatting with clear headings and bullet points.`;

      const res = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeAi.provider,
          model: activeAi.model,
          apiKey: activeAi.apiKey,
          customEndpoint: activeAi.customEndpoint,
          prompt,
          systemPrompt: 'You are an elite Wall Street equity research strategist with deep financial and market expertise. Deliver rigorous, data-driven, and clear investment analysis.',
          tools: activeAi.provider === 'gemini' ? [{ googleSearch: {} }] : undefined
        })
      });

      const responseData = await res.json();
      if (!res.ok) {
        setEarningsAnalysisErrorCode(responseData.code || 'PROVIDER_ERROR');
        setEarningsAnalysisErrorProvider(responseData.provider || activeAi.provider);
        throw new Error(responseData.details || responseData.error || 'Earnings analysis failed.');
      }

      if (responseData.fallbackNotice) {
        setEarningsAnalysisFallbackNotice(responseData.fallbackNotice);
      }
      if (responseData.model) {
        setEarningsAnalysisModelName(responseData.model);
      }
      if (responseData.provider) {
        setEarningsAnalysisProviderName(responseData.provider);
      }

      setEarningsAnalysisResult(responseData.text || 'Failed to generate analysis.');
    } catch (error) {
      console.error('Earnings analysis error:', error);
      setEarningsAnalysisResult(error instanceof Error ? error.message : 'An error occurred during analysis.');
    } finally {
      setIsAnalyzingEarnings(false);
    }
  };

  const handleSaveAnalysis = async () => {
    if (!analysisResult) return;
    setIsSavingAnalysis(true);
    try {
      await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: analysisTicker || 'portfolio',
          result: analysisResult,
          sentiment: analysisSentiment
        }),
      });
      setAnalysisSaved(true);
    } catch (err) {
      console.error('Failed to save analysis');
    } finally {
      setIsSavingAnalysis(false);
    }
  };

  const handleAnalyze = async (ticker?: string, modelOverride?: string) => {
    if (!ticker && holdings.length === 0) return;
    
    setIsAnalyzing(true);
    setShowAnalysisModal(true);
    setAnalysisResult('');
    setAnalysisTicker(ticker || null);
    setAnalysisSources([]);
    setAnalysisSentiment('neutral');
    setAnalysisSaved(false);
    setAnalysisErrorCode(null);
    setAnalysisErrorProvider(null);
    setAnalysisFallbackNotice(null);

    const activeAi = resolveAiConfig(modelOverride);
    setAnalysisModelName(activeAi.model);
    setAnalysisProviderName(activeAi.provider);

    try {
      let prompt = '';

      if (ticker) {
        const holding = portfolioStats.enrichedHoldings.find(h => h.ticker === ticker);
        
        if (holding) {
          prompt = `You are a professional investment strategist. Analyze this specific stock holding and provide actionable insights.
          
          Stock: ${ticker}
          Shares: ${holding.shares}
          Average Price: ${getCurrencySymbol(activeCurrency)}${holding.displayAvgPrice}
          Current Price: ${getCurrencySymbol(activeCurrency)}${holding.currentPrice}
          Current Value: ${getCurrencySymbol(activeCurrency)}${holding.currentValue}
          Profit/Loss: ${getCurrencySymbol(activeCurrency)}${holding.profitLoss} (${holding.profitLossPercent.toFixed(2)}%)
          
          Please provide:
          1. **Company Overview & Recent Performance**: Brief overview and analysis of recent price action.
          2. **Significant Recent Events**: Summarize recent earnings, major news, and market sentiment.
          3. **Fundamental Analysis**: Key drivers, valuation perspective, and competitive position.
          4. **Technical Context**: Key support/resistance levels and trend analysis.
          5. **Strategic Recommendation**: Hold, accumulate, or trim based on the current position.

          IMPORTANT: Start your response with exactly "SENTIMENT: [Bullish/Bearish/Neutral]" on the first line, then follow with your detailed analysis.
          Ensure you provide fresh, accurate context.
          Use professional Markdown formatting.`;
        } else {
          prompt = `You are a professional investment strategist. Analyze the stock ${ticker} and provide actionable insights.
          
          Please provide:
          1. **Company Overview & Recent Performance**: Brief overview and analysis of recent price action.
          2. **Significant Recent Events**: Summarize recent earnings, major news, and market sentiment.
          3. **Fundamental Analysis**: Key drivers, valuation perspective, and competitive position.
          4. **Technical Context**: Key support/resistance levels and trend analysis.
          5. **Strategic Recommendation**: Buy, hold, or sell recommendation.

          IMPORTANT: Start your response with exactly "SENTIMENT: [Bullish/Bearish/Neutral]" on the first line, then follow with your detailed analysis.
          Ensure you provide fresh, accurate context.
          Use professional Markdown formatting.`;
        }
      } else {
        const portfolioData = portfolioStats.enrichedHoldings.filter(h => h.shares !== 0).map(h => ({
          ticker: h.ticker,
          shares: h.shares,
          avgPrice: h.displayAvgPrice,
          currentPrice: h.currentPrice,
          currentValue: h.currentValue,
          profitLoss: h.profitLoss,
          profitLossPercent: h.profitLossPercent
        }));

        const totalValue = portfolioStats.totalValue;
        const totalProfit = portfolioStats.totalProfitLoss;
        const totalProfitPercent = portfolioStats.totalProfitLossPercent;

        prompt = `You are a professional investment strategist. Analyze this stock portfolio and provide actionable insights.
        
        Portfolio Summary:
        - Total Value: ${formatCurrency(totalValue, activeCurrency)}
        - Total Profit/Loss: ${formatCurrency(totalProfit, activeCurrency, true)} (${totalProfitPercent.toFixed(2)}%)
        
        Holdings:
        ${JSON.stringify(portfolioData, null, 2)}
        
        Please provide:
        1. **Stock-Specific Analysis**: Provide a detailed analysis of each individual holding, including its recent performance, potential catalysts, and outlook.
        2. **Diversification Analysis**: Evaluate concentration and sector balance.
        3. **Risk Assessment**: Identify main risks (volatility, sector specific, etc).
        4. **Strategic Recommendations**: Suggest rebalancing or areas for research.

        Ensure you provide thorough, quantitative, and strategic insights.
        Use professional Markdown formatting.`;
      }

      const res = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeAi.provider,
          model: activeAi.model,
          apiKey: activeAi.apiKey,
          customEndpoint: activeAi.customEndpoint,
          prompt,
          systemPrompt: 'You are an elite investment strategist and portfolio manager. Provide clear, rigorous, data-driven analysis and insights.',
          tools: activeAi.provider === 'gemini' ? [{ googleSearch: {} }] : undefined
        })
      });

      const responseData = await res.json();
      if (!res.ok) {
        setAnalysisErrorCode(responseData.code || 'PROVIDER_ERROR');
        setAnalysisErrorProvider(responseData.provider || activeAi.provider);
        throw new Error(responseData.details || responseData.error || 'Analysis failed');
      }

      if (responseData.fallbackNotice) {
        setAnalysisFallbackNotice(responseData.fallbackNotice);
      }
      if (responseData.model) {
        setAnalysisModelName(responseData.model);
      }
      if (responseData.provider) {
        setAnalysisProviderName(responseData.provider);
      }

      const fullText = responseData.text || 'Failed to generate analysis.';
      
      if (ticker) {
        // Parse sentiment for stock analysis
        const sentimentMatch = fullText.match(/SENTIMENT:\s*(Bullish|Bearish|Neutral)/i);
        if (sentimentMatch) {
          setAnalysisSentiment(sentimentMatch[1].toLowerCase());
          setAnalysisResult(fullText.replace(/SENTIMENT:\s*(Bullish|Bearish|Neutral)/i, '').trim());
        } else {
          setAnalysisResult(fullText);
        }
      } else {
        setAnalysisResult(fullText);
      }

      if (Array.isArray(responseData.sources)) {
        setAnalysisSources(responseData.sources);
      } else {
        setAnalysisSources([]);
      }
    } catch (error) {
      console.error('Error analyzing:', error);
      setAnalysisResult(error instanceof Error ? error.message : 'An error occurred while analyzing. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const parseCSVLocally = (csvText: string, activeTab: string) => {
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return [];

    const parseCSVLine = (text: string) => {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += char;
        }
      }
      result.push(cur.trim());
      return result;
    };

    let headerIndex = -1;
    let headers: string[] = [];
    
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const cols = parseCSVLine(lines[i]).map(c => c.toLowerCase());
      const hasTicker = cols.some(c => c.includes('ticker') || c.includes('symbol') || c.includes('code') || c.includes('instrument') || c.includes('security') || c.includes('stock'));
      const hasQty = cols.some(c => c.includes('qty') || c.includes('quantity') || c.includes('shares') || c.includes('units') || c.includes('volume'));
      
      if (hasTicker && hasQty) {
        headerIndex = i;
        headers = cols;
        break;
      }
    }

    if (headerIndex === -1) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().length > 0) {
          headerIndex = i;
          headers = parseCSVLine(lines[i]).map(c => c.toLowerCase());
          break;
        }
      }
    }

    if (headerIndex === -1) return [];

    let tickerIdx = headers.findIndex(c => c.includes('ticker') || c.includes('symbol') || c.includes('code') || c.includes('instrument') || c.includes('security') || c.includes('stock'));
    let sharesIdx = headers.findIndex(c => c.includes('shares') || c.includes('qty') || c.includes('quantity') || c.includes('units') || c.includes('volume'));
    let priceIdx = headers.findIndex(c => c.includes('avg') || c.includes('average') || c.includes('cost') || c.includes('price') || c.includes('basis') || c.includes('rate') || c.includes('unit'));

    if (tickerIdx === -1) tickerIdx = 0;
    if (sharesIdx === -1) sharesIdx = headers.length > 1 ? 1 : 0;
    if (priceIdx === -1) priceIdx = headers.length > 2 ? 2 : 0;

    const holdings = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCSVLine(line);
      if (cols.length <= Math.max(tickerIdx, sharesIdx, priceIdx)) continue;

      const ticker = cols[tickerIdx].replace(/["']/g, '').trim();
      if (!ticker || ticker.toLowerCase() === 'cash' || ticker.toLowerCase() === 'total' || ticker.toLowerCase().includes('grand total') || ticker.toLowerCase() === 'unknown') {
        continue;
      }

      const sharesStr = cols[sharesIdx].replace(/[^0-9.-]/g, '');
      const shares = parseFloat(sharesStr);

      const priceStr = cols[priceIdx].replace(/[^0-9.-]/g, '');
      const avg_price = parseFloat(priceStr);

      if (isNaN(shares) || isNaN(avg_price) || shares <= 0 || avg_price < 0) {
        continue;
      }

      let currency = undefined;
      if (activeTab === 'australia') currency = 'AUD';
      else currency = 'USD';

      holdings.push({
        ticker,
        shares,
        avg_price,
        currency
      });
    }

    return holdings;
  };

  const wasUploadingRef = useRef(false);
  useEffect(() => {
    if (wasUploadingRef.current && !isUploading && !uploadError) setShowImportMenu(false);
    wasUploadingRef.current = isUploading;
  }, [isUploading, uploadError]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdf = file.type === 'application/pdf';
    const isCsv = file.type === 'text/csv' || file.name.endsWith('.csv');

    if (!isPdf && !isCsv) {
      setUploadError('Please upload a PDF or CSV file.');
      return;
    }

    setIsUploading(true);
    setUploadError('');

    try {
      const reader = new FileReader();

      if (isPdf) {
        reader.readAsDataURL(file);
        reader.onload = async () => {
          try {
            const base64Pdf = (reader.result as string).split(',')[1];
            
            const res = await fetch('/api/gemini-analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gemini-3.1-pro-preview',
                contents: [
                  {
                    inlineData: {
                      data: base64Pdf,
                      mimeType: 'application/pdf'
                    }
                  },
                  activeTab === 'australia'
                    ? "Extract the stock portfolio from this document. This is likely an Australian brokerage statement (e.g., CommSec, Spaceship, SelfWealth, Stake). Return a list of holdings with ticker symbol, number of shares, and average price/cost basis. IMPORTANT: For Australian stocks, you MUST append '.AX' to the ticker symbol. Many Australian statements for international stocks provide costs in AUD. If you see columns like 'Unit Price (A$)', 'Total Cost (A$)', or 'FX Fee (A$)', you MUST calculate the average price by dividing the 'Total Cost (A$)' (which includes the FX fee) by the number of 'Units' or 'Shares'. Set the currency to 'AUD'. If the statement only provides the native price (e.g., USD), use that and set the currency to 'USD'."
                    : "Extract the stock portfolio from this document. Return a list of holdings with ticker symbol, number of shares, and average price/cost basis."
                ],
                config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        ticker: { type: "string", description: "Stock ticker symbol (e.g., AAPL)" },
                        shares: { type: "number", description: "Number of shares" },
                        avg_price: { type: "number", description: "Average price or cost basis per share" },
                        currency: { type: "string", description: "The currency of the average price (e.g., 'AUD', 'USD', 'INR')" }
                      },
                      required: ["ticker", "shares", "avg_price"]
                    }
                  }
                }
              })
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.details || err.error || 'PDF extraction failed');
            }
            const responseData = await res.json();
            await processExtractedHoldings(responseData.text);
          } catch (err: any) {
            console.error('Error processing PDF with Gemini:', err);
            setUploadError(err.message || 'Failed to process PDF.');
          } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        };
      } else {
        // Handle CSV
        reader.readAsText(file);
        reader.onload = async () => {
          try {
            const csvText = reader.result as string;
            let extractedText = '';
            
            try {
              const res = await fetch('/api/gemini-analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'gemini-3.1-pro-preview',
                  contents: [
                    activeTab === 'australia'
                      ? `Extract the stock portfolio from this CSV data. This is likely an Australian brokerage statement (e.g., CommSec, Spaceship, SelfWealth, Stake). 
                    Return a list of current holdings with ticker symbol, number of shares, and average price/cost basis.
                    IMPORTANT: For Australian stocks, you MUST append '.AX' to the ticker symbol. Many Australian statements for international stocks provide costs in AUD. If you see columns like 'Unit Price (A$)', 'Total Cost (A$)', or 'FX Fee (A$)', you MUST calculate the average price by dividing the 'Total Cost (A$)' (which includes the FX fee) by the number of 'Units' or 'Shares'. Set the currency to 'AUD'. If the CSV only provides the native price (e.g., USD), use that and set the currency to 'USD'.
                    
                    CSV Data:
                    ${csvText.slice(0, 30000)}`
                      : `Extract the stock portfolio from this CSV data. This is likely an Interactive Brokers Flex Query or export. 
                    Return a list of current holdings with ticker symbol, number of shares, and average price/cost basis.
                    
                    CSV Data:
                    ${csvText.slice(0, 30000)}`,
                  ],
                  config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          ticker: { type: "string" },
                          shares: { type: "number" },
                          avg_price: { type: "number" },
                          currency: { type: "string" }
                        },
                        required: ["ticker", "shares", "avg_price"]
                      }
                    }
                  }
                })
              });

              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.details || err.error || 'CSV extraction failed');
              }
              const responseData = await res.json();
              extractedText = responseData.text;
            } catch (geminiErr: any) {
              console.warn('Gemini CSV extraction failed, falling back to local parsing:', geminiErr);
              const localHoldings = parseCSVLocally(csvText, activeTab);
              if (localHoldings.length === 0) {
                throw new Error(geminiErr.message || 'Failed to process CSV file with local fallback parsing.');
              }
              extractedText = JSON.stringify(localHoldings);
            }

            await processExtractedHoldings(extractedText);
          } catch (err: any) {
            console.error('Error processing CSV:', err);
            setUploadError(err.message || 'Failed to process CSV.');
          } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        };
      }
      
      reader.onerror = () => {
        setUploadError('Failed to read file');
        setIsUploading(false);
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      setUploadError('An error occurred during upload.');
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const processExtractedHoldings = async (text: string | undefined) => {
    if (!text) {
      setUploadError('Failed to extract data from file');
      return;
    }

    const extractedHoldings = JSON.parse(text);
    if (!Array.isArray(extractedHoldings)) {
      throw new Error('Extracted data is not a list of holdings.');
    }
    if (!user) return;

    if (importMode === 'replace') {
      // Clear existing portfolio for active tab
      const q = query(collection(db, 'holdings'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      const docsToDelete = snapshot.docs.filter(d => (d.data().portfolioType || 'global') === activeTab);
      await Promise.all(docsToDelete.map(d => deleteDoc(d.ref)));
    }

    // Save to Firestore
    for (const holding of extractedHoldings) {
      if (!holding.ticker || holding.shares === undefined || holding.avg_price === undefined) {
        console.warn('Skipping invalid holding:', holding);
        continue;
      }

      let finalTicker = (holding.ticker || '').toUpperCase().trim();

      // For Australian stocks, append .AX suffix if missing
      if (activeTab === 'australia' && !finalTicker.includes('.') && finalTicker !== 'CASH') {
        finalTicker = `${finalTicker}.AX`;
      }

      const holdingShares = Number(holding.shares);
      const holdingAvgPrice = Number(holding.avg_price);

      if (isNaN(holdingShares) || isNaN(holdingAvgPrice)) {
        console.warn('Skipping holding with invalid numbers:', holding);
        continue;
      }

      if (importMode === 'merge') {
        // Check if already exists in active tab
        const q = query(
          collection(db, 'holdings'), 
          where('userId', '==', user.uid),
          where('ticker', '==', finalTicker),
          where('portfolioType', '==', activeTab)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          // Update existing
          const docRef = snapshot.docs[0].ref;
          const existingData = snapshot.docs[0].data();
          const newShares = existingData.shares + holdingShares;
          
          // Weighted average price - need to be careful if currencies are different
          // But for simplicity, we assume they are the same or we convert the new one to existing
          let normalizedHoldingAvgPrice = holdingAvgPrice;
          if (holding.currency && existingData.avgPriceCurrency && holding.currency !== existingData.avgPriceCurrency) {
            // This is a rare case, but let's handle it if we have rates
            // For now, we'll just use the existing currency and hope for the best
            // or just store them as separate docs? No, merge means merge.
          }

          const newAvgPrice = ((existingData.shares * existingData.avg_price) + (holdingShares * normalizedHoldingAvgPrice)) / newShares;
          
          await setDoc(docRef, {
            shares: newShares,
            avg_price: newAvgPrice,
            avgPriceCurrency: existingData.avgPriceCurrency || holding.currency,
            updatedAt: serverTimestamp()
          }, { merge: true });

          // Record a transaction for the merged shares!
          await addDoc(collection(db, 'transactions'), {
            holdingId: docRef.id,
            type: 'buy',
            shares: holdingShares,
            price: holdingAvgPrice,
            date: new Date().toISOString(),
            userId: user.uid
          });
          continue;
        }
      }

      const holdingRef = await addDoc(collection(db, 'holdings'), {
        ticker: finalTicker,
        shares: holdingShares,
        avg_price: holdingAvgPrice,
        avgPriceCurrency: holding.currency || activeCurrency,
        userId: user.uid,
        portfolioType: activeTab,
        updatedAt: serverTimestamp()
      });

      // Record an initial purchase transaction for the new holding!
      await addDoc(collection(db, 'transactions'), {
        holdingId: holdingRef.id,
        type: 'buy',
        shares: holdingShares,
        price: holdingAvgPrice,
        date: new Date().toISOString(),
        userId: user.uid
      });
    }
  };

  const portfolioStats = useMemo(() => {
    let totalValue = 0;
    let totalCost = 0;
    let totalDayChange = 0;

    const enrichedHoldings = holdings.map(h => {
      // Handle Cash
      if (h.ticker === 'CASH') {
        const targetCurrency = activeCurrency;
        const sourceCurrency = h.avgPriceCurrency || targetCurrency;
        
        let currentPriceVal = 1;
        let previousCloseVal = 1;
        let convertedAvgPrice = 1;

        if (sourceCurrency !== targetCurrency) {
          const rate = getExchangeRate(sourceCurrency, targetCurrency, quotes);
          currentPriceVal = rate;
          previousCloseVal = rate;
          convertedAvgPrice = rate;
        }

        const currentValue = currentPriceVal * h.shares;
        const costBasis = convertedAvgPrice * h.shares;
        const profitLoss = 0;
        const profitLossPercent = 0;
        const dayChange = 0;
        const dayChangePercent = 0;

        totalValue += currentValue;
        totalCost += costBasis;

        return {
          ...h,
          displayAvgPrice: convertedAvgPrice,
          currentPrice: currentPriceVal,
          currentValue,
          costBasis,
          profitLoss,
          profitLossPercent,
          dayChange,
          dayChangePercent,
          marketState: 'REGULAR',
          marketCap: undefined,
          realizedProfitLoss: 0
        };
      }

      const quote = quotes[h.ticker] as any;
      let currentPrice = quote?.price != null ? quote.price : (typeof quote === 'number' ? quote : h.avg_price);
      let previousClose = quote?.previousClose != null ? quote.previousClose : currentPrice;
      const marketState = quote?.marketState || 'REGULAR';
      
      const targetCurrency = activeCurrency;
      const sourceCurrency = quote?.currency;
      
      let convertedAvgPrice = h.avg_price;

      // Only convert if the stored currency is different from the target currency
      // If no stored currency, assume it's in the stock's native currency (sourceCurrency)
      const storedCurrency = h.avgPriceCurrency || sourceCurrency;

      if (storedCurrency && storedCurrency !== targetCurrency) {
        const rate = getExchangeRate(storedCurrency, targetCurrency, quotes);
        convertedAvgPrice = h.avg_price * rate;
        
        // Add currency conversion charge for Australia (0.70% typical FX fee)
        // Only add if we are converting FROM a foreign currency TO AUD
        if (h.portfolioType === 'australia' && storedCurrency !== 'AUD') {
          const fxFeeRate = 0.007;
          convertedAvgPrice = convertedAvgPrice * (1 + fxFeeRate);
        }
      }

      // Handle current price conversion (always from sourceCurrency to targetCurrency)
      let currentPriceVal = quote?.price != null ? quote.price : (typeof quote === 'number' ? quote : h.avg_price);
      let previousCloseVal = quote?.previousClose != null ? quote.previousClose : currentPriceVal;

      if (sourceCurrency && sourceCurrency !== targetCurrency) {
        const rate = getExchangeRate(sourceCurrency, targetCurrency, quotes);
        currentPriceVal *= rate;
        previousCloseVal *= rate;
      }
      
      const currentValue = currentPriceVal * h.shares;
      const costBasis = convertedAvgPrice * h.shares;
      const profitLoss = currentValue - costBasis;
      const profitLossPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;
      
      const dayChange = (currentPriceVal - previousCloseVal) * h.shares;
      const dayChangePercent = previousCloseVal > 0 ? ((currentPriceVal - previousCloseVal) / previousCloseVal) * 100 : 0;
      
      let marketCap = quote?.marketCap;
      if (marketCap && sourceCurrency) {
        const marketCapCurrency = sourceCurrency === 'GBp' ? 'GBP' : sourceCurrency;
        if (marketCapCurrency !== targetCurrency) {
          const rate = getExchangeRate(marketCapCurrency, targetCurrency, quotes);
          marketCap *= rate;
        }
      }

      let realizedProfitLoss = 0;
      if (allTransactions.length > 0) {
        const hTransactions = transactionsByHolding.get(h.id) ?? NO_TRANSACTIONS;
        if (hTransactions.length > 0) {
          const sortedTxs = sortedTransactionsByHolding.get(h.id) ?? NO_TRANSACTIONS;
          const buyPool: { id: string; shares: number; priceInTarget: number }[] = [];
          
          let conversionRate = 1;
          const storedCurrency = h.avgPriceCurrency || sourceCurrency;
          if (storedCurrency && storedCurrency !== targetCurrency) {
            conversionRate = getExchangeRate(storedCurrency, targetCurrency, quotes);
            if (h.portfolioType === 'australia' && storedCurrency !== 'AUD') {
              conversionRate *= 1.007; // FX fee
            }
          }

          const buys = sortedTxs.filter(tx => tx.type === 'buy');
          const sells = sortedTxs.filter(tx => tx.type === 'sell').map(tx => ({
            ...tx,
            remainingToMatch: tx.shares
          }));

          buys.forEach(tx => {
            buyPool.push({
              id: tx.id,
              shares: tx.shares,
              priceInTarget: tx.price * conversionRate
            });
          });

          // Match specific lots first
          sells.forEach(tx => {
            if (tx.lotId) {
              const txPriceInTarget = tx.price * conversionRate;
              const targetBuy = buyPool.find(b => b.id === tx.lotId);
              if (targetBuy && targetBuy.shares > 0) {
                const consumed = Math.min(tx.remainingToMatch, targetBuy.shares);
                const buyCost = consumed * targetBuy.priceInTarget;
                const sellValue = consumed * txPriceInTarget;
                realizedProfitLoss += (sellValue - buyCost);
                targetBuy.shares -= consumed;
                tx.remainingToMatch -= consumed;
              }
            }
          });

          // Match remainder with FIFO
          sells.forEach(tx => {
            let sharesToSell = tx.remainingToMatch;
            const txPriceInTarget = tx.price * conversionRate;
            
            while (sharesToSell > 0 && buyPool.some(b => b.shares > 0)) {
              const oldestBuy = buyPool.find(b => b.shares > 0);
              if (!oldestBuy) break;

              if (oldestBuy.shares <= sharesToSell) {
                const buyCost = oldestBuy.shares * oldestBuy.priceInTarget;
                const sellValue = oldestBuy.shares * txPriceInTarget;
                realizedProfitLoss += (sellValue - buyCost);
                sharesToSell -= oldestBuy.shares;
                oldestBuy.shares = 0;
              } else {
                const buyCost = sharesToSell * oldestBuy.priceInTarget;
                const sellValue = sharesToSell * txPriceInTarget;
                realizedProfitLoss += (sellValue - buyCost);
                oldestBuy.shares -= sharesToSell;
                sharesToSell = 0;
              }
            }
          });
        }
      }

      totalValue += currentValue;
      totalCost += costBasis;
      totalDayChange += dayChange;

      const growthMultiple = costBasis > 0 ? (currentValue / costBasis) : (currentValue > 0 ? 1 : 0);

      return {
        ...h,
        displayAvgPrice: convertedAvgPrice,
        currentPrice: currentPriceVal,
        currentValue,
        costBasis,
        profitLoss,
        profitLossPercent,
        growthMultiple,
        dayChange,
        dayChangePercent,
        marketState,
        marketCap,
        realizedProfitLoss
      };
    });

    const totalProfitLoss = totalValue - totalCost;
    const totalProfitLossPercent = totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0;
    
    // Calculate total previous close value for the portfolio to get the total day change percentage
    const totalPreviousValue = totalValue - totalDayChange;
    const totalDayChangePercent = totalPreviousValue > 0 ? (totalDayChange / totalPreviousValue) * 100 : 0;


    // Benchmark stats
    const benchmarkQuote = quotes[benchmarkTicker] as any;
    const benchmarkDayChangePercent = benchmarkQuote?.changePercent != null 
      ? benchmarkQuote.changePercent 
      : (benchmarkQuote && benchmarkQuote.previousClose > 0 
          ? ((benchmarkQuote.price - benchmarkQuote.previousClose) / benchmarkQuote.previousClose) * 100 
          : 0);
    
    const benchmarkYtdReturn = benchmarkQuote?.ytdReturn;

    return {
      enrichedHoldings,
      totalValue,
      totalCost,
      totalProfitLoss,
      totalProfitLossPercent,
      totalDayChange,
      totalDayChangePercent,
      benchmarkDayChangePercent,
      benchmarkYtdReturn,
      benchmarkTicker
    };
  }, [holdings, quotes, benchmarkTicker, allTransactions, transactionsByHolding, sortedTransactionsByHolding]);

  const combinedStats = useMemo(() => {
    let totalValue = 0;
    let totalCost = 0;
    let totalDayChange = 0;

    const targetCurrency = userSettings.combinedCurrency || 'USD';

    allHoldings.forEach(h => {
      // Handle Cash
      if (h.ticker === 'CASH') {
        const sourceCurrency = h.avgPriceCurrency || (h.portfolioType === 'australia' ? 'AUD' : 'USD');
        let rate = 1;
        if (sourceCurrency !== targetCurrency) {
          rate = getExchangeRate(sourceCurrency, targetCurrency, quotes);
        }
        const value = h.shares * rate;
        totalValue += value;
        totalCost += value;
        return;
      }

      const quote = quotes[h.ticker] as any;
      let currentPrice = quote?.price != null ? quote.price : (typeof quote === 'number' ? quote : h.avg_price);
      let previousClose = quote?.previousClose != null ? quote.previousClose : currentPrice;
      
      const sourceCurrency = quote?.currency || (h.portfolioType === 'australia' ? 'AUD' : 'USD');
      const storedCurrency = h.avgPriceCurrency || sourceCurrency;

      // Convert Cost Basis to targetCurrency
      let convertedAvgPrice = h.avg_price;
      if (storedCurrency && storedCurrency !== targetCurrency) {
        const rate = getExchangeRate(storedCurrency, targetCurrency, quotes);
        convertedAvgPrice = h.avg_price * rate;
        
        if (h.portfolioType === 'australia' && storedCurrency !== 'AUD') {
          convertedAvgPrice *= 1.007; // FX fee
        }
      }

      // Convert Current Price to targetCurrency
      let currentPriceVal = currentPrice;
      let previousCloseVal = previousClose;
      if (sourceCurrency && sourceCurrency !== targetCurrency) {
        const rate = getExchangeRate(sourceCurrency, targetCurrency, quotes);
        currentPriceVal *= rate;
        previousCloseVal *= rate;
      }

      totalValue += currentPriceVal * h.shares;
      totalCost += convertedAvgPrice * h.shares;
      totalDayChange += (currentPriceVal - previousCloseVal) * h.shares;
    });

    const totalProfitLoss = totalValue - totalCost;
    const totalProfitLossPercent = totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0;
    const totalPreviousValue = totalValue - totalDayChange;
    const totalDayChangePercent = totalPreviousValue > 0 ? (totalDayChange / totalPreviousValue) * 100 : 0;

    return {
      totalValue,
      totalCost,
      totalProfitLoss,
      totalProfitLossPercent,
      totalDayChange,
      totalDayChangePercent
    };
  }, [allHoldings, quotes, userSettings.combinedCurrency]);

  const combinedPeriodStats = useMemo(() => {
    const now = new Date();
    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    const stats = {
      allTimeRealized: 0,
      sixMonths: { realized: 0, unrealized: 0, total: 0, costBasis: 0, percent: 0 },
      ytd: { realized: 0, unrealized: 0, total: 0, costBasis: 0, percent: 0 },
      oneYear: { realized: 0, unrealized: 0, total: 0, costBasis: 0, percent: 0 }
    };

    if (!user || allTransactions.length === 0) return stats;

    const targetCurrency = userSettings.combinedCurrency || 'USD';

    allHoldings.forEach(h => {
      if (h.ticker === 'CASH') return;

      const hTransactions = transactionsByHolding.get(h.id) ?? NO_TRANSACTIONS;
      if (hTransactions.length === 0) return;

      const quote = quotes[h.ticker] as any;
      let currentPriceVal = quote?.price != null ? quote.price : h.avg_price;
      const sourceCurrency = quote?.currency || (h.portfolioType === 'australia' ? 'AUD' : 'USD');
      
      if (sourceCurrency && sourceCurrency !== targetCurrency) {
        const rate = getExchangeRate(sourceCurrency, targetCurrency, quotes);
        currentPriceVal *= rate;
      }

      const storedCurrency = h.avgPriceCurrency || sourceCurrency;
      let conversionRate = 1;
      if (storedCurrency && storedCurrency !== targetCurrency) {
        conversionRate = getExchangeRate(storedCurrency, targetCurrency, quotes);
        if (h.portfolioType === 'australia' && storedCurrency !== 'AUD') {
          conversionRate *= 1.007;
        }
      }

      const sortedTxs = sortedTransactionsByHolding.get(h.id) ?? NO_TRANSACTIONS;

      const buyPool: { date: Date; shares: number; priceInTarget: number }[] = [];
      const realizedGains: { date: Date; amount: number; cost: number }[] = [];

      sortedTxs.forEach(tx => {
        const txDate = new Date(tx.date);
        const txPriceInTarget = tx.price * conversionRate;

        if (tx.type === 'buy') {
          buyPool.push({
            date: txDate,
            shares: tx.shares,
            priceInTarget: txPriceInTarget
          });
        } else if (tx.type === 'sell') {
          let sharesToSell = tx.shares;
          while (sharesToSell > 0 && buyPool.length > 0) {
            const oldestBuy = buyPool[0];
            if (oldestBuy.shares <= sharesToSell) {
              const buyCost = oldestBuy.shares * oldestBuy.priceInTarget;
              const sellValue = oldestBuy.shares * txPriceInTarget;
              realizedGains.push({
                date: txDate,
                amount: sellValue - buyCost,
                cost: buyCost
              });
              sharesToSell -= oldestBuy.shares;
              buyPool.shift();
            } else {
              const buyCost = sharesToSell * oldestBuy.priceInTarget;
              const sellValue = sharesToSell * txPriceInTarget;
              realizedGains.push({
                date: txDate,
                amount: sellValue - buyCost,
                cost: buyCost
              });
              oldestBuy.shares -= sharesToSell;
              sharesToSell = 0;
            }
          }
        }
      });

      realizedGains.forEach(gain => {
        stats.allTimeRealized += gain.amount;
        const d = gain.date;
        if (d >= sixMonthsAgo) {
          stats.sixMonths.realized += gain.amount;
          stats.sixMonths.costBasis += gain.cost;
        }
        if (d >= ytdStart) {
          stats.ytd.realized += gain.amount;
          stats.ytd.costBasis += gain.cost;
        }
        if (d >= oneYearAgo) {
          stats.oneYear.realized += gain.amount;
          stats.oneYear.costBasis += gain.cost;
        }
      });

      buyPool.forEach(lot => {
        const d = lot.date;
        const lotCost = lot.shares * lot.priceInTarget;
        const lotCurrentValue = lot.shares * currentPriceVal;
        const lotUnrealized = lotCurrentValue - lotCost;

        if (d >= sixMonthsAgo) {
          stats.sixMonths.unrealized += lotUnrealized;
          stats.sixMonths.costBasis += lotCost;
        }
        if (d >= ytdStart) {
          stats.ytd.unrealized += lotUnrealized;
          stats.ytd.costBasis += lotCost;
        }
        if (d >= oneYearAgo) {
          stats.oneYear.unrealized += lotUnrealized;
          stats.oneYear.costBasis += lotCost;
        }
      });
    });

    const calculatePeriodTotals = (period: { realized: number; unrealized: number; total: number; costBasis: number; percent: number }) => {
      period.total = period.realized + period.unrealized;
      if (period.costBasis > 0) {
        period.percent = (period.total / period.costBasis) * 100;
      } else if (combinedStats.totalCost > 0) {
        period.percent = (period.total / combinedStats.totalCost) * 100;
      } else if (combinedStats.totalValue > 0) {
        period.percent = (period.total / combinedStats.totalValue) * 100;
      } else {
        period.percent = 0;
      }
    };

    calculatePeriodTotals(stats.sixMonths);
    calculatePeriodTotals(stats.ytd);
    calculatePeriodTotals(stats.oneYear);

    return stats;
  }, [allHoldings, allTransactions, transactionsByHolding, sortedTransactionsByHolding, quotes, userSettings.combinedCurrency, user, combinedStats.totalCost, combinedStats.totalValue]);

  const tabPeriodStats = useMemo(() => {
    const now = new Date();
    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    const stats = {
      sixMonths: { realized: 0, unrealized: 0 },
      ytd: { realized: 0, unrealized: 0 },
      oneYear: { realized: 0, unrealized: 0 }
    };

    if (!user || allTransactions.length === 0) return stats;

    const targetCurrency = activeCurrency;

    holdings.forEach(h => {
      if (h.ticker === 'CASH') return;

      const hTransactions = transactionsByHolding.get(h.id) ?? NO_TRANSACTIONS;
      if (hTransactions.length === 0) return;

      const quote = quotes[h.ticker] as any;
      let currentPriceVal = quote?.price != null ? quote.price : h.avg_price;
      const sourceCurrency = quote?.currency;
      
      if (sourceCurrency && sourceCurrency !== targetCurrency) {
        const rate = getExchangeRate(sourceCurrency, targetCurrency, quotes);
        currentPriceVal *= rate;
      }

      const storedCurrency = h.avgPriceCurrency || sourceCurrency;
      let conversionRate = 1;
      if (storedCurrency && storedCurrency !== targetCurrency) {
        conversionRate = getExchangeRate(storedCurrency, targetCurrency, quotes);
        if (h.portfolioType === 'australia' && storedCurrency !== 'AUD') {
          conversionRate *= 1.007;
        }
      }

      const sortedTxs = sortedTransactionsByHolding.get(h.id) ?? NO_TRANSACTIONS;

      const buyPool: { date: Date; shares: number; priceInTarget: number }[] = [];
      const realizedGains: { date: Date; amount: number }[] = [];

      sortedTxs.forEach(tx => {
        const txDate = new Date(tx.date);
        const txPriceInTarget = tx.price * conversionRate;

        if (tx.type === 'buy') {
          buyPool.push({
            date: txDate,
            shares: tx.shares,
            priceInTarget: txPriceInTarget
          });
        } else if (tx.type === 'sell') {
          let sharesToSell = tx.shares;
          while (sharesToSell > 0 && buyPool.length > 0) {
            const oldestBuy = buyPool[0];
            if (oldestBuy.shares <= sharesToSell) {
              const buyCost = oldestBuy.shares * oldestBuy.priceInTarget;
              const sellValue = oldestBuy.shares * txPriceInTarget;
              realizedGains.push({
                date: txDate,
                amount: sellValue - buyCost
              });
              sharesToSell -= oldestBuy.shares;
              buyPool.shift();
            } else {
              const buyCost = sharesToSell * oldestBuy.priceInTarget;
              const sellValue = sharesToSell * txPriceInTarget;
              realizedGains.push({
                date: txDate,
                amount: sellValue - buyCost
              });
              oldestBuy.shares -= sharesToSell;
              sharesToSell = 0;
            }
          }
        }
      });

      realizedGains.forEach(gain => {
        const d = gain.date;
        if (d >= sixMonthsAgo) stats.sixMonths.realized += gain.amount;
        if (d >= ytdStart) stats.ytd.realized += gain.amount;
        if (d >= oneYearAgo) stats.oneYear.realized += gain.amount;
      });

      buyPool.forEach(lot => {
        const d = lot.date;
        const lotCost = lot.shares * lot.priceInTarget;
        const lotCurrentValue = lot.shares * currentPriceVal;
        const lotUnrealized = lotCurrentValue - lotCost;

        if (d >= sixMonthsAgo) stats.sixMonths.unrealized += lotUnrealized;
        if (d >= ytdStart) stats.ytd.unrealized += lotUnrealized;
        if (d >= oneYearAgo) stats.oneYear.unrealized += lotUnrealized;
      });
    });

    return stats;
  }, [holdings, allTransactions, transactionsByHolding, sortedTransactionsByHolding, quotes, activeCurrency, user]);

  const sortedHoldings = useMemo(() => {
    let sortableItems = portfolioStats.enrichedHoldings.filter(h => h.shares !== 0);
    
    if (filterGroup) {
      if (chartView === 'asset') {
        sortableItems = sortableItems.filter(h => h.ticker === filterGroup);
      } else if (chartView === 'industry') {
        sortableItems = sortableItems.filter(h => {
          const sector = h.ticker === 'CASH' ? 'Cash' : (metadata[h.ticker]?.sector || 'Unknown');
          return sector === filterGroup;
        });
      }
    }

    if (sortConfig !== null && sortConfig.key !== 'manual') {
      sortableItems.sort((a, b) => {
        const aVal = a[sortConfig.key] ?? -Infinity;
        const bVal = b[sortConfig.key] ?? -Infinity;
        if (aVal < bVal) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [portfolioStats.enrichedHoldings, sortConfig, filterGroup, chartView, metadata]);

  const sortedWatchlist = useMemo(() => {
    return portfolioStats.enrichedHoldings
      .filter(h => h.shares === 0)
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [portfolioStats.enrichedHoldings]);

  const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#10b981', '#06b6d4', '#3b82f6'];

  const chartData = useMemo(() => {
    // Group by ticker for the pie chart
    const grouped: Record<string, { value: number, profitLoss: number, cost: number }> = {};
    sortedHoldings.forEach(h => {
      if (!grouped[h.ticker]) {
        grouped[h.ticker] = { value: 0, profitLoss: 0, cost: 0 };
      }
      grouped[h.ticker].value += h.currentValue;
      grouped[h.ticker].profitLoss += h.profitLoss;
      grouped[h.ticker].cost += h.costBasis;
    });
    
    return Object.entries(grouped)
      .map(([name, data]) => ({ name, value: data.value, profitLoss: data.profitLoss, cost: data.cost }))
      .sort((a, b) => b.value - a.value);
  }, [sortedHoldings]);

  const sectorData = useMemo(() => {
    const grouped: Record<string, { value: number, cost: number, profitLoss: number }> = {};
    sortedHoldings.forEach(h => {
      const sector = h.ticker === 'CASH' ? 'Cash' : (metadata[h.ticker]?.sector || 'Unknown');
      if (!grouped[sector]) {
        grouped[sector] = { value: 0, cost: 0, profitLoss: 0 };
      }
      grouped[sector].value += h.currentValue;
      grouped[sector].cost += h.costBasis;
      grouped[sector].profitLoss += h.profitLoss;
    });

    return Object.entries(grouped)
      .map(([name, data]) => ({ name, value: data.value, cost: data.cost, profitLoss: data.profitLoss }))
      .sort((a, b) => b.value - a.value);
  }, [sortedHoldings, metadata]);

  const { minScatterCost, maxScatterCost, minScatterValue, maxScatterValue } = useMemo(() => {
    const data = chartView === 'asset' ? chartData : sectorData;
    const costs = data.map(d => d.cost).filter(c => c > 0);
    const values = data.map(d => d.value).filter(v => v > 0);
    return {
      minScatterCost: costs.length > 0 ? Math.min(...costs) : 0,
      maxScatterCost: costs.length > 0 ? Math.max(...costs) : 10000,
      minScatterValue: values.length > 0 ? Math.min(...values) : 0,
      maxScatterValue: values.length > 0 ? Math.max(...values) : 10000,
    };
  }, [chartView, chartData, sectorData]);

  const maxScatterProfit = useMemo(() => {
    const data = chartView === 'asset' ? chartData : sectorData;
    const profits = data.map(d => d.profitLoss).filter(p => p > 0);
    return profits.length > 0 ? Math.max(...profits) : 1000;
  }, [chartView, chartData, sectorData]);

  const maxScatterLoss = useMemo(() => {
    const data = chartView === 'asset' ? chartData : sectorData;
    const losses = data.map(d => Math.abs(d.profitLoss)).filter((_, i) => data[i].profitLoss < 0);
    return losses.length > 0 ? Math.max(...losses) : 1000;
  }, [chartView, chartData, sectorData]);

  const scatterPlotData = useMemo(() => {
    const rawData = chartView === 'asset' ? chartData : sectorData;
    // Always sort descending by value so larger bubbles render first (at bottom of SVG stack)
    const sorted = [...rawData].sort((a, b) => b.value - a.value);

    if (!deconflictScatter || sorted.length <= 1) {
      return sorted.map(d => ({ ...d, offsetX: 0, offsetY: 0 }));
    }

    const costs = sorted.map(d => d.cost);
    const values = sorted.map(d => d.value);
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const costRange = maxCost - minCost || 1;
    const valueRange = maxValue - minValue || 1;

    // Approximate screen dimensions of chart plot area
    const plotWidth = 720;
    const plotHeight = 320;

    const points = sorted.map(d => ({
      ...d,
      px: ((d.cost - minCost) / costRange) * plotWidth,
      py: plotHeight - ((d.value - minValue) / valueRange) * plotHeight,
      offsetX: 0,
      offsetY: 0,
    }));

    // Find overlapping clusters (distance < 36px)
    const threshold = 36;
    const visited = new Set<number>();
    const clusters: number[][] = [];

    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      const cluster = [i];
      visited.add(i);

      for (let j = i + 1; j < points.length; j++) {
        if (visited.has(j)) continue;
        const dx = points[i].px - points[j].px;
        const dy = points[i].py - points[j].py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < threshold) {
          cluster.push(j);
          visited.add(j);
        }
      }

      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }

    // Spread each cluster around its center
    clusters.forEach(clusterIndices => {
      const count = clusterIndices.length;
      const radius = Math.min(30, 14 + count * 4.5);
      clusterIndices.forEach((idx, k) => {
        const angle = (2 * Math.PI * k) / count - Math.PI / 2;
        points[idx].offsetX = Math.round(Math.cos(angle) * radius);
        points[idx].offsetY = Math.round(Math.sin(angle) * radius);
      });
    });

    return points;
  }, [chartView, chartData, sectorData, deconflictScatter]);

  const getMarketStateBadge = (state?: string) => {
    if (!state || state === 'REGULAR') return null;
    
    let label = state;
    let color = 'bg-zinc-100 text-zinc-600';
    
    if (state === 'PRE') {
      label = 'PRE';
      color = 'bg-amber-100 text-amber-700';
    } else if (state === 'POST' || state === 'CLOSED' || state === 'POSTPOST') {
      label = 'POST';
      color = 'bg-indigo-100 text-indigo-700';
    }
    
    return (
      <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-2", color)}>
        {label}
      </span>
    );
  };

  if (loading || isAuthLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <Briefcase className="w-12 h-12 text-zinc-300 mb-4" />
          <div className="text-zinc-500 font-medium">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200 max-w-md w-full text-center">
          <div className="bg-zinc-900 w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-6">
            <Briefcase className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Portfolio Tracker</h1>
          <p className="text-zinc-500 mb-8">Please sign in to access your portfolio.</p>
          <button
            onClick={handleConnect}
            className="w-full flex items-center justify-center gap-3 bg-white border border-zinc-300 text-zinc-700 px-4 py-3 rounded-xl hover:bg-zinc-50 transition-colors font-medium"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
              <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z"/>
                <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z"/>
                <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.724 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z"/>
                <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z"/>
              </g>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const getMarketStatus = (tabId: string) => {
    // Check the benchmark ticker's market state as a proxy for the general market
    const tabBenchmark = tabSettings[tabId]?.benchmark || (tabId === 'australia' ? '^AXJO' : 'SPY');
    const benchmarkQuote = quotes[tabBenchmark] as any;
    if (!benchmarkQuote) return null;
    
    const state = benchmarkQuote.marketState;
    if (!state || state === 'REGULAR') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold border border-emerald-100 ml-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          OPEN
        </div>
      );
    }
    
    if (state === 'PRE') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[10px] font-bold border border-amber-100 ml-2">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          PRE
        </div>
      );
    }
    
    if (state === 'POST' || state === 'POSTPOST') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-bold border border-indigo-100 ml-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          POST
        </div>
      );
    }

    if (state === 'CLOSED') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full text-[10px] font-bold border border-zinc-200 ml-2">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
          CLOSED
        </div>
      );
    }
    
    return null;
  };

  const COLUMNS = [
    { id: 'ticker', label: 'Asset', align: 'left' as const, sortKey: 'ticker' as SortKey },
    { id: 'fearGreed', label: 'Fear/Greed', align: 'center' as const, sortKey: 'ticker' as SortKey },
    { id: 'shares', label: 'Shares', align: 'right' as const, sortKey: 'shares' as SortKey },
    { id: 'displayAvgPrice', label: `Avg Cost (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'displayAvgPrice' as SortKey },
    { id: 'costBasis', label: `Investment Cost (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'costBasis' as SortKey },
    { id: 'currentPrice', label: `Price (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'currentPrice' as SortKey },
    { id: 'dayChange', label: `Day Change (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'dayChange' as SortKey },
    { id: 'currentValue', label: `Total Value (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'currentValue' as SortKey },
    { id: 'allocation', label: 'Allocation', align: 'right' as const, sortKey: 'currentValue' as SortKey },
    { id: 'profitLoss', label: `Total Return (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'profitLoss' as SortKey },
    { id: 'growthMultiple', label: 'Growth Multiple', align: 'right' as const, sortKey: 'growthMultiple' as SortKey },
    { id: 'realizedProfitLoss', label: `Realized P&L (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'realizedProfitLoss' as SortKey },
    { id: 'marketCap', label: `Market Cap (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'marketCap' as SortKey },
  ];

  const handleHoldingsTableDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    if (active.id !== over.id) {
      const activeId = active.id as string;
      const overId = over.id as string;

      // Check if it's a column reorder
      if (columnOrder.includes(activeId)) {
        setColumnOrder((items) => {
          const oldIndex = items.indexOf(activeId);
          const newIndex = items.indexOf(overId);
          const newOrder = arrayMove(items, oldIndex, newIndex);
          saveTableLayout({ columnOrder: newOrder });
          return newOrder;
        });
      } else {
        // It's a holding reorder
        const oldIndex = allHoldings.findIndex(h => h.id === activeId);
        const newIndex = allHoldings.findIndex(h => h.id === overId);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          const newHoldings = arrayMove([...allHoldings], oldIndex, newIndex);
          
          // Assign sequential order values to all holdings of the active tab
          let orderCounter = 0;
          const updatedHoldings = newHoldings.map((h) => {
            if ((h.portfolioType || 'global') === activeTab) {
              return { ...h, order: orderCounter++ };
            }
            return h;
          });

          setAllHoldings(updatedHoldings);
          
          // Set sort to manual when user starts reordering
          const newSortConfig = { key: 'manual' as SortKey, direction: 'asc' as const };
          setSortConfig(newSortConfig);
          saveTableLayout({ sortConfig: newSortConfig });
          
          // Persist the new order of active tab holdings to Firestore
          const activeTabHoldings = updatedHoldings.filter(h => (h.portfolioType || 'global') === activeTab);
          activeTabHoldings.forEach(async (h) => {
            try {
              await updateDoc(doc(db, 'holdings', h.id), { order: h.order });
            } catch (err) {
              console.error('Error updating holding order:', err);
            }
          });
        }
      }
    }
  };

  const renderCell = (colId: string, holding: any) => {
    switch (colId) {
      case 'ticker':
        return (
          <td key={colId} className="px-6 py-4" onClick={(e) => { e.stopPropagation(); if (editingId !== holding.id) handleEditClick(holding, 'ticker'); }}>
            <div className="flex items-center gap-3">
              <CompanyLogo ticker={holding.ticker} logo={metadata[holding.ticker]?.logo} />
              {editingId === holding.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editTicker}
                    onChange={(e) => setEditTicker(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(holding.id);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    className="w-24 px-2 py-1 border border-zinc-300 rounded focus:outline-none focus:ring-1 focus:ring-zinc-900 uppercase text-xs font-mono font-bold"
                    placeholder="Ticker"
                    autoFocus={editField === 'ticker'}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(holding.id)}
                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                    title="Save"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="p-1 text-zinc-400 hover:bg-zinc-100 rounded"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="font-semibold text-zinc-900 group-hover/row:text-indigo-600 transition-colors flex items-center gap-1.5">
                  <span>{holding.ticker}</span>
                  {(holding.avg_price < 0 || holding.shares < 0) && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-rose-100 text-rose-700 font-bold rounded">
                      Negative
                    </span>
                  )}
                </div>
              )}
            </div>
          </td>
        );
      case 'fearGreed':
        const hFg = fearGreedData?.details?.find((d: any) => d.symbol === holding.ticker);
        return (
          <td key={colId} className="px-6 py-4 text-center">
            {hFg ? (
              <div 
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-all shadow-sm border",
                  hFg.score <= 25 ? "text-rose-600 bg-rose-50 border-rose-100" :
                  hFg.score <= 45 ? "text-orange-600 bg-orange-50 border-orange-100" :
                  hFg.score <= 55 ? "text-zinc-600 bg-zinc-50 border-zinc-100" :
                  hFg.score <= 75 ? "text-emerald-600 bg-emerald-50 border-emerald-100" :
                  "text-blue-600 bg-blue-50 border-blue-100"
                )}
                title={`RSI: ${Math.round(hFg.rsi)} | Momentum: ${hFg.momentum > 0 ? '+' : ''}${hFg.momentum.toFixed(1)}%`}
              >
                <Activity size={10} />
                {Math.round(hFg.score)}
              </div>
            ) : (
              <span className="text-zinc-300 text-[10px] font-bold">--</span>
            )}
          </td>
        );
      case 'shares':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm" onClick={(e) => { e.stopPropagation(); if (editingId !== holding.id) handleEditClick(holding, 'shares'); }}>
            {editingId === holding.id ? (
              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editShares}
                  onChange={(e) => setEditShares(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit(holding.id);
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                  className="w-20 px-2 py-1 border border-zinc-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-zinc-900 text-xs font-mono"
                  min="0"
                  step="any"
                  autoFocus={editField === 'shares'}
                />
                <button
                  type="button"
                  onClick={() => handleSaveEdit(holding.id)}
                  className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                  title="Save"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="p-1 text-zinc-400 hover:bg-zinc-100 rounded"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2 group/shares">
                <span className={holding.shares < 0 ? "text-rose-600 font-bold" : ""}>
                  {holding.shares.toLocaleString()}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQuickAddClick(holding);
                  }}
                  className="p-1 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors opacity-100 sm:opacity-0 group-hover/row:opacity-100"
                  title="Quick Add Quantity"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </td>
        );
      case 'displayAvgPrice':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm" onClick={(e) => { e.stopPropagation(); if (editingId !== holding.id) handleEditClick(holding, 'displayAvgPrice'); }}>
            {editingId === holding.id ? (
              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <select
                  value={editAvgPriceCurrency}
                  onChange={(e) => setEditAvgPriceCurrency(e.target.value)}
                  className="px-1 py-1 border border-zinc-300 rounded focus:outline-none focus:ring-1 focus:ring-zinc-900 bg-white text-xs"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="AUD">AUD</option>
                  <option value="CAD">CAD</option>
                  <option value="INR">INR</option>
                  <option value="SGD">SGD</option>
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editAvgPrice}
                  onChange={(e) => setEditAvgPrice(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit(holding.id);
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                  className="w-20 px-2 py-1 border border-zinc-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-zinc-900 text-xs font-mono"
                  min="0"
                  step="any"
                  autoFocus={editField === 'displayAvgPrice'}
                />
                <button
                  type="button"
                  onClick={() => handleSaveEdit(holding.id)}
                  className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                  title="Save"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="p-1 text-zinc-400 hover:bg-zinc-100 rounded"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <span className={holding.avg_price < 0 ? "text-rose-600 font-bold bg-rose-50 px-1 py-0.5 rounded" : ""}>
                {formatCurrency(holding.displayAvgPrice, activeCurrency)}
              </span>
            )}
          </td>
        );
      case 'costBasis':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm">
            {formatCurrency(holding.costBasis, activeCurrency)}
          </td>
        );
      case 'currentPrice':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm font-medium">
            <div className="flex items-center justify-end">
              {formatCurrency(holding.currentPrice, activeCurrency)}
              {getMarketStateBadge((holding as any).marketState)}
            </div>
          </td>
        );
      case 'dayChange':
        return (
          <td key={colId} className="px-6 py-4 text-right">
            <PulseCell value={holding.dayChange} className="items-end">
              <div className={cn(
                "inline-flex items-center gap-1 font-medium text-sm",
                holding.dayChange >= 0 ? "text-emerald-600" : "text-rose-600"
              )}>
                {holding.dayChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {holding.dayChange >= 0 ? '+' : '-'}{Math.abs(holding.dayChangePercent).toFixed(2)}%
              </div>
              <div className={cn(
                "text-xs mt-0.5 font-mono",
                holding.dayChange >= 0 ? "text-emerald-600/70" : "text-rose-600/70"
              )}>
                {formatCurrency(holding.dayChange, activeCurrency, true)}
              </div>
            </PulseCell>
          </td>
        );
      case 'currentValue':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm font-medium">
            {formatCurrency(holding.currentValue, activeCurrency)}
          </td>
        );
      case 'allocation':
        const allocationPercent = portfolioStats.totalValue > 0 
          ? (holding.currentValue / portfolioStats.totalValue) * 100 
          : 0;
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm">
            <div className="font-medium text-zinc-900">{allocationPercent.toFixed(1)}%</div>
            <div className="w-16 h-1 bg-zinc-100 rounded-full mt-1.5 ml-auto overflow-hidden">
              <div 
                className="h-full bg-indigo-500 rounded-full" 
                style={{ width: `${Math.min(allocationPercent, 100)}%` }}
              />
            </div>
          </td>
        );
      case 'profitLoss': {
        const multiple = holding.costBasis > 0 
          ? (holding.currentValue / holding.costBasis) 
          : (holding.currentValue > 0 ? 1 : 0);
        return (
          <td key={colId} className="px-6 py-4 text-right">
            <PulseCell value={holding.profitLoss} className="items-end">
              <div className="flex items-center justify-end gap-1.5">
                <div className={cn(
                  "inline-flex items-center gap-1 font-medium text-sm",
                  holding.profitLoss >= 0 ? "text-emerald-600" : "text-rose-600"
                )}>
                  {holding.profitLoss >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {holding.profitLoss >= 0 ? '+' : '-'}{Math.abs(holding.profitLossPercent).toFixed(2)}%
                </div>
                {holding.costBasis > 0 && (
                  <span 
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shadow-2xs",
                      multiple >= 2 ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800" :
                      multiple >= 1 ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900" :
                      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900"
                    )}
                    title={`Growth multiple: ${multiple.toFixed(2)}x initial cost`}
                  >
                    {multiple.toFixed(2)}x
                  </span>
                )}
              </div>
              <div className={cn(
                "text-xs mt-0.5 font-mono",
                holding.profitLoss >= 0 ? "text-emerald-600/70" : "text-rose-600/70"
              )}>
                {formatCurrency(holding.profitLoss, activeCurrency, true)}
              </div>
            </PulseCell>
          </td>
        );
      }
      case 'growthMultiple': {
        const multiple = holding.costBasis > 0 
          ? (holding.currentValue / holding.costBasis) 
          : (holding.currentValue > 0 ? 1 : 0);
        const isGain = multiple >= 1;
        return (
          <td key={colId} className="px-6 py-4 text-right">
            <div className="flex items-center justify-end">
              <span 
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold border shadow-2xs transition-all hover:scale-105",
                  multiple >= 2 ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800" :
                  multiple >= 1 ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900" :
                  "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900"
                )}
                title={`Investment has grown ${multiple.toFixed(2)}x (${((multiple - 1) * 100).toFixed(1)}% gain)`}
              >
                {isGain ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> : <TrendingDown className="w-3.5 h-3.5 text-rose-600" />}
                {multiple.toFixed(2)}x
              </span>
            </div>
          </td>
        );
      }
      case 'realizedProfitLoss':
        return (
          <td key={colId} className="px-6 py-4 text-right">
            <div className={cn(
              "text-sm font-semibold font-mono",
              holding.realizedProfitLoss > 0 ? "text-emerald-600" : holding.realizedProfitLoss < 0 ? "text-rose-600" : "text-zinc-400"
            )}>
              {holding.realizedProfitLoss > 0 ? '+' : ''}{formatCurrency(holding.realizedProfitLoss, activeCurrency, true)}
            </div>
          </td>
        );
      case 'marketCap':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm">
            {holding.marketCap ? (
              holding.marketCap >= 1e12 
                ? `${formatCurrency(holding.marketCap / 1e12, activeCurrency, false, 2)}T`
                : holding.marketCap >= 1e9 
                  ? `${formatCurrency(holding.marketCap / 1e9, activeCurrency, false, 2)}B`
                  : `${formatCurrency(holding.marketCap / 1e6, activeCurrency, false, 2)}M`
            ) : '-'}
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans pb-20">
      <SettingsModal 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        tabSettings={tabSettings}
        userSettings={userSettings}
        activeTab={activeTab}
        onSave={handleSaveSettings}
        isSaving={isSavingSettings}
      />
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-[100]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-zinc-900 p-2 rounded-lg">
              <Briefcase className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Portfolio Tracker</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-zinc-50 border border-zinc-100 rounded-xl">
              {userSettings.avatarUrl ? (
                <img src={userSettings.avatarUrl} alt={userSettings.displayName} className="w-6 h-6 rounded-full object-cover border border-zinc-200" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-[10px] font-bold">
                  {userSettings.displayName?.charAt(0) || 'U'}
                </div>
              )}
              <span className="text-sm font-bold text-zinc-700">
                {userSettings.displayName || user.email?.split('@')[0]}
              </span>
            </div>
            <button
              onClick={() => {
                setShowSavedAnalysesModal(true);
                fetchSavedAnalyses();
              }}
              className="p-2 text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex items-center gap-2"
              title="Saved AI Analyses"
            >
              <FileText size={20} />
              <span className="hidden sm:inline text-sm font-semibold">Saved Notes</span>
            </button>
            <button
              onClick={toggleDarkMode}
              className="p-2 text-zinc-500 hover:text-indigo-600 hover:bg-zinc-100 rounded-xl transition-all"
              title={userSettings.darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {userSettings.darkMode ? <Sun size={20} className="text-amber-500 fill-amber-500/20" /> : <Moon size={20} />}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
              title="Settings"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={handleLogout}
              className="text-sm font-bold text-zinc-500 hover:text-rose-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
        {userSettings.showCombinedSummary && (() => {
          return (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-0">
              <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto no-scrollbar">
                  <div className="p-4 flex flex-row items-center gap-6 lg:gap-10 min-w-max">
                    <div className="flex flex-col min-w-max">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Combined Value</span>
                        <select 
                          value={userSettings.combinedCurrency || 'USD'}
                          onChange={async (e) => {
                            const newCurrency = e.target.value;
                            const updatedSettings = { ...userSettings, combinedCurrency: newCurrency };
                            setUserSettings(updatedSettings);
                            if (user) {
                              try {
                                await setDoc(doc(db, 'settings', user.uid), { user: updatedSettings }, { merge: true });
                              } catch (error) {
                                console.error('Error updating combined currency:', error);
                              }
                            }
                          }}
                          className="text-xs font-bold bg-zinc-100 text-zinc-600 px-2 py-1 rounded border-none focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-zinc-200 transition-colors"
                        >
                          <option value="USD">USD</option>
                          <option value="INR">INR</option>
                          <option value="AUD">AUD</option>
                          <option value="EUR">EUR</option>
                          <option value="GBP">GBP</option>
                          <option value="CAD">CAD</option>
                          <option value="SGD">SGD</option>
                        </select>
                      </div>
                      <span className="text-2xl font-semibold tracking-tight text-zinc-900">
                        <AnimatedCountUp value={combinedStats.totalValue} currency={userSettings.combinedCurrency || 'USD'} />
                      </span>
                    </div>

                    <div className="flex flex-row gap-6 lg:gap-8 ml-auto min-w-max">
                      <div className="space-y-0.5">
                        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Combined Return
                        </div>
                        <div className={cn("text-xl md:text-2xl font-medium flex items-center gap-2", combinedStats.totalProfitLossPercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          <AnimatedCountUp value={combinedStats.totalProfitLoss} currency={userSettings.combinedCurrency || 'USD'} includeSign={true} />
                        </div>
                        <div className={cn("text-xs font-medium flex items-center gap-1", combinedStats.totalProfitLossPercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {combinedStats.totalProfitLossPercent >= 0 ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                          <AnimatedCountUp value={Math.abs(combinedStats.totalProfitLossPercent)} suffix="% All Time" />
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Realized Return
                        </div>
                        <div className={cn("text-xl md:text-2xl font-medium flex items-center gap-2", combinedPeriodStats.allTimeRealized >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          <AnimatedCountUp value={combinedPeriodStats.allTimeRealized} currency={userSettings.combinedCurrency || 'USD'} includeSign={true} />
                        </div>
                        <div className="text-xs font-medium text-zinc-400">
                          Closed Positions
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Combined Day Change
                        </div>
                        <div className={cn("text-xl md:text-2xl font-medium flex items-center gap-2", combinedStats.totalDayChangePercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          <AnimatedCountUp value={combinedStats.totalDayChange} currency={userSettings.combinedCurrency || 'USD'} includeSign={true} />
                        </div>
                        <div className={cn("text-xs font-medium flex items-center gap-1", combinedStats.totalDayChangePercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {combinedStats.totalDayChangePercent >= 0 ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                          <AnimatedCountUp value={Math.abs(combinedStats.totalDayChangePercent)} suffix="% Today" />
                        </div>
                      </div>

                      <div className="h-10 w-px bg-zinc-200 self-center shrink-0 hidden md:block" />

                      <div className="space-y-0.5">
                        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Total Gain 6M
                        </div>
                        <div className={cn("text-xl md:text-2xl font-medium flex items-center gap-2", combinedPeriodStats.sixMonths.total >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          <AnimatedCountUp value={combinedPeriodStats.sixMonths.total} currency={userSettings.combinedCurrency || 'USD'} includeSign={true} />
                        </div>
                        <div className={cn("text-xs font-medium flex items-center gap-1", combinedPeriodStats.sixMonths.percent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {combinedPeriodStats.sixMonths.percent >= 0 ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                          <AnimatedCountUp value={Math.abs(combinedPeriodStats.sixMonths.percent)} suffix="% 6M" />
                        </div>
                        <div className="text-[10px] text-zinc-500 font-medium flex items-center gap-1 pt-0.5">
                          <span>Realized:</span>
                          <span className={cn("font-semibold font-mono", combinedPeriodStats.sixMonths.realized >= 0 ? "text-emerald-600" : "text-rose-600")}>
                            {combinedPeriodStats.sixMonths.realized >= 0 ? '+' : ''}
                            {formatCurrency(combinedPeriodStats.sixMonths.realized, userSettings.combinedCurrency || 'USD', true)}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Total Gain YTD
                        </div>
                        <div className={cn("text-xl md:text-2xl font-medium flex items-center gap-2", combinedPeriodStats.ytd.total >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          <AnimatedCountUp value={combinedPeriodStats.ytd.total} currency={userSettings.combinedCurrency || 'USD'} includeSign={true} />
                        </div>
                        <div className={cn("text-xs font-medium flex items-center gap-1", combinedPeriodStats.ytd.percent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {combinedPeriodStats.ytd.percent >= 0 ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                          <AnimatedCountUp value={Math.abs(combinedPeriodStats.ytd.percent)} suffix="% YTD" />
                        </div>
                        <div className="text-[10px] text-zinc-500 font-medium flex items-center gap-1 pt-0.5">
                          <span>Realized:</span>
                          <span className={cn("font-semibold font-mono", combinedPeriodStats.ytd.realized >= 0 ? "text-emerald-600" : "text-rose-600")}>
                            {combinedPeriodStats.ytd.realized >= 0 ? '+' : ''}
                            {formatCurrency(combinedPeriodStats.ytd.realized, userSettings.combinedCurrency || 'USD', true)}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-0.5 font-sans">
                        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Total Gain 1Y
                        </div>
                        <div className={cn("text-xl md:text-2xl font-medium flex items-center gap-2", combinedPeriodStats.oneYear.total >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          <AnimatedCountUp value={combinedPeriodStats.oneYear.total} currency={userSettings.combinedCurrency || 'USD'} includeSign={true} />
                        </div>
                        <div className={cn("text-xs font-medium flex items-center gap-1", combinedPeriodStats.oneYear.percent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {combinedPeriodStats.oneYear.percent >= 0 ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                          <AnimatedCountUp value={Math.abs(combinedPeriodStats.oneYear.percent)} suffix="% 1Y" />
                        </div>
                        <div className="text-[10px] text-zinc-500 font-medium flex items-center gap-1 pt-0.5">
                          <span>Realized:</span>
                          <span className={cn("font-semibold font-mono", combinedPeriodStats.oneYear.realized >= 0 ? "text-emerald-600" : "text-rose-600")}>
                            {combinedPeriodStats.oneYear.realized >= 0 ? '+' : ''}
                            {formatCurrency(combinedPeriodStats.oneYear.realized, userSettings.combinedCurrency || 'USD', true)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-start md:items-center justify-between mt-2">
          <div className="flex items-center gap-6 min-w-max pb-2 md:pb-0 overflow-x-auto hide-scrollbar">
            <button
              onClick={() => setActiveTab('global')}
              className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center ${activeTab === 'global' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'}`}
            >
              Global Portfolio
              {getMarketStatus('global')}
            </button>
            <button
              onClick={() => setActiveTab('australia')}
              className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center ${activeTab === 'australia' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'}`}
            >
              Australia Investment
              {getMarketStatus('australia')}
            </button>
            <button
              onClick={() => setActiveTab('bot')}
              className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center ${activeTab === 'bot' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'}`}
            >
              Trading Bot
              {getMarketStatus('bot')}
            </button>
          </div>
          
          <div className={cn("flex flex-wrap items-center gap-2 pb-2 md:pb-0 w-full md:w-auto mt-2 md:mt-0 justify-start md:justify-end", activeTab === 'bot' && "hidden")}>
            {saveMessage && (
              <span className={cn(
                "text-sm font-medium whitespace-nowrap",
                saveMessage.type === 'success' ? "text-emerald-600" : "text-rose-600"
              )}>
                {saveMessage.text}
              </span>
            )}
            <button
              onClick={() => promptAnalysisStrategy()}
              disabled={isAnalyzing || holdings.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap text-sm"
            >
              {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Analyze
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || holdings.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-900 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm whitespace-nowrap text-sm"
              title="Refresh market data"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <div className="relative shrink-0">
              <button
                ref={importBtnRef}
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-900 rounded-lg font-medium transition-colors shadow-sm"
                title="Import holdings from a brokerage statement (PDF or CSV)"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                <span className="hidden sm:inline">Import</span>
              </button>
              {showImportMenu && (
                <div ref={importMenuRef} className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-zinc-200 p-4 z-[150] animate-in fade-in zoom-in duration-200">
                  <div className="flex items-center gap-2 mb-3">
                    <UploadCloud className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Import Portfolio</span>
                  </div>
                  <p className="text-sm text-zinc-500 mb-4">
                    Upload a brokerage statement (PDF) or CSV (IBKR, CommSec, Stake) to automatically extract your holdings.
                  </p>
                  
                  <div className="flex bg-zinc-100 p-1 rounded-lg mb-4">
                    <button
                      onClick={() => setImportMode('replace')}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all",
                        importMode === 'replace' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                      )}
                    >
                      Replace All
                    </button>
                    <button
                      onClick={() => setImportMode('merge')}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all",
                        importMode === 'merge' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-550 hover:text-zinc-700"
                      )}
                    >
                      Merge
                    </button>
                  </div>

                  <div 
                    className={cn(
                      "border-2 border-dashed rounded-xl p-6 text-center transition-colors",
                      isUploading ? "border-zinc-300 bg-zinc-50" : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 cursor-pointer"
                    )}
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      accept="application/pdf,text/csv"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                    
                    {isUploading ? (
                      <div className="flex flex-col items-center">
                        <Loader2 className="w-8 h-8 text-zinc-400 animate-spin mb-2" />
                        <p className="text-sm font-medium text-zinc-700">Analyzing with AI...</p>
                        <p className="text-xs text-zinc-500 mt-1">This may take a few seconds</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <FileText className="w-8 h-8 text-zinc-400 mb-2" />
                        <p className="text-sm font-medium text-zinc-700">Click to upload PDF or CSV</p>
                        <p className="text-xs text-zinc-500 mt-1">Supports IBKR, Schwab, etc.</p>
                      </div>
                    )}
                  </div>
                  
                  {uploadError && (
                    <div className="mt-3 text-sm text-rose-600 flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>{uploadError}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex bg-zinc-100 p-0.5 rounded-lg shrink-0">
              <button
                onClick={handleDownload}
                className="p-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-white hover:shadow-sm rounded-md transition-all"
                title="Download Portfolio JSON"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleExportCSV}
                className="p-1.5 text-zinc-600 hover:text-emerald-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1 text-xs font-semibold"
                title="Export Portfolio as CSV File"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden md:inline">CSV</span>
              </button>
              <label className="p-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-white hover:shadow-sm rounded-md transition-all cursor-pointer" title="Import Portfolio JSON">
                <Upload className="w-3.5 h-3.5" />
                <input type="file" accept=".json" className="hidden" onChange={handleImport} />
              </label>

              <div className="w-[1px] bg-zinc-200 mx-1 my-1" />

              <button
                onClick={() => handleDownloadTransactions('csv', 'all')}
                className="p-1.5 text-zinc-600 hover:text-emerald-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1 text-xs font-semibold"
                title="Export Whole Transaction History (CSV)"
              >
                <History className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden lg:inline text-[11px]">Tx CSV</span>
              </button>
              <button
                onClick={() => handleDownloadTransactions('json', 'all')}
                className="p-1.5 text-zinc-600 hover:text-indigo-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1 text-xs font-semibold"
                title="Export Whole Transaction History (JSON)"
              >
                <Download className="w-3.5 h-3.5 text-indigo-600" />
                <span className="hidden lg:inline text-[11px]">Tx JSON</span>
              </button>
              <label className="p-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-white hover:shadow-sm rounded-md transition-all cursor-pointer" title="Import Transactions History (JSON/CSV)">
                <FileText className="w-3.5 h-3.5 text-emerald-600" />
                <input type="file" accept=".json,.csv" className="hidden" onChange={handleImportTransactions} />
              </label>

              <div className="w-[1px] bg-zinc-200 mx-1 my-1" />

              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting || holdings.length === 0}
                className="p-1.5 text-zinc-600 hover:text-rose-600 hover:bg-white hover:shadow-sm rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Reset Portfolio"
              >
                {isResetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
              {hasBackup && (
                <button
                  onClick={() => setShowRestoreConfirm(true)}
                  disabled={isRestoring}
                  className="p-1.5 text-zinc-600 hover:text-emerald-600 hover:bg-white hover:shadow-sm rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Restore Last Reset"
                >
                  {isRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            <div className="relative shrink-0">
              <button
                ref={addWidgetBtnRef}
                onClick={() => setShowAddWidget(!showAddWidget)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-900 rounded-lg font-medium transition-colors text-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add Widget</span>
              </button>
              {showAddWidget && (
                <div ref={addWidgetRef} className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-zinc-200 py-2 z-[150] animate-in fade-in zoom-in duration-200">
                  <div className="px-4 py-2 border-b border-zinc-100 mb-1">
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Add Widget</span>
                  </div>
                  {ALL_WIDGETS.filter(w => !widgetOrder.includes(w.id)).length === 0 ? (
                    <div className="px-4 py-2 text-sm text-zinc-500">All widgets added</div>
                  ) : (
                    ALL_WIDGETS.filter(w => !widgetOrder.includes(w.id)).map(w => (
                      <button
                        key={w.id}
                        onClick={() => {
                          if (!widgetOrder.includes(w.id)) {
                            setWidgetOrder(prev => [...prev, w.id]);
                          }
                          setShowAddWidget(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 hover:text-indigo-600"
                      >
                        {w.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {activeTab === 'bot' ? (
          <BotPortfolioView
            status={botStatus}
            livePrices={quotes}
            onRefresh={handleRefreshBot}
            isRefreshing={isRefreshingBot}
            onRunHousekeeping={handleRunBotHousekeeping}
            isRunningHousekeeping={isRunningHousekeeping}
            onClosePosition={(symbol) => { setBotCloseSymbol(symbol); setBotCloseConfirm(''); }}
          />
        ) : (<>
        {/* Dashboard Stats */}
        <PortfolioSummary
          totalValue={portfolioStats.totalValue}
          totalProfitLoss={portfolioStats.totalProfitLoss}
          totalProfitLossPercent={portfolioStats.totalProfitLossPercent}
          dayChange={portfolioStats.totalDayChange}
          dayChangePercent={portfolioStats.totalDayChangePercent}
          totalCost={portfolioStats.totalCost}
          benchmarkTicker={benchmarkTicker}
          benchmarkDayChangePercent={portfolioStats.benchmarkDayChangePercent}
          benchmarkYtdReturn={portfolioStats.benchmarkYtdReturn}
          periodStats={tabPeriodStats}
          onBenchmarkChange={(ticker) => {
            const newTabSettings = {
              ...tabSettings,
              [activeTab]: {
                ...tabSettings[activeTab],
                benchmark: ticker
              }
            };
            setTabSettings(newTabSettings);
            if (user) {
              setDoc(doc(db, 'settings', user.uid), {
                tabs: newTabSettings
              }, { merge: true }).catch(err => console.error('Error saving benchmark:', err));
            }
          }}
          onSyncHistory={handleSyncHistory}
          isSyncing={isSyncingHistory}
          activeCurrency={activeCurrency}
          riskProfile={tabSettings[activeTab]?.riskProfile}
          targetReturn={tabSettings[activeTab]?.targetReturn}
          fearGreed={fearGreedData}
          holdings={sortedHoldings}
          metadata={metadata}
        />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={widgetOrder}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {widgetOrder.map((widgetId) => {
                if (widgetId === 'performance') {
                  return (
                    <SortableWidget key="performance" id="performance" className={cn("p-8 min-h-[400px] flex flex-col", getWidgetClass('performance'))} onDoubleClick={() => toggleWidgetSize('performance')}>
                      <div className="flex justify-between items-start mb-6 relative z-20">
                        <div>
                          <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                            <Activity className="w-6 h-6 text-indigo-500" />
                            Performance vs Benchmarks
                          </h2>
                          <p className="text-sm text-zinc-500 mt-1">Simulated portfolio value vs major indices tracking invested capital</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => toggleWidgetSize('performance')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Resize Widget">
                            {widgetSizes.performance === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                          </button>
                          <button onClick={() => removeWidget('performance')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Remove Widget">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 w-full h-full relative z-10">
                        {user ? (
                          <PerformanceChart 
                            user={user} 
                            holdings={holdings} 
                            activeCurrency={activeCurrency} 
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full text-zinc-400 italic">Please sign in to view performance.</div>
                        )}
                      </div>
                    </SortableWidget>
                  );
                }

                if (widgetId === 'allocation') {
                  const hasData = chartData.length > 0 || sectorData.length > 0;
                  return (
                    <SortableWidget key="allocation" id="allocation" className={cn("p-8", getWidgetClass('allocation'))} onDoubleClick={() => toggleWidgetSize('allocation')}>
                      <div className="flex justify-end mb-2 relative z-20">
                        <button onClick={() => toggleWidgetSize('allocation')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Resize Widget">
                          {widgetSizes.allocation === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <button onClick={() => removeWidget('allocation')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Remove Widget">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {!hasData ? (
                        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-zinc-400">
                          <PieChartIcon className="w-12 h-12 mb-3 opacity-20" />
                          <p>No allocation data available</p>
                        </div>
                      ) : (
                        <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                  <div>
                    <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                      <PieChartIcon className="w-6 h-6 text-indigo-500" />
                      Portfolio Allocation
                    </h2>
                    <p className="text-sm text-zinc-500 mt-1">Distribution of your assets by value</p>
                  </div>
                  
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <div className="flex bg-zinc-100 p-1 rounded-xl">
                      <button
                        onClick={() => { setChartView('asset'); setFilterGroup(null); }}
                        className={cn(
                          "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
                          chartView === 'asset' 
                            ? "bg-white text-zinc-900 shadow-sm" 
                            : "text-zinc-500 hover:text-zinc-700"
                        )}
                      >
                        By Asset
                      </button>
                      <button
                        onClick={() => { setChartView('industry'); setFilterGroup(null); }}
                        className={cn(
                          "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
                          chartView === 'industry' 
                            ? "bg-white text-zinc-900 shadow-sm" 
                            : "text-zinc-500 hover:text-zinc-700"
                        )}
                      >
                        By Sector
                      </button>
                    </div>

                    <div className="flex bg-zinc-100 p-1 rounded-xl">
                      <button
                        onClick={() => setChartType('pie')}
                        className={cn(
                          "p-1.5 rounded-lg transition-colors",
                          chartType === 'pie' ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                        )}
                        title="Pie Chart"
                      >
                        <PieChartIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setChartType('bar')}
                        className={cn(
                          "p-1.5 rounded-lg transition-colors",
                          chartType === 'bar' ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                        )}
                        title="Bar Chart"
                      >
                        <BarChart2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setChartType('scatter')}
                        className={cn(
                          "p-1.5 rounded-lg transition-colors",
                          chartType === 'scatter' ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                        )}
                        title="Scatter Chart"
                      >
                        <ScatterChartIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-8">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                    {chartType === 'scatter' ? (
                      <div className="h-[440px] w-full relative col-span-1 lg:col-span-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                          <div>
                            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Market Value vs Investment Cost</h3>
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                              Position shows Cost (X) vs Value (Y). Hover over any bubble to isolate it.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setDeconflictScatter(prev => !prev)}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors shadow-2xs",
                                deconflictScatter 
                                  ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-800/60 dark:text-indigo-300"
                                  : "bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400"
                              )}
                              title={deconflictScatter ? "Overlapping points are fanned out for visibility" : "Points placed strictly at exact coordinates"}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Disperse Overlaps: {deconflictScatter ? 'ON' : 'OFF'}</span>
                            </button>
                            {hoveredScatterTicker && (
                              <button
                                type="button"
                                onClick={() => setHoveredScatterTicker(null)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                              >
                                <span>Focus: {hoveredScatterTicker}</span>
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap justify-center items-center gap-4 sm:gap-6 mb-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          <div className="flex items-center gap-1.5">
                            <span className="w-3.5 h-3.5 rounded-full border-[2.5px] border-emerald-300 bg-emerald-400/40 inline-block shrink-0" />
                            <span className="font-semibold text-zinc-700 dark:text-zinc-200">In Profit (Green ring = Profit)</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-3.5 h-3.5 rounded-full border-[2.5px] border-rose-300 bg-rose-400/40 inline-block shrink-0" />
                            <span className="font-semibold text-zinc-700 dark:text-zinc-200">In Loss</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
                            <span>• Icon size ∝ Investment Cost | Icon + Green ring ∝ Market Value</span>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 20, right: 35, bottom: 30, left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                            <XAxis 
                              type="number" 
                              dataKey="cost" 
                              name="Investment Cost" 
                              tickFormatter={(value) => `${getCurrencySymbol(activeCurrency)}${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`} 
                              tick={{ fontSize: 12, fill: '#71717a' }} 
                              axisLine={false} 
                              tickLine={false} 
                            />
                            <YAxis 
                              type="number" 
                              dataKey="value" 
                              name="Market Value" 
                              tickFormatter={(value) => `${getCurrencySymbol(activeCurrency)}${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`} 
                              tick={{ fontSize: 12, fill: '#71717a' }} 
                              axisLine={false} 
                              tickLine={false} 
                            />
                            <ZAxis type="number" dataKey="value" range={[100, 1600]} name="Market Value" />
                            <RechartsTooltip 
                              cursor={{ strokeDasharray: '3 3' }} 
                              content={<CustomTooltip activeCurrency={activeCurrency} metadata={metadata} />} 
                            />
                            <Scatter 
                              name="Assets" 
                              data={scatterPlotData} 
                              fill="#8b5cf6" 
                              shape={(props: any) => {
                                const pointName = props?.payload?.name;
                                const isHovered = hoveredScatterTicker === pointName;
                                const isDimmed = !!hoveredScatterTicker && hoveredScatterTicker !== pointName;
                                return (
                                  <CorporateLogoScatterPoint 
                                    {...props} 
                                    metadata={metadata} 
                                    maxValue={maxScatterValue}
                                    minValue={minScatterValue}
                                    maxCost={maxScatterCost}
                                    minCost={minScatterCost}
                                    maxProfit={maxScatterProfit}
                                    maxLoss={maxScatterLoss}
                                    activeCurrency={activeCurrency}
                                    isSelected={filterGroup === pointName}
                                    isHovered={isHovered}
                                    isDimmed={isDimmed}
                                    onHover={setHoveredScatterTicker}
                                    offsetX={props?.payload?.offsetX}
                                    offsetY={props?.payload?.offsetY}
                                  />
                                );
                              }}
                              animationDuration={800} 
                              animationEasing="ease-out"
                              onMouseLeave={() => setHoveredScatterTicker(null)}
                              onClick={(data) => {
                                if (data && (data as any).name) {
                                  const name = String((data as any).name);
                                  setFilterGroup(prev => prev === name ? null : name);
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              {scatterPlotData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[(index + (chartView === 'industry' ? 2 : 0)) % COLORS.length]} fillOpacity={0.7} stroke={COLORS[(index + (chartView === 'industry' ? 2 : 0)) % COLORS.length]} strokeWidth={1.5} />
                              ))}
                            </Scatter>
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <>
                        {/* Market Value Chart */}
                        <div className="h-80 w-full relative">
                          <h3 className="text-center text-sm font-semibold text-zinc-700 mb-2">Market Value</h3>
                          <div className="flex justify-center gap-6 mb-4 text-[10px] uppercase tracking-widest font-bold text-zinc-400">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-indigo-500" />
                              <span>Market Value</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span>Profit</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-rose-500" />
                              <span>Loss</span>
                            </div>
                          </div>
                          <div className="h-full w-full">
                        {chartType === 'pie' ? (
                          <div className="w-full h-full pb-8">
                            <Chart
                              chartType="PieChart"
                              data={[
                                ['Name', 'Market Value'],
                                ...(chartView === 'asset' ? chartData : sectorData).map(entry => [entry.name, entry.value])
                              ]}
                              chartEvents={[
                                {
                                  eventName: "select",
                                  callback: ({ chartWrapper }) => {
                                    const chart = chartWrapper.getChart();
                                    const selection = chart.getSelection();
                                    if (selection.length > 0) {
                                      const rowIndex = selection[0].row;
                                      const data = chartView === 'asset' ? chartData : sectorData;
                                      if (rowIndex !== null && data[rowIndex]) {
                                        const selectedName = data[rowIndex].name;
                                        setFilterGroup(prev => prev === selectedName ? null : selectedName);
                                      }
                                    } else {
                                      setFilterGroup(null);
                                    }
                                  }
                                }
                              ]}
                              options={{
                                is3D: true,
                                backgroundColor: 'transparent',
                                colors: (chartView === 'asset' ? chartData : sectorData).map((_, index) => COLORS[(index + (chartView === 'industry' ? 2 : 0)) % COLORS.length]),
                                legend: { position: 'right', textStyle: { color: '#71717a', fontSize: 12 } },
                                chartArea: { width: '90%', height: '90%' },
                                pieSliceText: 'percentage',
                              }}
                              width="100%"
                              height="100%"
                            />
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart 
                              data={chartView === 'asset' ? chartData : sectorData} 
                              margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
                              barGap={4}
                              onClick={(data) => {
                                if (data && data.activeLabel) {
                                  const label = String(data.activeLabel);
                                  setFilterGroup(prev => prev === label ? null : label);
                                }
                              }}
                            >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                            <XAxis 
                              dataKey="name" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 11, fill: '#71717a', angle: -45, textAnchor: 'end' }} 
                              height={60}
                              interval={0}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 11, fill: '#71717a' }}
                              tickFormatter={(value) => `${getCurrencySymbol(activeCurrency)}${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`}
                              width={60}
                              tickCount={8}
                            />
                            <RechartsTooltip 
                              content={<CustomTooltip activeCurrency={activeCurrency} metadata={metadata} />}
                              cursor={{ fill: '#f4f4f5', opacity: 0.4 }}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                            <Bar 
                              dataKey="value" 
                              name="Market Value" 
                              radius={[4, 4, 0, 0]} 
                              barSize={chartView === 'asset' ? 24 : 48} 
                              animationDuration={1000} 
                              animationEasing="ease-out"
                              activeBar={{ stroke: '#4f46e5', strokeWidth: 2, fillOpacity: 0.8 }}
                            >
                              {(chartView === 'asset' ? chartData : sectorData).map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={chartView === 'asset' ? '#6366f1' : COLORS[(index + (chartView === 'industry' ? 2 : 0)) % COLORS.length]} 
                                />
                              ))}
                            </Bar>
                            {chartView === 'asset' && (
                              <Bar 
                                dataKey="profitLoss" 
                                name="Profit/Loss" 
                                radius={[4, 4, 0, 0]} 
                                barSize={24} 
                                animationDuration={1000} 
                                animationEasing="ease-out"
                                activeBar={{ stroke: '#059669', strokeWidth: 2, fillOpacity: 0.8 }}
                              >
                                {chartData.map((entry, index) => (
                                  <Cell key={`cell-pl-${index}`} fill={entry.profitLoss >= 0 ? '#10b981' : '#ef4444'} />
                                ))}
                              </Bar>
                            )}
                          </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>

                    {/* Investment Cost Chart */}
                    <div className="h-80 w-full relative">
                      <h3 className="text-center text-sm font-semibold text-zinc-700 mb-2">Investment Cost</h3>
                      <div className="flex justify-center gap-6 mb-4 text-[10px] uppercase tracking-widest font-bold text-zinc-400">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-violet-500" />
                          <span>Total Cost</span>
                        </div>
                      </div>
                      <div className="h-full w-full">
                        {chartType === 'pie' ? (
                          <div className="w-full h-full pb-8">
                            <Chart
                              chartType="PieChart"
                              data={[
                                ['Name', 'Investment Cost'],
                                ...(chartView === 'asset' ? chartData : sectorData).map(entry => [entry.name, entry.cost])
                              ]}
                              chartEvents={[
                                {
                                  eventName: "select",
                                  callback: ({ chartWrapper }) => {
                                    const chart = chartWrapper.getChart();
                                    const selection = chart.getSelection();
                                    if (selection.length > 0) {
                                      const rowIndex = selection[0].row;
                                      const data = chartView === 'asset' ? chartData : sectorData;
                                      if (rowIndex !== null && data[rowIndex]) {
                                        const selectedName = data[rowIndex].name;
                                        setFilterGroup(prev => prev === selectedName ? null : selectedName);
                                      }
                                    } else {
                                      setFilterGroup(null);
                                    }
                                  }
                                }
                              ]}
                              options={{
                                is3D: true,
                                backgroundColor: 'transparent',
                                colors: (chartView === 'asset' ? chartData : sectorData).map((_, index) => COLORS[(index + (chartView === 'industry' ? 2 : 0)) % COLORS.length]),
                                legend: { position: 'right', textStyle: { color: '#71717a', fontSize: 12 } },
                                chartArea: { width: '90%', height: '90%' },
                                pieSliceText: 'percentage',
                              }}
                              width="100%"
                              height="100%"
                            />
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart 
                              data={chartView === 'asset' ? chartData : sectorData} 
                              margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
                              barGap={4}
                              onClick={(data) => {
                                if (data && data.activeLabel) {
                                  const label = String(data.activeLabel);
                                  setFilterGroup(prev => prev === label ? null : label);
                                }
                              }}
                            >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                            <XAxis 
                              dataKey="name" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 11, fill: '#71717a', angle: -45, textAnchor: 'end' }} 
                              height={60}
                              interval={0}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 11, fill: '#71717a' }}
                              tickFormatter={(value) => `${getCurrencySymbol(activeCurrency)}${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`}
                              width={60}
                              tickCount={8}
                            />
                            <RechartsTooltip 
                              content={<CustomTooltip activeCurrency={activeCurrency} metadata={metadata} />}
                              cursor={{ fill: '#f4f4f5', opacity: 0.4 }}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                            <Bar 
                              dataKey="cost" 
                              name="Investment Cost" 
                              radius={[4, 4, 0, 0]} 
                              barSize={chartView === 'asset' ? 24 : 48} 
                              animationDuration={1000} 
                              animationEasing="ease-out"
                              activeBar={{ stroke: '#7c3aed', strokeWidth: 2, fillOpacity: 0.8 }}
                            >
                              {(chartView === 'asset' ? chartData : sectorData).map((entry, index) => (
                                <Cell 
                                  key={`cell-cost-${index}`} 
                                  fill={chartView === 'asset' ? '#8b5cf6' : COLORS[(index + (chartView === 'industry' ? 2 : 0)) % COLORS.length]} 
                                />
                              ))}
                            </Bar>
                          </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>
                  </>
                  )}
                  </div>

                  <div className="pt-6 border-t border-zinc-100">
                    <h3 className="text-sm font-semibold text-zinc-900 mb-4">Allocation Details</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {(chartView === 'asset' ? chartData : sectorData).slice(0, showAllAllocation ? undefined : 9).map((entry, index) => {
                        const costValue = entry.cost || 0;
                        return (
                          <div 
                            key={entry.name} 
                            className="flex flex-col group cursor-pointer hover:bg-zinc-100/50 hover:shadow-sm p-3 rounded-xl border border-zinc-100 transition-all duration-200"
                            onClick={() => chartView === 'asset' && setSelectedChartTicker(entry.name)}
                          >
                            <div className="flex items-center gap-3 mb-2">
                              <CompanyLogo 
                                ticker={entry.name} 
                                logo={chartView === 'asset' ? metadata[entry.name]?.logo : undefined} 
                                size="sm" 
                              />
                              <span className="text-sm font-medium text-zinc-700 group-hover:text-zinc-900 transition-colors">{entry.name}</span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-xs text-zinc-500">Value</span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-zinc-700">
                                  {formatCurrency(entry.value, activeCurrency, false, 0)}
                                </span>
                                <span className="text-xs font-bold text-zinc-900 w-10 text-right">
                                  {((entry.value / portfolioStats.totalValue) * 100).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-xs text-zinc-500">Cost</span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-zinc-400">
                                  {formatCurrency(costValue, activeCurrency, false, 0)}
                                </span>
                                <span className="text-xs font-bold text-zinc-500 w-10 text-right">
                                  {((costValue / portfolioStats.totalCost) * 100).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {(chartView === 'asset' ? chartData : sectorData).length > 9 && (
                      <div className="pt-4 flex justify-center">
                        <button
                          onClick={() => setShowAllAllocation(!showAllAllocation)}
                          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
                        >
                          {showAllAllocation 
                            ? "Show Less" 
                            : `View ${(chartView === 'asset' ? chartData : sectorData).length - 9} more assets`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                </>
                )}
                    </SortableWidget>
                  );
                }

                if (widgetId === 'calendar') {
                  return (
                    <SortableWidget key="calendar" id="calendar" className={getWidgetClass('calendar')} onDoubleClick={() => toggleWidgetSize('calendar')}>
                      <FinancialCalendar 
                        earningsEvents={filteredEarningsEvents} 
                        metadata={metadata} 
                        onResize={() => toggleWidgetSize('calendar')}
                        onRemove={() => removeWidget('calendar')}
                        size={widgetSizes.calendar}
                        activeCurrency={activeCurrency}
                        onEarningsClick={promptEarningsAnalysisStrategy}
                        onRemoveEvent={handleRemoveCalendarEvent}
                        onEditEvent={(event) => {
                          setEditingEarningsEvent(event);
                          setShowEditEarningsModal(true);
                        }}
                        hasHiddenEvents={hiddenCalendarEvents.length > 0}
                        onRestoreEvents={handleRestoreCalendarEvents}
                      />
                    </SortableWidget>
                  );
                }

                if (widgetId === 'holdings') {
                  return (
                    <SortableWidget key="holdings" id="holdings" className={cn(getWidgetClass('holdings'))} onDoubleClick={() => toggleWidgetSize('holdings')}>
                      <div className="px-6 py-5 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50 rounded-t-2xl">
                        <div className="flex items-center gap-4 relative z-20">
                          <h2 className="text-lg font-semibold flex items-center gap-2">
                            Current Holdings
                            {filterGroup && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                                {filterGroup}
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setFilterGroup(null); }}
                                  className="hover:bg-indigo-200 rounded-full p-0.5 ml-1 transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            )}
                          </h2>
                          <div className="text-xs text-zinc-500 font-medium">
                            {sortedHoldings.length} {sortedHoldings.length === 1 ? 'Asset' : 'Assets'}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 relative z-20">
                          <StockSearch onSelect={(ticker) => setSelectedChartTicker(ticker)} />
                          
                          {layoutSaveStatus !== 'idle' && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium select-none transition-all">
                              {layoutSaveStatus === 'saving' && (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                  <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">Saving layout...</span>
                                </>
                              )}
                              {layoutSaveStatus === 'saved' && (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">Layout synced</span>
                                </>
                              )}
                              {layoutSaveStatus === 'error' && (
                                <>
                                  <X className="w-3.5 h-3.5 text-rose-500" />
                                  <span className="text-rose-600 dark:text-rose-400 text-[11px]">Sync failed</span>
                                </>
                              )}
                            </div>
                          )}

                          <button
                            onClick={handleExportCSV}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700 border text-xs font-medium border-zinc-200 text-zinc-700 rounded-lg focus:outline-none hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:border-zinc-300 transition-colors cursor-pointer mr-2 relative z-20 shadow-sm"
                            title="Export current portfolio as CSV file"
                          >
                            <Download className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Export CSV</span>
                          </button>

                          <select 
                            className="bg-white dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700 border text-xs font-medium border-zinc-200 text-zinc-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:border-zinc-300 transition-colors cursor-pointer mr-2 relative z-20"
                            value={tableGrouping}
                            onChange={(e) => {
                              const val = e.target.value as any;
                              setTableGrouping(val);
                              saveTableLayout({ tableGrouping: val });
                            }}
                          >
                            <option value="none">No Grouping</option>
                            <option value="theme">Group by Investing Theme (AI, Crypto, Defense, Clean Energy, etc.)</option>
                            <option value="assetType">Group by Asset Type (Stocks vs Cash)</option>
                            <option value="sector">Group by Business Area (Sector)</option>
                            <option value="industry">Group by Specific Industry (e.g., Semiconductors)</option>
                            <option value="marketCap">Group by Market Cap</option>
                          </select>
                          <button onClick={() => toggleWidgetSize('holdings')} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Resize Widget">
                            {widgetSizes.holdings === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                          </button>
                          <button onClick={() => removeWidget('holdings')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Remove Widget">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

              {(() => {
                const corruptedInView = holdings.filter(h => h.avg_price < 0 || h.shares < 0);
                if (corruptedInView.length === 0) return null;
                return (
                  <div className="mx-6 my-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-900 text-xs shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
                      <div>
                        <span className="font-bold text-rose-950">Data Inconsistency Detected: </span>
                        <span className="text-rose-800">
                          {corruptedInView.map(h => `${h.ticker} (${h.shares} shares @ $${h.avg_price?.toFixed(2)})`).join(', ')}.
                          Negative values cause distorted returns.
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleRepairCorruptedHoldings(corruptedInView)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Repair from Ledger
                      </button>
                      <button
                        onClick={() => setEditModalHolding(corruptedInView[0])}
                        className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-100 text-rose-900 font-medium rounded-lg text-xs transition-colors"
                      >
                        Manual Edit
                      </button>
                    </div>
                  </div>
                );
              })()}
              
              {holdings.length === 0 ? (
                <div className="p-12 text-center text-zinc-500">
                  <Briefcase className="w-12 h-12 mx-auto text-zinc-300 mb-3" />
                  <p>Your portfolio is empty.</p>
                  <p className="text-sm mt-1">Add your first stock to start tracking.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleHoldingsTableDragEnd}
                  >
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-200 text-xs uppercase tracking-wider text-zinc-500 bg-zinc-50/50">
                          {tableGrouping === 'none' && <th className="w-8 px-2 py-4"></th>}
                          <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                            {columnOrder.map((colId) => {
                              const col = COLUMNS.find(c => c.id === colId);
                              if (!col) return null;
                              return (
                                <SortableHeader
                                  key={col.id}
                                  id={col.id}
                                  label={col.label}
                                  sortKey={col.sortKey}
                                  align={col.align}
                                  sortConfig={sortConfig}
                                  onSort={handleSort}
                                />
                              );
                            })}
                          </SortableContext>
                          <th className="px-6 py-4 font-medium text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {tableGrouping !== 'none' ? (
                          <>
                            {(() => {
                              const getMarketCapGroup = (mc: number | undefined, currency: string) => {
                                if (mc === undefined || mc === null || mc <= 0) return 'Unknown / Cash';
                                let usdToTargetRate = 1;
                                if (currency !== 'USD') {
                                  usdToTargetRate = getExchangeRate('USD', currency, quotes) || 1;
                                }
                                const megaThreshold = 200e9 * usdToTargetRate;
                                const largeThreshold = 10e9 * usdToTargetRate;
                                const midThreshold = 2e9 * usdToTargetRate;
                                if (mc >= megaThreshold) return 'Mega Cap (>$200B)';
                                if (mc >= largeThreshold) return 'Large Cap ($10B - $200B)';
                                if (mc >= midThreshold) return 'Mid Cap ($2B - $10B)';
                                return 'Small/Micro Cap (<$2B)';
                              };

                              const groupedMap = sortedHoldings.reduce((acc, holding) => {
                                let groupKey = 'Unknown';
                                if (tableGrouping === 'theme') {
                                  groupKey = getInvestingTheme(holding, metadata);
                                } else if (tableGrouping === 'assetType') {
                                  if (holding.ticker === 'CASH') {
                                    groupKey = 'Cash & Liquid Assets';
                                  } else if (
                                    (holding as any).isCrypto || 
                                    holding.ticker?.endsWith('-USD') || 
                                    metadata[holding.ticker]?.sector === 'Cryptocurrency' || 
                                    ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].includes(holding.ticker?.toUpperCase())
                                  ) {
                                    groupKey = 'Cryptocurrency';
                                  } else if (
                                    metadata[holding.ticker]?.industry?.toLowerCase().includes('etf') || 
                                    metadata[holding.ticker]?.sector?.toLowerCase().includes('etf') || 
                                    ['SPY', 'QQQ', 'IVV', 'VOO', 'VTI', 'IWM', 'EFA', 'VEA', 'VWO'].includes(holding.ticker?.toUpperCase())
                                  ) {
                                    groupKey = 'ETFs & Index Funds';
                                  } else {
                                    groupKey = 'Stocks & Equities';
                                  }
                                } else if (tableGrouping === 'sector') {
                                  groupKey = holding.ticker === 'CASH' ? 'Cash' : (metadata[holding.ticker]?.sector || 'Unknown');
                                } else if (tableGrouping === 'industry') {
                                  const mag7Tickers = ['MSFT', 'AAPL', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA'];
                                  const cryptoTickers = ['BMNR', 'COIN'];
                                  if (holding.ticker && mag7Tickers.includes(holding.ticker.toUpperCase())) {
                                    groupKey = 'mag7';
                                  } else if (holding.ticker && cryptoTickers.includes(holding.ticker.toUpperCase())) {
                                    groupKey = 'crypto_proxies';
                                  } else {
                                    groupKey = holding.ticker === 'CASH' ? 'Cash' : (metadata[holding.ticker]?.industry || 'Unknown');
                                  }
                                } else if (tableGrouping === 'marketCap') {
                                  groupKey = holding.ticker === 'CASH' ? 'Cash' : getMarketCapGroup(holding.marketCap, activeCurrency);
                                }
                                if (!acc[groupKey]) {
                                  acc[groupKey] = {
                                    holdings: [],
                                    value: 0,
                                    totalCost: 0,
                                    totalProfit: 0,
                                    totalDayChange: 0,
                                    totalRealizedProfitLoss: 0,
                                  };
                                }
                                acc[groupKey].holdings.push(holding);
                                acc[groupKey].value += holding.currentValue;
                                acc[groupKey].totalCost += holding.costBasis || 0;
                                acc[groupKey].totalProfit += holding.profitLoss || 0;
                                acc[groupKey].totalDayChange += holding.dayChange || 0;
                                acc[groupKey].totalRealizedProfitLoss += holding.realizedProfitLoss || 0;
                                return acc;
                              }, {} as Record<string, {
                                holdings: typeof sortedHoldings,
                                value: number,
                                totalCost: number,
                                totalProfit: number,
                                totalDayChange: number,
                                totalRealizedProfitLoss: number,
                              }>);

                              return Object.entries(groupedMap).sort((a, b) => {
                                if (tableGrouping === 'theme') {
                                  const order = [
                                    'Artificial Intelligence & Big Tech',
                                    'Semiconductors & AI Hardware',
                                    'Crypto & Web3 Ecosystem',
                                    'Clean Energy & Autonomous Mobility',
                                    'Defense, Aerospace & Security',
                                    'ETFs & Index Funds',
                                    'Healthcare, Biotech & Longevity',
                                    'Banking, Payments & Fintech',
                                    'Energy & Hard Assets',
                                    'Consumer Brands & Retail',
                                    'Real Estate & Infrastructure',
                                    'Global Growth & Diversified',
                                    'Cash & Liquid Reserves',
                                  ];
                                  const idxA = order.indexOf(a[0]);
                                  const idxB = order.indexOf(b[0]);
                                  const finalIdxA = idxA === -1 ? 999 : idxA;
                                  const finalIdxB = idxB === -1 ? 999 : idxB;
                                  if (finalIdxA !== finalIdxB) return finalIdxA - finalIdxB;
                                }
                                if (tableGrouping === 'assetType') {
                                  const order = ['Stocks & Equities', 'ETFs & Index Funds', 'Cryptocurrency', 'Cash & Liquid Assets'];
                                  const idxA = order.indexOf(a[0]);
                                  const idxB = order.indexOf(b[0]);
                                  const finalIdxA = idxA === -1 ? 999 : idxA;
                                  const finalIdxB = idxB === -1 ? 999 : idxB;
                                  return finalIdxA - finalIdxB;
                                }
                                if (tableGrouping === 'marketCap') {
                                  const order = ['Mega Cap (>$200B)', 'Large Cap ($10B - $200B)', 'Mid Cap ($2B - $10B)', 'Small/Micro Cap (<$2B)', 'Cash', 'Unknown / Cash'];
                                  const idxA = order.indexOf(a[0]);
                                  const idxB = order.indexOf(b[0]);
                                  const finalIdxA = idxA === -1 ? 999 : idxA;
                                  const finalIdxB = idxB === -1 ? 999 : idxB;
                                  return finalIdxA - finalIdxB;
                                }
                                return b[1].value - a[1].value;
                              }).map(([groupName, groupData]) => {
                                const groupFg = calculateGroupFearGreed(groupData.holdings, fearGreedData);
                                return (
                                <React.Fragment key={groupName}>
                                <tr className="bg-zinc-50 border-y border-zinc-200 group/header">
                                  <td colSpan={columnOrder.length + 1} className="px-6 py-2.5 bg-zinc-100/30">
                                    <div className="flex justify-between items-center w-full">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-800">{groupName === 'mag7' ? 'Magnificent Seven (Mag7)' : groupName === 'crypto_proxies' ? 'Crypto Proxies' : groupName}</span>
                                        {groupFg && (
                                          <span 
                                            className={cn(
                                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight border shadow-2xs transition-all",
                                              groupFg.badgeBgClass,
                                              groupFg.colorClass,
                                              groupFg.borderClass
                                            )}
                                            title={`Group Fear & Greed: ${groupFg.rating} (${groupFg.score})`}
                                          >
                                            <Activity size={10} />
                                            {groupFg.rating} ({groupFg.score})
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-xs font-medium text-zinc-600 bg-white px-2 py-0.5 rounded shadow-sm border border-zinc-200 flex items-center gap-2">
                                        <span>{formatCurrency(groupData.value, activeCurrency)}</span>
                                        <span className="text-zinc-400 font-normal">({(groupData.value / portfolioStats.totalValue * 100).toFixed(1)}%)</span>
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                                {groupData.holdings.map((holding) => (
                                  <SortableHoldingRow
                                    key={holding.id}
                                    holding={holding}
                                    columnOrder={columnOrder}
                                    renderCell={renderCell}
                                    editingId={editingId}
                                    setSelectedChartTicker={setSelectedChartTicker}
                                    handleSaveEdit={handleSaveEdit}
                                    handleCancelEdit={handleCancelEdit}
                                    promptAnalysisStrategy={promptAnalysisStrategy}
                                    handleEditClick={handleEditClick}
                                    handleViewHistory={handleViewHistory}
                                    handleDelete={handleDelete}
                                    isSortable={false}
                                  />
                                ))}
                                {/* Group Totals Summary Row */}
                                <tr className="bg-zinc-100/35 border-t border-b border-zinc-200/80 font-semibold text-zinc-700 text-xs">
                                  {columnOrder.map((colId) => {
                                    switch (colId) {
                                      case 'ticker':
                                        return (
                                          <td key={colId} className="px-6 py-3 text-left font-sans font-bold text-zinc-500 uppercase tracking-wider text-[10px]">
                                            Total {groupName === 'mag7' ? 'Mag7' : groupName === 'crypto_proxies' ? 'Crypto Proxies' : groupName === 'Cash' ? 'Cash' : groupName}
                                          </td>
                                        );
                                      case 'fearGreed':
                                        return (
                                          <td key={colId} className="px-6 py-3 text-center">
                                            {groupFg ? (
                                              <div 
                                                className={cn(
                                                  "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-extrabold uppercase transition-all shadow-2xs border",
                                                  groupFg.badgeBgClass,
                                                  groupFg.colorClass,
                                                  groupFg.borderClass
                                                )}
                                                title={`Group Fear & Greed: ${groupFg.rating} (${groupFg.score})`}
                                              >
                                                <Activity size={10} />
                                                {groupFg.score} ({groupFg.rating})
                                              </div>
                                            ) : (
                                              <span className="text-zinc-300 text-[10px] font-bold">--</span>
                                            )}
                                          </td>
                                        );
                                      case 'costBasis':
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right text-zinc-900 font-bold font-mono">
                                            {formatCurrency(groupData.totalCost, activeCurrency)}
                                          </td>
                                        );
                                      case 'currentValue':
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right text-zinc-900 font-bold font-mono">
                                            {formatCurrency(groupData.value, activeCurrency)}
                                          </td>
                                        );
                                      case 'allocation':
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right text-zinc-500 font-medium font-mono">
                                            {((groupData.value / (portfolioStats.totalValue || 1)) * 100).toFixed(1)}%
                                          </td>
                                        );
                                      case 'profitLoss': {
                                        const profitPercent = groupData.totalCost > 0 ? (groupData.totalProfit / groupData.totalCost) * 100 : 0;
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right">
                                            <div className={cn(
                                              "font-bold font-mono text-sm",
                                              groupData.totalProfit >= 0 ? "text-emerald-600" : "text-rose-600"
                                            )}>
                                              {groupData.totalProfit >= 0 ? '+' : ''}{formatCurrency(groupData.totalProfit, activeCurrency, true)}
                                            </div>
                                            <div className={cn(
                                              "text-[10px] mt-0.5 font-mono font-medium",
                                              groupData.totalProfit >= 0 ? "text-emerald-600/70" : "text-rose-600/70"
                                            )}>
                                              {groupData.totalProfit >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%
                                            </div>
                                          </td>
                                        );
                                      }
                                      case 'dayChange': {
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right">
                                            <div className={cn(
                                              "font-bold font-mono text-sm",
                                              groupData.totalDayChange >= 0 ? "text-emerald-600" : "text-rose-600"
                                            )}>
                                              {groupData.totalDayChange >= 0 ? '+' : ''}{formatCurrency(groupData.totalDayChange, activeCurrency, true)}
                                            </div>
                                          </td>
                                        );
                                      }
                                      case 'growthMultiple': {
                                        const groupMultiple = groupData.totalCost > 0 ? (groupData.value / groupData.totalCost) : 1;
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right">
                                            <span 
                                              className={cn(
                                                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold border shadow-2xs",
                                                groupMultiple >= 2 ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300" :
                                                groupMultiple >= 1 ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400" :
                                                "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400"
                                              )}
                                              title={`Group Growth Multiple: ${groupMultiple.toFixed(2)}x initial cost`}
                                            >
                                              {groupMultiple.toFixed(2)}x
                                            </span>
                                          </td>
                                        );
                                      }
                                      case 'realizedProfitLoss': {
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right">
                                            <div className={cn(
                                              "font-bold font-mono text-sm",
                                              groupData.totalRealizedProfitLoss > 0 ? "text-emerald-600" : groupData.totalRealizedProfitLoss < 0 ? "text-rose-600" : "text-zinc-400"
                                            )}>
                                              {groupData.totalRealizedProfitLoss > 0 ? '+' : ''}{formatCurrency(groupData.totalRealizedProfitLoss, activeCurrency, true)}
                                            </div>
                                          </td>
                                        );
                                      }
                                      default:
                                        return (
                                          <td key={colId} className="px-6 py-3 text-right text-zinc-400/60 font-normal font-mono">
                                            -
                                          </td>
                                        );
                                    }
                                  })}
                                  <td className="px-6 py-3"></td>
                                </tr>
                                </React.Fragment>
                            )})})()}
                          </>
                        ) : (
                          <SortableContext 
                            items={sortedHoldings.map(h => h.id)} 
                            strategy={verticalListSortingStrategy}
                          >
                            {sortedHoldings.map((holding) => (
                              <SortableHoldingRow
                                key={holding.id}
                                holding={holding}
                                columnOrder={columnOrder}
                                renderCell={renderCell}
                                editingId={editingId}
                                setSelectedChartTicker={setSelectedChartTicker}
                                handleSaveEdit={handleSaveEdit}
                                handleCancelEdit={handleCancelEdit}
                                promptAnalysisStrategy={promptAnalysisStrategy}
                                handleEditClick={handleEditClick}
                                handleViewHistory={handleViewHistory}
                                handleDelete={handleDelete}
                              />
                            ))}
                          </SortableContext>
                        )}
                      </tbody>
                    </table>
                  </DndContext>
                </div>
              )}
                    </SortableWidget>
                  );
                }

                if (widgetId === 'watchlist') {
                  return (
                    <SortableWidget key="watchlist" id="watchlist" className={cn(getWidgetClass('watchlist'))} onDoubleClick={() => toggleWidgetSize('watchlist')}>
                      <div className="px-6 py-5 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50 rounded-t-2xl">
                        <div className="flex items-center gap-4 relative z-20">
                          <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Eye className="w-5 h-5 text-indigo-500" />
                            Watchlist
                          </h2>
                          <div className="text-xs text-zinc-500 font-medium">
                            {sortedWatchlist.length} {sortedWatchlist.length === 1 ? 'Asset' : 'Assets'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 relative z-20">
                          <button onClick={() => toggleWidgetSize('watchlist')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-all" title="Resize Widget">
                            {(widgetSizes.watchlist || 3) === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                          </button>
                          <button onClick={() => removeWidget('watchlist')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all" title="Remove Widget">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Watchlist Quick Add Search */}
                      <div className="px-6 py-4 border-b border-zinc-150 bg-white flex flex-col sm:flex-row items-start sm:items-center gap-3 relative z-30">
                        <div className="w-full sm:w-72">
                          <StockSearch 
                            activeTab={activeTab}
                            onSelect={handleAddToWatchlist}
                            clearOnSelect={true}
                          />
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Search and select a stock or crypto to add it directly to your watchlist.
                        </p>
                      </div>
                      
                      {sortedWatchlist.length === 0 ? (
                        <div className="p-12 text-center text-zinc-500">
                          <Eye className="w-12 h-12 mx-auto text-zinc-300 mb-3" />
                          <p>Your watchlist is empty.</p>
                          <p className="text-sm mt-1">Search above or sell all shares of a position to add here.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wider text-zinc-500 bg-zinc-50/50">
                                <th className="px-6 py-4 font-medium">Asset</th>
                                <th className="px-6 py-4 font-medium text-right">Price</th>
                                <th className="px-6 py-4 font-medium text-right">Today's Change</th>
                                <th className="px-6 py-4 font-medium text-right">Booked P&L</th>
                                <th className="px-6 py-4 font-medium text-center">Trend (30D)</th>
                                <th className="px-6 py-4 font-medium text-center">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {sortedWatchlist.map((holding) => {
                                const isPositive = holding.dayChangePercent >= 0;
                                return (
                                  <tr 
                                    key={holding.id} 
                                    className="hover:bg-zinc-100/50 hover:shadow-sm transition-all duration-200 cursor-pointer group/row"
                                    onClick={() => setSelectedChartTicker(holding.ticker)}
                                  >
                                    <td className="px-6 py-4">
                                      <div className="flex items-center gap-3">
                                        <CompanyLogo ticker={holding.ticker} logo={metadata[holding.ticker]?.logo} />
                                        <div>
                                          <div className="font-bold text-zinc-900">{holding.ticker}</div>
                                          <div className="text-xs text-zinc-500 truncate max-w-[150px]">{metadata[holding.ticker]?.sector || 'Asset'}</div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <div className="font-medium text-zinc-900">{formatCurrency(holding.currentPrice, holding.avgPriceCurrency || activeCurrency)}</div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <div className={cn("inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded text-sm", isPositive ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50")}>
                                        {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                        {isPositive ? '+' : ''}{holding.dayChangePercent.toFixed(2)}%
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <div className={cn(
                                        "font-semibold font-mono text-sm",
                                        holding.realizedProfitLoss > 0 ? "text-emerald-600" : holding.realizedProfitLoss < 0 ? "text-rose-600" : "text-zinc-400"
                                      )}>
                                        {holding.realizedProfitLoss > 0 ? '+' : ''}{formatCurrency(holding.realizedProfitLoss, holding.avgPriceCurrency || activeCurrency, true)}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex justify-center">
                                        <WatchlistSparkline ticker={holding.ticker} />
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center justify-center gap-1 relative z-20">
                                        {holding.shares > 0 && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleViewHistory(holding);
                                            }}
                                            className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                            title="Sell Specific Lot"
                                          >
                                            <TrendingDown className="w-4 h-4" />
                                          </button>
                                        )}
                                        <button
                                          onClick={() => handleViewHistory(holding)}
                                          className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                          title="View History"
                                        >
                                          <FileText className="w-4 h-4" />
                                        </button>
                                        <button
                                          onClick={() => handleDelete(holding.id)}
                                          className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                          title="Remove from watchlist"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </SortableWidget>
                  );
                }

                if (widgetId === 'dividends') {
                  return (
                    <SortableWidget key="dividends" id="dividends" className={cn("p-6", getWidgetClass('dividends'))} onDoubleClick={() => toggleWidgetSize('dividends')}>
                      <div className="flex items-center justify-between mb-4 relative z-20">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                          <DollarSign className="w-5 h-5 text-zinc-400" />
                          Dividends
                        </h2>
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleWidgetSize('dividends')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-all relative z-20" title="Resize Widget">
                            {(widgetSizes.dividends || 3) === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => removeWidget('dividends')}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                            title="Remove widget"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="overflow-x-auto relative z-10">
                        {dividendEvents.length === 0 ? (
                          <div className="text-center py-8 text-zinc-500">
                            No dividend data available for current holdings.
                          </div>
                        ) : (
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-zinc-200">
                                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Asset</th>
                                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider text-right">Div Yield</th>
                                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider text-right">Div Rate</th>
                                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider text-right">Ex-Div Date</th>
                                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider text-right">Pay Date</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {dividendEvents
                                .sort((a, b) => {
                                  if (!a.exDividendDate) return 1;
                                  if (!b.exDividendDate) return -1;
                                  return new Date(b.exDividendDate).getTime() - new Date(a.exDividendDate).getTime();
                                })
                                .map((div, idx) => (
                                <tr key={idx} className="hover:bg-zinc-50/50 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <CompanyLogo ticker={div.symbol} logo={metadata[div.symbol]?.logo} />
                                      <span className="font-semibold text-zinc-900">{div.symbol}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-sm">
                                    {div.dividendYield ? `${(div.dividendYield * 100).toFixed(2)}%` : '-'}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-sm">
                                    {div.dividendRate ? formatCurrency(div.dividendRate, quotes[div.symbol]?.currency || activeCurrency) : '-'}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-sm">
                                    {div.exDividendDate ? format(new Date(div.exDividendDate), 'MMM d, yyyy') : '-'}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-sm">
                                    {div.dividendDate ? format(new Date(div.dividendDate), 'MMM d, yyyy') : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </SortableWidget>
                  );
                }

                if (widgetId === 'addPosition') {
                  return (
                    <SortableWidget key="addPosition" id="addPosition" className={cn("p-6", getWidgetClass('addPosition'))} onDoubleClick={() => toggleWidgetSize('addPosition')}>
                      <div className="flex items-center justify-between mb-4 relative z-20">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                          <Plus className="w-5 h-5 text-zinc-400" />
                          Add Position
                        </h2>
                        <button onClick={() => toggleWidgetSize('addPosition')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Resize Widget">
                          {widgetSizes.addPosition === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <button onClick={() => removeWidget('addPosition')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Remove Widget">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
              <form onSubmit={handleAddStock} className="space-y-4">
                <div className="flex bg-zinc-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => { setTransactionType('buy'); if((ticker || '').toUpperCase() === 'CASH') setTicker(''); }}
                    className={cn(
                      "flex-1 py-1.5 text-sm font-medium rounded-md transition-all",
                      transactionType === 'buy' && (ticker || '').toUpperCase() !== 'CASH' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTransactionType('sell'); if((ticker || '').toUpperCase() === 'CASH') setTicker(''); }}
                    className={cn(
                      "flex-1 py-1.5 text-sm font-medium rounded-md transition-all",
                      transactionType === 'sell' && (ticker || '').toUpperCase() !== 'CASH' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    Sell
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTicker('CASH'); setTransactionType('buy'); }}
                    className={cn(
                      "flex-1 py-1.5 text-sm font-medium rounded-md transition-all",
                      transactionType === 'buy' && (ticker || '').toUpperCase() === 'CASH' ? "bg-white text-emerald-700 shadow-sm" : "text-emerald-600/70 hover:text-emerald-700"
                    )}
                  >
                    Deposit
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTicker('CASH'); setTransactionType('sell'); }}
                    className={cn(
                      "flex-1 py-1.5 text-sm font-medium rounded-md transition-all",
                      transactionType === 'sell' && (ticker || '').toUpperCase() === 'CASH' ? "bg-white text-emerald-700 shadow-sm" : "text-emerald-600/70 hover:text-emerald-700"
                    )}
                  >
                    Withdraw
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="ticker" className="block text-sm font-medium text-zinc-700 mb-1">
                      {(ticker || '').toUpperCase() === 'CASH' ? 'Asset Type' : 'Ticker Symbol'}
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 relative">
                        <input
                          id="ticker"
                          type="text"
                          required
                          readOnly={(ticker || '').toUpperCase() === 'CASH'}
                          placeholder={(ticker || '').toUpperCase() === 'CASH' ? "CASH" : "e.g. AAPL"}
                          className={cn("w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent uppercase placeholder:normal-case", (ticker || '').toUpperCase() === 'CASH' && "bg-zinc-50 text-zinc-500 cursor-default")}
                          value={ticker}
                          onChange={(e) => setTicker(e.target.value)}
                        />
                        {(ticker || '').toUpperCase() === 'CASH' && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded uppercase">Cash Mode</span>
                          </div>
                        )}
                      </div>
                      {(ticker || '').toUpperCase() !== 'CASH' && <CompanyLogo ticker={ticker || 'AAPL'} logo={metadata[ticker]?.logo} />}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="transactionDate" className="block text-sm font-medium text-zinc-700 mb-1">Date</label>
                    <input
                      id="transactionDate"
                      type="date"
                      required
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="shares" className="block text-sm font-medium text-zinc-700 mb-1">{(ticker || '').toUpperCase() === 'CASH' ? 'Amount' : 'Shares'}</label>
                    <input
                      id="shares"
                      type="text"
                      inputMode="decimal"
                      required
                      min="0.00001"
                      step="any"
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                      value={shares}
                      onChange={(e) => setShares(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="avgPrice" className="block text-sm font-medium text-zinc-700 mb-1">
                      {(ticker || '').toUpperCase() === 'CASH' ? 'Currency' : (transactionType === 'buy' ? 'Avg Cost' : 'Sell Price')}
                    </label>
                    <div className="flex">
                      <select
                        className={cn(
                          "px-2 py-2 border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent bg-zinc-50 text-zinc-700",
                          (ticker || '').toUpperCase() === 'CASH' ? "w-full rounded-lg" : "rounded-l-lg border-r-0"
                        )}
                        value={formCurrency || activeCurrency}
                        onChange={(e) => setFormCurrency(e.target.value)}
                      >
                        <option value="USD">USD</option>
                        <option value="AUD">AUD</option>
                        <option value="INR">INR</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                        <option value="CAD">CAD</option>
                        <option value="SGD">SGD</option>
                      </select>
                      {(ticker || '').toUpperCase() !== 'CASH' && (
                        <input
                          id="avgPrice"
                          type="text"
                          inputMode="decimal"
                          required
                          min="0.01"
                          step="any"
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-zinc-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                          value={avgPrice}
                          onChange={(e) => setAvgPrice(e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={cn(
                    "w-full text-white font-medium py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2",
                    transactionType === 'buy' ? "bg-zinc-900 hover:bg-zinc-800 focus:ring-zinc-900" : "bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
                  )}
                >
                  {isSubmitting ? (transactionType === 'buy' ? ((ticker || '').toUpperCase() === 'CASH' ? 'Depositing...' : 'Adding...') : ((ticker || '').toUpperCase() === 'CASH' ? 'Withdrawing...' : 'Selling...')) : (transactionType === 'buy' ? ((ticker || '').toUpperCase() === 'CASH' ? 'Deposit Cash' : 'Add Position') : ((ticker || '').toUpperCase() === 'CASH' ? 'Withdraw Cash' : 'Sell Position'))}
                </button>
              </form>
                    </SortableWidget>
                  );
                }

                if (widgetId === 'transactions') {
                  return (
                    <SortableWidget key="transactions" id="transactions" className={cn("p-0 overflow-hidden", getWidgetClass('transactions'))} onDoubleClick={() => toggleWidgetSize('transactions')}>
                      <div className="absolute top-5 right-6 flex items-center gap-2 z-30">
                        <button onClick={() => toggleWidgetSize('transactions')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-all" title="Resize Widget">
                          {(widgetSizes.transactions || 3) === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <button onClick={() => removeWidget('transactions')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all" title="Remove Widget">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <TransactionsWidget
                        user={user}
                        allHoldings={allHoldings}
                        allTransactions={allTransactions}
                        quotes={quotes}
                        activeTab={activeTab}
                        activeCurrency={activeCurrency}
                        onToastSuccess={(msg) => toast.success(msg)}
                        onToastError={(msg) => toast.error(msg)}
                      />
                    </SortableWidget>
                  );
                }

                if (widgetId === 'priceAlerts') {
                  return (
                    <SortableWidget key="priceAlerts" id="priceAlerts" className={cn("p-6", getWidgetClass('priceAlerts'))} onDoubleClick={() => toggleWidgetSize('priceAlerts')}>
                      <div className="flex items-center justify-between mb-4 relative z-20">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                          <Bell className="w-5 h-5 text-zinc-400" />
                          Price Alerts
                        </h2>
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleWidgetSize('priceAlerts')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-all relative z-20" title="Resize Widget">
                            {(widgetSizes.priceAlerts || 1) === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => removeWidget('priceAlerts')}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                            title="Remove widget"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <PriceAlertsWidget alerts={alerts} quotes={quotes} user={user} activeCurrency={activeCurrency} />
                    </SortableWidget>
                  );
                }


                if (widgetId === 'sectorHeatmap') {
                  return (
                    <SortableWidget key="sectorHeatmap" id="sectorHeatmap" className={cn("p-6 flex flex-col", getWidgetClass('sectorHeatmap'))} onDoubleClick={() => toggleWidgetSize('sectorHeatmap')}>
                      <div className="flex items-center justify-between mb-4 relative z-20">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                          <Grid className="w-5 h-5 text-zinc-400" />
                          Sector Heatmap
                        </h2>
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleWidgetSize('sectorHeatmap')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-all relative z-20" title="Resize Widget">
                            {(widgetSizes.sectorHeatmap || 3) === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => removeWidget('sectorHeatmap')}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-neutral-100 rounded-md transition-colors"
                            title="Remove widget"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <SectorHeatmapWidget
                        holdings={sortedHoldings}
                        quotes={quotes}
                        metadata={metadata}
                        activeCurrency={activeCurrency}
                        activeTab={activeTab}
                        fearGreedData={fearGreedData}
                      />
                    </SortableWidget>
                  );
                }
                return null;
              })}
            </div>
          </SortableContext>
        </DndContext>
        </>)}
      </main>

      <Toaster position="top-right" richColors />
      {botCloseSymbol && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => !isClosingBotPosition && setBotCloseSymbol(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Close {botCloseSymbol} position</h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              The trading bot will cancel this position's resting stop and <strong>market-sell all of it now</strong>. This places a real order and can't be undone.
            </p>
            <label className="mt-4 block text-sm text-zinc-700 dark:text-zinc-300">
              Type <span className="font-mono font-bold">{botCloseSymbol}</span> to confirm
              <input
                autoFocus
                value={botCloseConfirm}
                onChange={(e) => setBotCloseConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmBotClose(); }}
                className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 font-mono uppercase"
                disabled={isClosingBotPosition}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setBotCloseSymbol(null)} disabled={isClosingBotPosition} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
              <button
                onClick={handleConfirmBotClose}
                disabled={isClosingBotPosition || botCloseConfirm.trim().toUpperCase() !== botCloseSymbol}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isClosingBotPosition && <Loader2 className="w-4 h-4 animate-spin" />}
                Sell {botCloseSymbol} now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TradingView Chart Modal */}
      {selectedChartTicker && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <CompanyLogo ticker={selectedChartTicker} logo={metadata[selectedChartTicker]?.logo} size="sm" />
                  {selectedChartTicker}
                </h3>
                <div className="flex items-center bg-zinc-100 p-1 rounded-lg">
                  <button
                    onClick={() => setChartModalTab('chart')}
                    className={cn("px-3 py-1.5 text-sm font-medium rounded-md transition-colors", chartModalTab === 'chart' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}
                  >
                    Price Chart
                  </button>
                  <button
                    onClick={() => setChartModalTab('kpis')}
                    className={cn("px-3 py-1.5 text-sm font-medium rounded-md transition-colors", chartModalTab === 'kpis' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}
                  >
                    Business KPIs
                  </button>
                  <button
                    onClick={() => setChartModalTab('history')}
                    className={cn("px-3 py-1.5 text-sm font-medium rounded-md transition-colors", chartModalTab === 'history' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}
                  >
                    Historical Data
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {chartModalTab === 'chart' && !['CASH', 'USD', 'EUR', 'GBP'].includes((selectedChartTicker || '').toUpperCase()) && (
                  <button
                    id="rsi-toggle-btn"
                    onClick={() => setShowRsi(prev => !prev)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 border rounded-lg font-medium transition-all text-sm select-none",
                      showRsi 
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 shadow-sm" 
                        : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                    )}
                  >
                    <div className={cn(
                      "w-2 h-2 rounded-full transition-all duration-300",
                      showRsi ? "bg-indigo-600 scale-110 animate-pulse" : "bg-zinc-300"
                    )} />
                    Show RSI
                  </button>
                )}
                <button
                  onClick={() => promptAnalysisStrategy(selectedChartTicker)}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Analyze {selectedChartTicker}
                </button>
                <button
                  onClick={() => {
                    setSelectedChartTicker(null);
                    setChartModalTab('chart');
                  }}
                  className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 w-full h-full bg-zinc-50 relative">
              {chartModalTab === 'chart' ? (
                ['CASH', 'USD', 'EUR', 'GBP'].includes((selectedChartTicker || '').toUpperCase()) ? (
                  <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                    <LineChart className="w-12 h-12 mb-4 text-zinc-300" />
                    <p>Chart data is not available for cash positions.</p>
                  </div>
                ) : (
                  <TradingViewChartWithSkeleton 
                    symbol={selectedChartTicker}
                    showRsi={showRsi}
                    theme="light"
                    autosize
                    hide_side_toolbar={false}
                    studies={(showRsi ? [...TRADINGVIEW_STUDIES, "RSI@tv-basicstudies"] : TRADINGVIEW_STUDIES) as any}
                    isMutualFund={/^[A-Z]{4}X$/.test(selectedChartTicker)}
                  />
                )
              ) : chartModalTab === 'history' ? (
                <HistoricalPriceChart ticker={selectedChartTicker} activeCurrency={activeCurrency} />
              ) : (
                <div className="h-full w-full p-6 overflow-auto">
                  {isFinancialsLoading || isBusinessKpisLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-8 max-w-4xl mx-auto">
                      <div className="flex justify-end">
                        <select
                          value={kpiTimeScale}
                          onChange={(e) => setKpiTimeScale(e.target.value as any)}
                          className="px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="5y">Last 5 Years</option>
                          <option value="10y">Last 10 Years</option>
                          <option value="all_y">All Available Years</option>
                          <option value="8q">Last 8 Quarters</option>
                          <option value="12q">Last 12 Quarters</option>
                          <option value="20q">Last 20 Quarters</option>
                        </select>
                      </div>
                      {businessKpisData && businessKpisData.length > 0 && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-200">
                          <h4 className="text-base font-semibold mb-4 text-zinc-800">Operational KPIs</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {[1, 2, 3].map((kpiIndex) => {
                              const kpiNameKey = `kpi${kpiIndex}Name`;
                              const kpiValueKey = `kpi${kpiIndex}Value`;
                              const kpiName = businessKpisData[0][kpiNameKey];
                              
                              if (!kpiName) return null;
                              
                              return (
                                <div key={kpiIndex} className="h-64">
                                  <h5 className="text-sm font-medium text-zinc-600 mb-2 text-center">{kpiName}</h5>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={businessKpisData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                                      <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                                      <YAxis 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 12, fill: '#71717a' }}
                                        tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                                        tickCount={8}
                                      />
                                      <RechartsTooltip 
                                        formatter={(value: number, name: string, props: any) => {
                                          const isProj = props.payload.isProjection;
                                          return [value.toLocaleString(), isProj ? `${name} (Projected)` : name];
                                        }}
                                        labelStyle={{ color: '#18181b', fontWeight: 600 }}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        cursor={{ fill: '#f4f4f5' }}
                                      />
                                      <Bar 
                                        dataKey={kpiValueKey} 
                                        name={kpiName} 
                                        radius={[4, 4, 0, 0]} 
                                        animationDuration={1000} 
                                        animationEasing="ease-out"
                                        activeBar={{ stroke: '#f59e0b', strokeWidth: 2, fillOpacity: 0.8 }}
                                      >
                                        {businessKpisData.map((entry: any, index: number) => {
                                          const defaultColor = kpiIndex === 1 ? "#f59e0b" : kpiIndex === 2 ? "#ec4899" : "#06b6d4";
                                          const projectionColor = kpiIndex === 1 ? "#fcd34d" : kpiIndex === 2 ? "#f9a8d4" : "#67e8f9";
                                          return <Cell key={`cell-${index}`} fill={entry.isProjection ? projectionColor : defaultColor} />;
                                        })}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {financialsData && financialsData.kpis && financialsData.kpis.length > 0 && (
                        <>
                          <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-200">
                            <h4 className="text-base font-semibold mb-4 text-zinc-800">Revenue & Net Income</h4>
                            <div className="h-80">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={financialsData.kpis} margin={{ top: 10, right: 10, left: 40, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                                  <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                                  <YAxis 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{ fontSize: 12, fill: '#71717a' }}
                                    tickFormatter={(val) => `${getCurrencySymbol(activeCurrency)}${(val / 1e9).toFixed(1)}B`}
                                    tickCount={8}
                                  />
                                  <RechartsTooltip 
                                    formatter={(value: number, name: string) => [`${getCurrencySymbol(activeCurrency)}${(value / 1e9).toFixed(2)}B`, name]}
                                    labelStyle={{ color: '#18181b', fontWeight: 600 }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    cursor={{ fill: '#f4f4f5' }}
                                  />
                                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                  <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} animationDuration={1000} animationEasing="ease-out" activeBar={{ stroke: '#4f46e5', strokeWidth: 2, fillOpacity: 0.8 }} />
                                  <Bar dataKey="netIncome" name="Net Income" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={1000} animationEasing="ease-out" activeBar={{ stroke: '#059669', strokeWidth: 2, fillOpacity: 0.8 }} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>

                          <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-200">
                            <h4 className="text-base font-semibold mb-4 text-zinc-800">Cash Flow</h4>
                            <div className="h-80">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={financialsData.kpis} margin={{ top: 10, right: 10, left: 40, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                                  <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                                  <YAxis 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{ fontSize: 12, fill: '#71717a' }}
                                    tickFormatter={(val) => `${getCurrencySymbol(activeCurrency)}${(val / 1e9).toFixed(1)}B`}
                                    tickCount={8}
                                  />
                                  <RechartsTooltip 
                                    formatter={(value: number, name: string) => [`${getCurrencySymbol(activeCurrency)}${(value / 1e9).toFixed(2)}B`, name]}
                                    labelStyle={{ color: '#18181b', fontWeight: 600 }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    cursor={{ fill: '#f4f4f5' }}
                                  />
                                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                  <Bar dataKey="operatingCashflow" name="Operating Cash Flow" fill="#3b82f6" radius={[4, 4, 0, 0]} animationDuration={1000} animationEasing="ease-out" activeBar={{ stroke: '#2563eb', strokeWidth: 2, fillOpacity: 0.8 }} />
                                  <Bar dataKey="freeCashflow" name="Free Cash Flow" fill="#8b5cf6" radius={[4, 4, 0, 0]} animationDuration={1000} animationEasing="ease-out" activeBar={{ stroke: '#7c3aed', strokeWidth: 2, fillOpacity: 0.8 }} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </>
                      )}

                      {(!businessKpisData || businessKpisData.length === 0) && (!financialsData || !financialsData.kpis || financialsData.kpis.length === 0) && (
                        <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
                          <BarChart2 className="w-12 h-12 mb-4 text-zinc-300" />
                          <p>Business KPIs are not available for this asset.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyHolding && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                {historyHolding.ticker} Transaction History
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const h = holdings.find(item => item.id === historyHolding.id) || historyHolding;
                    setEditModalHolding(h);
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg flex items-center gap-1.5 transition-colors"
                  title="Edit Position"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Position
                </button>
                <button
                  onClick={() => { setHistoryHolding(null); setSellingLot(null); }}
                  className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-zinc-50">
              {/* Ledger Summary & Reconciliation Banner */}
              {(() => {
                const computed = computeHoldingFromTransactions(historyTransactions);
                const isCorrupted = historyHolding.avg_price < 0 || historyHolding.shares < 0;
                const hasDiff = computed.totalBuys > 0 && (
                  isCorrupted ||
                  Math.abs(historyHolding.shares - computed.shares) > 0.001 ||
                  Math.abs(historyHolding.avg_price - computed.avg_price) > 0.01
                );

                if (!hasDiff) return null;

                return (
                  <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <div>
                        <div className="font-semibold">Transaction Ledger Discrepancy</div>
                        <div className="text-[11px] text-amber-800 mt-0.5">
                          Ledger computes to <strong>{computed.shares} shares</strong> @ <strong>{formatCurrency(computed.avg_price, historyHolding.avgPriceCurrency || activeCurrency)}</strong>, while saved holding is <strong>{historyHolding.shares} shares</strong> @ <strong>{formatCurrency(historyHolding.avg_price, historyHolding.avgPriceCurrency || activeCurrency)}</strong>.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSyncHoldingWithLedger(historyHolding, computed)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-xs transition-colors flex items-center gap-1 flex-shrink-0 shadow-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Sync with Ledger
                    </button>
                  </div>
                );
              })()}
              {undoError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-lg flex items-center gap-2 text-rose-700 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {undoError}
                  <button onClick={() => setUndoError(null)} className="ml-auto text-rose-400 hover:text-rose-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Sell from Specific Lot Form */}
              {sellingLot && (
                <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-6 shadow-sm animate-in fade-in zoom-in-95 duration-200">
                  <h4 className="font-semibold text-zinc-900 text-sm mb-3 flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4 text-rose-500" />
                    Sell from Lot (Purchased {new Date(sellingLot.date).toLocaleDateString()} @ {formatCurrency(sellingLot.price, activeCurrency)})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                        Shares to Sell
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="any"
                          max={getRemainingSharesForLots(historyTransactions)[sellingLot.id] || 0}
                          min="0.0001"
                          value={sellLotShares}
                          onChange={(e) => setSellLotShares(parseFloat(e.target.value) || 0)}
                          className="w-full bg-white text-sm font-medium border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                        <button
                          type="button"
                          onClick={() => setSellLotShares(getRemainingSharesForLots(historyTransactions)[sellingLot.id] || 0)}
                          className="absolute right-2 top-1.5 px-2 py-0.5 text-[10px] font-bold bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded"
                        >
                          MAX
                        </button>
                      </div>
                      <span className="text-[11px] text-zinc-400 mt-1 block">
                        Available in Lot: {(getRemainingSharesForLots(historyTransactions)[sellingLot.id] || 0).toLocaleString(undefined, { maximumFractionDigits: 5 })} shares
                      </span>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                        Sell Price per Share
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={sellLotPrice}
                        onChange={(e) => setSellLotPrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-white text-sm font-medium border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                      <span className="text-[11px] text-zinc-400 mt-1 block">
                        Current Price: {formatCurrency(quotes[historyHolding.ticker]?.price ?? historyHolding.avg_price, activeCurrency)}
                      </span>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                        Sale Date
                      </label>
                      <input
                        type="date"
                        value={sellLotDate}
                        onChange={(e) => setSellLotDate(e.target.value)}
                        className="w-full bg-white text-sm font-medium border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                  </div>
                  
                  <div className="flex justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => setSellingLot(null)}
                      className="px-3.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors border border-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSellLot(sellLotShares, sellLotPrice, sellLotDate, sellingLot)}
                      disabled={sellLotShares <= 0 || sellLotShares > (getRemainingSharesForLots(historyTransactions)[sellingLot.id] || 0) || sellLotPrice <= 0}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                    >
                      Confirm Sale
                    </button>
                  </div>
                </div>
              )}

              {isHistoryLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : historyTransactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
                  <FileText className="w-12 h-12 mb-2 opacity-20" />
                  <p>No transactions found for this holding.</p>
                </div>
              ) : (
                <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200">
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Type</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Shares</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Price</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Total</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Profit / Loss</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {historyTransactions.map((tx, index) => {
                        const lotRemainingMap = getRemainingSharesForLots(historyTransactions);
                        const rem = lotRemainingMap[tx.id] ?? 0;

                        const curPrice = quotes[historyHolding.ticker]?.price ?? historyHolding.avg_price ?? 0;
                        let txPl = 0;
                        let txPlPct = 0;
                        let isRealized = false;

                        if (tx.type === 'buy') {
                          if (curPrice > 0 && tx.price > 0) {
                            txPl = (curPrice - tx.price) * tx.shares;
                            txPlPct = ((curPrice - tx.price) / tx.price) * 100;
                          }
                        } else if (tx.type === 'sell') {
                          isRealized = true;
                          let buyCost = historyHolding.avg_price || 0;
                          if (tx.lotId) {
                            const buyLot = historyTransactions.find(t => t.id === tx.lotId);
                            if (buyLot && buyLot.price > 0) {
                              buyCost = buyLot.price;
                            }
                          }
                          if (buyCost > 0 && tx.price > 0) {
                            txPl = (tx.price - buyCost) * tx.shares;
                            txPlPct = ((tx.price - buyCost) / buyCost) * 100;
                          }
                        }
                        const isPlPos = txPl >= 0;

                        return (
                          <tr key={tx.id} className="hover:bg-zinc-100/50 transition-all duration-200 group/row">
                            <td className="px-4 py-3 text-sm text-zinc-900">
                              {new Date(tx.date).toLocaleDateString()} {new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider",
                                tx.type === 'buy' ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                              )}>
                                {tx.type}
                                {tx.type === 'sell' && tx.lotId && (
                                  <span className="text-[10px] font-sans text-rose-500 font-normal normal-case ml-1" title="Specifically matched to buy lot">
                                    (SpecID)
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-mono text-zinc-900">
                              <div>{tx.shares.toLocaleString(undefined, { maximumFractionDigits: 5 })}</div>
                              {tx.type === 'buy' && (
                                rem === tx.shares ? (
                                  <div className="text-[10px] text-zinc-400 font-sans mt-0.5">Full Lot ({rem.toLocaleString(undefined, { maximumFractionDigits: 3 })} avail)</div>
                                ) : rem > 0 ? (
                                  <div className="text-[10px] text-amber-600 font-semibold font-sans mt-0.5">{rem.toLocaleString(undefined, { maximumFractionDigits: 3 })} left</div>
                                ) : (
                                  <div className="text-[10px] text-zinc-300 font-sans mt-0.5 line-through">Sold out</div>
                                )
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-mono text-zinc-900">
                              {formatCurrency(tx.price, activeCurrency)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-mono font-medium text-zinc-900">
                              {formatCurrency(tx.shares * tx.price, activeCurrency)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-mono">
                              <div className={cn("font-semibold inline-flex items-center gap-1", isPlPos ? "text-emerald-600" : "text-rose-600")}>
                                {isPlPos ? <TrendingUp className="w-3.5 h-3.5 stroke-[2.5px]" /> : <TrendingDown className="w-3.5 h-3.5 stroke-[2.5px]" />}
                                <span>{isPlPos ? '+' : '-'}{formatCurrency(Math.abs(txPl), activeCurrency)}</span>
                              </div>
                              <div className="flex items-center justify-end gap-1 text-[10px] mt-0.5">
                                <span className="text-zinc-400 font-sans">{isRealized ? 'Realized' : 'Unrealized'}</span>
                                <span className={cn("font-medium", isPlPos ? "text-emerald-600" : "text-rose-600")}>
                                  ({isPlPos ? '+' : ''}{txPlPct.toFixed(2)}%)
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {confirmUndoId === tx.id ? (
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => handleUndoTransaction(tx)}
                                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                                    title="Confirm Undo"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setConfirmUndoId(null)}
                                    className="p-1 text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                    title="Cancel Undo"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1.5">
                                  {tx.type === 'buy' && rem > 0 && (
                                    <button
                                      onClick={() => {
                                        setSellingLot(tx);
                                        setSellLotShares(rem);
                                        setSellLotPrice(quotes[historyHolding.ticker]?.price ?? historyHolding.avg_price ?? tx.price);
                                        setSellLotDate(format(new Date(), 'yyyy-MM-dd'));
                                      }}
                                      className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 rounded-md transition-all flex items-center gap-1 shadow-sm"
                                      title="Sell from this Lot"
                                    >
                                      <TrendingDown className="w-3.5 h-3.5" />
                                      <span>Sell</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setConfirmUndoId(tx.id)}
                                    className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                    title="Undo Transaction"
                                  >
                                    <Undo2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Analysis Modal */}
      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[300] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-rose-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-rose-600" />
                </div>
                <h2 className="text-xl font-bold text-zinc-900">Reset Portfolio</h2>
              </div>
              <button 
                onClick={() => setShowResetConfirm(false)}
                className="text-zinc-400 hover:text-zinc-600 transition-colors p-2 hover:bg-zinc-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-zinc-600">
                Are you sure you want to completely reset the <strong>{activeTab === 'global' ? 'Global Portfolio' : 'Australia Investment'}</strong>?
              </p>
              <p className="text-sm text-rose-600 font-medium bg-rose-50 p-3 rounded-lg border border-rose-100">
                This action cannot be undone. All holdings and associated transactions in this tab will be permanently deleted.
              </p>
            </div>
            
            <div className="p-6 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm font-bold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetPortfolio}
                disabled={isResetting}
                className="flex items-center gap-2 px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Yes, Reset Portfolio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {showRestoreConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[300] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-emerald-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Undo2 className="w-5 h-5 text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-zinc-900">Restore Portfolio</h2>
              </div>
              <button 
                onClick={() => setShowRestoreConfirm(false)}
                className="text-zinc-400 hover:text-zinc-600 transition-colors p-2 hover:bg-zinc-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-zinc-600">
                Are you sure you want to restore the previously reset portfolio?
              </p>
              <p className="text-sm text-emerald-600 font-medium bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                This will recover the holdings and transactions from your last reset. The backup will be consumed and cannot be restored again.
              </p>
            </div>
            
            <div className="p-6 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowRestoreConfirm(false)}
                className="px-4 py-2 text-sm font-bold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRestorePortfolio}
                disabled={isRestoring}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                Yes, Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Modal */}
      {showQuickAddModal && quickAddHolding && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-emerald-600" />
                Add to {quickAddHolding.ticker}
              </h3>
              <button
                onClick={() => setShowQuickAddModal(false)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleQuickAddSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">
                  {quickAddHolding.ticker === 'CASH' ? 'Amount to Add' : 'Quantity to Add'}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quickAddShares}
                  onChange={(e) => setQuickAddShares(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900 font-mono"
                  placeholder="0.00"
                  step="any"
                  required
                  autoFocus
                />
              </div>
              {quickAddHolding.ticker !== 'CASH' && (
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Price per Share ({getCurrencySymbol(activeCurrency)})</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quickAddPrice}
                    onChange={(e) => setQuickAddPrice(e.target.value)}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900 font-mono"
                    placeholder="0.00"
                    step="any"
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Transaction Date</label>
                <input
                  type="date"
                  value={quickAddDate}
                  onChange={(e) => setQuickAddDate(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  required
                />
              </div>
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isQuickAdding}
                  className="w-full py-3 bg-zinc-900 text-white rounded-xl font-semibold hover:bg-zinc-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isQuickAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAnalysisModal && (
        <div 
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm cursor-pointer"
          onClick={() => setShowAnalysisModal(false)}
        >
          <div 
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden cursor-default border border-zinc-200 dark:border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2.5 rounded-xl",
                  analysisTicker && analysisSentiment === 'bullish' ? "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400" :
                  analysisTicker && analysisSentiment === 'bearish' ? "bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400" :
                  analysisTicker && analysisSentiment === 'neutral' ? "bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400" :
                  "bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400"
                )}>
                  <Zap className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {analysisTicker ? `AI Analysis: ${analysisTicker}` : 'AI Portfolio Analysis'}
                    </h3>
                    {analysisModelName && (
                      <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-indigo-500" />
                        {POPULAR_AI_MODELS.find(m => m.id === analysisModelName)?.name || analysisModelName}
                      </span>
                    )}
                  </div>
                  {analysisTicker && !isAnalyzing && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                        analysisSentiment === 'bullish' ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" :
                        analysisSentiment === 'bearish' ? "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800" :
                        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                      )}>
                        {analysisSentiment} Sentiment
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSettingsInitialTab('ai');
                    setShowSettings(true);
                  }}
                  className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                  title="Configure AI Models & Keys"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowAnalysisModal(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-zinc-50 dark:bg-zinc-950 min-h-0 min-w-0">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center h-64">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-indigo-600 dark:text-indigo-400 animate-spin" />
                    <Zap className={cn(
                      "w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse",
                      analysisTicker ? "text-amber-500" : "text-indigo-500"
                    )} />
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300 mt-4 font-semibold animate-pulse">
                    {analysisTicker ? `Analyzing ${analysisTicker}...` : 'Analyzing your portfolio strategy...'}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 italic">
                    Running with {POPULAR_AI_MODELS.find(m => m.id === analysisModelName)?.name || analysisModelName || 'AI Intelligence'}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {analysisFallbackNotice && (
                    <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 rounded-xl p-3.5 flex items-start gap-3 text-indigo-900 dark:text-indigo-200 text-xs">
                      <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold">{analysisFallbackNotice}</span>
                      </div>
                      <button
                        onClick={() => {
                          setSettingsInitialTab('ai');
                          setShowSettings(true);
                        }}
                        className="underline text-indigo-700 dark:text-indigo-300 font-semibold hover:text-indigo-900 shrink-0 text-xs"
                      >
                        AI Settings
                      </button>
                    </div>
                  )}

                  {analysisErrorCode ? (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-6 text-center space-y-4">
                      <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mx-auto text-amber-600 dark:text-amber-400">
                        {analysisErrorCode === 'MISSING_API_KEY' ? <Key className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-amber-900 dark:text-amber-200">
                          {analysisErrorCode === 'MISSING_API_KEY' ? 'API Key Required' :
                           analysisErrorCode === 'QUOTA_EXCEEDED' ? 'Provider Quota Exceeded' :
                           analysisErrorCode === 'INSUFFICIENT_BALANCE' ? 'Insufficient Provider Balance' :
                           'AI Provider Error'}
                        </h4>
                        <p className="text-sm text-amber-800 dark:text-amber-300/90 mt-1.5 max-w-md mx-auto leading-relaxed">
                          {analysisResult}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                        <button
                          onClick={() => handleAnalyze(analysisTicker || undefined, 'gemini-3.1-pro-preview')}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow inline-flex items-center gap-2"
                        >
                          <Sparkles className="w-4 h-4" />
                          Analyze with Gemini 3.1 Pro
                        </button>
                        <button
                          onClick={() => {
                            setSettingsInitialTab('ai');
                            setShowSettings(true);
                          }}
                          className="px-5 py-2.5 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-sm font-bold rounded-xl transition-all inline-flex items-center gap-2"
                        >
                          <Settings className="w-4 h-4" />
                          Configure Keys in Settings
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm overflow-x-auto">
                      <div className="prose prose-indigo dark:prose-invert prose-sm max-w-none break-words">
                        <Markdown>{analysisResult}</Markdown>
                      </div>
                    </div>
                  )}

                  {/* Switch Model & Re-run Bar */}
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Re-analyze with:</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {POPULAR_AI_MODELS.slice(0, 4).map(m => (
                        <button
                          key={m.id}
                          onClick={() => handleAnalyze(analysisTicker || undefined, m.id)}
                          className={cn(
                            "px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all",
                            analysisModelName === m.id
                              ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                              : "bg-zinc-50 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                          )}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {analysisSources.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                        <ExternalLink className="w-3 h-3" />
                        Sources & Further Reading
                      </h4>
                      <div className="grid grid-cols-1 gap-2">
                        {analysisSources.map((source, idx) => (
                          <a
                            key={idx}
                            href={source.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
                          >
                            <span className="text-sm text-zinc-700 dark:text-zinc-300 font-medium truncate pr-4 group-hover:text-indigo-600">
                              {source.title || source.uri}
                            </span>
                            <ExternalLink className="w-3 h-3 text-zinc-400 group-hover:text-indigo-500 flex-shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-center">
              <p className="text-[10px] text-zinc-400 italic">
                AI-generated insights. Verify with official sources.
              </p>
              <div className="flex items-center gap-2">
                {!isAnalyzing && analysisResult && !analysisSaved && analysisErrorCode !== 'MISSING_API_KEY' && (
                  <button
                    onClick={handleSaveAnalysis}
                    disabled={isSavingAnalysis}
                    className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-semibold shadow-sm flex items-center justify-center gap-2"
                  >
                    {isSavingAnalysis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Note
                  </button>
                )}
                {analysisSaved && (
                  <div className="px-4 py-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg text-sm font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Saved
                  </div>
                )}
                <button
                  onClick={() => setShowAnalysisModal(false)}
                  className="px-6 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors text-sm font-semibold shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEarningsAnalysisModal && selectedEarningsEvent && (
        <div 
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm cursor-pointer"
          onClick={() => setShowEarningsAnalysisModal(false)}
        >
          <div 
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden cursor-default border border-zinc-200 dark:border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <CalendarIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      Earnings Analysis: {selectedEarningsEvent.symbol}
                    </h3>
                    {earningsAnalysisModelName && (
                      <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-indigo-500" />
                        {POPULAR_AI_MODELS.find(m => m.id === earningsAnalysisModelName)?.name || earningsAnalysisModelName}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                    <span>{format(parseISO(selectedEarningsEvent.date), 'MMMM d, yyyy')}</span>
                    {hasExactTime(selectedEarningsEvent.date) && (
                      <>
                        <span className="text-zinc-300">•</span>
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {formatEarningsTime(selectedEarningsEvent.date)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSettingsInitialTab('ai');
                    setShowSettings(true);
                  }}
                  className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                  title="Configure AI Models & Keys"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowEarningsAnalysisModal(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-zinc-50 dark:bg-zinc-950 min-h-0 min-w-0">
              {isAnalyzingEarnings ? (
                <div className="flex flex-col items-center justify-center h-64">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-indigo-600 dark:text-indigo-400 animate-spin" />
                    <Zap className="w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-500 animate-pulse" />
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300 mt-4 font-semibold animate-pulse">
                    Analyzing earnings for {selectedEarningsEvent.symbol}...
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 italic">
                    Running with {POPULAR_AI_MODELS.find(m => m.id === earningsAnalysisModelName)?.name || earningsAnalysisModelName || 'AI Intelligence'}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {earningsAnalysisFallbackNotice && (
                    <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 rounded-xl p-3.5 flex items-start gap-3 text-indigo-900 dark:text-indigo-200 text-xs">
                      <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold">{earningsAnalysisFallbackNotice}</span>
                      </div>
                      <button
                        onClick={() => {
                          setSettingsInitialTab('ai');
                          setShowSettings(true);
                        }}
                        className="underline text-indigo-700 dark:text-indigo-300 font-semibold hover:text-indigo-900 shrink-0 text-xs"
                      >
                        AI Settings
                      </button>
                    </div>
                  )}

                  {earningsAnalysisErrorCode ? (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-6 text-center space-y-4">
                      <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mx-auto text-amber-600 dark:text-amber-400">
                        {earningsAnalysisErrorCode === 'MISSING_API_KEY' ? <Key className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-amber-900 dark:text-amber-200">
                          {earningsAnalysisErrorCode === 'MISSING_API_KEY' ? 'API Key Required' :
                           earningsAnalysisErrorCode === 'QUOTA_EXCEEDED' ? 'Provider Quota Exceeded' :
                           earningsAnalysisErrorCode === 'INSUFFICIENT_BALANCE' ? 'Insufficient Provider Balance' :
                           'AI Provider Error'}
                        </h4>
                        <p className="text-sm text-amber-800 dark:text-amber-300/90 mt-1.5 max-w-md mx-auto leading-relaxed">
                          {earningsAnalysisResult}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                        <button
                          onClick={() => handleAnalyzeEarnings(selectedEarningsEvent, 'gemini-3.1-pro-preview')}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow inline-flex items-center gap-2"
                        >
                          <Sparkles className="w-4 h-4" />
                          Analyze with Gemini 3.1 Pro
                        </button>
                        <button
                          onClick={() => {
                            setSettingsInitialTab('ai');
                            setShowSettings(true);
                          }}
                          className="px-5 py-2.5 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-sm font-bold rounded-xl transition-all inline-flex items-center gap-2"
                        >
                          <Settings className="w-4 h-4" />
                          Configure Keys in Settings
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm overflow-x-auto">
                      <div className="prose prose-indigo dark:prose-invert prose-sm max-w-none break-words">
                        <Markdown>{earningsAnalysisResult}</Markdown>
                      </div>
                    </div>
                  )}

                  {/* Switch Model & Re-run Bar */}
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Re-analyze with:</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {POPULAR_AI_MODELS.slice(0, 4).map(m => (
                        <button
                          key={m.id}
                          onClick={() => handleAnalyzeEarnings(selectedEarningsEvent, m.id)}
                          className={cn(
                            "px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all",
                            earningsAnalysisModelName === m.id
                              ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                              : "bg-zinc-50 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                          )}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-center">
              <p className="text-[10px] text-zinc-400 italic">
                AI-generated insights. Verify with official sources.
              </p>
              <div className="flex items-center gap-2">
                {!isAnalyzingEarnings && earningsAnalysisResult && !earningsAnalysisSaved && earningsAnalysisErrorCode !== 'MISSING_API_KEY' && (
                  <button
                    onClick={handleSaveEarningsAnalysis}
                    disabled={isSavingEarningsAnalysis}
                    className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-semibold shadow-sm flex items-center justify-center gap-2"
                  >
                    {isSavingEarningsAnalysis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Note
                  </button>
                )}
                {earningsAnalysisSaved && (
                  <div className="px-4 py-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg text-sm font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Saved
                  </div>
                )}
                <button
                  onClick={() => setShowEarningsAnalysisModal(false)}
                  className="px-6 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors text-sm font-semibold shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAnalysisStrategyModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden p-6 text-center border border-zinc-100 dark:border-zinc-800">
            <div className="mx-auto w-12 h-12 bg-indigo-100 dark:bg-indigo-950/50 rounded-2xl flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">AI Investment Insights</h3>
            <p className="text-sm text-zinc-500 mb-4 font-medium">Select model and choose how to proceed for {strategyTicker || 'your portfolio'}:</p>

            {/* Model Selector in Strategy Modal */}
            <div className="bg-zinc-50 dark:bg-zinc-800/60 p-3 rounded-2xl border border-zinc-200 dark:border-zinc-700/60 text-left mb-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">AI Model</span>
                <button
                  onClick={() => {
                    setShowAnalysisStrategyModal(false);
                    setSettingsInitialTab('ai');
                    setShowSettings(true);
                  }}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <Settings className="w-3 h-3" />
                  Configure Keys
                </button>
              </div>
              <select
                value={selectedStrategyModel || userSettings.aiConfig?.model || 'claude-3-7-sonnet-20250219'}
                onChange={(e) => setSelectedStrategyModel(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                {POPULAR_AI_MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowAnalysisStrategyModal(false);
                  handleAnalyze(strategyTicker || undefined, selectedStrategyModel || userSettings.aiConfig?.model);
                }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <Zap className="w-5 h-5" />
                Generate Fresh Analysis
              </button>
              <button
                onClick={() => {
                  setShowAnalysisStrategyModal(false);
                  setShowSavedAnalysesModal(true);
                  fetchSavedAnalyses(strategyTicker || 'portfolio');
                }}
                className="w-full py-3 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <FileText className="w-5 h-5" />
                View Saved Notes
              </button>
            </div>
            <button
              onClick={() => setShowAnalysisStrategyModal(false)}
              className="mt-5 text-sm font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showEarningsAnalysisStrategyModal && strategyEarningsEvent && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden p-6 text-center border border-zinc-100 dark:border-zinc-800">
            <div className="mx-auto w-12 h-12 bg-indigo-100 dark:bg-indigo-950/50 rounded-2xl flex items-center justify-center mb-4">
              <CalendarIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Earnings Insights</h3>
            <div className="text-xs text-zinc-400 mt-1 mb-3 flex flex-col items-center gap-0.5">
              <span>Date: {formatEventDateStr(strategyEarningsEvent.date)}</span>
              {hasExactTime(strategyEarningsEvent.date) && (
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                  Time: {formatEarningsTime(strategyEarningsEvent.date)}
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mb-4 font-medium">Select model and choose how to proceed for {strategyEarningsEvent.symbol}:</p>

            {/* Model Selector in Earnings Strategy Modal */}
            <div className="bg-zinc-50 dark:bg-zinc-800/60 p-3 rounded-2xl border border-zinc-200 dark:border-zinc-700/60 text-left mb-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">AI Model</span>
                <button
                  onClick={() => {
                    setShowEarningsAnalysisStrategyModal(false);
                    setSettingsInitialTab('ai');
                    setShowSettings(true);
                  }}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <Settings className="w-3 h-3" />
                  Configure Keys
                </button>
              </div>
              <select
                value={selectedEarningsStrategyModel || userSettings.aiConfig?.model || 'claude-3-7-sonnet-20250219'}
                onChange={(e) => setSelectedEarningsStrategyModel(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                {POPULAR_AI_MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowEarningsAnalysisStrategyModal(false);
                  handleAnalyzeEarnings(strategyEarningsEvent, selectedEarningsStrategyModel || userSettings.aiConfig?.model);
                }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <Zap className="w-5 h-5" />
                Generate Fresh Analysis
              </button>
              <button
                onClick={() => {
                  setShowEarningsAnalysisStrategyModal(false);
                  setShowSavedAnalysesModal(true);
                  fetchSavedAnalyses(strategyEarningsEvent.symbol);
                }}
                className="w-full py-3 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <FileText className="w-5 h-5" />
                View Saved Notes
              </button>
            </div>
            <button
              onClick={() => setShowEarningsAnalysisStrategyModal(false)}
              className="mt-5 text-sm font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showSavedAnalysesModal && (
        <div 
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm cursor-pointer"
          onClick={() => setShowSavedAnalysesModal(false)}
        >
          <div 
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600">
                  <FileText className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-900">
                  Saved AI Notes & Analysis
                </h3>
              </div>
              <button
                onClick={() => setShowSavedAnalysesModal(false)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-zinc-50 relative min-h-0 min-w-0">
              {isFetchingAnalyses ? (
                <div className="flex flex-col items-center justify-center h-64">
                  <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                  <p className="text-sm font-medium text-zinc-500">Loading saved analyses...</p>
                </div>
              ) : savedAnalyses.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-zinc-400">
                  <FileText className="w-12 h-12 mb-4 opacity-50" />
                  <p className="text-lg font-medium text-zinc-500 mb-2">No saved analysis notes</p>
                  <p className="text-sm">When you run AI analysis, you can save the results here.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {savedAnalyses.map(analysis => (
                    <div key={analysis.id} className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm relative group">
                      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => deleteAnalysis(analysis.id)}
                          className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete specific note"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-3 mb-4 flex-wrap">
                        {analysis.ticker ? (
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-zinc-900 text-lg">{analysis.ticker}</span>
                            <span className="text-xs text-zinc-500 px-2 py-1 bg-zinc-100 rounded-full">Stock</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Briefcase className="w-5 h-5 text-indigo-600" />
                            <span className="font-bold text-zinc-900 text-lg">Portfolio Analysis</span>
                          </div>
                        )}
                        <span className="text-sm text-zinc-500">
                          {format(parseISO(analysis.date), 'MMM d, yyyy h:mm a')}
                        </span>
                        {analysis.sentiment && (
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded",
                            analysis.sentiment === 'bullish' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                            analysis.sentiment === 'bearish' ? "bg-rose-50 text-rose-700 border border-rose-200" :
                            "bg-zinc-100 text-zinc-700 border border-zinc-200"
                          )}>
                            {analysis.sentiment}
                          </span>
                        )}
                      </div>
                      <div className="prose prose-indigo prose-sm max-w-none break-words overflow-x-auto">
                        <Markdown>{analysis.result}</Markdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showEditEarningsModal && (
        <EditEarningsEventModal
          isOpen={showEditEarningsModal}
          onClose={() => {
            setShowEditEarningsModal(false);
            setEditingEarningsEvent(null);
          }}
          initialEvent={editingEarningsEvent}
          holdings={holdings}
          onSave={handleSaveCustomCalendarEvent}
          onReset={handleResetCustomCalendarEvent}
        />
      )}

      {editModalHolding && (
        <EditHoldingModal
          isOpen={!!editModalHolding}
          onClose={() => setEditModalHolding(null)}
          holding={editModalHolding}
          transactions={allTransactions}
          activeCurrency={activeCurrency}
          onSave={handleSaveModalEdit}
          onSyncWithLedger={handleSyncHoldingWithLedger}
        />
      )}

    </div>
  );
}
