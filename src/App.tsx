import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ScatterChart, Scatter, ZAxis, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Plus, Trash2, AlertCircle, DollarSign, PieChart as PieChartIcon, Briefcase, UploadCloud, FileText, Loader2, Edit2, Check, X, BarChart2, Save, ChevronUp, ChevronDown, LineChart, Zap, ExternalLink, Calendar as CalendarIcon, ChevronLeft, ChevronRight, ScatterChart as ScatterChartIcon, Maximize2, Minimize2, GripHorizontal, RefreshCw, Settings, User as UserIcon, PlusCircle, Undo2, Download, Upload, History, Activity } from 'lucide-react';
import { format, isSameMonth, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, addMonths, subMonths, subYears, parseISO } from 'date-fns';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Chart } from "react-google-charts";
import { GoogleGenAI, Type } from '@google/genai';
import Papa from 'papaparse';
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
  updateDoc,
  serverTimestamp,
  User
} from './firebase';
import { StatCard, AllocationChart, PortfolioSummary } from './components/DashboardComponents';
import { PerformanceChart } from './components/PerformanceChart';
import { HistoricalPriceChart } from './components/HistoricalPriceChart';
import { StockSearch } from './components/StockSearch';
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import { formatCurrency, getCurrencySymbol } from './lib/currency';

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
            {editTicker.toUpperCase() !== 'CASH' && (
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
          <>
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
          </>
        )}
      </td>
      <td className="px-6 py-4 text-right font-mono text-sm font-medium">
        {formatCurrency(holding.currentValue, activeCurrency)}
      </td>
      <td className="px-6 py-4 text-right">
        {holding.ticker === 'CASH' ? (
          <span className="text-zinc-400">-</span>
        ) : (
          <>
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
          </>
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

type SortKey = 'ticker' | 'shares' | 'avg_price' | 'displayAvgPrice' | 'costBasis' | 'currentPrice' | 'dayChange' | 'currentValue' | 'profitLoss' | 'marketCap';

interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  avgPriceCurrency?: string;
  userId: string;
  portfolioType?: 'global' | 'india' | 'australia';
  updatedAt?: any;
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

interface EconomicEvent {
  actual: number | null;
  country: string;
  estimate: number | null;
  event: string;
  impact: string;
  previous: number | null;
  time: string;
  unit: string;
}

const CustomTooltip = ({ active, payload, label, activeCurrency }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const value = data.value || 0;
    const profitLoss = data.profitLoss || 0;
    const cost = data.cost ?? (value - profitLoss);
    const name = data.name || label;
    
    return (
      <div className="bg-white p-4 border border-zinc-200 shadow-xl rounded-xl min-w-[200px]">
        <p className="font-bold text-zinc-900 mb-3 border-b border-zinc-100 pb-2">{name}</p>
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

const CompanyLogo = ({ ticker, logo, size = 'md' }: { ticker: string, logo?: string, size?: 'sm' | 'md' }) => {
  const [error, setError] = useState(false);
  const dimensions = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const fontSize = size === 'sm' ? 'text-[8px]' : 'text-[10px]';

  useEffect(() => {
    // Reset error if ticker changes
    setError(false);
  }, [ticker]);

  const displayLogo = logo || `/api/logo/${ticker}`;

  if (error) {
    return (
      <div className={cn(dimensions, "rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 border border-zinc-200")}>
        <span className={cn("font-bold text-zinc-400", fontSize)}>{ticker.slice(0, 2)}</span>
      </div>
    );
  }

  return (
    <div className={cn(dimensions, "rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0 border border-zinc-200 p-0.5")}>
      <img 
        src={displayLogo} 
        alt={ticker} 
        className="w-full h-full object-contain"
        referrerPolicy="no-referrer"
        onError={() => {
          // Log only once per session per ticker to avoid spam
          setError(true);
        }}
      />
    </div>
  );
};

const FinancialCalendar = ({ earningsEvents, economicEvents, metadata, className, onResize, onRemove, size, activeCurrency, onEarningsClick }: { earningsEvents: EarningsEvent[], economicEvents: EconomicEvent[], metadata: any, className?: string, onResize?: () => void, onRemove?: () => void, size?: number, activeCurrency: string, onEarningsClick?: (event: EarningsEvent) => void }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'earnings' | 'economic'>('earnings');

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
      const dateKey = format(parseISO(event.date), 'yyyy-MM-dd');
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(event);
    });
    return map;
  }, [earningsEvents]);

  const economicByDate = useMemo(() => {
    const map: Record<string, EconomicEvent[]> = {};
    if (economicEvents) {
      economicEvents.forEach(event => {
        const dateKey = format(parseISO(event.time), 'yyyy-MM-dd');
        if (!map[dateKey]) map[dateKey] = [];
        map[dateKey].push(event);
      });
    }
    // Sort by impact
    Object.keys(map).forEach(key => {
      map[key].sort((a, b) => {
        const impactScore = { 'High': 3, 'Medium': 2, 'Low': 1 };
        return (impactScore[b.impact as keyof typeof impactScore] || 0) - (impactScore[a.impact as keyof typeof impactScore] || 0);
      });
    });
    return map;
  }, [economicEvents]);

  const handleExport = () => {
    if (activeTab === 'earnings') {
      if (earningsEvents.length === 0) return;
      let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Stock Portfolio Tracker//Earnings Calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Earnings Calendar\r\nX-WR-TIMEZONE:UTC\r\n';
      earningsEvents.forEach(event => {
        if (!event.date) return;
        const date = new Date(event.date);
        const dateStr = date.toISOString().replace(/[-:]/g, '').substring(0, 8);
        const dtstamp = new Date().toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        ics += 'BEGIN:VEVENT\r\n';
        ics += `UID:${event.symbol}-earnings-${dateStr}@stocktracker\r\n`;
        ics += `DTSTAMP:${dtstamp}\r\n`;
        ics += `DTSTART;VALUE=DATE:${dateStr}\r\n`;
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
    } else {
      if (economicEvents.length === 0) return;
      let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Stock Portfolio Tracker//Economic Calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Economic Calendar\r\nX-WR-TIMEZONE:UTC\r\n';
      economicEvents.forEach(event => {
        if (!event.time) return;
        const date = parseISO(event.time);
        const dateStr = date.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        const dtstamp = new Date().toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        ics += 'BEGIN:VEVENT\r\n';
        ics += `UID:${event.event.replace(/\s+/g, '-')}-${dateStr}@stocktracker\r\n`;
        ics += `DTSTAMP:${dtstamp}\r\n`;
        ics += `DTSTART:${dateStr}\r\n`;
        const endDateShort = new Date(date.getTime() + 30 * 60000);
        const endDateStr = endDateShort.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        ics += `DTEND:${endDateStr}\r\n`;
        ics += `SUMMARY:Economic: ${event.event}\r\n`;
        ics += `DESCRIPTION:Country: ${event.country}\\nImpact: ${event.impact}\\nEstimate: ${event.estimate || 'N/A'}${event.unit || ''}\\nPrevious: ${event.previous || 'N/A'}${event.unit || ''}\r\n`;
        ics += 'END:VEVENT\r\n';
      });
      ics += 'END:VCALENDAR\r\n';
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'economic_events.ics');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }
  };

  return (
    <div className={cn("flex flex-col flex-1 h-full", className)}>
      <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg transition-colors",
              activeTab === 'earnings' ? "bg-indigo-600 shadow-indigo-100" : "bg-amber-500 shadow-amber-100"
            )}>
              {activeTab === 'earnings' ? <CalendarIcon size={20} /> : <Zap size={20} />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Financial Calendar</h2>
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <span>{activeTab === 'earnings' ? 'Corporate Earnings' : 'US Macro Economic Events'}</span>
              </div>
            </div>
          </div>

          <div className="flex p-1 bg-zinc-100 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('earnings')}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2",
                activeTab === 'earnings' 
                  ? "bg-white text-indigo-600 shadow-sm" 
                  : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              <CalendarIcon size={16} />
              Earnings
            </button>
            <button
              onClick={() => setActiveTab('economic')}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2",
                activeTab === 'economic' 
                  ? "bg-white text-amber-600 shadow-sm" 
                  : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              <Zap size={16} />
              US Economic
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExport}
            disabled={activeTab === 'earnings' ? earningsEvents.length === 0 : economicEvents.length === 0}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              activeTab === 'earnings' 
                ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100" 
                : "text-amber-700 bg-amber-50 hover:bg-amber-100"
            )}
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
            const ecEvents = economicByDate[dateKey] || [];
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());

            const todayColor = activeTab === 'earnings' ? "bg-indigo-50/30" : "bg-amber-50/30";
            const badgeColor = activeTab === 'earnings' 
              ? (isToday ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" : "text-zinc-500")
              : (isToday ? "bg-amber-500 text-white shadow-md shadow-amber-100" : "text-zinc-500");

            return (
              <div 
                key={i} 
                className={cn(
                  "min-h-[140px] p-2 border-r border-b border-zinc-100 transition-colors",
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
                </div>
                <div className="space-y-1">
                  {activeTab === 'earnings' ? (
                    eEvents.map((event, idx) => (
                      <div 
                        key={`earn-${idx}`}
                        onClick={() => onEarningsClick && onEarningsClick(event)}
                        className={cn(
                          "group relative flex items-center gap-1.5 p-1.5 rounded-lg bg-white border border-zinc-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all",
                          onEarningsClick ? "cursor-pointer" : "cursor-default"
                        )}
                      >
                        <CompanyLogo ticker={event.symbol} logo={metadata[event.symbol]?.logo} size="sm" />
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold text-zinc-900 truncate">{event.symbol}</div>
                          {event.estimate && (
                            <div className="text-[8px] text-zinc-500 font-mono">EST: {getCurrencySymbol(activeCurrency)}{event.estimate.toFixed(2)}</div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    ecEvents.map((event, idx) => {
                      const impactColorClass = event.impact === 'High' ? 'text-rose-600 bg-rose-50 border-rose-200' : event.impact === 'Medium' ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-emerald-600 bg-emerald-50 border-emerald-200';
                      return (
                        <div 
                          key={`econ-${idx}`}
                          className={cn("group relative flex items-center gap-1.5 p-1.5 rounded-lg border shadow-sm hover:shadow-md transition-all cursor-default", impactColorClass)}
                        >
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold truncate">{event.event}</div>
                            <div className="text-[8px] font-mono opacity-80">{format(parseISO(event.time), 'HH:mm')}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
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
    zIndex: isDragging ? 50 : 'auto',
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
  isSaving 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  tabSettings: any, 
  userSettings: any, 
  activeTab: string, 
  onSave: (tabs: any, user: any) => void, 
  isSaving: boolean 
}) => {
  const [localTabSettings, setLocalTabSettings] = useState(tabSettings);
  const [localUserSettings, setLocalUserSettings] = useState(userSettings);

  useEffect(() => {
    if (isOpen) {
      setLocalTabSettings(tabSettings);
      setLocalUserSettings(userSettings);
    }
  }, [tabSettings, userSettings, isOpen]);

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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center text-white">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Settings</h2>
              <p className="text-sm text-zinc-500">Manage your profile and investment preferences</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <X size={20} className="text-zinc-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-10">
          {/* User Profile Section */}
          <section>
            <div className="flex items-center gap-2 mb-6 text-zinc-900">
              <UserIcon size={18} className="text-indigo-600" />
              <h3 className="font-bold uppercase tracking-wider text-xs">User Profile</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-700">Display Name</label>
                <input 
                  type="text" 
                  value={localUserSettings.displayName}
                  onChange={(e) => handleUserSettingChange('displayName', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-700">Avatar URL</label>
                <input 
                  type="text" 
                  value={localUserSettings.avatarUrl}
                  onChange={(e) => handleUserSettingChange('avatarUrl', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-2 flex items-center gap-3 pt-6">
                <button
                  onClick={() => handleUserSettingChange('showCombinedSummary', !localUserSettings.showCombinedSummary)}
                  className={cn(
                    "w-12 h-6 rounded-full transition-all relative",
                    localUserSettings.showCombinedSummary ? "bg-indigo-600" : "bg-zinc-200"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 bg-white rounded-full absolute top-1 transition-all",
                    localUserSettings.showCombinedSummary ? "left-7" : "left-1"
                  )} />
                </button>
                <span className="text-sm font-bold text-zinc-700">Show Combined Portfolio Summary</span>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-700">Combined Portfolio Currency</label>
                <select 
                  value={localUserSettings.combinedCurrency || 'USD'}
                  onChange={(e) => handleUserSettingChange('combinedCurrency', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
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

          {/* Investment Settings Section */}
          <section>
            <div className="flex items-center gap-2 mb-6 text-zinc-900">
              <Briefcase size={18} className="text-indigo-600" />
              <h3 className="font-bold uppercase tracking-wider text-xs">Investment Settings (Tab Specific)</h3>
            </div>
            
            <div className="space-y-8">
              {['global', 'india', 'australia'].map((tab) => (
                <div key={tab} className={cn(
                  "p-6 rounded-2xl border transition-all",
                  activeTab === tab ? "bg-indigo-50/30 border-indigo-100 ring-1 ring-indigo-100" : "bg-white border-zinc-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-zinc-900 capitalize">{tab} Portfolio</h4>
                    {activeTab === tab && <span className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase tracking-tighter">Active</span>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Currency</label>
                      <select 
                        value={localTabSettings[tab]?.currency || (tab === 'india' ? 'INR' : tab === 'australia' ? 'AUD' : 'USD')}
                        onChange={(e) => handleTabSettingChange(tab, 'currency', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
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
                      <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Benchmark</label>
                      <input 
                        type="text" 
                        value={localTabSettings[tab]?.benchmark}
                        onChange={(e) => handleTabSettingChange(tab, 'benchmark', e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Risk Profile</label>
                      <select 
                        value={localTabSettings[tab]?.riskProfile}
                        onChange={(e) => handleTabSettingChange(tab, 'riskProfile', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      >
                        <option value="conservative">Conservative</option>
                        <option value="moderate">Moderate</option>
                        <option value="aggressive">Aggressive</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Target Return (%)</label>
                      <input 
                        type="number" 
                        value={localTabSettings[tab]?.targetReturn}
                        onChange={(e) => handleTabSettingChange(tab, 'targetReturn', parseFloat(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="p-6 border-t border-zinc-100 bg-zinc-50/50 flex items-center justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-bold text-zinc-600 hover:bg-zinc-100 transition-all text-sm"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(localTabSettings, localUserSettings)}
            disabled={isSaving}
            className="px-8 py-2.5 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all flex items-center gap-2 shadow-lg shadow-zinc-200 disabled:opacity-50 text-sm"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [allHoldings, setAllHoldings] = useState<Holding[]>([]);
  const [activeTab, setActiveTab] = useState<'global' | 'india' | 'australia'>('global');
  
  const holdings = useMemo(() => {
    return allHoldings.filter(h => (h.portfolioType || 'global') === activeTab);
  }, [allHoldings, activeTab]);

  const [quotes, setQuotes] = useState<Quotes>({});
  const [metadata, setMetadata] = useState<Record<string, { sector: string, industry: string, logo?: string, website?: string }>>({});
  const [earningsEvents, setEarningsEvents] = useState<EarningsEvent[]>([]);
  const [dividendEvents, setDividendEvents] = useState<DividendEvent[]>([]);
  const [economicEvents, setEconomicEvents] = useState<EconomicEvent[]>([]);
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
  const [selectedChartTicker, setSelectedChartTicker] = useState<string | null>(null);
  const [chartModalTab, setChartModalTab] = useState<'chart' | 'kpis' | 'history'>('chart');
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [kpiTimeScale, setKpiTimeScale] = useState<'5y' | '10y' | 'all_y' | '8q' | '12q' | '20q'>('5y');
  const [financialsData, setFinancialsData] = useState<any>(null);
  const [isFinancialsLoading, setIsFinancialsLoading] = useState(false);
  const [businessKpisData, setBusinessKpisData] = useState<any>(null);
  const [isBusinessKpisLoading, setIsBusinessKpisLoading] = useState(false);

  // History state
  const [historyHolding, setHistoryHolding] = useState<Holding | null>(null);
  const [historyTransactions, setHistoryTransactions] = useState<Transaction[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

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
  
  // Earnings Analysis state
  const [selectedEarningsEvent, setSelectedEarningsEvent] = useState<EarningsEvent | null>(null);
  const [isAnalyzingEarnings, setIsAnalyzingEarnings] = useState(false);
  const [earningsAnalysisResult, setEarningsAnalysisResult] = useState('');
  const [showEarningsAnalysisModal, setShowEarningsAnalysisModal] = useState(false);
  const [isSavingEarningsAnalysis, setIsSavingEarningsAnalysis] = useState(false);
  const [earningsAnalysisSaved, setEarningsAnalysisSaved] = useState(false);

  const [showEarningsAnalysisStrategyModal, setShowEarningsAnalysisStrategyModal] = useState(false);
  const [strategyEarningsEvent, setStrategyEarningsEvent] = useState<EarningsEvent | null>(null);

  const promptEarningsAnalysisStrategy = (event: EarningsEvent) => {
    setStrategyEarningsEvent(event);
    setShowEarningsAnalysisStrategyModal(true);
  };

  // Chart state
  const [chartType, setChartType] = useState<'pie' | 'bar' | 'scatter'>('pie');
  const [chartView, setChartView] = useState<'asset' | 'industry'>('asset');
  const [showAllAllocation, setShowAllAllocation] = useState(false);

  // Widget sizes state (1, 2, or 3 columns)
  const [widgetSizes, setWidgetSizes] = useState<Record<string, number>>(() => {
    const defaults = {
      allocation: 2,
      calendar: 2,
      holdings: 3,
      dividends: 3,
      addPosition: 1,
      upload: 1,
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
    let order = [
      'performance',
      'allocation',
      'calendar',
      'holdings',
      'dividends',
      'addPosition',
      'upload'
    ];
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // If they don't have the performance widget yet, add it to the top
          if (!parsed.includes('performance')) {
            parsed.unshift('performance');
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addWidgetRef.current && !addWidgetRef.current.contains(event.target as Node)) {
        setShowAddWidget(false);
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
    { id: 'dividends', label: 'Dividends' },
    { id: 'addPosition', label: 'Add Position' },
    { id: 'upload', label: 'Import Portfolio' }
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
      
      alert('Portfolio historical data (5Y) has been synced and cached locally.');
    } catch (err) {
      console.error('Error syncing history:', err);
      alert('Failed to sync historical data. Please try again later.');
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
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>([
    'ticker', 'shares', 'displayAvgPrice', 'costBasis', 'currentPrice', 'dayChange', 'currentValue', 'profitLoss', 'marketCap'
  ]);

  // Settings state
  const [tabSettings, setTabSettings] = useState<Record<string, { benchmark: string, riskProfile: string, targetReturn: number, currency: string }>>({
    global: { benchmark: 'SPY', riskProfile: 'moderate', targetReturn: 8, currency: 'USD' },
    india: { benchmark: '^NSEI', riskProfile: 'moderate', targetReturn: 12, currency: 'INR' },
    australia: { benchmark: '^AXJO', riskProfile: 'moderate', targetReturn: 7, currency: 'AUD' },
  });
  const [userSettings, setUserSettings] = useState<{ displayName: string, avatarUrl: string, showCombinedSummary: boolean, combinedCurrency: string, combinedBenchmark: string }>({
    displayName: '',
    avatarUrl: '',
    showCombinedSummary: true,
    combinedCurrency: 'USD',
    combinedBenchmark: 'SPY',
  });
  const [showSettings, setShowSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

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
  const activeCurrency = tabSettings[activeTab]?.currency || (activeTab === 'india' ? 'INR' : activeTab === 'australia' ? 'AUD' : 'USD');

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'settings', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.tabs) setTabSettings(data.tabs);
        if (data.user) setUserSettings({
          displayName: data.user.displayName || '',
          avatarUrl: data.user.avatarUrl || '',
          showCombinedSummary: data.user.showCombinedSummary !== undefined ? data.user.showCombinedSummary : true,
          combinedCurrency: data.user.combinedCurrency || 'USD',
          combinedBenchmark: data.user.combinedBenchmark || 'SPY',
        });
      } else {
        // Initialize default settings in Firestore
        setDoc(doc(db, 'settings', user.uid), {
          tabs: {
            global: { benchmark: 'SPY', riskProfile: 'moderate', targetReturn: 8, currency: 'USD' },
            india: { benchmark: '^NSEI', riskProfile: 'moderate', targetReturn: 12, currency: 'INR' },
            australia: { benchmark: '^AXJO', riskProfile: 'moderate', targetReturn: 7, currency: 'AUD' }
          },
          user: {
            displayName: user.displayName || user.email?.split('@')[0] || 'Investor',
            avatarUrl: user.photoURL || '',
            showCombinedSummary: true,
            combinedCurrency: 'USD',
            combinedBenchmark: 'SPY',
          }
        });
      }
    });
    return () => unsubscribe();
  }, [user]);

  const handleSaveSettings = async (newTabSettings: any, newUserSettings: any) => {
    if (!user) return;
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, 'settings', user.uid), {
        tabs: newTabSettings,
        user: newUserSettings
      }, { merge: true });
      
      setTabSettings(newTabSettings);
      setUserSettings(newUserSettings);

      setSaveMessage({ text: 'Settings saved', type: 'success' });
      setShowSettings(false);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage({ text: 'Failed to save settings', type: 'error' });
    } finally {
      setIsSavingSettings(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const [benchmarkData, setBenchmarkData] = useState<{ dayChangePercent: number, ytdReturn?: number } | null>(null);

  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
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

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedHoldings = JSON.parse(event.target?.result as string);
        if (!Array.isArray(importedHoldings)) throw new Error('Invalid format');
        
        if (!user) return;

        setIsSubmitting(true);
        // Clear existing (optional, or merge)
        const q = query(collection(db, 'holdings'), where('userId', '==', user.uid));
        const snapshot = await getDocs(q);
        const docsToDelete = snapshot.docs.filter(d => (d.data().portfolioType || 'global') === activeTab);
        await Promise.all(docsToDelete.map(d => deleteDoc(d.ref)));

        for (const h of importedHoldings) {
          await addDoc(collection(db, 'holdings'), {
            ticker: h.ticker.toUpperCase(),
            shares: h.shares,
            avg_price: h.avg_price,
            userId: user.uid,
            portfolioType: activeTab,
            updatedAt: serverTimestamp()
          });
        }
        setSaveMessage({ text: 'Portfolio imported successfully', type: 'success' });
      } catch (err) {
        console.error('Import error:', err);
        alert('Failed to import portfolio. Please check the file format.');
      } finally {
        setIsSubmitting(false);
        setTimeout(() => setSaveMessage(null), 3000);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadTransactions = async () => {
    if (!user) return;
    try {
      const q = query(collection(db, 'transactions'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      
      const holdingsMap = Object.fromEntries(holdings.map(h => [h.id, h.ticker]));

      const transactionData = snapshot.docs
        .map(docSnap => {
          const tx = docSnap.data();
          return {
            ...tx,
            id: docSnap.id,
            ticker: holdingsMap[tx.holdingId] || 'UNKNOWN'
          };
        })
        .filter(tx => tx.ticker !== 'UNKNOWN');

      const dataStr = JSON.stringify(transactionData, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const exportFileDefaultName = `transactions_${activeTab}.json`;
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    } catch (error) {
      console.error('Export transactions error:', error);
      alert('Failed to export transactions');
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
          
          return normalized;
        }).map(tx => {
          // Clean up ticker (handle cases like "Bitcoin BTC" or "BTC-USD")
          let ticker = tx.ticker.trim();
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

        // Group transactions by ticker
        const transactionsByTicker: Record<string, any[]> = {};
        for (const tx of importedTransactions) {
          let ticker = (tx.ticker || '').toString().toUpperCase().trim();
          if (!ticker) continue;

          if (ticker.includes('/') || ticker.includes('-') || ticker.includes('_')) {
            ticker = ticker.split(/[\/\-_]/)[0].trim();
          }

          if (!transactionsByTicker[ticker]) transactionsByTicker[ticker] = [];
          transactionsByTicker[ticker].push(tx);
        }

        // Clear existing data only for the tickers present in the import
        const tickersToImport = new Set(Object.keys(transactionsByTicker));
        
        const holdingsQ = query(collection(db, 'holdings'), where('userId', '==', user.uid), where('portfolioType', '==', activeTab || 'global'));
        const holdingsSnapshot = await getDocs(holdingsQ);
        
        // Fetch ALL user transactions once to avoid per-holding queries and index requirements
        const allTxQ = query(collection(db, 'transactions'), where('userId', '==', user.uid));
        const allTxSnapshot = await getDocs(allTxQ);
        const allUserTransactions = allTxSnapshot.docs;

        for (const holdingDoc of holdingsSnapshot.docs) {
          const hData = holdingDoc.data();
          if (tickersToImport.has(hData.ticker)) {
            // Filter transactions for THIS holding locally
            const txToDelete = allUserTransactions.filter(d => d.data().holdingId === holdingDoc.id);
            await Promise.all(txToDelete.map(d => deleteDoc(d.ref)));
            await deleteDoc(holdingDoc.ref);
          }
        }

        let totalHoldingsCreated = 0;
        let totalTransactionsCreated = 0;

        // Re-create holdings and transactions from history
        for (const ticker of Object.keys(transactionsByTicker)) {
          const txs = transactionsByTicker[ticker];
          // Robust date sorting
          txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          
          let currentShares = 0;
          let currentAvgPrice = 0;
          let firstTxCurrency = txs[0].currency || activeCurrency;

          for (const tx of txs) {
            const numShares = tx.shares;
            const numPrice = tx.price;
            const typeStr = tx.type.toLowerCase();
            const isSell = typeStr.includes('sell') || typeStr.includes('sale') || typeStr.includes('out') || typeStr.includes('short') || typeStr.includes('withdrawal');

            if (isSell) {
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
            portfolioType: activeTab || 'global',
            updatedAt: serverTimestamp()
          };

          if (firstTxCurrency) {
            holdingData.avgPriceCurrency = firstTxCurrency.toString().substring(0, 10);
          }

          const holdingRef = await addDoc(collection(db, 'holdings'), holdingData);
          totalHoldingsCreated++;

          // Create Transactions History
          for (const tx of txs) {
            const typeStr = tx.type.toLowerCase();
            const isSell = typeStr.includes('sell') || typeStr.includes('sale') || typeStr.includes('out') || typeStr.includes('short') || typeStr.includes('withdrawal');

             await addDoc(collection(db, 'transactions'), {
              holdingId: holdingRef.id,
              type: isSell ? 'sell' : 'buy',
              shares: tx.shares,
              price: tx.price,
              date: tx.date,
              userId: user.uid
            });
            totalTransactionsCreated++;
          }
        }

        setSaveMessage({ 
          text: `Successfully imported ${totalTransactionsCreated} transactions for ${totalHoldingsCreated} assets.`, 
          type: 'success' 
        });
      } catch (err) {
        console.error('Import transactions error:', err);
        alert('Failed to import transactions. Please check the file format.');
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
      alert('Failed to connect to Google');
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
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
      tabSettings['india']?.benchmark || '^NSEI',
      tabSettings['australia']?.benchmark || '^AXJO'
    ];
    const symbolsToFetch = Array.from(new Set([...currentHoldings.map(h => h.ticker), ...allBenchmarks, 'AUD=X', 'INR=X', 'EUR=X', 'GBP=X', 'CAD=X', 'SGD=X'])).join(',');
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

  const fetchEconomicEvents = async () => {
    try {
      const from = format(subMonths(new Date(), 1), 'yyyy-MM-dd');
      const to = format(addMonths(new Date(), 2), 'yyyy-MM-dd');
      const res = await fetch(`/api/economic-events?from=${from}&to=${to}`);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setEconomicEvents(data);
      }
    } catch (error) {
      console.error('Error fetching economic events:', error);
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
        fetchDividends(holdings),
        fetchEconomicEvents()
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
      setAllHoldings(data);
      setLoading(false);
    }, (error) => {
      console.error('Firestore Error:', error);
      setLoading(false);
    });

    const backupUnsubscribe = onSnapshot(doc(db, 'backups', user.uid), (snapshot) => {
      setHasBackup(snapshot.exists());
    });

    return () => {
      unsubscribe();
      backupUnsubscribe();
    };
  }, [user]);

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
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not configured');
          }
          const ai = new GoogleGenAI({ apiKey });
          
          const isQuarterly = kpiTimeScale.endsWith('q');
          const timeValue = kpiTimeScale.replace(/[yq]/, '').replace('all_', 'all ');
          const periodText = isQuarterly ? 'quarterly' : 'annual';
          const durationText = kpiTimeScale.startsWith('all') ? 'all available' : `the last ${timeValue}`;
          const durationUnit = isQuarterly ? 'quarters' : 'years';

          const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: `Provide the historical and projected ${periodText} business KPIs (e.g., Daily Active Users, Monthly Active Users, Subscribers, Deliveries, or other relevant operational metrics) for the company with ticker symbol ${selectedChartTicker} over ${durationText} ${durationUnit}, plus the next 2-3 ${durationUnit} of analyst and company projections. If the company is not a tech/service company with users, provide their most relevant operational KPIs (e.g., vehicles delivered for TSLA, stores opened for SBUX). Return the data as a JSON array of objects, where each object has a 'period' (string, e.g., '2023' for annual or 'Q1 2023' for quarterly), a boolean 'isProjection' indicating if it's a future estimate, and 2-3 relevant KPI fields (numbers). Use short, camelCase keys for the KPI fields.`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    period: { type: Type.STRING },
                    isProjection: { type: Type.BOOLEAN, description: "True if this period is a future projection/estimate" },
                    kpi1Name: { type: Type.STRING, description: "Display name of the first KPI (e.g., 'Daily Active Users (Millions)')" },
                    kpi1Value: { type: Type.NUMBER },
                    kpi2Name: { type: Type.STRING, description: "Display name of the second KPI" },
                    kpi2Value: { type: Type.NUMBER },
                    kpi3Name: { type: Type.STRING, description: "Display name of the third KPI (optional)" },
                    kpi3Value: { type: Type.NUMBER }
                  },
                  required: ["period", "isProjection", "kpi1Name", "kpi1Value", "kpi2Name", "kpi2Value"]
                }
              }
            }
          });
          
          const data = JSON.parse(response.text || '[]');
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

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'trade' && data.data) {
          // Use functional update to ensure we have the latest state
          // and avoid closure issues
          setQuotes(prev => {
            const newQuotes = { ...prev };
            let updated = false;
            data.data.forEach((trade: any) => {
              if (trade.s && trade.p != null) {
                // Only update if price actually changed or we don't have it
                if (!prev[trade.s] || prev[trade.s].price !== trade.p) {
                  newQuotes[trade.s] = { 
                    ...prev[trade.s],
                    price: trade.p, 
                    previousClose: trade.pc != null ? trade.pc : (prev[trade.s]?.previousClose ?? trade.p),
                    marketState: trade.ms || prev[trade.s]?.marketState
                  };
                  updated = true;
                }
              }
            });
            return updated ? newQuotes : prev;
          });
        }
      } catch (e) {
        console.error('Error parsing WS message', e);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    const allBenchmarks = [
      tabSettings['global']?.benchmark || 'SPY',
      tabSettings['india']?.benchmark || '^NSEI',
      tabSettings['australia']?.benchmark || '^AXJO'
    ];
    if (holdings.length > 0 || allBenchmarks.length > 0) {
      const symbols = Array.from(new Set([...holdings.map(h => h.ticker), ...allBenchmarks]));
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
    const finalTicker = ticker.trim().toUpperCase();
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
        // Update existing holding
        let newShares = isSell ? existingHolding.shares - numShares : existingHolding.shares + numShares;
        
        // Calculate new average price (only for buys)
        let newAvgPrice = existingHolding.avg_price;
        if (!isSell) {
          const totalCost = (existingHolding.shares * existingHolding.avg_price) + (numShares * numPrice);
          newAvgPrice = totalCost / newShares;
        }

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
        const holdingData = {
          ticker: finalTicker,
          shares: isSell ? -numShares : numShares,
          avg_price: numPrice,
          avgPriceCurrency: formCurrency || activeCurrency,
          userId: user.uid,
          portfolioType: activeTab,
          updatedAt: serverTimestamp()
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

      setTicker('');
      setShares('');
      setAvgPrice('');
      setFormCurrency('');
      setTransactionDate(format(new Date(), 'yyyy-MM-dd'));
      setTransactionType('buy');
    } catch (error) {
      console.error('Error adding stock:', error);
    } finally {
      setIsSubmitting(false);
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

  const handleEditClick = (holding: Holding, field: string | null = null) => {
    setEditingId(holding.id);
    setEditTicker(holding.ticker);
    setEditShares(holding.shares.toString());
    setEditAvgPrice(holding.avg_price.toString());
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
    if (!editTicker || !editShares || (!isCash && !editAvgPrice) || !user) return;
    try {
      await updateDoc(doc(db, 'holdings', id), {
        ticker: finalTicker,
        shares: parseFloat(editShares.toString().replace(/,/g, '.')),
        avg_price: isCash ? 1 : parseFloat(editAvgPrice.toString().replace(/,/g, '.')),
        avgPriceCurrency: editAvgPriceCurrency,
        updatedAt: serverTimestamp()
      });
      
      setEditingId(null);
      setEditTicker('');
      setEditShares('');
      setEditAvgPrice('');
      setEditAvgPriceCurrency('');
      setEditField(null);
    } catch (error) {
      console.error('Error updating stock:', error);
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
      setHistoryTransactions(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (error) {
      console.error('Error fetching transactions:', error);
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

  const handleAnalyzeEarnings = async (event: EarningsEvent) => {
    setSelectedEarningsEvent(event);
    setShowEarningsAnalysisModal(true);
    setIsAnalyzingEarnings(true);
    setEarningsAnalysisResult('');
    setEarningsAnalysisSaved(false);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setEarningsAnalysisResult('Error: GEMINI_API_KEY is not configured.');
        setIsAnalyzingEarnings(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const eventDate = parseISO(event.date);
      const isPast = eventDate < new Date();
      
      let prompt = '';
      
      if (isPast) {
        prompt = `You are a professional investment strategist. Analyze the recent earnings report for ${event.symbol} that occurred around ${format(eventDate, 'MMM d, yyyy')}.
        
        Estimated EPS was: ${event.estimate ? event.estimate.toFixed(2) : 'N/A'}
        
        Please provide:
        1. **Actual Results vs Expectations**: Did they beat or miss estimates? Summarize the actual EPS and revenue vs expectations.
        2. **Market Reaction**: How did the stock price react following the report?
        3. **Key Takeaways & Guidance**: What were the main highlights from the earnings call and any forward guidance provided by management?
        4. **Strategic Implications**: What does this mean for the company's outlook and the stock going forward?
        
        Use the search tool to get the actual reported numbers, news, and analyst reactions following this specific earnings event.
        Use professional Markdown formatting.`;
      } else {
        prompt = `You are a professional investment strategist. Analyze the upcoming earnings event for ${event.symbol}.
        
        Earnings Date: ${format(eventDate, 'MMM d, yyyy')}
        Estimated EPS: ${event.estimate ? event.estimate.toFixed(2) : 'N/A'}
        High Estimate: ${event.high ? event.high.toFixed(2) : 'N/A'}
        Low Estimate: ${event.low ? event.low.toFixed(2) : 'N/A'}
        
        Please provide:
        1. **Analyst Expectations**: Summarize what the market is expecting for this quarter.
        2. **Key Themes to Watch**: What are the main topics or metrics investors will be focusing on during the earnings call?
        3. **Recent Performance Context**: How has the stock performed leading up to this earnings report?
        4. **Potential Surprises**: What could cause a positive or negative surprise?
        
        Use the search tool to get the most up-to-date information, news, and analyst reports from the last 3 months regarding this specific earnings event.
        Use professional Markdown formatting.`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      setEarningsAnalysisResult(response.text || 'Failed to generate analysis.');
    } catch (error) {
      console.error('Earnings analysis error:', error);
      setEarningsAnalysisResult('An error occurred during analysis.');
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

  const handleAnalyze = async (ticker?: string) => {
    if (!ticker && holdings.length === 0) return;
    
    setIsAnalyzing(true);
    setShowAnalysisModal(true);
    setAnalysisResult('');
    setAnalysisTicker(ticker || null);
    setAnalysisSources([]);
    setAnalysisSentiment('neutral');
    setAnalysisSaved(false);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setAnalysisResult('Error: GEMINI_API_KEY is not configured.');
        return;
      }

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
          Ensure you use the search tool to get the most up-to-date information from the last 6 months.
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
          Ensure you use the search tool to get the most up-to-date information from the last 6 months.
          Use professional Markdown formatting.`;
        }
      } else {
        const portfolioData = portfolioStats.enrichedHoldings.map(h => ({
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

        Ensure you use the search tool to get the most up-to-date information.
        Use professional Markdown formatting.`;
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      const fullText = response.text || 'Failed to generate analysis.';
      
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

      // Extract URLs from grounding metadata
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        const sources = chunks
          .filter((chunk: any) => chunk.web)
          .map((chunk: any) => ({
            uri: chunk.web.uri,
            title: chunk.web.title
          }));
        setAnalysisSources(sources);
      }
    } catch (error) {
      console.error('Error analyzing:', error);
      setAnalysisResult('An error occurred while analyzing. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

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
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setUploadError('GEMINI_API_KEY is not configured');
        setIsUploading(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const reader = new FileReader();

      if (isPdf) {
        reader.readAsDataURL(file);
        reader.onload = async () => {
          try {
            const base64Pdf = (reader.result as string).split(',')[1];
            
            const response = await ai.models.generateContent({
              model: 'gemini-3.1-pro-preview',
              contents: [
                {
                  inlineData: {
                    data: base64Pdf,
                    mimeType: 'application/pdf'
                  }
                },
                activeTab === 'india'
                  ? "Extract the stock portfolio from this document. This is likely an Indian brokerage statement (e.g., ICICI Direct, Zerodha). Return a list of holdings with ticker symbol, number of shares, and average price/cost basis."
                  : activeTab === 'australia'
                  ? "Extract the stock portfolio from this document. This is likely an Australian brokerage statement (e.g., CommSec, Spaceship, SelfWealth, Stake). Return a list of holdings with ticker symbol, number of shares, and average price/cost basis. IMPORTANT: For Australian stocks, you MUST append '.AX' to the ticker symbol. Many Australian statements for international stocks provide costs in AUD. If you see columns like 'Unit Price (A$)', 'Total Cost (A$)', or 'FX Fee (A$)', you MUST calculate the average price by dividing the 'Total Cost (A$)' (which includes the FX fee) by the number of 'Units' or 'Shares'. Set the currency to 'AUD'. If the statement only provides the native price (e.g., USD), use that and set the currency to 'USD'."
                  : "Extract the stock portfolio from this document. Return a list of holdings with ticker symbol, number of shares, and average price/cost basis."
              ],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      ticker: { type: Type.STRING, description: "Stock ticker symbol (e.g., AAPL)" },
                      shares: { type: Type.NUMBER, description: "Number of shares" },
                      avg_price: { type: Type.NUMBER, description: "Average price or cost basis per share" },
                      currency: { type: Type.STRING, description: "The currency of the average price (e.g., 'AUD', 'USD', 'INR')" }
                    },
                    required: ["ticker", "shares", "avg_price"]
                  }
                }
              }
            });

            await processExtractedHoldings(response.text);
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
            
            const response = await ai.models.generateContent({
              model: 'gemini-3.1-pro-preview',
              contents: [
                activeTab === 'india'
                  ? `Extract the stock portfolio from this CSV data. This is likely an Indian brokerage statement (e.g., ICICI Direct, Zerodha). 
                Return a list of current holdings with ticker symbol, number of shares, and average price/cost basis.
                IMPORTANT: Do NOT append '.NS' or any other exchange suffix to the ticker symbols. Return the exact ticker symbol as it appears in the CSV.
                
                CSV Data:
                ${csvText.slice(0, 30000)}`
                  : activeTab === 'australia'
                  ? `Extract the stock portfolio from this CSV data. This is likely an Australian brokerage statement (e.g., CommSec, Spaceship, SelfWealth, Stake). 
                Return a list of current holdings with ticker symbol, number of shares, and average price/cost basis.
                IMPORTANT: For Australian stocks, you MUST append '.AX' to the ticker symbol. Many Australian statements for international stocks provide costs in AUD. If you see columns like 'Unit Price (A$)', 'Total Cost (A$)', or 'FX Fee (A$)', you MUST calculate the average price by dividing the 'Total Cost (A$)' (which includes the FX fee) by the number of 'Units' or 'Shares'. Set the currency to 'AUD'. If the CSV only provides the native price (e.g., USD), use that and set the currency to 'USD'.
                
                CSV Data:
                ${csvText.slice(0, 30000)}`
                  : `Extract the stock portfolio from this CSV data. This is likely an Interactive Brokers Flex Query or export. 
                Return a list of current holdings with ticker symbol, number of shares, and average price/cost basis.
                
                CSV Data:
                ${csvText.slice(0, 30000)}`, // Truncate if too long, though Gemini 3 series models handle more
              ],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      ticker: { type: Type.STRING, description: "Stock ticker symbol (e.g., AAPL)" },
                      shares: { type: Type.NUMBER, description: "Number of shares" },
                      avg_price: { type: Type.NUMBER, description: "Average price or cost basis per share" },
                      currency: { type: Type.STRING, description: "The currency of the average price (e.g., 'AUD', 'USD', 'INR')" }
                    },
                    required: ["ticker", "shares", "avg_price"]
                  }
                }
              }
            });

            await processExtractedHoldings(response.text);
          } catch (err: any) {
            console.error('Error processing CSV with Gemini:', err);
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

      let finalTicker = holding.ticker.toUpperCase().trim();

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
          continue;
        }
      }

      await addDoc(collection(db, 'holdings'), {
        ticker: finalTicker,
        shares: holdingShares,
        avg_price: holdingAvgPrice,
        avgPriceCurrency: holding.currency || activeCurrency,
        userId: user.uid,
        portfolioType: activeTab,
        updatedAt: serverTimestamp()
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
          marketCap: undefined
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

      totalValue += currentValue;
      totalCost += costBasis;
      totalDayChange += dayChange;

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
        marketState,
        marketCap
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
  }, [holdings, quotes, benchmarkTicker]);

  const combinedStats = useMemo(() => {
    let totalValue = 0;
    let totalCost = 0;
    let totalDayChange = 0;

    const targetCurrency = userSettings.combinedCurrency || 'USD';

    allHoldings.forEach(h => {
      // Handle Cash
      if (h.ticker === 'CASH') {
        const sourceCurrency = h.avgPriceCurrency || (h.portfolioType === 'india' ? 'INR' : (h.portfolioType === 'australia' ? 'AUD' : 'USD'));
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
      
      const sourceCurrency = quote?.currency || (h.portfolioType === 'india' ? 'INR' : (h.portfolioType === 'australia' ? 'AUD' : 'USD'));
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
      totalProfitLoss,
      totalProfitLossPercent,
      totalDayChange,
      totalDayChangePercent
    };
  }, [allHoldings, quotes, userSettings.combinedCurrency]);

  const sortedHoldings = useMemo(() => {
    let sortableItems = [...portfolioStats.enrichedHoldings];
    
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

    if (sortConfig !== null) {
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
  }, [portfolioStats.enrichedHoldings, sortConfig]);

  const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#10b981', '#06b6d4', '#3b82f6'];

  const chartData = useMemo(() => {
    // Group by ticker for the pie chart
    const grouped: Record<string, { value: number, profitLoss: number, cost: number }> = {};
    portfolioStats.enrichedHoldings.forEach(h => {
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
  }, [portfolioStats.enrichedHoldings]);

  const sectorData = useMemo(() => {
    const grouped: Record<string, { value: number, cost: number, profitLoss: number }> = {};
    portfolioStats.enrichedHoldings.forEach(h => {
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
  }, [portfolioStats.enrichedHoldings, metadata]);

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
    const tabBenchmark = tabSettings[tabId]?.benchmark || (tabId === 'india' ? '^NSEI' : tabId === 'australia' ? '^AXJO' : 'SPY');
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
    { id: 'shares', label: 'Shares', align: 'right' as const, sortKey: 'shares' as SortKey },
    { id: 'displayAvgPrice', label: `Avg Cost (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'displayAvgPrice' as SortKey },
    { id: 'costBasis', label: `Investment Cost (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'costBasis' as SortKey },
    { id: 'currentPrice', label: `Price (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'currentPrice' as SortKey },
    { id: 'dayChange', label: `Day Change (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'dayChange' as SortKey },
    { id: 'currentValue', label: `Total Value (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'currentValue' as SortKey },
    { id: 'profitLoss', label: `Total Return (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'profitLoss' as SortKey },
    { id: 'marketCap', label: `Market Cap (${getCurrencySymbol(activeCurrency).trim()})`, align: 'right' as const, sortKey: 'marketCap' as SortKey },
  ];

  const handleDragEndColumns = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumnOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const renderCell = (colId: string, holding: any) => {
    switch (colId) {
      case 'ticker':
        return (
          <td key={colId} className="px-6 py-4" onClick={(e) => { e.stopPropagation(); handleEditClick(holding, 'ticker'); }}>
            <div className="flex items-center gap-3">
              <CompanyLogo ticker={holding.ticker} logo={metadata[holding.ticker]?.logo} />
              {editingId === holding.id ? (
                <input
                  type="text"
                  value={editTicker}
                  onChange={(e) => setEditTicker(e.target.value)}
                  className="w-24 px-2 py-1 border border-zinc-300 rounded focus:outline-none focus:ring-1 focus:ring-zinc-900 uppercase"
                  placeholder="Ticker"
                  autoFocus={editField === 'ticker'}
                />
              ) : (
                <div className="font-semibold text-zinc-900 group-hover/row:text-indigo-600 transition-colors">{holding.ticker}</div>
              )}
            </div>
          </td>
        );
      case 'shares':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm" onClick={(e) => { e.stopPropagation(); handleEditClick(holding, 'shares'); }}>
            {editingId === holding.id ? (
              <input
                type="text"
                inputMode="decimal"
                value={editShares}
                onChange={(e) => setEditShares(e.target.value)}
                className="w-24 px-2 py-1 border border-zinc-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-zinc-900"
                min="0.00001"
                step="any"
                autoFocus={editField === 'shares'}
              />
            ) : (
              <div className="flex items-center justify-end gap-2 group/shares">
                <span>{holding.shares.toLocaleString()}</span>
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
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm" onClick={(e) => { e.stopPropagation(); handleEditClick(holding, 'displayAvgPrice'); }}>
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
                <input
                  type="text"
                  inputMode="decimal"
                  value={editAvgPrice}
                  onChange={(e) => setEditAvgPrice(e.target.value)}
                  className="w-24 px-2 py-1 border border-zinc-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-zinc-900"
                  min="0.01"
                  step="any"
                  autoFocus={editField === 'displayAvgPrice'}
                />
              </div>
            ) : (
              formatCurrency(holding.displayAvgPrice, activeCurrency)
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
          </td>
        );
      case 'currentValue':
        return (
          <td key={colId} className="px-6 py-4 text-right font-mono text-sm font-medium">
            {formatCurrency(holding.currentValue, activeCurrency)}
          </td>
        );
      case 'profitLoss':
        return (
          <td key={colId} className="px-6 py-4 text-right">
            <div className={cn(
              "inline-flex items-center gap-1 font-medium text-sm",
              holding.profitLoss >= 0 ? "text-emerald-600" : "text-rose-600"
            )}>
              {holding.profitLoss >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {holding.profitLoss >= 0 ? '+' : '-'}{Math.abs(holding.profitLossPercent).toFixed(2)}%
            </div>
            <div className={cn(
              "text-xs mt-0.5 font-mono",
              holding.profitLoss >= 0 ? "text-emerald-600/70" : "text-rose-600/70"
            )}>
              {formatCurrency(holding.profitLoss, activeCurrency, true)}
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
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
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
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
              <div className="flex flex-col gap-6 bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto no-scrollbar">
                  <div className="p-6 md:p-8 flex flex-row items-center gap-8 lg:gap-16 min-w-max">
                    <div className="flex flex-col min-w-max">
                      <div className="flex items-center gap-2 mb-2">
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
                      <span className="text-4xl font-semibold tracking-tight text-zinc-900">{formatCurrency(combinedStats.totalValue, userSettings.combinedCurrency || 'USD')}</span>
                    </div>

                    <div className="flex flex-row gap-8 lg:gap-16 ml-auto min-w-max">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
                          Combined Return
                        </div>
                        <div className={cn("text-2xl md:text-3xl font-medium flex items-center gap-2", combinedStats.totalProfitLossPercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {formatCurrency(combinedStats.totalProfitLoss, userSettings.combinedCurrency || 'USD', true)}
                        </div>
                        <div className={cn("text-sm font-medium flex items-center gap-1", combinedStats.totalProfitLossPercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {combinedStats.totalProfitLossPercent >= 0 ? <TrendingUp size={16} /> : <TrendingUp size={16} className="rotate-180" />}
                          {Math.abs(combinedStats.totalProfitLossPercent).toFixed(2)}% All Time
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
                          Combined Day Change
                        </div>
                        <div className={cn("text-2xl md:text-3xl font-medium flex items-center gap-2", combinedStats.totalDayChangePercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {formatCurrency(combinedStats.totalDayChange, userSettings.combinedCurrency || 'USD', true)}
                        </div>
                        <div className={cn("text-sm font-medium flex items-center gap-1", combinedStats.totalDayChangePercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {combinedStats.totalDayChangePercent >= 0 ? <TrendingUp size={16} /> : <TrendingUp size={16} className="rotate-180" />}
                          {Math.abs(combinedStats.totalDayChangePercent).toFixed(2)}% Today
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-6">
          <button
            onClick={() => setActiveTab('global')}
            className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center ${activeTab === 'global' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'}`}
          >
            Global Portfolio
            {getMarketStatus('global')}
          </button>
          <button
            onClick={() => setActiveTab('india')}
            className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center ${activeTab === 'india' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'}`}
          >
            India Investment
            {getMarketStatus('india')}
          </button>
          <button
            onClick={() => setActiveTab('australia')}
            className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center ${activeTab === 'australia' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'}`}
          >
            Australia Investment
            {getMarketStatus('australia')}
          </button>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between border-t border-zinc-100">
          <div className="flex items-center gap-4">
            {saveMessage && (
              <span className={cn(
                "text-sm font-medium",
                saveMessage.type === 'success' ? "text-emerald-600" : "text-rose-600"
              )}>
                {saveMessage.text}
              </span>
            )}
            <button
              onClick={() => promptAnalysisStrategy()}
              disabled={isAnalyzing || holdings.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Analyze
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || holdings.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-900 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title="Refresh market data"
            >
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <div className="flex bg-zinc-100 p-1 rounded-lg">
              <button
                onClick={handleDownload}
                className="p-2 text-zinc-600 hover:text-zinc-900 hover:bg-white hover:shadow-sm rounded-md transition-all"
                title="Download Portfolio JSON"
              >
                <Download className="w-4 h-4" />
              </button>
              <label className="p-2 text-zinc-600 hover:text-zinc-900 hover:bg-white hover:shadow-sm rounded-md transition-all cursor-pointer" title="Import Portfolio JSON">
                <Upload className="w-4 h-4" />
                <input type="file" accept=".json" className="hidden" onChange={handleImport} />
              </label>

              <div className="w-[1px] bg-zinc-200 mx-1 my-1" />

              <button
                onClick={handleDownloadTransactions}
                className="p-2 text-zinc-600 hover:text-zinc-900 hover:bg-white hover:shadow-sm rounded-md transition-all"
                title="Download Transactions History"
              >
                <History className="w-4 h-4 text-emerald-600" />
              </button>
              <label className="p-2 text-zinc-600 hover:text-zinc-900 hover:bg-white hover:shadow-sm rounded-md transition-all cursor-pointer" title="Import Transactions History (JSON/CSV)">
                <FileText className="w-4 h-4 text-emerald-600" />
                <input type="file" accept=".json,.csv" className="hidden" onChange={handleImportTransactions} />
              </label>

              <div className="w-[1px] bg-zinc-200 mx-1 my-1" />

              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting || holdings.length === 0}
                className="p-2 text-zinc-600 hover:text-rose-600 hover:bg-white hover:shadow-sm rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Reset Portfolio"
              >
                {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
              {hasBackup && (
                <button
                  onClick={() => setShowRestoreConfirm(true)}
                  disabled={isRestoring}
                  className="p-2 text-zinc-600 hover:text-emerald-600 hover:bg-white hover:shadow-sm rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Restore Last Reset"
                >
                  {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                </button>
              )}
            </div>
            <div className="relative" ref={addWidgetRef}>
              <button
                onClick={() => setShowAddWidget(!showAddWidget)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-900 rounded-lg font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Widget
              </button>
              {showAddWidget && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-zinc-200 py-2 z-50">
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

                if (widgetId === 'allocation' && (chartData.length > 0 || sectorData.length > 0)) {
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
                      <div className="h-96 w-full relative col-span-1 lg:col-span-2">
                        <h3 className="text-center text-sm font-semibold text-zinc-700 mb-2">Market Value vs Investment Cost</h3>
                        <div className="flex justify-center gap-6 mb-4 text-[10px] uppercase tracking-widest font-bold text-zinc-400">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-indigo-500" />
                            <span>Correlation</span>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                            <XAxis type="number" dataKey="cost" name="Investment Cost" tickFormatter={(value) => `${getCurrencySymbol(activeCurrency)}${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`} tick={{ fontSize: 12, fill: '#71717a' }} axisLine={false} tickLine={false} />
                            <YAxis type="number" dataKey="value" name="Market Value" tickFormatter={(value) => `${getCurrencySymbol(activeCurrency)}${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`} tick={{ fontSize: 12, fill: '#71717a' }} axisLine={false} tickLine={false} />
                            <ZAxis type="number" dataKey="value" range={[60, 400]} name="Size" />
                            <RechartsTooltip 
                              cursor={{ strokeDasharray: '3 3' }} 
                              content={<CustomTooltip activeCurrency={activeCurrency} />} 
                            />
                            <Scatter 
                              name="Assets" 
                              data={chartView === 'asset' ? chartData : sectorData} 
                              fill="#8b5cf6" 
                              animationDuration={1000} 
                              animationEasing="ease-out"
                              onClick={(data) => {
                                if (data && (data as any).name) {
                                  const name = String((data as any).name);
                                  setFilterGroup(prev => prev === name ? null : name);
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              {(chartView === 'asset' ? chartData : sectorData).map((entry, index) => (
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
                              content={<CustomTooltip activeCurrency={activeCurrency} />}
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
                              content={<CustomTooltip activeCurrency={activeCurrency} />}
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
                    </SortableWidget>
                  );
                }

                if (widgetId === 'calendar') {
                  return (
                    <SortableWidget key="calendar" id="calendar" className={getWidgetClass('calendar')} onDoubleClick={() => toggleWidgetSize('calendar')}>
                      <FinancialCalendar 
                        earningsEvents={earningsEvents} 
                        economicEvents={economicEvents}
                        metadata={metadata} 
                        onResize={() => toggleWidgetSize('calendar')}
                        onRemove={() => removeWidget('calendar')}
                        size={widgetSizes.calendar}
                        activeCurrency={activeCurrency}
                        onEarningsClick={promptEarningsAnalysisStrategy}
                      />
                    </SortableWidget>
                  );
                }

                if (widgetId === 'holdings') {
                  return (
                    <SortableWidget key="holdings" id="holdings" className={cn("overflow-hidden", getWidgetClass('holdings'))} onDoubleClick={() => toggleWidgetSize('holdings')}>
                      <div className="px-6 py-5 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50">
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
                          <button onClick={() => toggleWidgetSize('holdings')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Resize Widget">
                            {widgetSizes.holdings === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                          </button>
                          <button onClick={() => removeWidget('holdings')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Remove Widget">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                <StockSearch onSelect={(ticker) => setSelectedChartTicker(ticker)} />
                <span className="text-sm text-zinc-500 font-medium">{holdings.length} Positions</span>
              </div>
              
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
                    onDragEnd={handleDragEndColumns}
                  >
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-200 text-xs uppercase tracking-wider text-zinc-500 bg-zinc-50/50">
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
                        {sortedHoldings.map((holding) => (
                          <tr 
                            key={holding.id} 
                            className={cn(
                              "hover:bg-zinc-100/50 hover:shadow-sm transition-all duration-200 group/row",
                              editingId === holding.id ? "cursor-default" : "cursor-pointer"
                            )}
                            onClick={() => {
                              if (editingId !== holding.id) {
                                setSelectedChartTicker(holding.ticker);
                              }
                            }}
                          >
                            {columnOrder.map((colId) => renderCell(colId, holding))}
                            <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                              {editingId === holding.id ? (
                                <div className="flex items-center justify-center gap-1">
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
                                <div className="flex items-center justify-center gap-1">
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
                        ))}
                      </tbody>
                    </table>
                  </DndContext>
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
                    onClick={() => setTransactionType('buy')}
                    className={cn(
                      "flex-1 py-1.5 text-sm font-medium rounded-md transition-all",
                      transactionType === 'buy' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransactionType('sell')}
                    className={cn(
                      "flex-1 py-1.5 text-sm font-medium rounded-md transition-all",
                      transactionType === 'sell' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    Sell
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="ticker" className="block text-sm font-medium text-zinc-700 mb-1">Ticker Symbol</label>
                    <div className="relative">
                      <input
                        id="ticker"
                        type="text"
                        required
                        placeholder="e.g. AAPL or CASH"
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent uppercase placeholder:normal-case"
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value)}
                      />
                      {ticker.toUpperCase() === 'CASH' && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded uppercase">Cash Mode</span>
                        </div>
                      )}
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
                    <label htmlFor="shares" className="block text-sm font-medium text-zinc-700 mb-1">{ticker.toUpperCase() === 'CASH' ? 'Amount' : 'Shares'}</label>
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
                      {ticker.toUpperCase() === 'CASH' ? 'Currency' : (transactionType === 'buy' ? 'Avg Cost' : 'Sell Price')}
                    </label>
                    <div className="flex">
                      <select
                        className={cn(
                          "px-2 py-2 border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent bg-zinc-50 text-zinc-700",
                          ticker.toUpperCase() === 'CASH' ? "w-full rounded-lg" : "rounded-l-lg border-r-0"
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
                      {ticker.toUpperCase() !== 'CASH' && (
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
                  {isSubmitting ? (transactionType === 'buy' ? 'Adding...' : 'Selling...') : (transactionType === 'buy' ? 'Add Position' : 'Sell Position')}
                </button>
              </form>
                    </SortableWidget>
                  );
                }

                if (widgetId === 'upload') {
                  return (
                    <SortableWidget key="upload" id="upload" className={cn("p-6", getWidgetClass('upload'))} onDoubleClick={() => toggleWidgetSize('upload')}>
                      <div className="flex items-center justify-between mb-4 relative z-20">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                          <UploadCloud className="w-5 h-5 text-zinc-400" />
                          Import Portfolio
                        </h2>
                        <button onClick={() => toggleWidgetSize('upload')} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Resize Widget">
                          {widgetSizes.upload === 3 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <button onClick={() => removeWidget('upload')} className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all relative z-20" title="Remove Widget">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
              <p className="text-sm text-zinc-500 mb-4">
                Upload a brokerage statement (PDF) or Interactive Brokers Flex Query / ICICI Direct / CommSec (CSV) to automatically extract your holdings.
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
                    importMode === 'merge' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
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
                    </SortableWidget>
                  );
                }
                return null;
              })}
            </div>
          </SortableContext>
        </DndContext>
      </main>

      {/* TradingView Chart Modal */}
      {selectedChartTicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <LineChart className="w-5 h-5 text-indigo-600" />
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
                ['CASH', 'USD', 'EUR', 'GBP'].includes(selectedChartTicker.toUpperCase()) ? (
                  <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                    <LineChart className="w-12 h-12 mb-4 text-zinc-300" />
                    <p>Chart data is not available for cash positions.</p>
                  </div>
                ) : (
                  <>
                    <AdvancedRealTimeChart 
                      key={selectedChartTicker}
                      symbol={selectedChartTicker.includes('-') ? `CRYPTO:${selectedChartTicker.replace('-', '')}` : selectedChartTicker}
                      theme="light"
                      autosize
                      hide_side_toolbar={false}
                      studies={TRADINGVIEW_STUDIES}
                    />
                    {/^[A-Z]{4}X$/.test(selectedChartTicker) && (
                      <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-sm p-3 rounded-lg border border-amber-200 shadow-sm text-sm text-amber-800 flex items-start gap-2 z-10">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                        <p><strong>Note:</strong> Mutual funds ({selectedChartTicker}) may not have intraday chart data available on TradingView. Try changing the timeframe to Daily (D) or Weekly (W) if the chart doesn't load.</p>
                      </div>
                    )}
                  </>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                {historyHolding.ticker} Transaction History
              </h3>
              <button
                onClick={() => setHistoryHolding(null)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-zinc-50">
              {undoError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-lg flex items-center gap-2 text-rose-700 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {undoError}
                  <button onClick={() => setUndoError(null)} className="ml-auto text-rose-400 hover:text-rose-600">
                    <X className="w-4 h-4" />
                  </button>
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
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {historyTransactions.map((tx, index) => (
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
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-zinc-900">
                            {tx.shares.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-zinc-900">
                            {formatCurrency(tx.price, activeCurrency)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono font-medium text-zinc-900">
                            {formatCurrency(tx.shares * tx.price, activeCurrency)}
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
                              <button
                                onClick={() => setConfirmUndoId(tx.id)}
                                className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                title="Undo Transaction"
                              >
                                <Undo2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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
                Are you sure you want to completely reset the <strong>{activeTab === 'global' ? 'Global Portfolio' : activeTab === 'india' ? 'India Investment' : 'Australia Investment'}</strong>?
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-lg",
                  analysisTicker && analysisSentiment === 'bullish' ? "bg-emerald-100 text-emerald-600" :
                  analysisTicker && analysisSentiment === 'bearish' ? "bg-rose-100 text-rose-600" :
                  analysisTicker && analysisSentiment === 'neutral' ? "bg-amber-100 text-amber-600" :
                  "bg-indigo-100 text-indigo-600"
                )}>
                  <Zap className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900">
                    {analysisTicker ? `AI Analysis: ${analysisTicker}` : 'AI Portfolio Analysis'}
                  </h3>
                  {analysisTicker && !isAnalyzing && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                        analysisSentiment === 'bullish' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                        analysisSentiment === 'bearish' ? "bg-rose-50 text-rose-700 border border-rose-200" :
                        "bg-zinc-100 text-zinc-700 border border-zinc-200"
                      )}>
                        {analysisSentiment} Sentiment
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowAnalysisModal(false)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-zinc-50">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center h-64">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
                    <Zap className={cn(
                      "w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse",
                      analysisTicker ? "text-amber-500" : "text-indigo-500"
                    )} />
                  </div>
                  <p className="text-zinc-500 mt-4 font-medium animate-pulse">
                    {analysisTicker ? `Analyzing ${analysisTicker}...` : 'Gemini is analyzing your portfolio strategy...'}
                  </p>
                  {analysisTicker && (
                    <p className="text-xs text-zinc-400 mt-1 italic">Scanning news, earnings, and market sentiment</p>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
                    <div className="prose prose-indigo prose-sm max-w-none">
                      <Markdown>{analysisResult}</Markdown>
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
                            className="flex items-center justify-between p-3 bg-white border border-zinc-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
                          >
                            <span className="text-sm text-zinc-700 font-medium truncate pr-4 group-hover:text-indigo-700">
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
            <div className="px-6 py-4 border-t border-zinc-200 bg-white flex justify-between items-center">
              <p className="text-[10px] text-zinc-400 italic">
                AI-generated insights. Verify with official sources.
              </p>
              <div className="flex items-center gap-2">
                {!isAnalyzing && analysisResult && !analysisSaved && (
                  <button
                    onClick={handleSaveAnalysis}
                    disabled={isSavingAnalysis}
                    className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-semibold shadow-sm flex items-center justify-center gap-2"
                  >
                    {isSavingAnalysis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Note
                  </button>
                )}
                {analysisSaved && (
                  <div className="px-4 py-2 text-emerald-600 bg-emerald-50 rounded-lg text-sm font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Saved
                  </div>
                )}
                <button
                  onClick={() => setShowAnalysisModal(false)}
                  className="px-6 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors text-sm font-semibold shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEarningsAnalysisModal && selectedEarningsEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600">
                  <CalendarIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900">
                    Earnings Analysis: {selectedEarningsEvent.symbol}
                  </h3>
                  <div className="text-sm text-zinc-500">
                    {format(parseISO(selectedEarningsEvent.date), 'MMMM d, yyyy')}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowEarningsAnalysisModal(false)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-zinc-50">
              {isAnalyzingEarnings ? (
                <div className="flex flex-col items-center justify-center h-64">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
                    <Zap className="w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-500 animate-pulse" />
                  </div>
                  <p className="text-zinc-500 mt-4 font-medium animate-pulse">
                    Analyzing earnings for {selectedEarningsEvent.symbol}...
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 italic">Scanning earnings data, analyst expectations, and recent news</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
                    <div className="prose prose-indigo prose-sm max-w-none">
                      <Markdown>{earningsAnalysisResult}</Markdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 bg-white flex justify-between items-center">
              <p className="text-[10px] text-zinc-400 italic">
                AI-generated insights. Verify with official sources.
              </p>
              <div className="flex items-center gap-2">
                {!isAnalyzingEarnings && earningsAnalysisResult && !earningsAnalysisSaved && (
                  <button
                    onClick={handleSaveEarningsAnalysis}
                    disabled={isSavingEarningsAnalysis}
                    className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-semibold shadow-sm flex items-center justify-center gap-2"
                  >
                    {isSavingEarningsAnalysis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Note
                  </button>
                )}
                {earningsAnalysisSaved && (
                  <div className="px-4 py-2 text-emerald-600 bg-emerald-50 rounded-lg text-sm font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Saved
                  </div>
                )}
                <button
                  onClick={() => setShowEarningsAnalysisModal(false)}
                  className="px-6 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors text-sm font-semibold shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAnalysisStrategyModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden p-6 text-center border border-zinc-100">
            <div className="mx-auto w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">AI Insights</h3>
            <p className="text-sm text-zinc-500 mb-6 font-medium">How would you like to proceed with the analysis for {strategyTicker || 'your portfolio'}?</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowAnalysisStrategyModal(false);
                  handleAnalyze(strategyTicker || undefined);
                }}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
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
                className="w-full py-3 bg-white text-zinc-700 border border-zinc-200 rounded-xl font-semibold hover:bg-zinc-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <FileText className="w-5 h-5" />
                View Saved Notes
              </button>
            </div>
            <button
              onClick={() => setShowAnalysisStrategyModal(false)}
              className="mt-6 text-sm font-semibold text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showEarningsAnalysisStrategyModal && strategyEarningsEvent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden p-6 text-center border border-zinc-100">
            <div className="mx-auto w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center mb-4">
              <CalendarIcon className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Earnings Insights</h3>
            <p className="text-sm text-zinc-500 mb-6 font-medium">How would you like to proceed with the analysis for {strategyEarningsEvent.symbol}?</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowEarningsAnalysisStrategyModal(false);
                  handleAnalyzeEarnings(strategyEarningsEvent);
                }}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
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
                className="w-full py-3 bg-white text-zinc-700 border border-zinc-200 rounded-xl font-semibold hover:bg-zinc-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <FileText className="w-5 h-5" />
                View Saved Notes
              </button>
            </div>
            <button
              onClick={() => setShowEarningsAnalysisStrategyModal(false)}
              className="mt-6 text-sm font-semibold text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showSavedAnalysesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
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
            <div className="flex-1 overflow-auto p-6 bg-zinc-50 relative">
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
                      <div className="prose prose-indigo prose-sm max-w-none">
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

    </div>
  );
}
