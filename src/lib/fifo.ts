// Realized P&L per sale, matched against buys the way brokers do: a sale tied to a
// specific lot (lotId) takes that lot first; everything else comes out of the
// oldest buys first (FIFO). Fixed once a sale is made: later buys don't change it.
// Amounts are in the trades' own currency, before commissions (the app doesn't
// store them). Used by the holdings table (Realized P&L) and the Transactions
// Registry (each sale's P&L), so the two always agree.

export interface FifoTx { id: string; type: string; shares: number; price: number; date: string | Date; lotId?: string | null }
export interface SaleMatch { realized: number; cost: number; matchedShares: number }

const EPS = 1e-9;

// txs: one holding's trades, in date order.
export function matchSalesFifo(txs: readonly FifoTx[]): Map<string, SaleMatch> {
  const time = (t: FifoTx) => new Date(t.date).getTime();
  const pool = txs.filter(t => t.type === 'buy').map(t => ({ id: t.id, left: t.shares, price: t.price, at: time(t) }));
  const sells = txs.filter(t => t.type === 'sell').map(t => ({ t, left: t.shares, at: time(t) }));
  const out = new Map<string, SaleMatch>(sells.map(s => [s.t.id, { realized: 0, cost: 0, matchedShares: 0 }]));
  const take = (s: (typeof sells)[number], b: (typeof pool)[number]) => {
    const n = Math.min(s.left, b.left);
    if (n <= EPS) return;
    const m = out.get(s.t.id)!;
    m.realized += n * (s.t.price - b.price);
    m.cost += n * b.price;
    m.matchedShares += n;
    s.left -= n;
    b.left -= n;
  };

  // Sales tied to a specific lot take it first.
  for (const s of sells) {
    if (!s.t.lotId) continue;
    const b = pool.find(p => p.id === s.t.lotId);
    if (b) take(s, b);
  }
  // The rest, oldest buys first, using only buys made on or before the sale (a
  // buy entered with a later date than the sale it funds is used as a last resort).
  for (const s of sells) {
    for (const b of pool) { if (s.left <= EPS) break; if (b.at <= s.at) take(s, b); }
    for (const b of pool) { if (s.left <= EPS) break; take(s, b); }
  }
  return out;
}
