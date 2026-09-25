// Copies a user's portfolio from the old Firebase app's exports into Neon, exactly as
// the old app stored it (no recalculation from transaction history):
//   - holdings from "Download Portfolio JSON" exports (one file per tab)
//   - transactions from a "Tx JSON" whole-history export, linked to holdings by the
//     original Firebase holding id
//
// Usage:
//   npx tsx db/import-firebase-export.ts --user <email|neon user id> \
//     --holdings portfolio1.json --holdings portfolio2.json \
//     --transactions transactions_whole_history.json [--replace] [--commit]
//
// Without --commit it is a dry run: every write happens inside a transaction that is
// rolled back after the totals are verified. --replace deletes the user's existing
// holdings (and, by cascade, their transactions) first.

import fs from 'fs';
import crypto from 'crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const opt = (name: string) => args.filter((_, i) => args[i - 1] === `--${name}`);
const flag = (name: string) => args.includes(`--${name}`);

const [userArg] = opt('user');
const holdingFiles = opt('holdings');
const [txFile] = opt('transactions');
const commit = flag('commit');
const replace = flag('replace');
if (!userArg || holdingFiles.length === 0 || !txFile) {
  console.error('Usage: --user <email|id> --holdings <file> [--holdings <file>...] --transactions <file> [--replace] [--commit]');
  process.exit(1);
}

const TABS = new Set(['global', 'australia']);
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tsToIso = (t: any) => (t && typeof t.seconds === 'number' ? new Date(t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6)).toISOString() : null);

const holdings: any[] = holdingFiles.flatMap(readJson);
const transactions: any[] = readJson(txFile);

// Old Firebase id -> new uuid.
const idMap = new Map<string, string>();
const skipped: string[] = [];
for (const h of holdings) {
  const tab = h.portfolioType || 'global';
  if (!TABS.has(tab)) { skipped.push(`holding ${h.ticker} (portfolio "${tab}")`); continue; }
  if (idMap.has(h.id)) throw new Error(`Duplicate holding id ${h.id} across files`);
  idMap.set(h.id, crypto.randomUUID());
}

const txRows = [];
for (const t of transactions) {
  const holdingId = idMap.get(t.holdingId);
  if (!holdingId) { skipped.push(`transaction ${t.ticker} ${t.date} (portfolio "${t.portfolio}", holding not in exports)`); continue; }
  const type = String(t.type).toLowerCase();
  if (type !== 'buy' && type !== 'sell') throw new Error(`Unknown transaction type "${t.type}" (${t.id})`);
  txRows.push({ holdingId, type, shares: Math.abs(Number(t.shares)), price: Math.abs(Number(t.price)), date: t.date });
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const { rows: users } = await client.query(
    `SELECT id::text FROM neon_auth."user" WHERE id::text = $1 OR lower(email) = lower($1)`, [userArg]);
  if (users.length !== 1) throw new Error(`Expected one Neon Auth user matching "${userArg}", found ${users.length}`);
  const userId = users[0].id;

  await client.query('BEGIN');
  if (replace) {
    const { rowCount } = await client.query('DELETE FROM holdings WHERE user_id = $1', [userId]);
    console.log(`Removed ${rowCount} existing holdings (and their transactions).`);
  }

  for (const h of holdings) {
    const id = idMap.get(h.id);
    if (!id) continue;
    await client.query(
      `INSERT INTO holdings (id, user_id, ticker, shares, avg_price, avg_price_currency, portfolio_type, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))`,
      [id, userId, String(h.ticker).toUpperCase(), Number(h.shares) || 0, Number(h.avg_price) || 0,
       h.avgPriceCurrency || null, h.portfolioType || 'global', h.order ?? null, tsToIso(h.updatedAt)]
    );
  }
  for (const t of txRows) {
    await client.query(
      `INSERT INTO transactions (user_id, holding_id, type, shares, price, date) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, t.holdingId, t.type, t.shares, t.price, t.date]
    );
  }

  // Verify against the source files before committing.
  const expected: Record<string, { holdings: number; txs: number; cost: number; cash: number }> = {};
  for (const h of holdings) {
    if (!idMap.has(h.id)) continue;
    const e = (expected[h.portfolioType || 'global'] ??= { holdings: 0, txs: 0, cost: 0, cash: 0 });
    e.holdings++;
    if (h.ticker === 'CASH') e.cash += Number(h.shares) || 0;
    else e.cost += (Number(h.shares) || 0) * (Number(h.avg_price) || 0);
  }
  const tabOf = new Map(holdings.filter((h) => idMap.has(h.id)).map((h) => [idMap.get(h.id), h.portfolioType || 'global']));
  for (const t of txRows) expected[tabOf.get(t.holdingId)!].txs++;

  const { rows: actual } = await client.query(
    `SELECT h.portfolio_type AS tab, count(DISTINCT h.id)::int AS holdings,
            (SELECT count(*)::int FROM transactions t JOIN holdings h2 ON h2.id = t.holding_id
              WHERE h2.user_id = $1 AND h2.portfolio_type = h.portfolio_type) AS txs,
            coalesce(sum(h.shares * h.avg_price) FILTER (WHERE h.ticker <> 'CASH'), 0) AS cost,
            coalesce(sum(h.shares) FILTER (WHERE h.ticker = 'CASH'), 0) AS cash
     FROM holdings h WHERE h.user_id = $1 GROUP BY h.portfolio_type`, [userId]);

  let ok = true;
  console.log('\ntab        holdings        transactions     cost (ex cash)                  cash');
  for (const a of actual) {
    const e = expected[a.tab] ?? { holdings: 0, txs: 0, cost: 0, cash: 0 };
    const match = a.holdings === e.holdings && a.txs === e.txs && Math.abs(a.cost - e.cost) < 0.01 && Math.abs(a.cash - e.cash) < 0.01;
    ok &&= match;
    console.log(`${a.tab.padEnd(10)} ${String(a.holdings).padStart(3)}/${String(e.holdings).padEnd(3)}      ${String(a.txs).padStart(4)}/${String(e.txs).padEnd(4)}      ${a.cost.toFixed(2).padStart(11)}/${e.cost.toFixed(2).padEnd(11)}   ${a.cash.toFixed(2).padStart(9)}/${e.cash.toFixed(2)}   ${match ? 'OK' : 'MISMATCH'}`);
  }
  if (actual.length !== Object.keys(expected).length) ok = false;
  if (skipped.length) console.log(`\nSkipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);

  if (!ok) throw new Error('Verification failed; rolled back.');
  if (commit) {
    await client.query('COMMIT');
    console.log('\nCommitted.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nDry run OK; rolled back. Re-run with --commit to apply.');
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
