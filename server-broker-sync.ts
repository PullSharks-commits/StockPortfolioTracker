// "Sync with broker" for the Global tab: one button per broker (Schwab, IBKR,
// Webull). A sync fetches the broker's real positions and USD cash, diffs them
// against the owner's Global holdings (src/lib/brokerSync.ts) and returns the
// changes as a preview. Nothing is written until the owner approves the preview;
// applying it records ordinary buy/sell adjustment transactions so the ledger keeps
// adding up.
//
// Where each broker's data comes from (all read-only):
// - IBKR and Webull: TradingBot/broker_holdings.py, run with the TradingBot venv.
//   IBKR goes through the local IB Gateway; Webull through its OpenAPI SDK.
// - Schwab: Truthifi's MCP server (https://api.truthifi.com/mcp), which aggregates
//   the Schwab account. This server signs in to it once with OAuth (dynamic client
//   registration + PKCE, offline_access for a refresh token); the tokens live in
//   .truthifi-oauth.json next to this file (gitignored, mode 600).
//
// The trading bot's positions also sit in the Webull account but belong on the
// Trading Bot tab, so a Webull sync subtracts them (from the bot dashboard) and
// leaves Webull's cash alone: that cash is the bot's sleeve.
//
// Owner only, like the Trading Bot tab.

import type { Express, Request, Response } from 'express';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import YahooFinance from 'yahoo-finance2';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { authedUser, requireOwner, requireUser } from './server-auth';
import {
  SYNC_BROKERS, avgAfterBuy, brokersKey, computeChanges,
  type BrokerSnapshot, type SyncBroker, type SyncChange, type SyncHolding,
} from './src/lib/brokerSync';

const TRUTHIFI_MCP_URL = process.env.TRUTHIFI_MCP_URL || 'https://api.truthifi.com/mcp';
const OAUTH_FILE = path.resolve(process.cwd(), '.truthifi-oauth.json');
const TRADINGBOT_DIR = process.env.TRADINGBOT_DIR || path.join(homedir(), 'Code', 'TradingBot');
const PREVIEW_TTL_MS = 30 * 60_000;
const STATE_TTL_MS = 15 * 60_000;

class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

// --- Truthifi OAuth -----------------------------------------------------------

interface OAuthStore {
  redirectUrl?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  stateCreatedAt?: number;
}

function loadStore(): OAuthStore {
  try { return JSON.parse(readFileSync(OAUTH_FILE, 'utf8')); } catch { return {}; }
}
function saveStore(s: OAuthStore) {
  writeFileSync(OAUTH_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  chmodSync(OAUTH_FILE, 0o600);
}
const patchStore = (p: Partial<OAuthStore>) => saveStore({ ...loadStore(), ...p });

// Interactive = started by the owner's Connect click, so a sign-in redirect is
// expected; otherwise (a sync) a needed redirect means "reconnect".
class TruthifiAuth implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  constructor(private redirect: string | undefined, private interactive: boolean) {}
  get redirectUrl() { return this.redirect ?? loadStore().redirectUrl; }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Stock Portfolio Tracker',
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'offline_access',
    };
  }
  state() {
    const state = randomBytes(24).toString('base64url');
    patchStore({ state, stateCreatedAt: Date.now() });
    return state;
  }
  clientInformation() { return loadStore().clientInformation; }
  saveClientInformation(info: OAuthClientInformationMixed) { patchStore({ clientInformation: info }); }
  tokens() { return loadStore().tokens; }
  saveTokens(tokens: OAuthTokens) { patchStore({ tokens }); }
  redirectToAuthorization(url: URL) {
    if (!this.interactive) throw new HttpError(409, 'Truthifi sign-in has expired. Click Connect Truthifi to sign in again.', { needsConnect: true });
    this.authorizationUrl = url;
  }
  saveCodeVerifier(v: string) { patchStore({ codeVerifier: v }); }
  codeVerifier() {
    const v = loadStore().codeVerifier;
    if (!v) throw new Error('No PKCE verifier saved');
    return v;
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier') {
    const s = loadStore();
    if (scope === 'all' || scope === 'client') delete s.clientInformation;
    if (scope === 'all' || scope === 'tokens') delete s.tokens;
    if (scope === 'all' || scope === 'verifier') delete s.codeVerifier;
    saveStore(s);
  }
}

// The callback URL is this app's own origin, as the owner's browser sees it.
const ORIGIN_RE = /^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/i;

const toolOutput = (r: any) => {
  if (r?.isError) throw new Error(`Truthifi: ${r.content?.map((c: any) => c.text).join(' ') || 'tool error'}`);
  if (r?.structuredContent?.output) return r.structuredContent.output as any[];
  const text = r?.content?.find((c: any) => c.type === 'text')?.text;
  return (text ? JSON.parse(text).output : []) as any[];
};

const CASH_TYPES = new Set(['currency', 'sweep_account']);
const STOCK_TYPES = new Set(['equity', 'etf', 'etn', 'preferred_stock', 'unit', 'unknown']);
const CONTEXT = 'Keeping a personal portfolio tracker in sync with the brokerage account.';

async function fetchSchwab(): Promise<BrokerSnapshot> {
  const store = loadStore();
  if (!store.tokens) throw new HttpError(409, 'Truthifi is not connected yet.', { needsConnect: true });
  const transport = new StreamableHTTPClientTransport(new URL(TRUTHIFI_MCP_URL), { authProvider: new TruthifiAuth(undefined, false) });
  const client = new Client({ name: 'stock-portfolio-tracker', version: '1.0.0' });
  try {
    await client.connect(transport);
    const accounts = toolOutput(await client.callTool({
      name: 'get_accounts',
      arguments: { include: ['accountId', 'providerName', 'type'], context: CONTEXT },
    }));
    const schwab = accounts.filter(a => /schwab/i.test(a.providerName ?? ''));
    if (!schwab.length) throw new HttpError(502, 'No Charles Schwab account is linked in Truthifi.');
    const rows = toolOutput(await client.callTool({
      name: 'get_dated_holdings',
      arguments: {
        accountIds: schwab.map(a => a.accountId),
        include: ['accountId', 'symbol', 'quantity', 'securityType', 'price', 'costBasis', 'date'],
        context: CONTEXT,
      },
    }));
    const notes: string[] = [];
    let cash = 0;
    const positions: BrokerSnapshot['positions'] = [];
    let asOf: string | null = null;
    for (const r of rows) {
      if (r.date && (!asOf || r.date > asOf)) asOf = r.date;
      const qty = Number(r.quantity) || 0;
      if (CASH_TYPES.has(r.securityType) || /^CUR:USD$/i.test(r.symbol ?? '')) { cash += qty * (Number(r.price) || 1); continue; }
      if (!r.symbol || !STOCK_TYPES.has(r.securityType ?? 'unknown')) {
        if (qty) notes.push(`Skipped ${r.symbol ?? 'unnamed holding'} (${r.securityType ?? 'unknown type'}).`);
        continue;
      }
      positions.push({
        ticker: String(r.symbol).toUpperCase(),
        qty,
        avgCost: r.costBasis != null && qty ? Number(r.costBasis) / qty : null,
        lastPrice: r.price != null ? Number(r.price) : null,
      });
    }
    notes.unshift(`Schwab data comes from Truthifi, as of ${asOf ?? 'an unknown date'}. It can lag the broker by a day or two, so anything traded since then won't show yet.`);
    return { broker: 'Schwab', asOf, cashUsd: Math.round(cash * 100) / 100, positions, notes };
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    if (err?.name === 'UnauthorizedError' || /unauthori[sz]ed|invalid_grant/i.test(err?.message ?? '')) {
      throw new HttpError(409, 'Truthifi sign-in has expired. Click Connect Truthifi to sign in again.', { needsConnect: true });
    }
    throw new HttpError(502, `Couldn't read Schwab from Truthifi: ${err?.message ?? err}`);
  } finally {
    await client.close().catch(() => {});
  }
}

// --- IBKR / Webull via TradingBot ---------------------------------------------

function runBrokerScript(broker: 'ibkr' | 'webull'): Promise<any> {
  const python = path.join(TRADINGBOT_DIR, 'myenv', 'bin', 'python3');
  const script = path.join(TRADINGBOT_DIR, 'broker_holdings.py');
  if (!existsSync(python) || !existsSync(script)) {
    return Promise.reject(new HttpError(500, `TradingBot not found at ${TRADINGBOT_DIR} (set TRADINGBOT_DIR).`));
  }
  return new Promise((resolve, reject) => {
    execFile(python, [script, '--broker', broker], { cwd: TRADINGBOT_DIR, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      let out: any = null;
      try { out = JSON.parse(stdout.trim().split('\n').pop() || 'null'); } catch { /* handled below */ }
      if (out?.error) return reject(new HttpError(502, out.error));
      if (err || !out) return reject(new HttpError(502, `broker_holdings.py --broker ${broker} failed: ${err?.message ?? 'no output'}`));
      resolve(out);
    });
  });
}

const toPositions = (rows: any[]) => rows.map(p => ({
  ticker: String(p.ticker),
  qty: Number(p.qty) || 0,
  avgCost: p.avg_cost ?? null,
  lastPrice: p.last_price ?? null,
}));

async function fetchIbkr(): Promise<BrokerSnapshot> {
  const out = await runBrokerScript('ibkr');
  const notes = (out.skipped ?? []).map((s: any) => `Skipped ${s.ticker} (${s.reason}).`);
  const nonUsd = (out.positions ?? []).filter((p: any) => p.currency && p.currency !== 'USD');
  if (nonUsd.length) notes.push(`Not in USD: ${nonUsd.map((p: any) => `${p.ticker} (${p.currency})`).join(', ')}; their prices are in that currency.`);
  return { broker: 'IBKR', asOf: out.as_of ?? null, cashUsd: out.cash_usd ?? null, positions: toPositions(out.positions ?? []), notes };
}

async function fetchWebull(): Promise<BrokerSnapshot> {
  const botUrl = (process.env.BOT_DASHBOARD_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  // The bot's positions first: without them a sync would pull the bot's trades
  // into the Global tab.
  let bot: { symbol: string; qty: number }[];
  try {
    const r = await fetch(`${botUrl}/api/positions`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    bot = ((await r.json()).positions ?? []).map((p: any) => ({ symbol: String(p.symbol).toUpperCase(), qty: Number(p.qty) || 0 }));
  } catch (err: any) {
    throw new HttpError(502, `Can't tell which Webull positions are the trading bot's: its dashboard at ${botUrl} didn't answer (${err?.message ?? err}).`);
  }
  const out = await runBrokerScript('webull');
  const botQty = new Map<string, number>();
  for (const b of bot) botQty.set(b.symbol, (botQty.get(b.symbol) ?? 0) + b.qty);
  const positions = toPositions(out.positions ?? []).map(p => {
    const less = botQty.get(p.ticker.toUpperCase()) ?? 0;
    return { ...p, qty: Math.max(0, p.qty - less) };
  });
  const notes = (out.skipped ?? []).map((s: any) => `Skipped ${s.ticker} (${s.reason}).`);
  if (bot.length) notes.unshift(`Left out the trading bot's positions (${bot.map(b => `${b.symbol} ${b.qty}`).join(', ')}); they're on the Trading Bot tab.`);
  notes.push(`Webull's cash ($${Number(out.cash_usd ?? 0).toFixed(2)}) belongs to the trading bot, so it isn't synced here.`);
  return { broker: 'Webull', asOf: out.as_of ?? null, cashUsd: null, positions, notes };
}

// --- Routes ---------------------------------------------------------------------

interface Preview { userId: string; broker: SyncBroker; changes: SyncChange[]; expires: number }

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] } as any);

export function registerBrokerSyncRoutes(app: Express) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    app.use('/api/broker-sync', (_req, res) => { res.status(503).json({ error: 'Broker sync needs DATABASE_URL.' }); });
    return;
  }
  const pool = new pg.Pool({ connectionString, max: 2 });
  pool.on('error', (err) => console.error('Broker sync pool error:', err));

  const previews = new Map<string, Preview>();
  const running = new Set<SyncBroker>();

  const handle = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (err: any) {
      if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
      console.error('[broker-sync]', err);
      res.status(500).json({ error: err?.message ?? 'Broker sync failed' });
    }
  };

  const loadGlobal = async (db: pg.Pool | pg.PoolClient, userId: string, lock = false): Promise<SyncHolding[]> => {
    const { rows } = await db.query(
      `SELECT id, ticker, shares, avg_price, brokers FROM holdings WHERE user_id = $1 AND portfolio_type = 'global'${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    return rows.map(r => ({ id: r.id, ticker: r.ticker, shares: Number(r.shares), avg_price: Number(r.avg_price), brokers: r.brokers }));
  };

  app.get('/api/broker-sync/status', requireUser, requireOwner, (_req, res) => {
    const s = loadStore();
    res.json({ truthifiConnected: !!s.tokens, brokers: SYNC_BROKERS });
  });

  // Fetch one broker and diff it. Read-only; returns a preview id to apply.
  app.post('/api/broker-sync/:broker/preview', requireUser, requireOwner, handle(async (req, res) => {
    const broker = SYNC_BROKERS.find(b => b.toLowerCase() === String(req.params.broker).toLowerCase());
    if (!broker) throw new HttpError(404, 'Unknown broker');
    if (running.has(broker)) throw new HttpError(429, `A ${broker} sync is already running.`);
    running.add(broker);
    try {
      const snap = broker === 'Schwab' ? await fetchSchwab() : broker === 'IBKR' ? await fetchIbkr() : await fetchWebull();
      const userId = authedUser(req).id;
      const changes = computeChanges(await loadGlobal(pool, userId), snap);
      // A position the broker no longer reports (sold out) comes with no broker
      // price, and the diff falls back to the app's average cost, which would
      // record the sale at break-even. Price those at the market instead; the
      // owner can still type the actual fill before applying.
      const unpriced = changes.filter(c => c.kind === 'sell' && c.priceSource.startsWith('app avg cost'));
      if (unpriced.length) {
        try {
          const quotes: any = await yahoo.quote(unpriced.map(c => c.ticker), {}, { validateResult: false });
          const bySym = new Map<string, number>((Array.isArray(quotes) ? quotes : [quotes])
            .filter((q: any) => q?.symbol && q.regularMarketPrice > 0)
            .map((q: any) => [String(q.symbol).toUpperCase(), Number(q.regularMarketPrice)]));
          for (const c of unpriced) {
            const px = bySym.get(c.ticker.toUpperCase());
            if (px) { c.txPrice = px; c.priceSource = 'market price (check your actual fill)'; }
            else { c.txPrice = null; c.priceSource = 'unknown: enter your actual fill'; }
          }
        } catch {
          for (const c of unpriced) { c.txPrice = null; c.priceSource = 'unknown: enter your actual fill'; }
        }
      }
      const now = Date.now();
      for (const [id, p] of previews) if (p.expires < now) previews.delete(id);
      const previewId = randomUUID();
      previews.set(previewId, { userId, broker, changes, expires: now + PREVIEW_TTL_MS });
      console.log(`[broker-sync] ${broker} preview: ${changes.length} change(s)`);
      res.json({
        previewId, broker, asOf: snap.asOf, notes: snap.notes, changes,
        brokerCash: snap.cashUsd, brokerPositions: snap.positions.filter(p => p.qty > 0).length,
      });
    } finally {
      running.delete(broker);
    }
  }));

  // Apply the approved rows of a preview. Body: { previewId, date?: 'YYYY-MM-DD',
  // items: [{ key, price? }] }. Refuses if any affected holding changed since.
  app.post('/api/broker-sync/apply', requireUser, requireOwner, handle(async (req, res) => {
    const userId = authedUser(req).id;
    const { previewId, items, date } = req.body ?? {};
    const preview = previews.get(String(previewId));
    if (!preview || preview.userId !== userId || preview.expires < Date.now()) throw new HttpError(410, 'This preview has expired. Sync again.');
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Nothing selected.');

    const day = date ? String(date) : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, 'Invalid date.');
    const txDate = new Date(`${day}T16:00:00-05:00`).toISOString(); // US close
    if (Date.parse(day) > Date.now() + 86_400_000) throw new HttpError(400, 'Date is in the future.');

    const byKey = new Map(preview.changes.map(c => [c.key, c]));
    const chosen = items.map((it: any) => {
      const c = byKey.get(String(it?.key));
      if (!c) throw new HttpError(400, `Unknown change ${it?.key}`);
      let price = c.txPrice;
      if (it.price !== undefined && c.kind !== 'cash' && c.kind !== 'split-only') {
        price = Number(it.price);
        if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, `Invalid price for ${c.ticker}`);
      }
      if (c.txType && c.kind !== 'cash' && !(price && price > 0)) throw new HttpError(400, `Enter a price for ${c.ticker}`);
      return { c, price: price ?? 0 };
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = new Map((await loadGlobal(client, userId, true)).map(h => [h.id, h]));
      const holdingsNow = [...current.values()];
      let nextOrder: number | null = null;

      for (const { c, price } of chosen) {
        if (c.holdingId) {
          const h = current.get(c.holdingId);
          if (!h || Math.abs(h.shares - c.sharesBefore) > 1e-6 || brokersKey(h.brokers) !== brokersKey(c.brokersBefore)) {
            throw new HttpError(409, `${c.ticker} changed since this sync was fetched. Sync again.`);
          }
        } else if (holdingsNow.some(h => h.ticker.toUpperCase() === c.ticker.toUpperCase())) {
          throw new HttpError(409, `${c.ticker} was added since this sync was fetched. Sync again.`);
        }

        let holdingId = c.holdingId;
        if (!holdingId) {
          if (nextOrder === null) {
            const { rows } = await client.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM holdings WHERE user_id = $1 AND portfolio_type = 'global'`, [userId]);
            nextOrder = Number(rows[0].n);
          }
          const isCash = c.kind === 'cash';
          const { rows } = await client.query(
            `INSERT INTO holdings (user_id, ticker, shares, avg_price, avg_price_currency, portfolio_type, sort_order, brokers)
             VALUES ($1, $2, $3, $4, 'USD', 'global', $5, $6) RETURNING id`,
            [userId, c.ticker, c.sharesAfter, isCash ? 1 : price, nextOrder++, JSON.stringify(c.brokersAfter)],
          );
          holdingId = rows[0].id;
        } else {
          const avg = c.txType === 'buy' && c.kind !== 'cash'
            ? avgAfterBuy(c.sharesBefore, c.avgPriceBefore, c.txShares, price)
            : c.avgPriceBefore;
          await client.query(
            `UPDATE holdings SET shares = $1, avg_price = $2, brokers = $3, updated_at = now() WHERE id = $4 AND user_id = $5`,
            [c.sharesAfter, avg, Object.keys(c.brokersAfter).length ? JSON.stringify(c.brokersAfter) : null, holdingId, userId],
          );
        }
        if (c.txType && c.txShares > 0) {
          await client.query(
            `INSERT INTO transactions (user_id, holding_id, type, shares, price, date) VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, holdingId, c.txType, c.txShares, c.kind === 'cash' ? 1 : price, txDate],
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    previews.delete(String(previewId));
    console.log(`[broker-sync] ${preview.broker} applied ${chosen.length} change(s): ${chosen.map(x => x.c.ticker).join(', ')}`);
    res.json({ ok: true, applied: chosen.length });
  }));

  // Start Truthifi sign-in. Body: { origin } (window.location.origin). Returns the
  // URL to send the browser to.
  app.post('/api/broker-sync/schwab/connect', requireUser, requireOwner, handle(async (req, res) => {
    const origin = String(req.body?.origin ?? '').replace(/\/+$/, '');
    if (!ORIGIN_RE.test(origin)) throw new HttpError(400, 'Invalid origin');
    const redirectUrl = `${origin}/api/broker-sync/schwab/callback`;
    const store = loadStore();
    // A different callback URL needs a new client registration.
    if (store.redirectUrl !== redirectUrl) saveStore({ redirectUrl });
    const provider = new TruthifiAuth(redirectUrl, true);
    const result = await auth(provider, { serverUrl: TRUTHIFI_MCP_URL, scope: 'offline_access' });
    if (result === 'AUTHORIZED') { res.json({ connected: true }); return; }
    if (!provider.authorizationUrl) throw new HttpError(502, 'Truthifi did not return a sign-in URL.');
    res.json({ authorizationUrl: provider.authorizationUrl.toString() });
  }));

  // Truthifi redirects the browser here. It's a plain navigation (no bearer
  // token), so this route is public; the one-time `state` ties it to a Connect
  // click by the owner.
  app.get('/api/broker-sync/schwab/callback', async (req, res) => {
    const done = (status: string) => res.redirect(`/?brokerSync=${encodeURIComponent(status)}`);
    try {
      const store = loadStore();
      const { code, state, error } = req.query as Record<string, string | undefined>;
      if (error) return done(`schwab-error:${error}`);
      if (!code || !state || !store.state || state !== store.state || Date.now() - (store.stateCreatedAt ?? 0) > STATE_TTL_MS) {
        return done('schwab-error:invalid_state');
      }
      patchStore({ state: undefined, stateCreatedAt: undefined });
      const result = await auth(new TruthifiAuth(store.redirectUrl, false), { serverUrl: TRUTHIFI_MCP_URL, authorizationCode: code });
      patchStore({ codeVerifier: undefined });
      console.log(`[broker-sync] Truthifi connect: ${result}`);
      return done(result === 'AUTHORIZED' ? 'schwab-connected' : 'schwab-error:not_authorized');
    } catch (err: any) {
      console.error('[broker-sync] Truthifi callback failed:', err?.message ?? err);
      return done('schwab-error:exchange_failed');
    }
  });

  app.post('/api/broker-sync/schwab/disconnect', requireUser, requireOwner, (_req, res) => {
    try { unlinkSync(OAUTH_FILE); } catch { /* already gone */ }
    res.json({ ok: true });
  });
}
