import { db } from './src/firebase';
import { collection, getDocs } from 'firebase/firestore';

async function main() {
  console.log('Fetching all holdings...');
  const holdingsSnapshot = await getDocs(collection(db, 'holdings'));
  const holdingsMap = new Map();
  holdingsSnapshot.docs.forEach(doc => {
    holdingsMap.set(doc.id, doc.data());
  });

  console.log('Fetching all transactions...');
  const txSnapshot = await getDocs(collection(db, 'transactions'));
  console.log(`Total transactions in DB: ${txSnapshot.size}`);

  const wesTx: any[] = [];
  txSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.userId === 'BWQkSWz6z5c5C4QCYwhXWI82qSi2') {
      const holding = holdingsMap.get(data.holdingId);
      const ticker = holding ? holding.ticker : 'UNKNOWN';
      if (ticker.includes('WES') || (data.holdingId && data.holdingId.includes('WES'))) {
        wesTx.push({ id: doc.id, ticker, ...data });
      }
    }
  });

  console.log(`Found ${wesTx.length} WES-related transactions:`);
  wesTx.forEach(t => console.log(JSON.stringify(t)));
}

main().catch(console.error);
