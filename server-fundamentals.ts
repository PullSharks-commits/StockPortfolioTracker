// Company fundamentals from SEC EDGAR (companyfacts XBRL API), normalised into
// annual and quarterly series with derived ratios, cached in Postgres.
//
// Why EDGAR: it is the companies' own reported numbers, 10+ years deep, free.
// Coverage: US filers (10-K/10-Q, US GAAP) and foreign filers (20-F/6-K, US GAAP or
// IFRS). Non-US listings (e.g. .AX) and ETFs are reported as unsupported rather than
// guessed - a bare ticker like "WES" belongs to a different, US company.
//
// Rules that matter for correctness:
// - A metric can move between XBRL tags over time (Microsoft's revenue moved from
//   "Revenues" to "RevenueFromContractWithCustomer..." after 2017), so tags are
//   chosen per period, not once per company.
// - A filing's fy/fp describe the filing, not each value in it (a 10-K also holds
//   prior years), so periods come from each value's own start/end dates.
// - Restated values supersede earlier ones: for the same period the latest filing wins.
// - Values keep their currency; a period mixing currencies isn't combined.
// - Q4 is rarely filed on its own, so it is derived as FY minus Q1-Q3 for flow items.

import type { Express, Request, Response } from 'express';
import pg from 'pg';
import { createRequireUser } from './server-auth';

// ---------------------------------------------------------------------------
// Metric definitions

type Kind = 'flow' | 'instant';
interface MetricDef { kind: Kind; unit: 'currency' | 'shares' | 'perShare'; tags: string[] }

// Tags in priority order. us-gaap and ifrs-full names are listed together; each
// value records which tag it came from.
const METRICS: Record<string, MetricDef> = {
  // Total revenues first: contract revenue can exclude e.g. a lender's interest income.
  revenue: { kind: 'flow', unit: 'currency', tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'Revenue', 'RevenueFromContractsWithCustomers'] },
  costOfRevenue: { kind: 'flow', unit: 'currency', tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfSales'] },
  grossProfit: { kind: 'flow', unit: 'currency', tags: ['GrossProfit'] },
  operatingIncome: { kind: 'flow', unit: 'currency', tags: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'] },
  pretaxIncome: { kind: 'flow', unit: 'currency', tags: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'ProfitLossBeforeTax'] },
  incomeTax: { kind: 'flow', unit: 'currency', tags: ['IncomeTaxExpenseBenefit', 'IncomeTaxExpenseContinuingOperations'] },
  netIncome: { kind: 'flow', unit: 'currency', tags: ['NetIncomeLoss', 'ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'] },
  operatingCashFlow: { kind: 'flow', unit: 'currency', tags: ['NetCashProvidedByUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities'] },
  capex: { kind: 'flow', unit: 'currency', tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PaymentsToAcquireProductiveAssets'] },
  stockComp: { kind: 'flow', unit: 'currency', tags: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense', 'AdjustmentsForSharebasedPayments', 'ExpenseFromSharebasedPaymentTransactionsWithEmployees'] },
  dilutedShares: { kind: 'flow', unit: 'shares', tags: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'AdjustedWeightedAverageShares', 'WeightedAverageNumberOfSharesOutstandingBasicAndDiluted'] },
  epsDiluted: { kind: 'flow', unit: 'perShare', tags: ['EarningsPerShareDiluted', 'DilutedEarningsLossPerShare', 'EarningsPerShareBasicAndDiluted'] },
  cash: { kind: 'instant', unit: 'currency', tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'] },
  equity: { kind: 'instant', unit: 'currency', tags: ['StockholdersEquity', 'EquityAttributableToOwnersOfParent', 'Equity'] },
  debtTotal: { kind: 'instant', unit: 'currency', tags: ['LongTermDebt', 'Borrowings'] },
  debtNoncurrent: { kind: 'instant', unit: 'currency', tags: ['LongTermDebtNoncurrent', 'NoncurrentPortionOfNoncurrentBorrowings'] },
  debtCurrent: { kind: 'instant', unit: 'currency', tags: ['LongTermDebtCurrent', 'CurrentPortionOfNoncurrentBorrowings'] },
};

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A', '10-KT']);

interface Fact { val: number; unit: string; start?: string; end: string; form: string; filed: string; tag: string; tagRank: number; firstFiled?: string }
// filed = filing the value was taken from (latest, so restatements win);
// firstFiled = when this period's figure was first reported (for point-in-time use).
interface Value { value: number; currency: string | null; tag: string; filed: string; firstFiled: string; form: string; derived?: boolean }
export interface Period {
  key: string;            // "FY2024" or "Q3 FY2024"
  fiscalYear: number;
  fiscalQuarter: number | null;   // null for annual
  start: string | null;
  end: string;
  values: Record<string, Value>;
  derived: Record<string, number | null>;
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const unitCurrency = (unit: string) => (/^[A-Z]{3}$/.test(unit) ? unit : unit.includes('/shares') ? unit.split('/')[0] : null);

// ---------------------------------------------------------------------------
// Normalisation

function collectFacts(companyFacts: any, def: MetricDef): Fact[] {
  const out: Fact[] = [];
  for (const ns of ['us-gaap', 'ifrs-full']) {
    const tags = companyFacts.facts?.[ns] ?? {};
    def.tags.forEach((tag, tagRank) => {
      const units = tags[tag]?.units;
      if (!units) return;
      for (const [unit, list] of Object.entries<any[]>(units)) {
        if (def.unit === 'shares' && unit !== 'shares') continue;
        if (def.unit === 'currency' && !/^[A-Z]{3}$/.test(unit)) continue;
        if (def.unit === 'perShare' && !unit.includes('/shares')) continue;
        for (const x of list) {
          if (typeof x.val !== 'number' || !x.end || !x.form) continue;
          out.push({ val: x.val, unit, start: x.start, end: x.end, form: x.form, filed: x.filed, tag, tagRank });
        }
      }
    });
  }
  return out;
}

// For each period (start|end), keep one fact: best tag first, then latest filing.
// Also note when the period was first reported at all - later filings repeat old
// periods as comparatives, which must not make them look newly known.
function pickPerPeriod(facts: Fact[]): Map<string, Fact> {
  const best = new Map<string, Fact>();
  const first = new Map<string, string>();
  for (const f of facts) {
    const key = `${f.start ?? ''}|${f.end}`;
    const cur = best.get(key);
    if (!cur || f.tagRank < cur.tagRank || (f.tagRank === cur.tagRank && f.filed > cur.filed)) best.set(key, f);
    if (!first.has(key) || f.filed < first.get(key)!) first.set(key, f.filed);
  }
  for (const [key, f] of best) best.set(key, { ...f, firstFiled: first.get(key) });
  return best;
}

const toValue = (f: Fact, derived = false): Value => ({ value: f.val, currency: unitCurrency(f.unit), tag: f.tag, filed: f.filed, firstFiled: f.firstFiled ?? f.filed, form: f.form, ...(derived ? { derived } : {}) });

export function normalizeCompanyFacts(companyFacts: any) {
  const perMetric: Record<string, Map<string, Fact>> = {};
  const rawFacts: Record<string, Fact[]> = {};
  for (const [name, def] of Object.entries(METRICS)) {
    rawFacts[name] = collectFacts(companyFacts, def);
    perMetric[name] = pickPerPeriod(rawFacts[name]);
  }

  // Fiscal years are ~1-year revenue/net income/cash-flow periods that appeared in an
  // annual report. Check every filing, not just the one a value was taken from: the
  // latest copy of a year can come from an 8-K recasting old results.
  const annualSpans = new Map<string, { start: string; end: string }>();
  for (const name of ['revenue', 'netIncome', 'operatingCashFlow', 'operatingIncome']) {
    for (const f of rawFacts[name]) {
      if (!f.start) continue;
      const d = days(f.start, f.end);
      if (d >= 350 && d <= 380 && ANNUAL_FORMS.has(f.form)) annualSpans.set(f.end, { start: f.start, end: f.end });
    }
  }
  const fiscalYears = [...annualSpans.values()].sort((a, b) => a.end.localeCompare(b.end));
  const addYear = (date: string) => { const d = new Date(date); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };
  // Quarters after the last reported fiscal year belong to the year in progress,
  // which ends one year after the last fiscal year end.
  const fiscalYearOf = (end: string) => {
    const known = fiscalYears.find(fy => end > fy.start && end <= fy.end);
    if (known) return known;
    const last = fiscalYears[fiscalYears.length - 1];
    return last && end > last.end && end <= addYear(last.end) ? { start: last.end, end: addYear(last.end) } : undefined;
  };

  const annual: Period[] = fiscalYears.map(fy => ({
    key: `FY${fy.end.slice(0, 4)}`, fiscalYear: Number(fy.end.slice(0, 4)), fiscalQuarter: null,
    start: fy.start, end: fy.end, values: {}, derived: {},
  }));

  // Quarterly periods (~3 months), assigned to a fiscal year and quarter number.
  const quarterSpans = new Map<string, { start: string; end: string }>();
  for (const name of ['revenue', 'netIncome', 'operatingIncome']) {
    for (const f of perMetric[name].values()) {
      if (!f.start) continue;
      const d = days(f.start, f.end);
      if (d >= 80 && d <= 100) quarterSpans.set(`${f.start}|${f.end}`, { start: f.start, end: f.end });
    }
  }
  const quarterly: Period[] = [];
  for (const q of [...quarterSpans.values()].sort((a, b) => a.end.localeCompare(b.end))) {
    const fy = fiscalYearOf(q.end);
    // Quarter number from how many months into the fiscal year the quarter ends.
    const fiscalQuarter = fy ? Math.min(4, Math.max(1, Math.round(days(fy.start, q.end) / 91.3))) : null;
    const fiscalYear = fy ? Number(fy.end.slice(0, 4)) : Number(q.end.slice(0, 4));
    if (quarterly.some(p => p.fiscalYear === fiscalYear && p.fiscalQuarter === fiscalQuarter)) continue;
    // Companies without an annual report yet get calendar-quarter labels.
    const key = fiscalQuarter ? `Q${fiscalQuarter} FY${fiscalYear}` : `Q${Math.floor(Number(q.end.slice(5, 7)) / 3.01) + 1} ${q.end.slice(0, 4)}`;
    quarterly.push({ key, fiscalYear, fiscalQuarter, start: q.start, end: q.end, values: {}, derived: {} });
  }

  // Fill values.
  for (const [name, def] of Object.entries(METRICS)) {
    const facts = perMetric[name];
    for (const p of [...annual, ...quarterly]) {
      const f = def.kind === 'instant'
        ? [...facts.values()].find(x => !x.start && x.end === p.end)
        : facts.get(`${p.start}|${p.end}`);
      if (f) p.values[name] = toValue(f);
    }
  }

  // Derive missing Q4 flow values: FY - (Q1 + Q2 + Q3), same currency only.
  for (const fy of annual) {
    const qs = [1, 2, 3].map(n => quarterly.find(q => q.fiscalYear === fy.fiscalYear && q.fiscalQuarter === n));
    if (qs.some(q => !q)) continue;
    let q4 = quarterly.find(q => q.fiscalYear === fy.fiscalYear && q.fiscalQuarter === 4);
    if (!q4) {
      q4 = { key: `Q4 FY${fy.fiscalYear}`, fiscalYear: fy.fiscalYear, fiscalQuarter: 4, start: qs[2]!.end, end: fy.end, values: {}, derived: {} };
      quarterly.push(q4);
    }
    for (const [name, def] of Object.entries(METRICS)) {
      if (q4.values[name]) continue;
      const total = fy.values[name];
      if (def.kind === 'instant') {
        if (total) q4.values[name] = total;
        continue;
      }
      if (def.unit !== 'currency' || !total) continue; // shares/EPS don't sum across quarters
      const parts = qs.map(q => q!.values[name]);
      if (parts.some(v => !v || v.currency !== total.currency)) continue;
      q4.values[name] = { value: total.value - parts.reduce((s, v) => s + v!.value, 0), currency: total.currency, tag: total.tag, filed: total.filed, firstFiled: total.firstFiled, form: total.form, derived: true };
    }
  }
  quarterly.sort((a, b) => a.end.localeCompare(b.end));

  for (const series of [annual, quarterly]) derive(series, series === annual ? 1 : 4);

  // Keep periods that have at least revenue or net income.
  const useful = (p: Period) => p.values.revenue || p.values.netIncome;
  return {
    entityName: companyFacts.entityName as string,
    annual: annual.filter(useful),
    quarterly: quarterly.filter(useful),
  };
}

// Ratios and growth. `lag` = periods back for year-over-year (1 annual, 4 quarterly).
function derive(series: Period[], lag: number) {
  const num = (p: Period, k: string) => p.values[k]?.value ?? null;
  const sameCurrency = (p: Period, keys: string[]) => {
    const cur = keys.map(k => p.values[k]?.currency).filter(Boolean);
    return cur.every(c => c === cur[0]);
  };
  const ratio = (p: Period, a: string, b: string) => {
    const x = num(p, a), y = num(p, b);
    return x != null && y != null && y !== 0 && sameCurrency(p, [a, b]) ? x / y : null;
  };

  series.forEach((p, i) => {
    const d = p.derived;
    const revenue = num(p, 'revenue');
    const grossProfit = num(p, 'grossProfit') ?? (revenue != null && num(p, 'costOfRevenue') != null && sameCurrency(p, ['revenue', 'costOfRevenue']) ? revenue - num(p, 'costOfRevenue')! : null);
    const ocf = num(p, 'operatingCashFlow'), capex = num(p, 'capex');
    const fcf = ocf != null && capex != null && sameCurrency(p, ['operatingCashFlow', 'capex']) ? ocf - capex : null;
    const debt = num(p, 'debtTotal') ?? (num(p, 'debtNoncurrent') != null || num(p, 'debtCurrent') != null ? (num(p, 'debtNoncurrent') ?? 0) + (num(p, 'debtCurrent') ?? 0) : null);

    d.grossProfit = grossProfit;
    d.freeCashFlow = fcf;
    d.debt = debt;
    d.grossMargin = grossProfit != null && revenue ? grossProfit / revenue : null;
    d.operatingMargin = ratio(p, 'operatingIncome', 'revenue');
    d.netMargin = ratio(p, 'netIncome', 'revenue');
    d.fcfMargin = fcf != null && revenue ? fcf / revenue : null;
    d.stockCompToRevenue = ratio(p, 'stockComp', 'revenue');

    const pretax = num(p, 'pretaxIncome'), tax = num(p, 'incomeTax');
    const taxRate = pretax && pretax > 0 && tax != null ? Math.min(Math.max(tax / pretax, 0), 0.5) : 0.21;
    const investedCapital = num(p, 'equity') != null ? num(p, 'equity')! + (debt ?? 0) - (num(p, 'cash') ?? 0) : null;
    const opInc = num(p, 'operatingIncome');
    // Annualise quarterly operating income so quarterly ROIC is comparable.
    d.roic = opInc != null && investedCapital && investedCapital > 0 && sameCurrency(p, ['operatingIncome', 'equity'])
      ? (opInc * (lag === 4 ? 4 : 1) * (1 - taxRate)) / investedCapital : null;

    const prev = series[i - lag];
    const growth = (k: string, prevVal: number | null) => {
      const cur = k === 'freeCashFlow' ? fcf : num(p, k);
      return prev && cur != null && prevVal && prevVal > 0 && p.values[k]?.currency === prev.values[k]?.currency ? cur / prevVal - 1 : null;
    };
    d.revenueGrowth = prev ? growth('revenue', num(prev, 'revenue')) : null;
    d.netIncomeGrowth = prev ? growth('netIncome', num(prev, 'netIncome')) : null;
    d.epsGrowth = prev ? growth('epsDiluted', num(prev, 'epsDiluted')) : null;
    const shares = num(p, 'dilutedShares'), prevShares = prev ? num(prev, 'dilutedShares') : null;
    d.shareCountChange = shares && prevShares ? shares / prevShares - 1 : null;
  });

  // Compound annual revenue growth over 3/5/10 years (annual series only).
  if (lag === 1) {
    series.forEach((p, i) => {
      for (const years of [3, 5, 10]) {
        const base = series[i - years];
        const a = base?.values.revenue, b = p.values.revenue;
        p.derived[`revenueCagr${years}y`] = a && b && a.value > 0 && a.currency === b.currency ? Math.pow(b.value / a.value, 1 / years) - 1 : null;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// SEC access (rate-limited, identified per SEC policy) and caching

const SEC_MIN_INTERVAL_MS = 150; // well under SEC's 10 requests/second
let lastSecRequest = 0;
let tickerMap: { at: number; map: Map<string, { cik: number; title: string }> } | null = null;

export async function secFetch(url: string, contact: string) {
  const wait = lastSecRequest + SEC_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSecRequest = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': `StockPortfolioTracker ${contact}`, 'Accept-Encoding': 'gzip, deflate' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SEC request failed (${res.status}) for ${url}`);
  return url.endsWith('.json') ? res.json() : res.text();
}

export async function lookupCik(ticker: string, contact: string) {
  if (!tickerMap || Date.now() - tickerMap.at > 24 * 3600_000) {
    const raw = await secFetch('https://www.sec.gov/files/company_tickers.json', contact);
    const map = new Map<string, { cik: number; title: string }>();
    for (const v of Object.values<any>(raw ?? {})) map.set(String(v.ticker).toUpperCase(), { cik: v.cik_str, title: v.title });
    tickerMap = { at: Date.now(), map };
  }
  return tickerMap.map.get(ticker) ?? null;
}

const CACHE_TTL_MS = 24 * 3600_000;
// Bump when the payload shape changes so older cached entries are rebuilt.
const PAYLOAD_VERSION = 3;

export function registerFundamentalsRoutes(app: Express) {
  const connectionString = process.env.DATABASE_URL;
  const authBase = process.env.NEON_AUTH_BASE_URL;
  const contact = (process.env.SEC_USER_AGENT_EMAIL || '').trim();
  if (!connectionString || !authBase) return;
  const pool = new pg.Pool({ connectionString, max: 3 });
  const requireUser = createRequireUser(authBase);
  const inFlight = new Map<string, Promise<any>>();

  async function load(ticker: string, force: boolean) {
    const cached = await pool.query('SELECT * FROM company_fundamentals WHERE ticker = $1', [ticker]);
    const row = cached.rows[0];
    if (row && !force && row.payload?.version === PAYLOAD_VERSION && Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS) return row.payload;

    // Exchange-suffixed tickers (WES.AX, 0700.HK...) are not SEC registrants, and
    // stripping the suffix would match an unrelated US company.
    if (ticker.includes('.')) return store(ticker, { ticker, source: 'none', reason: 'Not a US-listed security - SEC EDGAR has no filings for it.', annual: [], quarterly: [] });
    if (!contact) throw new Error('SEC_USER_AGENT_EMAIL is not set.');

    const match = await lookupCik(ticker, contact);
    if (!match) return store(ticker, { ticker, source: 'none', reason: 'No SEC registrant for this ticker (funds and ETFs have no company financials).', annual: [], quarterly: [] });

    const facts = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(match.cik).padStart(10, '0')}.json`, contact);
    if (!facts) return store(ticker, { ticker, source: 'none', reason: 'The SEC has no structured financial data for this company yet.', cik: match.cik, annual: [], quarterly: [] });

    const normalized = normalizeCompanyFacts(facts);
    const latestFiled = [...normalized.annual, ...normalized.quarterly].flatMap(p => Object.values(p.values).map(v => v.filed)).sort().pop() ?? null;
    return store(ticker, {
      ticker, source: 'sec', cik: match.cik, entityName: normalized.entityName, latestFiled,
      filingsUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${match.cik}&type=10-K&dateb=&owner=include&count=40`,
      annual: normalized.annual, quarterly: normalized.quarterly,
    });
  }

  async function store(ticker: string, payload: any) {
    payload.fetchedAt = new Date().toISOString();
    payload.version = PAYLOAD_VERSION;
    await pool.query(
      `INSERT INTO company_fundamentals (ticker, source, payload, fetched_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (ticker) DO UPDATE SET source = EXCLUDED.source, payload = EXCLUDED.payload, fetched_at = now()`,
      [ticker, payload.source, JSON.stringify(payload)]
    );
    return payload;
  }

  app.get('/api/fundamentals/:ticker', requireUser, async (req: Request, res: Response) => {
    const ticker = String(req.params.ticker || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) return res.status(400).json({ error: 'Invalid ticker' });
    const force = req.query.refresh === '1';
    try {
      // Concurrent requests for the same ticker share one SEC fetch.
      if (!inFlight.has(ticker)) inFlight.set(ticker, load(ticker, force).finally(() => inFlight.delete(ticker)));
      res.json(await inFlight.get(ticker));
    } catch (err: any) {
      console.error(`[fundamentals] ${ticker}:`, err?.message || err);
      res.status(502).json({ error: `Couldn't load fundamentals for ${ticker}: ${err?.message || err}` });
    }
  });
}
