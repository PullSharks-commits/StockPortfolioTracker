// Saved AI analyses ("Saved Notes"), per user in Neon Postgres (table analyses).
// Same routes and row shape the client has always used: { id, ticker, result,
// sentiment, date }. Portfolio-wide notes are stored without a ticker; the client
// calls them "portfolio" both when saving and when listing (`?ticker=portfolio`).

import type { Express, Request, Response } from 'express';
import pg from 'pg';
import { authedUser, requireUser } from './server-auth';

export function registerAnalysesRoutes(app: Express) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const pool = new pg.Pool({ connectionString, max: 3 });
  const columns = 'id, ticker, result, sentiment, date';

  app.get('/api/analyses', requireUser, async (req: Request, res: Response) => {
    const userId = authedUser(req).id;
    const ticker = typeof req.query.ticker === 'string' ? req.query.ticker : '';
    try {
      const { rows } = ticker === 'portfolio'
        ? await pool.query(`SELECT ${columns} FROM analyses WHERE user_id = $1 AND (ticker IS NULL OR ticker IN ('', 'portfolio')) ORDER BY date DESC`, [userId])
        : ticker
          ? await pool.query(`SELECT ${columns} FROM analyses WHERE user_id = $1 AND ticker = $2 ORDER BY date DESC`, [userId, ticker])
          : await pool.query(`SELECT ${columns} FROM analyses WHERE user_id = $1 ORDER BY date DESC`, [userId]);
      res.json(rows.map(r => ({ ...r, id: Number(r.id), date: r.date.toISOString() })));
    } catch (err: any) {
      console.error('[analyses] list:', err?.message || err);
      res.status(500).json({ error: 'Failed to fetch analyses' });
    }
  });

  app.post('/api/analyses', requireUser, async (req: Request, res: Response) => {
    const { ticker, result, sentiment } = req.body ?? {};
    if (!result || typeof result !== 'string') return res.status(400).json({ error: 'Missing required fields' });
    try {
      const { rows } = await pool.query(
        'INSERT INTO analyses (user_id, ticker, result, sentiment) VALUES ($1, $2, $3, $4) RETURNING id',
        [authedUser(req).id, ticker && ticker !== 'portfolio' ? ticker : null, result.slice(0, 200_000), sentiment || null]
      );
      res.json({ id: Number(rows[0].id), success: true });
    } catch (err: any) {
      console.error('[analyses] save:', err?.message || err);
      res.status(500).json({ error: 'Failed to save analysis' });
    }
  });

  app.delete('/api/analyses/:id', requireUser, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
      await pool.query('DELETE FROM analyses WHERE id = $1 AND user_id = $2', [id, authedUser(req).id]);
      res.json({ success: true });
    } catch (err: any) {
      console.error('[analyses] delete:', err?.message || err);
      res.status(500).json({ error: 'Failed to delete analysis' });
    }
  });
}
