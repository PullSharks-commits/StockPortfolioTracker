// Express middleware that verifies a Neon Auth JWT (Authorization: Bearer <jwt>)
// against the project's JWKS and exposes the signed-in user on the request.

import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AuthedUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
}

export const authedUser = (req: Request): AuthedUser => (req as any).authedUser;

export function createRequireUser(authBase: string) {
  const jwks = createRemoteJWKSet(new URL(`${authBase}/.well-known/jwks.json`));
  const issuer = new URL(authBase).origin;

  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });
      if (!payload.sub) throw new Error('Token has no subject');
      const user: AuthedUser = {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        emailVerified: payload.emailVerified === true,
      };
      (req as any).authedUser = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}
