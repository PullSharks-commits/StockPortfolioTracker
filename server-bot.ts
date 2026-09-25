// Proxy to the TradingBot's local dashboard server (positions_dashboard.py), which
// backs the "Trading Bot" portfolio tab.
//
// The bot dashboard has no authentication of its own and binds to localhost, while
// this server listens on every interface and Neon Auth lets any Google account sign
// in. So every route here requires a verified sign-in as BOT_OWNER_EMAIL, and only
// an explicit allow-list of the bot's endpoints is forwarded. Two of them place real
// orders (close-position, run-housekeeping); the UI asks for confirmation first.

import type { Express, Request, Response, NextFunction } from 'express';
import { authedUser, createRequireUser } from './server-auth';

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

export function registerBotRoutes(app: Express) {
  const authBase = process.env.NEON_AUTH_BASE_URL;
  const ownerEmail = (process.env.BOT_OWNER_EMAIL || '').trim().toLowerCase();
  const botUrl = (process.env.BOT_DASHBOARD_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');

  if (!authBase || !ownerEmail) {
    // Without an owner there is no safe way to expose order-placing endpoints.
    app.use('/api/bot', (_req, res) => { res.status(503).json({ error: 'Trading bot tab is not configured (set BOT_OWNER_EMAIL).' }); });
    console.warn('BOT_OWNER_EMAIL / NEON_AUTH_BASE_URL not set: /api/bot routes disabled.');
    return;
  }

  const requireUser = createRequireUser(authBase);
  const requireOwner = (req: Request, res: Response, next: NextFunction) => {
    const user = authedUser(req);
    if (!user.emailVerified || (user.email || '').toLowerCase() !== ownerEmail) {
      return res.status(403).json({ error: 'The trading bot is only available to its owner.' });
    }
    next();
  };

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
