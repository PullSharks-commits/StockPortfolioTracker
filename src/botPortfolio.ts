// Feeds the "Trading Bot" portfolio tab from the TradingBot's dashboard (proxied by
// server-bot.ts). The bot's open positions, cash and closed trades are exposed to
// the rest of the app as read-only holdings/transactions (see setVirtualDocs), so
// the tab works like Global/Australia - totals, allocation, charts, realized P&L -
// without anything being stored in the database.

import { authedFetch, setVirtualDocs, VIRTUAL_ID_PREFIX } from './backend';

export const BOT_TAB = 'bot' as const;

export interface BotStatus {
  loaded: boolean;
  updatedAt: string | null;
  marketOpen: boolean | null;
  regime: { ok: boolean; detail: string } | null;
  jobs: { name: string; last_run_at: string | null; last_exit_code: number | null }[];
  errors: string[];
  error: string | null; // the bot dashboard itself could not be reached
  snapshot: any | null; // the bot's /api/positions response, for the Trading Bot tab
}

let status: BotStatus = { loaded: false, updatedAt: null, marketOpen: null, regime: null, jobs: [], errors: [], error: null, snapshot: null };
const statusListeners = new Set<(s: BotStatus) => void>();

export function onBotStatus(listener: (s: BotStatus) => void) {
  statusListeners.add(listener);
  listener(status);
  return () => { statusListeners.delete(listener); };
}

function setStatus(next: Partial<BotStatus>) {
  status = { ...status, ...next };
  statusListeners.forEach((l) => l(status));
}

const holdingId = (symbol: string) => `${VIRTUAL_ID_PREFIX}${symbol}`;

// Trades carry dates only. Give them times so that on a day with both an exit and a
// new entry for the same symbol, the exit sorts first: closed-trade buys at the open,
// sells before the close, open-position buys after them.
const at = (date: string, time: string) => `${String(date).slice(0, 10)}T${time}.000Z`;

let inFlight: Promise<void> | null = null;

export function refreshBotPortfolio(userId: string): Promise<void> {
  if (!inFlight) {
    inFlight = load(userId).finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function load(userId: string) {
  try {
    const [snap, history] = await Promise.all([
      authedFetch('GET', '/api/bot/positions'),
      authedFetch('GET', '/api/bot/trade-history').catch(() => ({ ok: false, trade_history: [] })),
    ]);
    const updatedAt = snap.updated_at || new Date().toISOString();
    const positions: any[] = snap.positions || [];
    const closed: any[] = history?.ok ? history.trade_history || [] : [];

    const holdings = new Map<string, { id: string; data: any }>();
    const transactions: { id: string; data: any }[] = [];
    const base = (symbol: string, order: number) => ({
      ticker: symbol,
      avgPriceCurrency: 'USD',
      portfolioType: BOT_TAB,
      userId,
      order,
      updatedAt,
    });

    positions.forEach((p, i) => {
      holdings.set(p.symbol, {
        id: holdingId(p.symbol),
        data: {
          ...base(p.symbol, i),
          shares: Number(p.qty) || 0,
          avg_price: Number(p.entry_price) || 0,
          botStop: p.stop ?? null,
          botTarget: p.target ?? null,
          botEntryDate: p.entry_date ?? null,
        },
      });
      transactions.push({
        id: `${VIRTUAL_ID_PREFIX}open:${p.symbol}`,
        data: { holdingId: holdingId(p.symbol), type: 'buy', shares: Number(p.qty) || 0, price: Number(p.entry_price) || 0, date: at(p.entry_date, '20:30:00'), userId },
      });
    });

    // Fully closed symbols stay as 0-share holdings so their realized P&L shows.
    for (const t of closed) {
      if (!holdings.has(t.symbol)) {
        holdings.set(t.symbol, { id: holdingId(t.symbol), data: { ...base(t.symbol, holdings.size), shares: 0, avg_price: Number(t.entry_price) || 0 } });
      }
      transactions.push(
        { id: `${VIRTUAL_ID_PREFIX}trade:${t.id}:buy`, data: { holdingId: holdingId(t.symbol), type: 'buy', shares: Number(t.qty), price: Number(t.entry_price), date: at(t.entry_date, '13:30:00'), userId } },
        { id: `${VIRTUAL_ID_PREFIX}trade:${t.id}:sell`, data: { holdingId: holdingId(t.symbol), type: 'sell', shares: Number(t.qty), price: Number(t.exit_price), date: at(t.exit_date, '19:30:00'), userId } },
      );
    }

    const cash = snap.totals?.remaining_cash;
    if (typeof cash === 'number') {
      holdings.set('CASH', { id: holdingId('CASH'), data: { ...base('CASH', holdings.size), shares: cash, avg_price: 1 } });
    }

    setVirtualDocs('holdings', [...holdings.values()]);
    setVirtualDocs('transactions', transactions);
    setStatus({
      loaded: true,
      updatedAt,
      marketOpen: snap.market_open ?? null,
      regime: snap.regime ?? null,
      jobs: snap.job_status || [],
      errors: [...(snap.errors || []), ...(snap.realized_error ? [snap.realized_error] : [])],
      error: null,
      snapshot: snap,
    });
  } catch (err) {
    setStatus({ loaded: true, error: err instanceof Error ? err.message : String(err) });
  }
}

export function clearBotPortfolio() {
  setVirtualDocs('holdings', []);
  setVirtualDocs('transactions', []);
  setStatus({ loaded: false, updatedAt: null, marketOpen: null, regime: null, jobs: [], errors: [], error: null, snapshot: null });
}

// --- Actions (place real orders) ----------------------------------------------

export async function closeBotPosition(symbol: string): Promise<{ ok: boolean; message: string }> {
  // The bot answers 200 with { ok: false, error } for refusals (not tracked, order failed...).
  const res = await authedFetch('POST', '/api/bot/close-position', { symbol });
  if (!res?.ok) return { ok: false, message: res?.error || `Closing ${symbol} failed` };
  const price = typeof res.exit_price === 'number' ? ` at ~$${res.exit_price.toFixed(2)}` : '';
  return { ok: true, message: `Sold ${res.qty ?? ''} ${symbol}${price} (order ${res.close_order_id ?? 'placed'})`.replace(/\s+/g, ' ') };
}

export async function runBotHousekeeping(onDone: (result: { ok: boolean; message: string }) => void) {
  const start = await authedFetch('POST', '/api/bot/run-housekeeping');
  if (start?.ok === false) {
    onDone({ ok: false, message: start.error || 'Could not start housekeeping' });
    return;
  }
  // The job runs in the background on the bot side; poll until it finishes.
  const poll = async () => {
    try {
      const job = await authedFetch('GET', '/api/bot/housekeeping-status');
      if (job?.status === 'running') {
        setTimeout(poll, 3000);
        return;
      }
      onDone(job?.returncode === 0
        ? { ok: true, message: 'Housekeeping finished' }
        : { ok: false, message: `Housekeeping exited with code ${job?.returncode ?? '?'}${job?.tail ? `: ${String(job.tail).slice(-200)}` : ''}` });
    } catch (err) {
      onDone({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  };
  setTimeout(poll, 3000);
}
