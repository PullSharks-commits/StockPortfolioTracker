import { db } from './src/firebase';
import { collection, getDocs } from 'firebase/firestore';

async function main() {
  console.log('Fetching holdings...');
  const holdingsSnapshot = await getDocs(collection(db, 'holdings'));
  const wesHoldings: any[] = [];
  holdingsSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.userId === 'BWQkSWz6z5c5C4QCYwhXWI82qSi2' && data.ticker.includes('WES')) {
      wesHoldings.push({ id: doc.id, ...data });
    }
  });
  console.log('WES holdings found:', wesHoldings);

  console.log('\nFetching transactions...');
  const txSnapshot = await getDocs(collection(db, 'transactions'));
  const wesTransactions: any[] = [];
  txSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.userId === 'BWQkSWz6z5c5C4QCYwhXWI82qSi2') {
      const isWesHolding = wesHoldings.some(h => h.id === data.holdingId);
      if (isWesHolding) {
        wesTransactions.push({ id: doc.id, ...data });
      }
    }
  });
  console.log(`WES transactions found: ${wesTransactions.length}`);
  wesTransactions.forEach(t => console.log(JSON.stringify(t)));
}

main().catch(console.error);
