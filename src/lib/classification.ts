// How holdings are grouped in the holdings table (and the export): by theme, asset
// type, sector, industry or market cap. One place, one set of rules. Pure functions.
//
// Theme = an investment narrative, so it is partly opinion. It is decided in order:
//   1. the user's own choice for that ticker (Settings, via the holding's ⋯ menu)
//   2. a short curated ticker list (where Yahoo's industry would mislead)
//   3. Yahoo's industry, matched exactly against a table
//   4. Yahoo's sector
// Funds that track one stock or sector with leverage take that underlying's theme
// (FBL = 2x META → Big Tech); other funds are "Index & Diversified Funds".
// Everything else (asset type, sector, industry, market cap) is Yahoo's data as-is.

export interface SecurityMeta {
  sector?: string;
  industry?: string;
  quoteType?: string;     // EQUITY | ETF | MUTUALFUND | CRYPTOCURRENCY | ...
  fundCategory?: string;  // e.g. "Trading--Leveraged Equity"
  name?: string;
}

export const THEMES = [
  { id: 'big_tech', label: 'Big Tech Platforms' },
  { id: 'ai_semis', label: 'AI Chips & Semiconductors' },
  { id: 'software', label: 'Software & Cloud' },
  { id: 'internet', label: 'Internet, Media & Consumer Apps' },
  { id: 'fintech', label: 'Fintech & Payments' },
  { id: 'crypto', label: 'Crypto & Digital Assets' },
  { id: 'space_defense', label: 'Space & Defense' },
  { id: 'clean_energy', label: 'Clean Energy & EVs' },
  { id: 'healthcare', label: 'Healthcare & Biotech' },
  { id: 'financials', label: 'Banks & Insurance' },
  { id: 'energy', label: 'Energy, Materials & Utilities' },
  { id: 'industrials', label: 'Industrials' },
  { id: 'consumer', label: 'Consumer Brands & Retail' },
  { id: 'real_estate', label: 'Real Estate' },
  { id: 'index', label: 'Index & Diversified Funds' },
  { id: 'other', label: 'Other' },
  { id: 'cash', label: 'Cash' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const THEME_LABEL = Object.fromEntries(THEMES.map(t => [t.id, t.label])) as Record<ThemeId, string>;
const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && THEMES.some(t => t.id === v);

// Tickers whose Yahoo industry would put them in the wrong theme.
const CURATED: Record<string, ThemeId> = {
  // Big Tech platforms span several industries (software, internet, retail).
  MSFT: 'big_tech', GOOGL: 'big_tech', GOOG: 'big_tech', META: 'big_tech', AMZN: 'big_tech', AAPL: 'big_tech',
  // Crypto exposure listed as financial services.
  COIN: 'crypto', BMNR: 'crypto', MSTR: 'crypto', MARA: 'crypto', RIOT: 'crypto', IBIT: 'crypto', BITO: 'crypto',
  // Consumer apps Yahoo lists as "Software - Application".
  UBER: 'internet', LYFT: 'internet', DUOL: 'internet', ABNB: 'internet', SPOT: 'internet', DASH: 'internet',
  // Payments companies listed as software.
  DLO: 'fintech', XYZ: 'fintech', SQ: 'fintech', AFRM: 'fintech', TOST: 'fintech',
  TSLA: 'clean_energy',
  SRAD: 'consumer', // owner's choice (sports data & betting)
};

// Leveraged / inverse funds: the ticker they track (its theme applies), or a theme.
const LEVERAGED_UNDERLYING: Record<string, string | ThemeId> = {
  FBL: 'META', METU: 'META', NVDL: 'NVDA', NVDU: 'NVDA', TSLL: 'TSLA', TSLT: 'TSLA', AMZU: 'AMZN', GGLL: 'GOOGL',
  MSFU: 'MSFT', AAPU: 'AAPL', CONL: 'COIN', MSTU: 'MSTR', MSTX: 'MSTR', AMDL: 'AMD', AVL: 'AVGO',
  SOXL: 'ai_semis', SOXS: 'ai_semis', USD: 'ai_semis', TQQQ: 'big_tech', SQQQ: 'big_tech', QLD: 'big_tech',
  TECL: 'software', FNGU: 'big_tech', BITX: 'crypto', ETHU: 'crypto',
};

// Yahoo industry → theme (exact names, as Yahoo reports them).
const BY_INDUSTRY: Record<string, ThemeId> = {
  'Semiconductors': 'ai_semis', 'Semiconductor Equipment & Materials': 'ai_semis',
  'Software - Application': 'software', 'Software - Infrastructure': 'software', 'Information Technology Services': 'software',
  'Computer Hardware': 'software', 'Communication Equipment': 'software', 'Scientific & Technical Instruments': 'software',
  'Internet Content & Information': 'internet', 'Internet Retail': 'internet', 'Entertainment': 'internet',
  'Advertising Agencies': 'internet', 'Electronic Gaming & Multimedia': 'internet', 'Broadcasting': 'internet',
  'Publishing': 'internet', 'Travel Services': 'internet', 'Telecom Services': 'internet',
  'Credit Services': 'fintech', 'Financial Data & Stock Exchanges': 'fintech',
  'Banks - Diversified': 'financials', 'Banks - Regional': 'financials', 'Asset Management': 'financials', 'Capital Markets': 'financials',
  'Insurance - Diversified': 'financials', 'Insurance - Life': 'financials', 'Insurance - Property & Casualty': 'financials',
  'Insurance - Specialty': 'financials', 'Insurance Brokers': 'financials', 'Financial Conglomerates': 'financials', 'Mortgage Finance': 'financials',
  'Aerospace & Defense': 'space_defense',
  'Solar': 'clean_energy', 'Utilities - Renewable': 'clean_energy', 'Electrical Equipment & Parts': 'clean_energy',
  'Biotechnology': 'healthcare', 'Drug Manufacturers - General': 'healthcare', 'Drug Manufacturers - Specialty & Generic': 'healthcare',
  'Medical Devices': 'healthcare', 'Medical Instruments & Supplies': 'healthcare', 'Diagnostics & Research': 'healthcare',
  'Healthcare Plans': 'healthcare', 'Health Information Services': 'healthcare', 'Medical Care Facilities': 'healthcare',
  'Gold': 'energy', 'Silver': 'energy', 'Copper': 'energy', 'Steel': 'energy', 'Other Industrial Metals & Mining': 'energy',
  'Specialty Chemicals': 'energy', 'Chemicals': 'energy', 'Uranium': 'energy', 'Coal': 'energy',
  'Footwear & Accessories': 'consumer', 'Apparel Retail': 'consumer', 'Apparel Manufacturing': 'consumer',
  'Home Improvement Retail': 'consumer', 'Specialty Retail': 'consumer', 'Discount Stores': 'consumer',
  'Department Stores': 'consumer', 'Restaurants': 'consumer', 'Luxury Goods': 'consumer', 'Leisure': 'consumer',
  'Gambling': 'consumer', 'Resorts & Casinos': 'consumer', 'Auto Manufacturers': 'consumer', 'Auto Parts': 'consumer',
  'Beverages - Non-Alcoholic': 'consumer', 'Beverages - Brewers': 'consumer', 'Packaged Foods': 'consumer',
  'Household & Personal Products': 'consumer', 'Grocery Stores': 'consumer', 'Auto & Truck Dealerships': 'consumer',
};

// Yahoo sector → theme, when the industry isn't in the table above.
const BY_SECTOR: Record<string, ThemeId> = {
  'Technology': 'software', 'Communication Services': 'internet', 'Consumer Cyclical': 'consumer', 'Consumer Defensive': 'consumer',
  'Financial Services': 'financials', 'Healthcare': 'healthcare', 'Energy': 'energy', 'Basic Materials': 'energy',
  'Utilities': 'energy', 'Industrials': 'industrials', 'Real Estate': 'real_estate',
};

export type AssetKind = 'stock' | 'fund' | 'leveraged' | 'crypto' | 'cash';
export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  stock: 'Stocks', fund: 'Funds & ETFs', leveraged: 'Leveraged & Inverse Funds', crypto: 'Crypto', cash: 'Cash',
};
const ASSET_KIND_ORDER: AssetKind[] = ['stock', 'fund', 'leveraged', 'crypto', 'cash'];

const norm = (ticker: string) => (ticker || '').toUpperCase().trim();
const isCashTicker = (t: string) => t === 'CASH' || t.startsWith('CASH');

export function assetKind(ticker: string, meta: SecurityMeta = {}): AssetKind {
  const t = norm(ticker);
  if (isCashTicker(t)) return 'cash';
  const qt = (meta.quoteType || '').toUpperCase();
  if (qt === 'CRYPTOCURRENCY' || t.endsWith('-USD')) return 'crypto';
  if (LEVERAGED_UNDERLYING[t] || /leveraged|inverse|trading--/i.test(meta.fundCategory || '')) return 'leveraged';
  if (qt === 'ETF' || qt === 'MUTUALFUND' || qt === 'INDEX') return 'fund';
  return 'stock';
}

export type ThemeSource = 'yours' | 'curated' | 'tracks' | 'industry' | 'sector' | 'fund' | 'none';

// The automatic theme (ignoring the user's choice) and why it was picked.
export function autoTheme(ticker: string, meta: SecurityMeta = {}, lookup?: (t: string) => SecurityMeta): { theme: ThemeId; source: ThemeSource } {
  const t = norm(ticker);
  const kind = assetKind(t, meta);
  if (kind === 'cash') return { theme: 'cash', source: 'none' };
  if (CURATED[t]) return { theme: CURATED[t], source: 'curated' };
  if (kind === 'crypto') return { theme: 'crypto', source: 'none' };
  if (kind === 'leveraged') {
    const u = LEVERAGED_UNDERLYING[t];
    if (u && isThemeId(u)) return { theme: u, source: 'tracks' };
    if (u) return { theme: autoTheme(u, lookup?.(u) ?? {}, lookup).theme, source: 'tracks' };
    return { theme: 'index', source: 'fund' };
  }
  if (kind === 'fund') return { theme: 'index', source: 'fund' };
  if (meta.industry && BY_INDUSTRY[meta.industry]) return { theme: BY_INDUSTRY[meta.industry], source: 'industry' };
  if (meta.sector && BY_SECTOR[meta.sector]) return { theme: BY_SECTOR[meta.sector], source: 'sector' };
  return { theme: 'other', source: 'none' };
}

export function themeOf(ticker: string, meta: SecurityMeta = {}, overrides: Record<string, string | null> = {}, lookup?: (t: string) => SecurityMeta) {
  const own = overrides[norm(ticker)];
  if (isThemeId(own)) return { theme: own, source: 'yours' as ThemeSource };
  return autoTheme(ticker, meta, lookup);
}

export function sectorOf(ticker: string, meta: SecurityMeta = {}): string {
  const kind = assetKind(ticker, meta);
  if (kind !== 'stock') return ASSET_KIND_LABEL[kind];
  return meta.sector && meta.sector !== 'Unknown' ? meta.sector : 'Other';
}

export function industryOf(ticker: string, meta: SecurityMeta = {}): string {
  const kind = assetKind(ticker, meta);
  if (kind === 'cash' || kind === 'crypto') return ASSET_KIND_LABEL[kind];
  if (kind !== 'stock') return meta.fundCategory?.replace(/^Trading--/, '') || ASSET_KIND_LABEL[kind];
  return meta.industry && meta.industry !== 'Unknown' ? meta.industry : 'Other';
}

const CAP_BANDS = [
  { min: 200e9, label: 'Mega cap (over US$200B)' },
  { min: 10e9, label: 'Large cap (US$10–200B)' },
  { min: 2e9, label: 'Mid cap (US$2–10B)' },
  { min: 300e6, label: 'Small cap (US$300M–2B)' },
  { min: 0, label: 'Micro cap (under US$300M)' },
];

export function marketCapBand(ticker: string, meta: SecurityMeta, marketCapUsd: number | null | undefined): string {
  const kind = assetKind(ticker, meta);
  if (kind !== 'stock') return ASSET_KIND_LABEL[kind];
  if (!marketCapUsd || marketCapUsd <= 0) return 'Market cap unknown';
  return CAP_BANDS.find(b => marketCapUsd >= b.min)!.label;
}

export type Grouping = 'theme' | 'assetType' | 'sector' | 'industry' | 'marketCap';

// Display order for groups; anything not listed sorts after, by value.
export function groupOrder(grouping: Grouping): string[] {
  if (grouping === 'theme') return THEMES.map(t => t.label);
  if (grouping === 'assetType') return ASSET_KIND_ORDER.map(k => ASSET_KIND_LABEL[k]);
  if (grouping === 'marketCap') return [...CAP_BANDS.map(b => b.label), 'Market cap unknown', ...ASSET_KIND_ORDER.filter(k => k !== 'stock').map(k => ASSET_KIND_LABEL[k])];
  // Sector / industry: by value, with non-stock buckets last.
  return [];
}
export const TRAILING_GROUPS = [...ASSET_KIND_ORDER.filter(k => k !== 'stock').map(k => ASSET_KIND_LABEL[k]), 'Other', 'Market cap unknown'];
