import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

async function run() {
  try {
    const prices = await yahooFinance.chart('PYPL', {
      period1: new Date('2023-01-01'),
      period2: new Date(),
      interval: '1d',
      return: 'array'
    });
    console.log(prices.quotes.length);
    console.log(prices.quotes[0]);
  } catch (err) {
    console.error('Error with PYPL:', err.message);
  }
}
run();
