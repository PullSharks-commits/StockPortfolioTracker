import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

async function run() {
  try {
    const prices = await yahooFinance.historical('PYPL', {
      period1: new Date('2023-01-01'),
      period2: new Date(),
      interval: '1d'
    });
    console.log(prices.length);
  } catch (err) {
    console.error('Error with PYPL:', err.message);
  }
}
run();
