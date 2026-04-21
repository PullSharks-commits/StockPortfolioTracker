import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

async function test() {
  const res = await yahooFinance.quote('TSCO.L');
  console.log('TSCO.L marketCap:', res.marketCap);
  console.log('TSCO.L currency:', res.currency);
}
test();
