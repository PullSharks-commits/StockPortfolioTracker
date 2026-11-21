// AI / data-centre build-out exposure: which side of the AI spending boom each holding
// sits on. Pure functions; used by the AI Exposure widget and the holdings table's
// "Group by AI exposure".
//
//   builders  - sell the chips, networking, servers and power the build-out buys
//               (revenue rises and falls with AI capex)
//   spenders  - the hyperscalers paying for it (capex is their cost; cut spending
//               lifts their cash flow, unless it's cut because AI disappointed)
//   adjacent  - software that uses AI rather than builds it (beneficiary or at risk)
//   none      - no meaningful link
//
// Decided in order: curated ticker list, leveraged fund → its underlying (with its
// leverage, for "effective" exposure), Yahoo industry, otherwise none.

import { assetKind, type SecurityMeta } from './classification';

export const AI_BUCKETS = [
  { id: 'builders', label: 'AI build-out · Chips & hardware', short: 'Chips & hardware', color: 'bg-indigo-500', hint: 'Sell what the build-out buys: revenue moves with AI capex.' },
  { id: 'spenders', label: 'AI build-out · Hyperscalers', short: 'Hyperscalers (spenders)', color: 'bg-sky-400', hint: 'Pay for the build-out. A spending slowdown lifts their cash flow if demand holds, but hurts if it slows because AI disappointed.' },
  { id: 'adjacent', label: 'AI-adjacent software', short: 'AI-adjacent software', color: 'bg-amber-400', hint: 'Use AI rather than build it: could benefit or be disrupted.' },
  { id: 'none', label: 'Not AI-exposed', short: 'Not AI-exposed', color: 'bg-zinc-300 dark:bg-zinc-600', hint: 'No meaningful link to AI spending.' },
  { id: 'cash', label: 'Cash', short: 'Cash', color: 'bg-emerald-300', hint: 'Cash.' },
] as const;
export type AiBucket = (typeof AI_BUCKETS)[number]['id'];
export const AI_BUCKET_LABEL = Object.fromEntries(AI_BUCKETS.map(b => [b.id, b.label])) as Record<AiBucket, string>;

const CURATED: Record<string, AiBucket> = {};
const add = (b: AiBucket, ts: string) => ts.split(/\s+/).filter(Boolean).forEach(t => { CURATED[t] = b; });
add('builders', `NVDA AMD AVGO TSM ASML MU MRVL ARM AMAT LRCX KLAC ANET SMCI DELL HPE VRT ETN CEG VST TLN
  CRWV NBIS BRUN EQIX DLR CIEN COHR LITE CRDO ALAB SOXX SMH CLS GEV`);
add('spenders', 'MSFT AMZN GOOGL GOOG META ORCL');
add('adjacent', 'CRM ADBE TEAM NOW PLTR SNOW DDOG MDB PATH U DUOL INTU WDAY SHOP');
// Yahoo calls these software/semis but they aren't on either side of AI spending.
add('none', 'UBER SOFI SRAD COIN BMNR');

// Leveraged / inverse funds: underlying ticker (or bucket) and the multiple.
const LEVERAGED: Record<string, { u: string; x: number }> = {
  SOXL: { u: 'SOXX', x: 3 }, SOXS: { u: 'SOXX', x: -3 }, USD: { u: 'SOXX', x: 2 },
  FBL: { u: 'META', x: 2 }, METU: { u: 'META', x: 2 }, NVDL: { u: 'NVDA', x: 2 }, NVDU: { u: 'NVDA', x: 2 },
  AMZU: { u: 'AMZN', x: 2 }, GGLL: { u: 'GOOGL', x: 2 }, MSFU: { u: 'MSFT', x: 2 }, AMDL: { u: 'AMD', x: 2 }, AVL: { u: 'AVGO', x: 2 },
};

const BY_INDUSTRY: Record<string, AiBucket> = {
  'Semiconductors': 'builders', 'Semiconductor Equipment & Materials': 'builders',
  'Software - Application': 'adjacent', 'Software - Infrastructure': 'adjacent',
};

export function aiExposureOf(ticker: string, meta: SecurityMeta = {}): { bucket: AiBucket; leverage: number } {
  const t = (ticker || '').toUpperCase().trim();
  const kind = assetKind(t, meta);
  if (kind === 'cash') return { bucket: 'cash', leverage: 1 };
  if (CURATED[t]) return { bucket: CURATED[t], leverage: 1 };
  const lev = LEVERAGED[t];
  if (lev) return { bucket: aiExposureOf(lev.u).bucket, leverage: lev.x };
  if (kind !== 'stock') return { bucket: 'none', leverage: 1 };
  if (meta.industry && BY_INDUSTRY[meta.industry]) return { bucket: BY_INDUSTRY[meta.industry], leverage: 1 };
  return { bucket: 'none', leverage: 1 };
}

export interface AiRow { ticker: string; value: number; meta?: SecurityMeta }
export interface AiBucketSummary {
  id: AiBucket; value: number; share: number; effective: number; effectiveShare: number;
  holdings: { ticker: string; value: number; share: number; leverage: number }[];
}

export function aiBreakdown(rows: AiRow[]) {
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
  const map = new Map<AiBucket, AiBucketSummary>();
  for (const b of AI_BUCKETS) map.set(b.id, { id: b.id, value: 0, share: 0, effective: 0, effectiveShare: 0, holdings: [] });
  const merged = new Map<string, AiRow>();
  for (const r of rows) {
    if (!(r.value > 0)) continue;
    const k = r.ticker.toUpperCase();
    const prev = merged.get(k);
    merged.set(k, prev ? { ...prev, value: prev.value + r.value } : { ...r, ticker: k });
  }
  for (const r of merged.values()) {
    const { bucket, leverage } = aiExposureOf(r.ticker, r.meta);
    const s = map.get(bucket)!;
    s.value += r.value;
    s.effective += r.value * leverage;
    s.holdings.push({ ticker: r.ticker, value: r.value, share: total ? r.value / total : 0, leverage });
  }
  const buckets = [...map.values()].map(s => ({
    ...s,
    share: total ? s.value / total : 0,
    effectiveShare: total ? s.effective / total : 0,
    holdings: s.holdings.sort((a, b) => b.value - a.value),
  }));
  const pick = (id: AiBucket) => buckets.find(b => b.id === id)!;
  const buildOut = pick('builders').value + pick('spenders').value;
  const buildOutEff = pick('builders').effective + pick('spenders').effective;
  return { total, buckets, buildOutShare: total ? buildOut / total : 0, buildOutEffectiveShare: total ? buildOutEff / total : 0 };
}
