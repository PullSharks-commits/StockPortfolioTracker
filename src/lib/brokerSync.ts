// Compares the Global tab with one broker's real account and works out the changes
// that would make the app match it. Used by server-broker-sync.ts (which applies
// them after the owner approves) and shown by BrokerSyncModal. Pure, no I/O.
//
// What "match" means, per broker B:
// - A holding's `brokers` map says how many of its shares sit at each broker. B's
//   entry is set to what B actually holds; the other brokers' entries are left alone.
// - The holding's `shares` becomes the sum of its broker entries, recorded as a buy
//   or sell transaction for the difference, so the ledger keeps adding up. (Summing
//   the entries rather than adding B's change also repairs stale entries: a holding
//   at 0 shares that still lists 87 at IBKR just has the entry cleared.)
// - CASH works the same way: B's slice of the CASH row is set to B's USD cash, with
//   a buy/sell of cash at $1 for the difference. Stock adjustments deliberately don't
//   move cash: the cash row is synced to the broker's own figure instead, so it ends
//   up right whatever the stock trades cost.

export const SYNC_BROKERS = ['Schwab', 'IBKR', 'Webull'] as const;
export type SyncBroker = (typeof SYNC_BROKERS)[number];

export interface BrokerPosition {
  ticker: string;
  qty: number;
  avgCost: number | null;   // per share
  lastPrice: number | null;
}

export interface BrokerSnapshot {
  broker: SyncBroker;
  asOf: string | null;      // when the broker data is from (Truthifi lags a day or two)
  cashUsd: number | null;   // null = don't sync cash for this broker
  positions: BrokerPosition[];
  notes: string[];          // shown above the diff (excluded bot positions, skipped options...)
}

export interface SyncHolding {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  brokers: Record<string, number> | null;
}

export type ChangeKind = 'new' | 'buy' | 'sell' | 'split-only' | 'cash';

export interface SyncChange {
  key: string;              // stable id within one preview: normalised ticker, or CASH
  ticker: string;
  kind: ChangeKind;
  holdingId: string | null; // null = a new holding will be created
  appLeg: number;           // shares the app has at this broker now
  brokerLeg: number;        // shares the broker reports
  sharesBefore: number;
  sharesAfter: number;
  brokersBefore: Record<string, number> | null;
  brokersAfter: Record<string, number>;
  txType: 'buy' | 'sell' | null;
  txShares: number;         // always >= 0
  txPrice: number | null;   // suggested; the owner can change it before applying
  priceSource: string;
  avgPriceBefore: number;
}

const EPS = 1e-6;
const CASH_EPS = 0.005;

export const normTicker = (t: string) => t.trim().toUpperCase().replace(/[\s./]+/g, '-');
const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

// Same broker map in a canonical form, for comparing before/after.
export function brokersKey(b: Record<string, number> | null | undefined) {
  if (!b) return 'null';
  return JSON.stringify(Object.entries(b).filter(([, n]) => n > EPS).sort(([a], [z]) => a.localeCompare(z)).map(([k, n]) => [k, round(n)]));
}

function suggestBuyPrice(pos: BrokerPosition | undefined, appLeg: number, brokerLeg: number, appAvg: number) {
  const last = pos?.lastPrice ?? null;
  const cost = pos?.avgCost ?? null;
  if (cost != null && cost > 0) {
    if (appLeg <= EPS) return { price: cost, source: 'broker avg cost' };
    // The price that makes this broker's slice cost what the broker says it cost.
    const implied = (brokerLeg * cost - appLeg * appAvg) / (brokerLeg - appLeg);
    const sane = implied > 0 && (last == null || (implied > last * 0.2 && implied < last * 5));
    if (sane) return { price: implied, source: 'implied by broker avg cost' };
  }
  if (last != null && last > 0) return { price: last, source: 'last price' };
  if (cost != null && cost > 0) return { price: cost, source: 'broker avg cost' };
  return { price: null, source: 'unknown: enter a price' };
}

export function computeChanges(holdings: SyncHolding[], snap: BrokerSnapshot): SyncChange[] {
  const B = snap.broker;
  const changes: SyncChange[] = [];

  // Merge duplicate rows (same ticker in two accounts at one broker).
  const brokerPos = new Map<string, BrokerPosition>();
  for (const p of snap.positions) {
    if (!(p.qty > EPS)) continue;
    const k = normTicker(p.ticker);
    const prev = brokerPos.get(k);
    if (!prev) { brokerPos.set(k, { ...p }); continue; }
    const qty = prev.qty + p.qty;
    const cost = prev.avgCost != null && p.avgCost != null ? (prev.avgCost * prev.qty + p.avgCost * p.qty) / qty : prev.avgCost ?? p.avgCost;
    brokerPos.set(k, { ticker: prev.ticker, qty, avgCost: cost, lastPrice: prev.lastPrice ?? p.lastPrice });
  }

  // App holdings by ticker. If a ticker somehow has two rows, prefer the one that
  // already lists this broker, then the one with shares.
  const appByKey = new Map<string, SyncHolding>();
  for (const h of holdings) {
    if (h.ticker === 'CASH') continue;
    const k = normTicker(h.ticker);
    const prev = appByKey.get(k);
    const score = (x: SyncHolding) => ((x.brokers?.[B] ?? 0) > EPS ? 2 : 0) + (x.shares > EPS ? 1 : 0);
    if (!prev || score(h) > score(prev)) appByKey.set(k, h);
  }

  const keys = new Set<string>([...brokerPos.keys()]);
  for (const [k, h] of appByKey) if ((h.brokers?.[B] ?? 0) > EPS) keys.add(k);

  for (const key of [...keys].sort()) {
    const pos = brokerPos.get(key);
    const h = appByKey.get(key);
    const brokerLeg = round(pos?.qty ?? 0);
    const appLeg = round(h?.brokers?.[B] ?? 0);
    if (Math.abs(brokerLeg - appLeg) < EPS) continue;

    const brokersAfter: Record<string, number> = { ...(h?.brokers ?? {}) };
    if (brokerLeg > EPS) brokersAfter[B] = brokerLeg; else delete brokersAfter[B];

    if (!h) {
      const { price, source } = suggestBuyPrice(pos, 0, brokerLeg, 0);
      changes.push({
        key, ticker: pos!.ticker, kind: 'new', holdingId: null, appLeg, brokerLeg,
        sharesBefore: 0, sharesAfter: brokerLeg, brokersBefore: null, brokersAfter,
        txType: 'buy', txShares: brokerLeg, txPrice: price, priceSource: source, avgPriceBefore: 0,
      });
      continue;
    }

    // A holding with no broker map yet: its shares aren't attributed anywhere, so
    // treat them as this broker's (the common case for an old manually-entered row).
    const unattributed = !h.brokers || Object.keys(h.brokers).length === 0;
    const sharesAfter = unattributed
      ? brokerLeg
      : round(Object.values(brokersAfter).reduce((a, n) => a + n, 0));
    const delta = round(sharesAfter - h.shares);
    const base = {
      key, ticker: h.ticker, holdingId: h.id, appLeg, brokerLeg,
      sharesBefore: h.shares, sharesAfter, brokersBefore: h.brokers, brokersAfter, avgPriceBefore: h.avg_price,
    };
    if (Math.abs(delta) < EPS) {
      changes.push({ ...base, kind: 'split-only', txType: null, txShares: 0, txPrice: null, priceSource: '' });
    } else if (delta > 0) {
      const { price, source } = suggestBuyPrice(pos, unattributed ? h.shares : appLeg, brokerLeg, h.avg_price);
      changes.push({ ...base, kind: 'buy', txType: 'buy', txShares: delta, txPrice: price, priceSource: source });
    } else {
      const last = pos?.lastPrice ?? null;
      changes.push({
        ...base, kind: 'sell', txType: 'sell', txShares: -delta,
        txPrice: last ?? (h.avg_price > 0 ? h.avg_price : null),
        priceSource: last != null ? 'last price' : 'app avg cost (no broker price)',
      });
    }
  }

  if (snap.cashUsd != null) {
    const cash = holdings.find(h => h.ticker === 'CASH') ?? null;
    const brokerLeg = round(snap.cashUsd, 2);
    const appLeg = round(cash?.brokers?.[B] ?? 0, 2);
    if (Math.abs(brokerLeg - appLeg) >= CASH_EPS) {
      const brokersAfter: Record<string, number> = { ...(cash?.brokers ?? {}) };
      if (Math.abs(brokerLeg) >= CASH_EPS) brokersAfter[B] = brokerLeg; else delete brokersAfter[B];
      // As with stocks, the balance becomes the sum of the broker slices (a cash row
      // with no slices yet is treated as this broker's).
      const sharesBefore = cash?.shares ?? 0;
      const sharesAfter = round(Object.values(brokersAfter).reduce((a, n) => a + n, 0), 2);
      const delta = round(sharesAfter - sharesBefore, 2);
      changes.push({
        key: 'CASH', ticker: 'CASH', kind: 'cash', holdingId: cash?.id ?? null, appLeg, brokerLeg,
        sharesBefore, sharesAfter, brokersBefore: cash?.brokers ?? null, brokersAfter,
        txType: Math.abs(delta) < CASH_EPS ? null : delta > 0 ? 'buy' : 'sell',
        txShares: Math.abs(delta), txPrice: 1, priceSource: 'cash', avgPriceBefore: 1,
      });
    }
  }
  return changes;
}

// Average cost after a buy, the way the app's own buy form computes it.
export const avgAfterBuy = (shares: number, avg: number, qty: number, price: number) =>
  shares > EPS ? (shares * avg + qty * price) / (shares + qty) : price;
