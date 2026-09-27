// Read-only bridge to the owner's Thesis Tracker (~/Code/ThesisTracker), a daily
// Claude task that grades each holding's investment thesis green / yellow / red
// from news and earnings. It writes plain files, which this server parses on
// request, so the app shows each run's ratings as soon as they're written:
//
// - theses/<TICKER>.md: frontmatter (current_rating, company, ...), the thesis,
//   its pillars, disconfirming signals, rubric and a dated thesis log
// - reports/YYYY-MM-DD.md: a ratings table (rating, change, one-line reason) and a
//   "### TICKER — Company — 🟢" detail section per holding
//
// The files are the owner's private notes, so the routes require a verified
// sign-in as BOT_OWNER_EMAIL (as for the Trading Bot tab).

import type { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { authedUser, createRequireUser } from './server-auth';

export type Rating = 'green' | 'yellow' | 'red';

export interface ThesisDoc {
  ticker: string;
  company: string | null;
  rating: Rating | null;
  draft: boolean;
  created: string | null;
  lastUpdated: string | null;
  oneLine: string | null;
  whyHold: string[];
  pillars: { name: string; text: string }[];
  disconfirming: string[];
  rubric: Partial<Record<Rating, string>>;
  log: { date: string; text: string }[];
}

export interface ReportRow { ticker: string; rating: Rating | null; draft: boolean; change: string | null; reason: string }
export interface ReportDoc { date: string; rows: ReportRow[]; details: Record<string, string>; intro: string | null }

const RATING_EMOJI: Record<string, Rating> = { '🟢': 'green', '🟡': 'yellow', '🔴': 'red' };
const ratingFrom = (s: string): Rating | null => {
  for (const [e, r] of Object.entries(RATING_EMOJI)) if (s.includes(e)) return r;
  const w = s.toLowerCase().match(/\b(green|yellow|red)\b/);
  return w ? (w[1] as Rating) : null;
};

// Minimal frontmatter: `key: value  # comment` lines between the --- markers.
function frontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*?)\s*(?:#.*)?$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: md.slice(m[0].length) };
}

// "## Heading" -> section text.
function sections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^## +/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    out[p.slice(0, nl).trim().toLowerCase()] = p.slice(nl + 1).trim();
  }
  return out;
}
const findSection = (s: Record<string, string>, start: string) => Object.entries(s).find(([k]) => k.startsWith(start))?.[1] ?? '';

// Bulleted or numbered items; continuation lines are joined onto their item.
function items(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const start = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (start) out.push(start[1].trim());
    else if (line.trim() && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}
const unwrap = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

export function parseThesis(ticker: string, md: string): ThesisDoc {
  const { meta, body } = frontmatter(md);
  const s = sections(body);
  const pillars = items(findSection(s, 'thesis pillars')).map(it => {
    const m = it.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.*)$/);
    return m ? { name: m[1], text: m[2] } : { name: '', text: it };
  });
  const rubric: Partial<Record<Rating, string>> = {};
  for (const it of items(findSection(s, '🟢')) .concat(items(findSection(s, 'rubric')))) {
    const m = it.match(/^\*\*\s*(?:🟢|🟡|🔴)?\s*(green|yellow|red)\s*:?\s*\*\*\s*:?\s*(.*)$/i);
    if (m) rubric[m[1].toLowerCase() as Rating] = m[2];
  }
  const log = items(findSection(s, 'thesis log')).map(it => {
    const m = it.match(/^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.*)$/);
    return m ? { date: m[1], text: m[2] } : { date: '', text: it };
  });
  return {
    ticker,
    company: meta.company || null,
    rating: meta.current_rating ? ratingFrom(meta.current_rating) : null,
    draft: log.some(l => /^DRAFT\b/.test(l.text)),
    created: meta.created || null,
    lastUpdated: meta.last_updated || null,
    oneLine: unwrap(findSection(s, 'one-line thesis')) || null,
    whyHold: items(findSection(s, 'why i hold')),
    pillars,
    disconfirming: items(findSection(s, 'disconfirming')),
    rubric,
    log,
  };
}

export function parseReport(date: string, md: string): ReportDoc {
  const rows: ReportRow[] = [];
  const ratings = md.split(/^## +Ratings.*$/m)[1]?.split(/^## /m)[0] ?? '';
  for (const line of ratings.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 4 || /^-+$/.test(cells[0]) || /^ticker$/i.test(cells[0])) continue;
    const ticker = cells[0].replace(/[*_`]/g, '').toUpperCase();
    if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) continue;
    rows.push({
      ticker,
      rating: ratingFrom(cells[2] ?? ''),
      draft: /draft/i.test(cells[2] ?? ''),
      change: cells[3] || null,
      reason: cells[cells.length - 1] ?? '',
    });
  }
  // Per-holding detail: "### TICKER — Company — 🟢 ..." up to the next heading.
  const details: Record<string, string> = {};
  const re = /^### +([A-Z0-9.\-]{1,12})\b[^\n]*\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/gm;
  for (const m of md.matchAll(re)) details[m[1]] = m[2].trim();
  const intro = md.split(/^## /m)[0].split('\n').slice(1).join('\n').trim() || null;
  return { date, rows, details, intro };
}

export interface TrackerHolding {
  ticker: string;
  rating: Rating | null;
  draft: boolean;
  reason: string | null;       // latest report's one-line reason
  change: string | null;       // latest report's Δ (→ ↑ ↓ NEW)
  reportDate: string | null;
  detail: string | null;       // latest report's markdown detail for this ticker
  thesis: ThesisDoc | null;
  history: { date: string; rating: Rating | null; reason: string }[]; // oldest first
}

export interface TrackerSnapshot {
  available: boolean;
  reason?: string;
  latestReport: { date: string; intro: string | null; changes: { ticker: string; from: Rating | null; to: Rating | null; reason: string }[] } | null;
  reportDates: string[];
  holdings: Record<string, TrackerHolding>;
}

export async function loadTracker(dir: string): Promise<TrackerSnapshot> {
  let thesisFiles: string[], reportFiles: string[];
  try {
    thesisFiles = (await fs.readdir(path.join(dir, 'theses'))).filter(f => /^[A-Za-z0-9.\-]+\.md$/.test(f) && !f.startsWith('_'));
    reportFiles = (await fs.readdir(path.join(dir, 'reports'))).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  } catch {
    return { available: false, reason: `No Thesis Tracker found at ${dir}`, latestReport: null, reportDates: [], holdings: {} };
  }

  const theses = new Map<string, ThesisDoc>();
  await Promise.all(thesisFiles.map(async f => {
    const ticker = f.replace(/\.md$/, '').toUpperCase();
    theses.set(ticker, parseThesis(ticker, await fs.readFile(path.join(dir, 'theses', f), 'utf8')));
  }));
  const reports = await Promise.all(reportFiles.map(async f => parseReport(f.slice(0, 10), await fs.readFile(path.join(dir, 'reports', f), 'utf8'))));
  const latest = reports[reports.length - 1] ?? null;
  const previous = reports[reports.length - 2] ?? null;

  const tickers = new Set<string>([...theses.keys(), ...(latest?.rows.map(r => r.ticker) ?? [])]);
  const holdings: Record<string, TrackerHolding> = {};
  for (const ticker of tickers) {
    const row = latest?.rows.find(r => r.ticker === ticker) ?? null;
    const thesis = theses.get(ticker) ?? null;
    holdings[ticker] = {
      ticker,
      // The latest report is the run's verdict; the file's current_rating is the fallback.
      rating: row?.rating ?? thesis?.rating ?? null,
      draft: row?.draft || thesis?.draft || false,
      reason: row?.reason ?? null,
      change: row?.change ?? null,
      reportDate: row ? latest!.date : null,
      detail: latest?.details[ticker] ?? null,
      thesis,
      history: reports.flatMap(r => {
        const x = r.rows.find(rr => rr.ticker === ticker);
        return x ? [{ date: r.date, rating: x.rating, reason: x.reason }] : [];
      }),
    };
  }

  const changes = latest && previous
    ? latest.rows.flatMap(r => {
        const before = previous.rows.find(p => p.ticker === r.ticker)?.rating ?? null;
        return before && r.rating && before !== r.rating ? [{ ticker: r.ticker, from: before, to: r.rating, reason: r.reason }] : [];
      })
    : [];

  return {
    available: true,
    latestReport: latest ? { date: latest.date, intro: latest.intro, changes } : null,
    reportDates: reports.map(r => r.date),
    holdings,
  };
}

export function registerThesisTrackerRoutes(app: Express) {
  const authBase = process.env.NEON_AUTH_BASE_URL;
  const ownerEmail = (process.env.BOT_OWNER_EMAIL || '').trim().toLowerCase();
  const dir = process.env.THESIS_TRACKER_DIR || path.join(os.homedir(), 'Code', 'ThesisTracker');
  if (!authBase || !ownerEmail) {
    app.use('/api/thesis-tracker', (_req, res) => { res.status(503).json({ error: 'Thesis Tracker is not configured (set BOT_OWNER_EMAIL).' }); });
    return;
  }
  const requireUser = createRequireUser(authBase);
  const requireOwner = (req: Request, res: Response, next: NextFunction) => {
    const user = authedUser(req);
    if (!user.emailVerified || (user.email || '').toLowerCase() !== ownerEmail) {
      return res.status(403).json({ error: 'The Thesis Tracker is only available to its owner.' });
    }
    next();
  };

  app.get('/api/thesis-tracker', requireUser, requireOwner, async (_req: Request, res: Response) => {
    try {
      res.json(await loadTracker(dir));
    } catch (err: any) {
      console.error('[thesis-tracker]', err?.message || err);
      res.status(500).json({ error: 'Could not read the Thesis Tracker files' });
    }
  });

  // A full daily report: { date, markdown }.
  app.get('/api/thesis-tracker/reports/:date', requireUser, requireOwner, async (req: Request, res: Response) => {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
    try {
      res.json({ date, markdown: await fs.readFile(path.join(dir, 'reports', `${date}.md`), 'utf8') });
    } catch {
      res.status(404).json({ error: 'No report for that date' });
    }
  });
}
