import { db } from './src/firebase';
import { collection, getDocs } from 'firebase/firestore';

async function main() {
  const holdingsSnapshot = await getDocs(collection(db, 'holdings'));
  console.log('--- ALL Holdings ---');
  const holdingsMap = new Map();
  holdingsSnapshot.docs.forEach(doc => {
    const data = doc.data();
    holdingsMap.set(doc.id, data);
    console.log(`Holding ID: ${doc.id} | Ticker: ${data.ticker} | Portfolio: ${data.portfolioType} | Shares: ${data.shares}`);
  });

  const txSnapshot = await getDocs(collection(db, 'transactions'));
  console.log(`\n--- ALL Transactions (${txSnapshot.size}) ---`);
  const countsByHoldingId = new Map();
  txSnapshot.docs.forEach(doc => {
    const data = doc.data();
    countsByHoldingId.set(data.holdingId, (countsByHoldingId.get(data.holdingId) || 0) + 1);
  });

  countsByHoldingId.forEach((count, holdingId) => {
    const holding = holdingsMap.get(holdingId);
    console.log(`Holding ID: ${holdingId} | Ticker: ${holding ? holding.ticker : 'UNKNOWN'} | Portfolio: ${holding ? holding.portfolioType : 'UNKNOWN'} | Tx Count: ${count}`);
  });
}

main().catch(console.error);
