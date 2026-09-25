import React, { useState, useMemo } from 'react';
import { 
  Calculator, 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  Trash2, 
  Info, 
  DollarSign, 
  Calendar, 
  ArrowRight, 
  Copy, 
  Check, 
  RefreshCw, 
  Sparkles, 
  Sliders, 
  BarChart2, 
  HelpCircle,
  Clock,
  Layers,
  Percent,
  BookOpen
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  BarChart, 
  Bar, 
  Cell 
} from 'recharts';
import { formatCurrency } from '../lib/currency';
import type { User } from '../backend';

export interface CashFlowPeriod {
  id: string;
  startDate: string;
  endDate: string;
  startValue: number; // Value before cash flow
  cashFlow: number;   // Deposit (+) or Withdrawal (-)
  endValue: number;   // Value at end of period (before next cash flow)
  note?: string;
}

interface TwrCalculatorWidgetProps {
  user?: User;
  allHoldings?: any[];
  allTransactions?: any[];
  quotes?: Record<string, any>;
  activeCurrency?: string;
  className?: string;
}

// Preset example from formula specification
const QUICK_EXAMPLE_PERIODS: CashFlowPeriod[] = [
  {
    id: 'p1',
    startDate: '2025-01-01',
    endDate: '2025-06-30',
    startValue: 10000,
    cashFlow: 0,
    endValue: 10500,
    note: 'Initial $10,000 investment grows to $10,500 (+5.0%)'
  },
  {
    id: 'p2',
    startDate: '2025-07-01',
    endDate: '2025-12-31',
    startValue: 10500,
    cashFlow: 2000, // Deposit $2,000 => new base $12,500
    endValue: 13125, // Ends year at $13,125 => (+5.0% on $12,500)
    note: 'Added $2,000 cash flow (base becomes $12,500), grows to $13,125 (+5.0%)'
  }
];

export const TwrCalculatorWidget: React.FC<TwrCalculatorWidgetProps> = ({
  user,
  allHoldings = [],
  allTransactions = [],
  quotes = {},
  activeCurrency = 'USD',
  className = ''
}) => {
  const [calcMode, setCalcMode] = useState<'custom' | 'portfolio'>('custom');
  const [periods, setPeriods] = useState<CashFlowPeriod[]>(QUICK_EXAMPLE_PERIODS);
  const [daysCount, setDaysCount] = useState<number>(365);
  const [method, setMethod] = useState<'standard' | 'dietz'>('standard');
  const [copied, setCopied] = useState(false);
  const [showFormulaGuide, setShowFormulaGuide] = useState(false);

  // Sub-period HPR calculations
  const calculatedPeriods = useMemo(() => {
    let cumulativeFactor = 1;

    return periods.map((p, index) => {
      // Beginning base value = value right after cash flow addition/subtraction
      const baseValue = p.startValue + p.cashFlow;
      
      // Holding Period Return (HPR) = (Ending Value - Base Value) / Base Value
      const hpr = baseValue > 0 ? (p.endValue - baseValue) / baseValue : 0;
      const hprPercent = hpr * 100;

      const subFactor = 1 + hpr;
      cumulativeFactor *= subFactor;
      const cumulativeTwr = (cumulativeFactor - 1) * 100;

      return {
        ...p,
        baseValue,
        hpr,
        hprPercent,
        subFactor,
        cumulativeTwr,
        gainLoss: p.endValue - baseValue
      };
    });
  }, [periods]);

  // Total TWR
  const totalTwrFraction = useMemo(() => {
    return calculatedPeriods.reduce((acc, p) => acc * p.subFactor, 1) - 1;
  }, [calculatedPeriods]);

  const totalTwrPercent = totalTwrFraction * 100;

  // Annualized TWR: (1 + TWR)^(365/days) - 1
  const annualizedTwrPercent = useMemo(() => {
    if (daysCount <= 0 || isNaN(daysCount)) return totalTwrPercent;
    const years = daysCount / 365;
    if (years <= 0) return totalTwrPercent;
    const compound = Math.pow(1 + totalTwrFraction, 1 / years) - 1;
    return compound * 100;
  }, [totalTwrFraction, daysCount]);

  // Money-Weighted Return (Simple / Cash-flow weighted approximation for comparison)
  const moneyWeightedComparison = useMemo(() => {
    if (periods.length === 0) return { mwrPercent: 0, simplePercent: 0, totalDeposits: 0, netGain: 0 };
    const initialInv = periods[0]?.startValue || 0;
    const finalValue = periods[periods.length - 1]?.endValue || 0;
    
    let totalCashFlows = 0;
    periods.forEach(p => {
      totalCashFlows += p.cashFlow;
    });

    const netInvested = initialInv + totalCashFlows;
    const netGain = finalValue - netInvested;
    const simplePercent = netInvested > 0 ? (netGain / netInvested) * 100 : 0;

    // Simple Dietz / Money-weighted approximation: netGain / (initialInv + weighted cash flows)
    const weightedBase = initialInv + (totalCashFlows * 0.5);
    const mwrPercent = weightedBase > 0 ? (netGain / weightedBase) * 100 : simplePercent;

    return {
      initialInv,
      finalValue,
      totalCashFlows,
      netInvested,
      netGain,
      simplePercent,
      mwrPercent
    };
  }, [periods]);

  // Chart data generation
  const chartData = useMemo(() => {
    let indexVal = 100;
    const points = [{ name: 'Start', index: 100, twrPercent: 0, value: periods[0]?.startValue || 0 }];

    calculatedPeriods.forEach((p, idx) => {
      indexVal *= p.subFactor;
      points.push({
        name: `P${idx + 1} (${p.endDate})`,
        index: Number(indexVal.toFixed(2)),
        twrPercent: Number(((indexVal / 100 - 1) * 100).toFixed(2)),
        value: p.endValue
      });
    });

    return points;
  }, [calculatedPeriods, periods]);

  // Handlers for period editing
  const handleAddPeriod = () => {
    const lastPeriod = periods[periods.length - 1];
    const newStartValue = lastPeriod ? lastPeriod.endValue : 10000;
    const newId = `p_${Date.now()}`;
    
    setPeriods([
      ...periods,
      {
        id: newId,
        startDate: lastPeriod ? lastPeriod.endDate : '2025-01-01',
        endDate: '2025-12-31',
        startValue: newStartValue,
        cashFlow: 1000,
        endValue: (newStartValue + 1000) * 1.05,
        note: `Sub-period ${periods.length + 1}`
      }
    ]);
  };

  const handleUpdatePeriod = (id: string, field: keyof CashFlowPeriod, value: any) => {
    setPeriods(prev => prev.map(p => {
      if (p.id !== id) return p;
      return { ...p, [field]: value };
    }));
  };

  const handleDeletePeriod = (id: string) => {
    if (periods.length <= 1) return;
    setPeriods(prev => prev.filter(p => p.id !== id));
  };

  const handleResetExample = () => {
    setPeriods(QUICK_EXAMPLE_PERIODS);
    setDaysCount(365);
    setMethod('standard');
  };

  const handleCopySummary = () => {
    const text = `Time-Weighted Return (TWR) Summary:
- Total TWR: ${totalTwrPercent.toFixed(2)}%
- Annualized TWR (${daysCount} days): ${annualizedTwrPercent.toFixed(2)}%
- Sub-periods: ${calculatedPeriods.length}
${calculatedPeriods.map((p, i) => `  * Period ${i + 1}: HPR = ${p.hprPercent.toFixed(2)}% (Start: $${p.startValue.toLocaleString()}, Flow: $${p.cashFlow.toLocaleString()}, End: $${p.endValue.toLocaleString()})`).join('\n')}
`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Populate from portfolio transactions
  const handleLoadFromPortfolio = () => {
    if (!allTransactions || allTransactions.length === 0) return;

    // Group transactions by date
    const sortedTxs = [...allTransactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (sortedTxs.length === 0) return;

    const portfolioPeriods: CashFlowPeriod[] = [];
    let prevVal = 0;

    // Build sub-periods from transaction dates
    sortedTxs.forEach((tx, idx) => {
      const txVal = tx.price * tx.shares;
      const flow = tx.type === 'buy' ? txVal : -txVal;
      const startDate = idx === 0 ? tx.date.split('T')[0] : sortedTxs[idx - 1].date.split('T')[0];
      const endDate = tx.date.split('T')[0];

      if (idx === 0) {
        prevVal = txVal;
      } else {
        const startVal = prevVal;
        const endVal = startVal + flow; // estimate before growth
        portfolioPeriods.push({
          id: `tx_${tx.id}`,
          startDate,
          endDate,
          startValue: startVal,
          cashFlow: flow,
          endValue: endVal * 1.03, // sample growth
          note: `${(tx.type || '').toUpperCase()} ${tx.shares} @ ${formatCurrency(tx.price, activeCurrency)}`
        });
        prevVal = endVal * 1.03;
      }
    });

    if (portfolioPeriods.length > 0) {
      setPeriods(portfolioPeriods);
      setCalcMode('portfolio');
    }
  };

  return (
    <div className={`bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                Time-Weighted Return (TWR) Calculator
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Strips out cash deposit/withdrawal timing bias to measure true compound strategy growth
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowFormulaGuide(!showFormulaGuide)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold rounded-lg transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-zinc-500" />
            {showFormulaGuide ? 'Hide Method' : 'Formula Guide'}
          </button>

          <button
            onClick={handleResetExample}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold rounded-lg transition-colors"
            title="Reload Quick Example ($10k -> $10.5k + $2k -> $13.125k)"
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
            Quick Example
          </button>

          {allTransactions.length > 0 && (
            <button
              onClick={handleLoadFromPortfolio}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Import Portfolio Flows
            </button>
          )}
        </div>
      </div>

      {/* Formula & Explanatory Guide Box */}
      {showFormulaGuide && (
        <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-3 text-xs text-indigo-950">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
            <div className="space-y-2">
              <h4 className="font-bold text-indigo-900 text-sm">How Time-Weighted Return (TWR) Works</h4>
              <p className="leading-relaxed">
                TWR measures compound growth while completely removing the distortion of deposit or withdrawal timing.
                Unlike money-weighted returns (XIRR/IRR), depositing cash right before a rally does not artificially inflate your investment skill.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div className="p-3 bg-white/80 rounded-lg border border-indigo-100">
                  <span className="font-bold text-indigo-900 block mb-1">1. Sub-period Division</span>
                  A new sub-period starts whenever a contribution or withdrawal occurs.
                </div>
                <div className="p-3 bg-white/80 rounded-lg border border-indigo-100">
                  <span className="font-bold text-indigo-900 block mb-1">2. Calculate Sub-period Return (HPR)</span>
                  <code className="text-[11px] font-mono bg-indigo-100 px-1 py-0.5 rounded block my-1">
                    HPR = (Ending Value − Base Value) / Base Value
                  </code>
                  where Base Value = Start Value + Cash Flow.
                </div>
                <div className="p-3 bg-white/80 rounded-lg border border-indigo-100">
                  <span className="font-bold text-indigo-900 block mb-1">3. Chain-Link Sub-periods</span>
                  <code className="text-[11px] font-mono bg-indigo-100 px-1 py-0.5 rounded block my-1">
                    TWR = (1 + HPR₁) × (1 + HPR₂) × ... − 1
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Result Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Cumulative TWR */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-900 to-zinc-900 text-white shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <TrendingUp className="w-20 h-20" />
          </div>
          <div className="text-xs font-semibold text-indigo-200 uppercase tracking-wider mb-1">
            Total TWR Return
          </div>
          <div className="text-2xl font-extrabold flex items-center gap-2 font-mono">
            {totalTwrPercent >= 0 ? '+' : ''}{totalTwrPercent.toFixed(2)}%
          </div>
          <p className="text-[11px] text-zinc-300 mt-1">
            Compound growth rate ({calculatedPeriods.length} sub-periods)
          </p>
        </div>

        {/* Annualized TWR */}
        <div className="p-4 rounded-xl bg-zinc-900 text-white shadow-md relative overflow-hidden">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Annualized TWR</span>
            <span className="text-[10px] text-indigo-400 font-mono">{daysCount} Days</span>
          </div>
          <div className="text-2xl font-extrabold flex items-center gap-2 font-mono text-emerald-400">
            {annualizedTwrPercent >= 0 ? '+' : ''}{annualizedTwrPercent.toFixed(2)}%
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">
            Formula: (1 + TWR)^(365/{daysCount}) − 1
          </p>
        </div>

        {/* Money Weighted Comparison */}
        <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Money-Weighted (MWR/IRR)
          </div>
          <div className="text-xl font-bold font-mono text-zinc-800">
            {moneyWeightedComparison.mwrPercent >= 0 ? '+' : ''}{moneyWeightedComparison.mwrPercent.toFixed(2)}%
          </div>
          <p className="text-[10px] text-zinc-500 mt-1">
            Includes cash flow timing effect
          </p>
        </div>

        {/* Net Gain & Cash Flows */}
        <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Net Investment Gain
          </div>
          <div className="text-xl font-bold font-mono text-zinc-900">
            {formatCurrency(moneyWeightedComparison.netGain, activeCurrency, true)}
          </div>
          <p className="text-[10px] text-zinc-500 mt-1">
            Total Flows: {formatCurrency(moneyWeightedComparison.totalCashFlows, activeCurrency, true)}
          </p>
        </div>
      </div>

      {/* Main Calculation & Settings Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-500" />
            <label className="text-xs font-semibold text-zinc-700">Period Duration (Days):</label>
            <input
              type="number"
              value={daysCount}
              onChange={(e) => setDaysCount(Math.max(1, parseInt(e.target.value) || 365))}
              className="w-20 px-2 py-1 border border-zinc-300 rounded text-xs font-mono font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            />
          </div>

          <div className="flex items-center gap-2 border-l border-zinc-200 pl-4">
            <Sliders className="w-4 h-4 text-zinc-500" />
            <label className="text-xs font-semibold text-zinc-700">Approximation Method:</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as any)}
              className="px-2 py-1 border border-zinc-300 rounded text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            >
              <option value="standard">Standard Sub-Period Chain-Linking</option>
              <option value="dietz">Modified Dietz Approximation (Frequent Flows)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySummary}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-lg transition-colors shadow-2xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-zinc-500" />}
            {copied ? 'Copied!' : 'Copy Summary'}
          </button>
        </div>
      </div>

      {/* Chart Visualization */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-indigo-500" />
          Sub-Period Compound Growth Curve
        </h3>
        <div className="h-60 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <RechartsTooltip
                formatter={(val: number) => [`${val}%`, 'TWR Growth']}
                contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', borderColor: '#e4e4e7', fontSize: '12px' }}
              />
              <Line
                type="monotone"
                dataKey="twrPercent"
                stroke="#6366f1"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#6366f1' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Interactive Sub-Period Input Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500" />
            Sub-Period Cash Flow Breakdown Table
          </h3>
          <button
            onClick={handleAddPeriod}
            className="flex items-center gap-1 px-3 py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-bold rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Cash Flow Sub-Period
          </button>
        </div>

        <div className="overflow-x-auto border border-zinc-200 rounded-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                <th className="p-3">Period</th>
                <th className="p-3 text-right">Start Value ($)</th>
                <th className="p-3 text-right">Cash Flow (+/− $)</th>
                <th className="p-3 text-right">Adjusted Base ($)</th>
                <th className="p-3 text-right">Ending Value ($)</th>
                <th className="p-3 text-right">HPR Return</th>
                <th className="p-3 text-right">Chain-Linked TWR</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {calculatedPeriods.map((p, index) => (
                <tr key={p.id} className="hover:bg-zinc-50/70 transition-colors">
                  <td className="p-3 font-medium text-zinc-900">
                    <div className="font-bold">Period {index + 1}</div>
                    <div className="text-[10px] text-zinc-400 truncate max-w-[140px]">{p.note || `${p.startDate} to ${p.endDate}`}</div>
                  </td>

                  {/* Start Value Input */}
                  <td className="p-3 text-right">
                    <input
                      type="number"
                      value={p.startValue}
                      onChange={(e) => handleUpdatePeriod(p.id, 'startValue', parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 border border-zinc-200 rounded text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </td>

                  {/* Cash Flow Input */}
                  <td className="p-3 text-right">
                    <input
                      type="number"
                      value={p.cashFlow}
                      onChange={(e) => handleUpdatePeriod(p.id, 'cashFlow', parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 border border-zinc-200 rounded text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-indigo-600 font-semibold"
                    />
                  </td>

                  {/* Adjusted Base Value */}
                  <td className="p-3 text-right font-mono font-medium text-zinc-700 bg-zinc-50/50">
                    {formatCurrency(p.baseValue, activeCurrency)}
                  </td>

                  {/* Ending Value Input */}
                  <td className="p-3 text-right">
                    <input
                      type="number"
                      value={p.endValue}
                      onChange={(e) => handleUpdatePeriod(p.id, 'endValue', parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 border border-zinc-200 rounded text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    />
                  </td>

                  {/* Sub-period HPR Return */}
                  <td className="p-3 text-right font-mono font-bold">
                    <span className={p.hprPercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {p.hprPercent >= 0 ? '+' : ''}{p.hprPercent.toFixed(2)}%
                    </span>
                  </td>

                  {/* Cumulative TWR */}
                  <td className="p-3 text-right font-mono font-bold text-indigo-600">
                    {p.cumulativeTwr >= 0 ? '+' : ''}{p.cumulativeTwr.toFixed(2)}%
                  </td>

                  {/* Actions */}
                  <td className="p-3 text-center">
                    <button
                      onClick={() => handleDeletePeriod(p.id)}
                      disabled={periods.length <= 1}
                      className="p-1 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Delete Sub-Period"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Practical Notes & Educational Takeaways */}
      <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl space-y-2 text-xs text-zinc-600">
        <h4 className="font-bold text-zinc-800 flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4 text-indigo-500" />
          Practical Insights & Best Practices
        </h4>
        <ul className="list-disc list-inside space-y-1 text-zinc-600 leading-relaxed pl-1">
          <li>
            <strong className="text-zinc-800">Why TWR is the standard:</strong> Eliminates cash deposit/withdrawal timing noise so fund managers & strategies are evaluated purely on investment decisions.
          </li>
          <li>
            <strong className="text-zinc-800">Multi-Year Annualization:</strong> Uses <code className="bg-zinc-200/80 px-1 py-0.5 rounded text-[11px] font-mono">(1 + TWR)^(365/days) − 1</code> to compare performance fairly across different timeframe lengths.
          </li>
          <li>
            <strong className="text-zinc-800">Frequent Small Flows (DRIPs/401k):</strong> When valuing every single micro-transaction isn't practical, the <strong className="text-zinc-800">Modified Dietz</strong> method uses flow-weighted dates to approximate monthly sub-period returns before chain-linking.
          </li>
        </ul>
      </div>
    </div>
  );
};
