// Proxy to the TradingBot's local dashboard server (positions_dashboard.py), which
// backs the "Trading Bot" portfolio tab.
//
// The bot dashboard has no authentication of its own and binds to localhost, while
// this server listens on every interface and Neon Auth lets any Google account sign
// in. So every route here requires a verified sign-in as BOT_OWNER_EMAIL, and only
// an explicit allow-list of the bot's endpoints is forwarded. Two of them place real
// orders (close-position, run-housekeeping); the UI asks for confirmation first.

import type { Express, Response } from 'express';
import { authEnabled, authedUser, ownerEmail, requireOwner, requireUser } from './server-auth';

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

export function registerBotRoutes(app: Express) {
  const botUrl = (process.env.BOT_DASHBOARD_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');

  if (!authEnabled() || !ownerEmail()) {
    // Without an owner there is no safe way to expose order-placing endpoints.
    app.use('/api/bot', (_req, res) => { res.status(503).json({ error: 'Trading bot tab is not configured (set BOT_OWNER_EMAIL).' }); });
    console.warn('BOT_OWNER_EMAIL not set or sign-in disabled: /api/bot routes disabled.');
    return;
  }

  const forward = async (res: Response, path: string, init: RequestInit & { timeoutMs: number }) => {
    try {
      const upstream = await fetch(`${botUrl}${path}`, { ...init, signal: AbortSignal.timeout(init.timeoutMs) });
      const body = await upstream.text();
      res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(body);
    } catch (err: any) {
      const reason = err?.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
      res.status(502).json({ error: `Trading bot dashboard at ${botUrl} ${reason}. Is positions_dashboard.py running?` });
    }
  };

  const get = (path: string, upstreamPath: string) =>
    app.get(path, requireUser, requireOwner, (_req, res) => forward(res, upstreamPath, { method: 'GET', timeoutMs: 20_000 }));

  get('/api/bot/positions', '/api/positions');
  get('/api/bot/trade-history', '/api/trade-history');
  get('/api/bot/housekeeping-status', '/api/housekeeping-status');
  get('/api/bot/config', '/api/config');

  // Scheduling + connection settings (TradingBot/bot_config.py) - never credentials
  // (Webull's APP_KEY/SECRET stay in their own file; IBKR has none to hold, it
  // authenticates via Gateway's own session - see that file's module docstring for why).
  // The bot re-reads scheduling settings live (no restart); connection settings
  // (region/sandbox/ib_*) apply the next time that process is (re)started.
  // positions_dashboard.py validates/clamps too; this is just a friendlier error
  // before the request goes out.
  const NUMBER_KEYS = ['housekeeping_interval_minutes', 'takeprofit_poll_interval_minutes', 'ib_port', 'ib_client_id'];
  const STRING_KEYS = ['webull_region', 'ib_host'];
  const BOOLEAN_KEYS = ['webull_sandbox'];
  app.post('/api/bot/config', requireUser, requireOwner, (req, res) => {
    const body = req.body ?? {};
    const updates: Record<string, number | string | boolean> = {};
    for (const key of NUMBER_KEYS) {
      if (body[key] === undefined) continue;
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok: false, error: `${key} must be a positive number.` });
      updates[key] = n;
    }
    for (const key of STRING_KEYS) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'string' || !body[key].trim()) return res.status(400).json({ ok: false, error: `${key} must be a non-empty string.` });
      updates[key] = body[key].trim();
    }
    for (const key of BOOLEAN_KEYS) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'boolean') return res.status(400).json({ ok: false, error: `${key} must be true or false.` });
      updates[key] = body[key];
    }
    console.log(`[bot] config update ${JSON.stringify(updates)} requested by ${authedUser(req).email}`);
    return forward(res, '/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      timeoutMs: 10_000,
    });
  });

  // Market-sells the whole position (after cancelling its resting stop).
  app.post('/api/bot/close-position', requireUser, requireOwner, (req, res) => {
    const symbol = String(req.body?.symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ ok: false, error: 'Invalid symbol.' });
    console.log(`[bot] close-position ${symbol} requested by ${authedUser(req).email}`);
    return forward(res, '/api/close-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
      timeoutMs: 90_000,
    });
  });

  // Starts the bot's housekeeping job; poll housekeeping-status for completion.
  app.post('/api/bot/run-housekeeping', requireUser, requireOwner, (req, res) => {
    console.log(`[bot] run-housekeeping requested by ${authedUser(req).email}`);
    return forward(res, '/api/run-housekeeping', { method: 'POST', timeoutMs: 20_000 });
  });
}
