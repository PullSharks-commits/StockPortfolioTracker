import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

async function test() {
  const quote = await yahooFinance.quote('AAPL');
  console.log('Quote keys:', Object.keys(quote));
  
  const summary = await yahooFinance.quoteSummary('AAPL', { modules: ['summaryDetail'] });
  console.log('Summary beta:', summary.summaryDetail?.beta);
}
test();
