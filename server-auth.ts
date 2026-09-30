// Sign-in is Neon Auth (managed Better Auth, Google via Neon's shared credentials -
// no OAuth app to set up). The browser gets a short-lived EdDSA JWT from Neon Auth
// and sends it as `Authorization: Bearer <jwt>` (or `?token=` for the WebSocket);
// this module verifies it against the project's JWKS and exposes the user.

// Load .env here: modules read the auth settings when they register routes, and
// this may be imported before server.ts gets to its own dotenv.config() call.
import 'dotenv/config';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AuthedUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
}

export const authedUser = (req: Request): AuthedUser => (req as any).authedUser;

const env = (name: string) => (process.env[name] || '').trim();
const authBase = env('NEON_AUTH_BASE_URL');
const jwks = authBase ? createRemoteJWKSet(new URL(`${authBase}/.well-known/jwks.json`)) : null;
const issuer = authBase ? new URL(authBase).origin : '';

export const authEnabled = () => jwks !== null;

function tokenFrom(req: IncomingMessage): string {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  // WebSocket upgrades can't carry headers from the browser.
  return new URL(req.url || '/', 'http://x').searchParams.get('token') || '';
}

// The signed-in user for this request, or null (no token, invalid or expired).
export async function sessionUser(req: IncomingMessage): Promise<AuthedUser | null> {
  const token = tokenFrom(req);
  if (!token || !jwks) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    if (!payload.sub) return null;
    return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : null, emailVerified: payload.emailVerified === true };
  } catch {
    return null;
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  if ((req as any).authedUser) return next(); // already checked by the /api gate
  if (!jwks) return res.status(503).json({ error: 'Sign-in is not configured on this server.' });
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  (req as any).authedUser = user;
  next();
}

// The owner (BOT_OWNER_EMAIL, verified) gets the Trading Bot tab, the Thesis
// Tracker, the server's own AI keys and custom AI endpoints.
export const ownerEmail = () => env('BOT_OWNER_EMAIL').toLowerCase();
export const isOwner = (user: AuthedUser | null | undefined) =>
  !!user && !!ownerEmail() && user.emailVerified && (user.email || '').toLowerCase() === ownerEmail();

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!isOwner(authedUser(req))) return res.status(403).json({ error: 'Only available to the owner of this app.' });
  next();
}
