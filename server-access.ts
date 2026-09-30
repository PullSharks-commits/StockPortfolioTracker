// Invite-only access. Anyone can sign in with Google, but only the owner and the
// email addresses the owner has invited (table `invites`) can use the app; everyone
// else gets 403 { code: 'NOT_INVITED' } from every API route except /api/me.
// The owner manages the list in Settings → Account (/api/invites).

import type { Express, Request, Response, NextFunction } from 'express';
import pg from 'pg';
import { authedUser, isOwner, requireOwner, requireUser, type AuthedUser } from './server-auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalize = (email: string) => email.trim().toLowerCase();

let pool: pg.Pool | null = null;
let cache: { at: number; emails: Set<string> } | null = null;
const CACHE_MS = 60_000;

async function invitedEmails(): Promise<Set<string>> {
  if (!pool) return new Set();
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.emails;
  const { rows } = await pool.query('SELECT email FROM invites');
  cache = { at: Date.now(), emails: new Set(rows.map(r => r.email)) };
  return cache.emails;
}

// Owner always; others only with a verified, invited address.
export async function isAllowed(user: AuthedUser | null | undefined): Promise<boolean> {
  if (!user) return false;
  if (isOwner(user)) return true;
  if (!user.emailVerified || !user.email) return false;
  return (await invitedEmails()).has(normalize(user.email));
}

// Runs after the sign-in check on /api. /api/me stays open so the app can tell an
// uninvited person why they can't get in.
export async function requireInvited(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/me' || req.originalUrl.split('?')[0] === '/api/me') return next();
  try {
    if (await isAllowed(authedUser(req))) return next();
    res.status(403).json({ error: "You haven't been invited to use this app.", code: 'NOT_INVITED' });
  } catch (err: any) {
    console.error('[access] check failed:', err?.message || err);
    res.status(500).json({ error: 'Could not check access' });
  }
}

export function registerAccessRoutes(app: Express) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  pool = new pg.Pool({ connectionString, max: 2 });

  app.get('/api/invites', requireUser, requireOwner, async (_req: Request, res: Response) => {
    const { rows } = await pool!.query('SELECT email, added_at FROM invites ORDER BY added_at DESC');
    res.json(rows.map(r => ({ email: r.email, addedAt: r.added_at.toISOString() })));
  });

  app.post('/api/invites', requireUser, requireOwner, async (req: Request, res: Response) => {
    const email = normalize(String(req.body?.email ?? ''));
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address' });
    await pool!.query('INSERT INTO invites (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
    cache = null;
    res.status(201).json({ email });
  });

  app.delete('/api/invites/:email', requireUser, requireOwner, async (req: Request, res: Response) => {
    await pool!.query('DELETE FROM invites WHERE email = $1', [normalize(String(req.params.email))]);
    cache = null;
    res.status(204).end();
  });
}
