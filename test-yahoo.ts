import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

async function test() {
  try {
    const result = await yahooFinance.quoteSummary('AAPL', { modules: ['summaryDetail', 'calendarEvents'] });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
  }
}

test();
