// "What's moving?" for one ticker: today's move, the market's and its sector's move
// for context, and the latest headlines about it (Finnhub company news for US
// listings, Yahoo news for everything). The page asks the user's AI model to explain
// the move from exactly this; nothing here calls an AI.

import type { Express } from 'express';

interface Article { title: string; summary: string; source: string; url: string; time: string }

const SECTOR_ETF: Record<string, string> = {
  'Technology': 'XLK', 'Healthcare': 'XLV', 'Financial Services': 'XLF', 'Consumer Cyclical': 'XLY',
  'Industrials': 'XLI', 'Communication Services': 'XLC', 'Consumer Defensive': 'XLP', 'Energy': 'XLE',
  'Real Estate': 'XLRE', 'Utilities': 'XLU', 'Basic Materials': 'XLB',
};
const CACHE_MS = 5 * 60_000;
const RECENT_MS = 48 * 3600_000;
const cache = new Map<string, { at: number; data: any }>();

// Move vs the last close, using the extended-hours price when it's the latest. Before
// the open the last close is regularMarketPrice (yesterday's); otherwise it's the
// previous close (after hours: the move includes the day plus after-hours trading).
function liveMove(q: any): { price: number | null; base: number | null; percent: number | null } {
  const state: string = q?.marketState || 'REGULAR';
  const pre = state.startsWith('PRE');
  const price = Number((pre ? q?.preMarketPrice : state !== 'REGULAR' ? q?.postMarketPrice : undefined) ?? q?.regularMarketPrice ?? NaN);
  const base = Number((pre ? q?.regularMarketPrice : q?.regularMarketPreviousClose) ?? NaN);
  const ok = Number.isFinite(price) && base > 0;
  return { price: Number.isFinite(price) ? price : null, base: base > 0 ? base : null, percent: ok ? ((price - base) / base) * 100 : null };
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// "Wesfarmers Limited" -> "Wesfarmers": company-name searches match better without the suffix.
const searchName = (name: string) => name.replace(/[,.]/g, ' ').replace(/\b(limited|ltd|inc|corp|corporation|plc|group|holdings|co|n\.?v|s\.?a|ag|class [a-z])\b/gi, ' ').replace(/\s+/g, ' ').trim();

export function registerWhatsMovingRoutes(app: Express, deps: {
  yahooFinance: any;
  yahooWithRetry: <T>(fn: () => Promise<T>) => Promise<T>;
  finnhubApiKey?: string;
}) {
  const { yahooFinance, yahooWithRetry, finnhubApiKey } = deps;

  app.get('/api/whats-moving', async (req, res) => {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    if (!symbol || symbol === 'CASH' || !/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) return res.status(400).json({ error: 'A ticker is required' });
    const hit = cache.get(symbol);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.data);

    try {
      const isUs = !symbol.includes('.') && !symbol.startsWith('^') && !symbol.includes('=') && !symbol.endsWith('-USD');
      const marketSymbol = symbol.endsWith('.AX') ? '^AXJO' : isUs ? 'SPY' : null;

      const summary: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['price', 'assetProfile'] }, { validateResult: false })).catch(() => null);
      const p = summary?.price ?? {};
      const name: string = p.longName || p.shortName || symbol;
      const sectorName: string | undefined = summary?.assetProfile?.sector;
      const sectorEtf = isUs && sectorName ? SECTOR_ETF[sectorName] : undefined;

      const contextSymbols = [marketSymbol, sectorEtf].filter(Boolean) as string[];
      const ctxQuotes: any[] = contextSymbols.length
        ? await yahooWithRetry(() => yahooFinance.quote(contextSymbols, {}, { validateResult: false })).then((r: any) => (Array.isArray(r) ? r : [r])).catch(() => [])
        : [];
      const pct = (sym?: string) => (sym ? liveMove(ctxQuotes.find(x => x?.symbol === sym)).percent : null);
      const state: string = p.marketState || 'REGULAR';
      const move = liveMove(p);

      // Headlines from both sources, newest first, without duplicates.
      const articles: Article[] = [];
      const seen = new Set<string>();
      const add = (a: Article) => {
        const key = normTitle(a.title);
        if (!a.title || seen.has(key)) return;
        seen.add(key);
        articles.push(a);
      };
      const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const [finnhubNews, yahooNews] = await Promise.all([
        isUs && finnhubApiKey
          ? fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${day(Date.now() - 3 * 86400_000)}&to=${day(Date.now())}&token=${finnhubApiKey}`)
              .then(r => (r.ok ? r.json() : [])).catch(() => [])
          : Promise.resolve([]),
        // US tickers search well by symbol; other exchanges by company name, kept to
        // stories Yahoo tags with this ticker.
        yahooWithRetry(() => yahooFinance.search(isUs ? symbol : searchName(name), { newsCount: 20, quotesCount: 0 }, { validateResult: false }))
          .then((r: any) => (r?.news ?? []).filter((n: any) => isUs || (n.relatedTickers ?? []).includes(symbol))).catch(() => []),
      ]);
      for (const n of Array.isArray(finnhubNews) ? finnhubNews : []) {
        add({ title: n.headline || '', summary: n.summary || '', source: n.source || 'Finnhub', url: n.url || '', time: new Date((n.datetime || 0) * 1000).toISOString() });
      }
      for (const n of yahooNews) {
        const t = n.providerPublishTime instanceof Date ? n.providerPublishTime : new Date(n.providerPublishTime);
        add({ title: n.title || '', summary: '', source: n.publisher || 'Yahoo', url: n.link || '', time: isNaN(t.getTime()) ? new Date(0).toISOString() : t.toISOString() });
      }
      articles.sort((a, b) => b.time.localeCompare(a.time));
      const recent = articles.filter(a => Date.now() - Date.parse(a.time) <= RECENT_MS).slice(0, 25);
      // Nothing in the last two days: show the latest few anyway, marked older on the page.
      const shown = recent.length ? recent : articles.slice(0, 5);

      const data = {
        symbol, name, currency: p.currency || null, marketState: state,
        price: move.price, previousClose: move.base, changePercent: move.percent,
        market: marketSymbol ? { symbol: marketSymbol, name: marketSymbol === 'SPY' ? 'S&P 500' : 'ASX 200', changePercent: pct(marketSymbol) } : null,
        sector: sectorName ? { name: sectorName, etf: sectorEtf ?? null, changePercent: pct(sectorEtf) } : null,
        articles: shown, recentCount: recent.length,
        asOf: new Date().toISOString(),
      };
      cache.set(symbol, { at: Date.now(), data });
      res.json(data);
    } catch (err: any) {
      console.error('whats-moving failed:', err?.message || err);
      res.status(502).json({ error: "Couldn't load today's news", details: err?.message || String(err) });
    }
  });
}
