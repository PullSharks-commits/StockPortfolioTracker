import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ fetchOptions: { timeout: 15000 } } as any);

async function test() {
  try {
    const res = await yahooFinance.quote('AAPL');
    console.log('Success', res.symbol);
  } catch (e) {
    console.error('Error', e);
  }
}
test();
