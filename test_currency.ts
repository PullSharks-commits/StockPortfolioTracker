import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
async function test() {
  const quotes = await yahooFinance.quote(['BHP.AX', 'RELIANCE.NS']);
  quotes.forEach(q => console.log(`${q.symbol}: ${q.regularMarketPrice} ${q.currency}`));
}
test();
