// Authenticated per-user data API backed by Neon Postgres.
//
// The client (src/backend.ts) speaks in Firestore-style "collections" and
// "documents". Each collection maps onto a table, and every query is scoped to the
// Neon Auth user in the bearer JWT; that scoping replaces firestore.rules.
//
// Two kinds of collection:
// - row collections (holdings, transactions, alerts): many typed rows per user,
//   keyed by a uuid `id`, with a fixed field -> column mapping.
// - document collections (settings, backups): one JSON document per user, keyed by
//   the user id, stored whole in a `data` jsonb column.

import type { Express, Request, Response, NextFunction } from 'express';
import pg from 'pg';
import { createRemoteJWKSet, jwtVerify } from 'jose';

type FieldKind = 'text' | 'number' | 'boolean' | 'timestamp' | 'uuid';

interface RowCollection {
  kind: 'rows';
  table: string;
  // client field name -> [column, kind]
  fields: Record<string, [string, FieldKind]>;
  // Server-maintained timestamps, exposed to the client as these field names.
  updatedField?: [string, string];
  createdField?: [string, string];
}

interface DocCollection {
  kind: 'doc';
  table: string;
  updatedColumn: string;
}

type CollectionDef = RowCollection | DocCollection;

const COLLECTIONS: Record<string, CollectionDef> = {
  holdings: {
    kind: 'rows',
    table: 'holdings',
    fields: {
      ticker: ['ticker', 'text'],
      shares: ['shares', 'number'],
      avg_price: ['avg_price', 'number'],
      avgPriceCurrency: ['avg_price_currency', 'text'],
      portfolioType: ['portfolio_type', 'text'],
      order: ['sort_order', 'number'],
    },
    updatedField: ['updatedAt', 'updated_at'],
  },
  transactions: {
    kind: 'rows',
    table: 'transactions',
    fields: {
      holdingId: ['holding_id', 'uuid'],
      type: ['type', 'text'],
      shares: ['shares', 'number'],
      price: ['price', 'number'],
      date: ['date', 'timestamp'],
      lotId: ['lot_id', 'text'],
    },
    createdField: ['createdAt', 'created_at'],
  },
  alerts: {
    kind: 'rows',
    table: 'alerts',
    fields: {
      ticker: ['ticker', 'text'],
      condition: ['condition', 'text'],
      targetPrice: ['target_price', 'number'],
      isTriggered: ['is_triggered', 'boolean'],
    },
    createdField: ['createdAt', 'created_at'],
  },
  settings: { kind: 'doc', table: 'settings', updatedColumn: 'updated_at' },
  backups: { kind: 'doc', table: 'backups', updatedColumn: 'created_at' },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function encode(kind: FieldKind, value: unknown) {
  if (value === undefined || value === null) return null;
  if (kind === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new HttpError(400, `Invalid number: ${value}`);
    return n;
  }
  if (kind === 'boolean') return value === true || value === 'true';
  if (kind === 'uuid' && !UUID_RE.test(String(value))) throw new HttpError(400, `Invalid id: ${value}`);
  return value;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);

function rowToDoc(def: RowCollection, row: any) {
  const data: Record<string, unknown> = { userId: row.user_id };
  for (const [field, [column]] of Object.entries(def.fields)) data[field] = iso(row[column]);
  for (const f of [def.updatedField, def.createdField]) if (f) data[f[0]] = iso(row[f[1]]);
  return { id: row.id, data };
}

function docRowToDoc(row: any) {
  return { id: row.user_id, data: { ...row.data, userId: row.user_id } };
}

// Picks the known fields out of a client payload. Unknown fields, userId (always
// taken from the token) and server-maintained timestamps are ignored.
function columnsFrom(def: RowCollection, body: Record<string, unknown>) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [field, [column, kind]] of Object.entries(def.fields)) {
    if (field in body) {
      cols.push(column);
      vals.push(encode(kind, body[field]));
    }
  }
  return { cols, vals };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Firestore `setDoc(..., { merge: true })` semantics: nested maps merge, anything
// else (including arrays) replaces.
function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  }
  return out;
}

function stripUserId(body: unknown) {
  if (!isPlainObject(body)) throw new HttpError(400, 'Document must be an object');
  const { userId: _ignored, ...rest } = body;
  return rest;
}

function getDef(req: Request) {
  const def = COLLECTIONS[req.params.collection];
  if (!def) throw new HttpError(404, `Unknown collection: ${req.params.collection}`);
  return def;
}

function checkDocId(def: CollectionDef, id: string, userId: string) {
  if (def.kind === 'doc' && id !== userId) throw new HttpError(403, 'Forbidden');
  if (def.kind === 'rows' && !UUID_RE.test(id)) throw new HttpError(404, 'Not found');
}

export function registerDataRoutes(app: Express) {
  const connectionString = process.env.DATABASE_URL;
  const authBase = process.env.NEON_AUTH_BASE_URL;
  if (!connectionString || !authBase) {
    console.warn('DATABASE_URL / NEON_AUTH_BASE_URL not set: /api/data routes disabled.');
    return;
  }

  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on('error', (err) => console.error('Postgres pool error:', err));

  const jwks = createRemoteJWKSet(new URL(`${authBase}/.well-known/jwks.json`));
  const issuer = new URL(authBase).origin;

  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });
      if (!payload.sub) throw new Error('Token has no subject');
      (req as any).userId = payload.sub;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session' });
    }
  };

  const route = (handler: (req: Request, res: Response, userId: string) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await handler(req, res, (req as any).userId);
      } catch (err: any) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
        } else if (err?.code === '23503') {
          res.status(400).json({ error: 'Referenced holding does not exist' });
        } else if (['23502', '23514', '22P02', '22007', '22008'].includes(err?.code)) {
          res.status(400).json({ error: `Invalid document: ${err.message}` });
        } else {
          console.error('Data API error:', err);
          res.status(500).json({ error: 'Database error' });
        }
      }
    };

  const withTransaction = async <T>(fn: (client: pg.PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  const insertRow = async (db: pg.Pool | pg.PoolClient, def: RowCollection, body: unknown, userId: string) => {
    const { cols, vals } = columnsFrom(def, stripUserId(body));
    cols.push('user_id');
    vals.push(userId);
    const { rows } = await db.query(
      `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      vals
    );
    return rowToDoc(def, rows[0]);
  };

  // List documents, filtered by equality on known fields: ?ticker=AAPL&portfolioType=global
  app.get('/api/data/:collection', requireUser, route(async (req, res, userId) => {
    const def = getDef(req);
    if (def.kind === 'doc') {
      const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE user_id = $1`, [userId]);
      res.json(rows.map(docRowToDoc));
      return;
    }
    const where = ['user_id = $1'];
    const vals: unknown[] = [userId];
    for (const [field, raw] of Object.entries(req.query)) {
      if (field === 'userId') continue;
      const spec = def.fields[field];
      if (!spec || typeof raw !== 'string') throw new HttpError(400, `Cannot filter on ${field}`);
      vals.push(encode(spec[1], raw));
      where.push(`${spec[0]} = $${vals.length}`);
    }
    const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE ${where.join(' AND ')}`, vals);
    res.json(rows.map((r) => rowToDoc(def, r)));
  }));

  app.get('/api/data/:collection/:id', requireUser, route(async (req, res, userId) => {
    const def = getDef(req);
    checkDocId(def, req.params.id, userId);
    if (def.kind === 'doc') {
      const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE user_id = $1`, [userId]);
      res.json(rows[0] ? docRowToDoc(rows[0]) : null);
      return;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ${def.table} WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );
    res.json(rows[0] ? rowToDoc(def, rows[0]) : null);
  }));

  // Create with a generated id (addDoc). An array body inserts every document in one
  // transaction (addDocs) and returns them in order.
  app.post('/api/data/:collection', requireUser, route(async (req, res, userId) => {
    const def = getDef(req);
    if (def.kind !== 'rows') throw new HttpError(400, 'Use PUT for this collection');
    if (Array.isArray(req.body)) {
      const created = await withTransaction(async (client) => {
        const out = [];
        for (const item of req.body) out.push(await insertRow(client, def, item, userId));
        return out;
      });
      res.status(201).json(created);
      return;
    }
    res.status(201).json(await insertRow(pool, def, req.body, userId));
  }));

  // Create-or-overwrite at a known id (setDoc); ?merge=1 merges into an existing document.
  app.put('/api/data/:collection/:id', requireUser, route(async (req, res, userId) => {
    const def = getDef(req);
    checkDocId(def, req.params.id, userId);
    const merge = req.query.merge === '1';
    const body = stripUserId(req.body);

    if (def.kind === 'doc') {
      const row = await withTransaction(async (client) => {
        let data = body;
        if (merge) {
          const { rows } = await client.query(`SELECT data FROM ${def.table} WHERE user_id = $1 FOR UPDATE`, [userId]);
          if (rows[0]) data = deepMerge(rows[0].data, body);
        }
        const { rows } = await client.query(
          `INSERT INTO ${def.table} (user_id, data) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, ${def.updatedColumn} = now()
           RETURNING *`,
          [userId, JSON.stringify(data)]
        );
        return rows[0];
      });
      res.json(docRowToDoc(row));
      return;
    }

    const { cols, vals } = columnsFrom(def, body);
    const touch = def.updatedField ? [`${def.updatedField[1]} = now()`] : [];

    // A merge usually carries a partial document, which would fail NOT NULL checks
    // on the INSERT half of an upsert, so update an existing row first.
    if (merge && cols.length) {
      const sets = [...cols.map((c, i) => `${c} = $${i + 1}`), ...touch];
      const { rows } = await pool.query(
        `UPDATE ${def.table} SET ${sets.join(', ')}
         WHERE id = $${vals.length + 1} AND user_id = $${vals.length + 2} RETURNING *`,
        [...vals, req.params.id, userId]
      );
      if (rows[0]) {
        res.json(rowToDoc(def, rows[0]));
        return;
      }
    }

    const insertVals = [...vals, req.params.id, userId];
    const updates = [...cols.map((c) => `${c} = EXCLUDED.${c}`), ...touch];
    // Ids are client supplied here, so never let an upsert take over another user's row.
    const { rows } = await pool.query(
      `INSERT INTO ${def.table} (${[...cols, 'id', 'user_id'].join(', ')})
       VALUES (${insertVals.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (id) DO ${updates.length ? `UPDATE SET ${updates.join(', ')} WHERE ${def.table}.user_id = $${insertVals.length}` : 'NOTHING'}
       RETURNING *`,
      insertVals
    );
    if (!rows[0]) throw new HttpError(403, 'Forbidden');
    res.json(rowToDoc(def, rows[0]));
  }));

  // Update top-level fields of an existing document (updateDoc).
  app.patch('/api/data/:collection/:id', requireUser, route(async (req, res, userId) => {
    const def = getDef(req);
    checkDocId(def, req.params.id, userId);
    const body = stripUserId(req.body);

    if (def.kind === 'doc') {
      const { rows } = await pool.query(
        `UPDATE ${def.table} SET data = data || $1::jsonb, ${def.updatedColumn} = now()
         WHERE user_id = $2 RETURNING *`,
        [JSON.stringify(body), userId]
      );
      if (!rows[0]) throw new HttpError(404, 'Not found');
      res.json(docRowToDoc(rows[0]));
      return;
    }

    const { cols, vals } = columnsFrom(def, body);
    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    if (def.updatedField) sets.push(`${def.updatedField[1]} = now()`);
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    vals.push(req.params.id, userId);
    const { rows } = await pool.query(
      `UPDATE ${def.table} SET ${sets.join(', ')}
       WHERE id = $${vals.length - 1} AND user_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows[0]) throw new HttpError(404, 'Not found');
    res.json(rowToDoc(def, rows[0]));
  }));

  app.delete('/api/data/:collection/:id', requireUser, route(async (req, res, userId) => {
    const def = getDef(req);
    checkDocId(def, req.params.id, userId);
    const keyCol = def.kind === 'rows' ? 'id' : 'user_id';
    await pool.query(`DELETE FROM ${def.table} WHERE ${keyCol} = $1 AND user_id = $2`, [req.params.id, userId]);
    res.status(204).end();
  }));
}
