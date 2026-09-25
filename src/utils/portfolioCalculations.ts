export interface TransactionItem {
  id: string;
  holdingId: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  date: string;
  userId?: string;
  lotId?: string;
  avgPriceCurrency?: string;
}

export interface ComputedHoldingResult {
  shares: number;
  avg_price: number;
  totalCost: number;
  activeLots: {
    id: string;
    shares: number;
    price: number;
    date: string;
  }[];
  totalBuys: number;
  totalSells: number;
  buyShares: number;
  sellShares: number;
}

/**
 * Computes the mathematically sound position (shares, average cost basis, and active lots)
 * from a list of transactions using FIFO lot matching.
 */
export function computeHoldingFromTransactions(txs: TransactionItem[]): ComputedHoldingResult {
  if (!txs || txs.length === 0) {
    return {
      shares: 0,
      avg_price: 0,
      totalCost: 0,
      activeLots: [],
      totalBuys: 0,
      totalSells: 0,
      buyShares: 0,
      sellShares: 0
    };
  }

  // Sort chronologically ascending
  const sorted = [...txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  const buyLots: { id: string; shares: number; price: number; date: string }[] = [];
  let totalBuys = 0;
  let totalSells = 0;
  let buyShares = 0;
  let sellShares = 0;

  for (const tx of sorted) {
    const numShares = Math.max(0, Number(tx.shares) || 0);
    const numPrice = Math.max(0, Number(tx.price) || 0);
    const isSell = (tx.type || '').toLowerCase().includes('sell');

    if (!isSell) {
      totalBuys++;
      buyShares += numShares;
      buyLots.push({
        id: tx.id,
        shares: numShares,
        price: numPrice,
        date: tx.date
      });
    } else {
      totalSells++;
      sellShares += numShares;
      let sharesToDeduct = numShares;

      // If specific lotId was specified, consume from that lot first
      if (tx.lotId) {
        const targetLot = buyLots.find(b => b.id === tx.lotId);
        if (targetLot && targetLot.shares > 0) {
          const consumed = Math.min(sharesToDeduct, targetLot.shares);
          targetLot.shares -= consumed;
          sharesToDeduct -= consumed;
        }
      }

      // Deduct remaining sell shares FIFO from oldest active lots
      while (sharesToDeduct > 0) {
        const oldestLot = buyLots.find(b => b.shares > 0);
        if (!oldestLot) break;
        if (oldestLot.shares <= sharesToDeduct) {
          sharesToDeduct -= oldestLot.shares;
          oldestLot.shares = 0;
        } else {
          oldestLot.shares -= sharesToDeduct;
          sharesToDeduct = 0;
        }
      }
    }
  }

  const activeLots = buyLots.filter(b => b.shares > 0.000001);
  const totalRemainingShares = activeLots.reduce((sum, b) => sum + b.shares, 0);
  const totalCost = activeLots.reduce((sum, b) => sum + (b.shares * b.price), 0);
  
  const avgPrice = totalRemainingShares > 0 
    ? totalCost / totalRemainingShares 
    : (sorted.length > 0 ? Number(sorted[sorted.length - 1].price) || 0 : 0);

  return {
    shares: totalRemainingShares,
    avg_price: Math.max(0, avgPrice),
    totalCost: Math.max(0, totalCost),
    activeLots,
    totalBuys,
    totalSells,
    buyShares,
    sellShares
  };
}
