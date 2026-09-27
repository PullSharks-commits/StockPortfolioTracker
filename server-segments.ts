// Segment, product and geography revenue from the XBRL data companies tag in their
// 10-Q/10-K (and 20-F/40-F) filings. The companyfacts API used for fundamentals drops
// dimensional facts, so this reads each filing's XBRL instance document directly.
//
// Rules, as for fundamentals:
// - Periods come from each fact's own start/end dates; quarters are ~3-month spans,
//   years ~12-month spans. Q4 is derived as the fiscal year minus the nine months.
// - A later filing's figure for the same period wins (segment recasts, restatements).
// - Values keep their reported currency.

import type { Express, Request, Response } from 'express';
import * as cheerio from 'cheerio';
import pg from 'pg';
import { createRequireUser } from './server-auth';
import { lookupCik, secFetch } from './server-fundamentals';

const PERIODIC_FORMS = new Set(['10-Q', '10-K', '20-F', '40-F']);
const ANNUAL_ONLY_FORMS = new Set(['20-F', '40-F']);
// ~2 years of 10-Q/10-Ks; each also carries prior-year comparatives.
const FILINGS_PER_COMPANY = 8;
const ANNUAL_ONLY_FILINGS = 3;
const CACHE_TTL_MS = 24 * 3600_000;
// Bump when the payload shape changes so older cached entries are rebuilt.
const PAYLOAD_VERSION = 1;

export type SegmentCategory = 'segment_revenue' | 'segment_operating_income' | 'product_revenue' | 'geographic_revenue';

const AXES: Record<string, 'segment' | 'product' | 'geography'> = {
  'us-gaap:StatementBusinessSegmentsAxis': 'segment',
  'ifrs-full:SegmentsAxis': 'segment',
  'srt:ProductOrServiceAxis': 'product',
  'ifrs-full:ProductsAndServicesAxis': 'product',
  'srt:StatementGeographicalAxis': 'geography',
  'ifrs-full:GeographicalAreasAxis': 'geography',
};
// Company-defined product axes, e.g. msft:ProductsOrServicesSecondaryCategorizationAxis.
const CUSTOM_PRODUCT_AXIS = /ProductsOrServices|ProductOrService/;

// In order of preference when a company tags more than one. Totals come first: banks
// like SoFi tag contract revenue (fees only) alongside net revenue for the same segment.
const REVENUE_CONCEPTS = [
  'us-gaap:Revenues',
  'us-gaap:RevenuesNetOfInterestExpense',
  'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
  'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax',
  'ifrs-full:Revenue',
  'ifrs-full:RevenueFromContractsWithCustomers',
];
const OPERATING_INCOME_CONCEPTS = ['us-gaap:OperatingIncomeLoss', 'ifrs-full:ProfitLossFromOperatingActivities'];

export interface SegmentPoint {
  start: string; end: string; type: 'quarter' | 'annual';
  value: number; currency: string | null; form: string; filed: string; url: string; derived?: boolean;
}
export interface SegmentSeries { key: string; label: string; category: SegmentCategory; points: SegmentPoint[] }

interface Filing { accession: string; form: string; filed: string }
interface RawFact { seriesKey: string; category: SegmentCategory; member: string; segment?: string; start: string; end: string; value: number; currency: string | null; rank: number }

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

// "msft:MicrosoftThreeSixFiveConsumerProductsAndCloudServicesMember" → "Microsoft Three Six Five Consumer …";
// only used when the filing's own label is missing.
const prettify = (qname: string) => qname.split(':').pop()!.replace(/Member$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

const axisKind = (axis: string) => AXES[axis] ?? (CUSTOM_PRODUCT_AXIS.test(axis) ? 'product' : null);

// Parses one XBRL instance into revenue / operating income facts broken down along one
// dimension. Some filers only tag regions per product (Netflix) or products per segment
// (SoFi); those qualified facts are used when the filing has no plain breakdown for that category.
export function parseInstance(xml: string): RawFact[] {
  const $ = cheerio.load(xml, { xml: true });
  const local = (name: string) => name.split(':').pop()!;
  const root = $.root().children().first();

  const contexts = new Map<string, { start: string; end: string; axis: string; member: string; segment?: string }>();
  const units = new Map<string, string | null>();
  root.children().each((_, node) => {
    const el = $(node);
    const kind = local((node as any).name);
    if (kind === 'context') {
      // Since the 2024 segment rules many filers add ConsolidationItemsAxis=OperatingSegmentsMember
      // alongside the segment; that qualifier doesn't change what the figure is.
      const members = el.find('*').filter((_, e) => local((e as any).name) === 'explicitMember')
        .filter((_, e) => !($(e).attr('dimension')?.trim() === 'srt:ConsolidationItemsAxis' && $(e).text().trim() === 'us-gaap:OperatingSegmentsMember'));
      const typed = el.find('*').filter((_, e) => local((e as any).name) === 'typedMember');
      if (typed.length || members.length < 1 || members.length > 2) return;
      const dims = members.map((_, e) => ({ axis: $(e).attr('dimension')!.trim(), member: $(e).text().trim() })).get();
      const text = (n: string) => el.find('*').filter((_, e) => local((e as any).name) === n).first().text().trim();
      const start = text('startDate'), end = text('endDate');
      if (!start || !end) return;
      if (dims.length === 1) { contexts.set(el.attr('id')!, { start, end, ...dims[0] }); return; }
      // Segment × product, segment × region or product × region: the first qualifies the second.
      const kinds = dims.map(d => axisKind(d.axis));
      const order = ['segment', 'product', 'geography'];
      if (kinds.includes(null) || kinds[0] === kinds[1]) return;
      const [outer, inner] = order.indexOf(kinds[0]!) < order.indexOf(kinds[1]!) ? [dims[0], dims[1]] : [dims[1], dims[0]];
      contexts.set(el.attr('id')!, { start, end, ...inner, segment: outer.member });
    } else if (kind === 'unit') {
      const measures = el.find('*').filter((_, e) => local((e as any).name) === 'measure').map((_, e) => $(e).text().trim()).get();
      const iso = measures.length === 1 && measures[0].startsWith('iso4217:') ? measures[0].slice(8) : null;
      units.set(el.attr('id')!, iso);
    }
  });

  const facts: RawFact[] = [];
  root.children().each((_, node) => {
    const name = (node as any).name as string;
    const revenueRank = REVENUE_CONCEPTS.indexOf(name);
    const incomeRank = OPERATING_INCOME_CONCEPTS.indexOf(name);
    if (revenueRank < 0 && incomeRank < 0) return;
    const el = $(node);
    if (el.attr('xsi:nil') === 'true') return;
    const ctx = contexts.get(el.attr('contextRef') ?? '');
    if (!ctx) return;
    const kind = axisKind(ctx.axis);
    if (!kind) return;
    let category: SegmentCategory;
    if (revenueRank >= 0) category = kind === 'segment' ? 'segment_revenue' : kind === 'product' ? 'product_revenue' : 'geographic_revenue';
    else if (kind === 'segment') category = 'segment_operating_income';
    else return;
    const value = Number(el.text().trim());
    if (!Number.isFinite(value)) return;
    facts.push({
      seriesKey: `${category}|${ctx.axis}|${ctx.member}${ctx.segment ? `|${ctx.segment}` : ''}`, category, member: ctx.member, segment: ctx.segment,
      start: ctx.start, end: ctx.end, value, currency: units.get(el.attr('unitRef') ?? '') ?? null,
      rank: revenueRank >= 0 ? revenueRank : incomeRank,
    });
  });
  // Plain breakdown wins, unless it's a single line (e.g. only "United States").
  const plainMembers = new Map<SegmentCategory, Set<string>>();
  for (const f of facts) if (!f.segment) plainMembers.set(f.category, (plainMembers.get(f.category) ?? new Set()).add(f.member));
  const usePlain = (c: SegmentCategory) => (plainMembers.get(c)?.size ?? 0) > 1;
  return facts.filter(f => (f.segment ? !usePlain(f.category) : usePlain(f.category) || !facts.some(g => g.segment && g.category === f.category)));
}

const decodeEntities = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" } as Record<string, string>)[e]);

// Company display labels for members ("Intelligent Cloud"), from the filing's MetaLinks.json.
export function memberLabels(metaLinks: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const inst of Object.values<any>(metaLinks?.instance ?? {})) {
    for (const [id, tag] of Object.entries<any>(inst?.tag ?? {})) {
      if (tag?.xbrltype !== 'domainItemType') continue; // members, incl. country:US
      const role = tag?.lang?.['en-us']?.role ?? {};
      const label = decodeEntities(role.terseLabel ?? role.label ?? '').replace(/\s*\[Member\]$/, '').trim();
      if (label) out.set(id.replace('_', ':'), label);
    }
  }
  return out;
}

// Merges facts from several filings (newest filing wins per period) into series,
// derives Q4s, and keeps only series still reported recently. Each series uses a
// single concept throughout, the one covering its latest period, so history never
// mixes definitions.
export function buildSeries(perFiling: { filing: Filing; url: string; facts: RawFact[] }[], labels: Map<string, string>): SegmentSeries[] {
  type Pt = Omit<SegmentPoint, 'type'> & { type: SegmentPoint['type'] | 'nine' };
  const byKey = new Map<string, { category: SegmentCategory; member: string; segment?: string; byConcept: Map<number, Map<string, Pt>> }>();
  const ordered = [...perFiling].sort((a, b) => a.filing.filed.localeCompare(b.filing.filed));
  for (const { filing, url, facts } of ordered) {
    for (const f of facts) {
      const span = days(f.start, f.end);
      const type = span >= 80 && span <= 100 ? 'quarter' : span >= 350 && span <= 380 ? 'annual' : span >= 250 && span <= 285 ? 'nine' : null;
      if (!type) continue;
      const s = byKey.get(f.seriesKey) ?? { category: f.category, member: f.member, segment: f.segment, byConcept: new Map() };
      byKey.set(f.seriesKey, s);
      const points = s.byConcept.get(f.rank) ?? new Map<string, Pt>();
      s.byConcept.set(f.rank, points);
      points.set(`${f.start}|${f.end}`, { start: f.start, end: f.end, type, value: f.value, currency: f.currency, form: filing.form, filed: filing.filed, url });
    }
  }

  const all: SegmentSeries[] = [];
  for (const [key, s] of byKey) {
    const latestEnd = (m: Map<string, Pt>) => [...m.values()].reduce((a, p) => (p.end > a ? p.end : a), '');
    const [, chosen] = [...s.byConcept.entries()].sort(([ra, a], [rb, b]) => latestEnd(b).localeCompare(latestEnd(a)) || ra - rb)[0];
    const pts = [...chosen.values()];
    const quarters = pts.filter(p => p.type === 'quarter');
    const annual = pts.filter(p => p.type === 'annual');
    const nine = pts.filter(p => p.type === 'nine');
    for (const y of annual) {
      if (quarters.some(q => Math.abs(days(q.end, y.end)) <= 7)) continue;
      const ytd = nine.find(n => n.start === y.start && n.currency === y.currency);
      const q123 = quarters.filter(q => q.start >= y.start && q.end < y.end && q.currency === y.currency);
      const partial = ytd ? ytd.value : q123.length === 3 ? q123.reduce((a, q) => a + q.value, 0) : null;
      const partialEnd = ytd ? ytd.end : q123.length === 3 ? q123.map(q => q.end).sort().pop()! : null;
      if (partial == null || !partialEnd) continue;
      quarters.push({ ...y, start: addDays(partialEnd, 1), type: 'quarter', value: y.value - partial, derived: true });
    }
    const points = [...quarters, ...annual].sort((a, b) => a.end.localeCompare(b.end) || a.type.localeCompare(b.type)) as SegmentPoint[];
    if (points.length === 0) continue;
    const label = labels.get(s.member) ?? prettify(s.member);
    // Name the qualifying segment/product only when a category is split across several.
    const segments = new Set([...byKey.values()].filter(o => o.category === s.category && o.segment).map(o => o.segment));
    const segmentLabel = s.segment && segments.size > 1 ? ` · ${labels.get(s.segment) ?? prettify(s.segment)}` : '';
    all.push({ key, label: label + segmentLabel, category: s.category, points });
  }

  // Drop series the company no longer reports (renamed or reorganised segments).
  const newest = all.reduce((m, s) => (s.points[s.points.length - 1].end > m ? s.points[s.points.length - 1].end : m), '');
  const current = all.filter(s => days(s.points[s.points.length - 1].end, newest) <= 120);
  // A single line in a category (one reportable segment, say) is just the company total.
  const perCategory = new Map<SegmentCategory, number>();
  for (const s of current) perCategory.set(s.category, (perCategory.get(s.category) ?? 0) + 1);
  return current.filter(s => perCategory.get(s.category)! > 1);
}

export async function recentFilings(cik: number, contact: string): Promise<Filing[]> {
  const sub = await secFetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, contact);
  const r = sub?.filings?.recent;
  if (!r) return [];
  const out: Filing[] = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!PERIODIC_FORMS.has(r.form[i])) continue;
    const limit = ANNUAL_ONLY_FORMS.has(r.form[i]) ? ANNUAL_ONLY_FILINGS : FILINGS_PER_COMPANY;
    if (out.length >= limit) break;
    out.push({ accession: r.accessionNumber[i], form: r.form[i], filed: r.filingDate[i] });
  }
  return out;
}

export async function buildSegments(cik: number, filings: Filing[], contact: string) {
  const perFiling: { filing: Filing; url: string; facts: RawFact[] }[] = [];
  let labels = new Map<string, string>();
  for (const [i, filing] of filings.entries()) {
    const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accession.replace(/-/g, '')}`;
    const index = await secFetch(`${base}/index.json`, contact);
    const names: string[] = (index?.directory?.item ?? []).map((x: any) => x.name);
    const instance = names.find(n => /_htm\.xml$/.test(n));
    if (!instance) continue; // pre-inline-XBRL filings and some 20-Fs
    const xml = await secFetch(`${base}/${instance}`, contact);
    if (typeof xml !== 'string') continue;
    perFiling.push({ filing, url: `${base}/${filing.accession}-index.htm`, facts: parseInstance(xml) });
    // Labels come from the newest filing; older-only members fall back to their tag name.
    if (i === 0 && names.includes('MetaLinks.json')) labels = memberLabels(await secFetch(`${base}/MetaLinks.json`, contact));
  }
  return buildSeries(perFiling, labels);
}

export function registerSegmentRoutes(app: Express) {
  const connectionString = process.env.DATABASE_URL;
  const authBase = process.env.NEON_AUTH_BASE_URL;
  const contact = (process.env.SEC_USER_AGENT_EMAIL || '').trim();
  if (!connectionString || !authBase) return;
  const pool = new pg.Pool({ connectionString, max: 3 });
  const requireUser = createRequireUser(authBase);
  const inFlight = new Map<string, Promise<any>>();

  async function load(ticker: string) {
    const cached = (await pool.query('SELECT * FROM company_segments WHERE ticker = $1', [ticker])).rows[0];
    const fresh = cached && cached.payload?.version === PAYLOAD_VERSION && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS;
    if (fresh) return cached.payload;

    const match = await lookupCik(ticker, contact);
    if (!match) return { version: PAYLOAD_VERSION, ticker, status: 'none', series: [] };
    const filings = await recentFilings(match.cik, contact);
    const latest = filings[0]?.accession ?? null;
    let payload;
    // Nothing new filed since the last build: keep it, just mark it checked.
    if (cached && cached.payload?.version === PAYLOAD_VERSION && cached.latest_accession === latest) payload = cached.payload;
    else {
      const series = latest ? await buildSegments(match.cik, filings, contact) : [];
      payload = { version: PAYLOAD_VERSION, ticker, entityName: match.title, status: series.length ? 'ready' : 'none', series };
    }
    await pool.query(
      `INSERT INTO company_segments (ticker, latest_accession, payload, fetched_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (ticker) DO UPDATE SET latest_accession = EXCLUDED.latest_accession, payload = EXCLUDED.payload, fetched_at = now()`,
      [ticker, latest, payload]
    );
    return payload;
  }

  app.get('/api/company-segments/:ticker', requireUser, async (req: Request, res: Response) => {
    const ticker = String(req.params.ticker || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) return res.status(400).json({ error: 'Invalid ticker' });
    if (ticker.includes('.')) return res.json({ ticker, status: 'unsupported', series: [] });
    if (!contact) return res.status(503).json({ error: 'SEC_USER_AGENT_EMAIL is not set on the server' });
    try {
      if (!inFlight.has(ticker)) inFlight.set(ticker, load(ticker).finally(() => inFlight.delete(ticker)));
      res.json(await inFlight.get(ticker));
    } catch (err: any) {
      console.error(`[segments] ${ticker}:`, err?.message || err);
      res.status(502).json({ error: 'Could not load segment data from the SEC' });
    }
  });
}
