// The signed-in user's account: who they are (and whether they're the owner, which
// unlocks the Trading Bot tab and Thesis Tracker), and deleting the account with all
// of its data.

import type { Express, Request, Response } from 'express';
import pg from 'pg';
import { authEnabled, authedUser, isOwner, requireUser } from './server-auth';

// Every per-user table (transactions also cascade from holdings).
const USER_TABLES = ['transactions', 'holdings', 'alerts', 'analyses', 'settings', 'backups'];

export function registerAccountRoutes(app: Express) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !authEnabled()) return;
  const pool = new pg.Pool({ connectionString, max: 2 });

  app.get('/api/me', requireUser, async (req: Request, res: Response) => {
    const user = authedUser(req);
    try {
      const [profile, accounts] = await Promise.all([
        pool.query('SELECT name, image FROM neon_auth."user" WHERE id::text = $1', [user.id]),
        pool.query('SELECT "providerId" FROM neon_auth.account WHERE "userId"::text = $1', [user.id]),
      ]);
      res.json({
        id: user.id,
        email: user.email,
        name: profile.rows[0]?.name ?? null,
        image: profile.rows[0]?.image ?? null,
        providers: accounts.rows.map(r => r.providerId),
        isOwner: isOwner(user),
      });
    } catch (err: any) {
      console.error('[account] me:', err?.message || err);
      res.status(500).json({ error: 'Could not load your account' });
    }
  });

  // Deletes the user's data and their Neon Auth user (sessions and Google link
  // cascade). The browser signs out right after.
  app.delete('/api/me', requireUser, async (req: Request, res: Response) => {
    const user = authedUser(req);
    if (isOwner(user)) return res.status(403).json({ error: "The owner's account can't be deleted from the app." });
    if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'Confirmation missing' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of USER_TABLES) await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [user.id]);
      await client.query('DELETE FROM neon_auth."user" WHERE id::text = $1', [user.id]);
      await client.query('COMMIT');
      console.log(`[account] deleted user ${user.id}`);
      res.status(204).end();
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[account] delete failed:', err?.message || err);
      res.status(500).json({ error: 'Could not delete the account' });
    } finally {
      client.release();
    }
  });
}
