import express from 'express';
console.log('Server file loading...');
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import finnhubModule from 'finnhub';
const finnhub: any = (finnhubModule as any)?.default || finnhubModule;
import fs from 'fs';
import path from 'path';
import session from 'express-session';
import crypto from 'crypto';
import dns from 'node:dns/promises';
import { registerDataRoutes } from './server-data';
import { Resend } from 'resend';

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Give it a moment to log before potentially dying
  setTimeout(() => process.exit(1), 100);
});

async function yahooWithRetry<T>(fn: () => Promise<T>, retries = 3, backoff = 1000): Promise<T> {
  const retryableErrors = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'EPIPE',
    'fetch failed',
    'socket hang up',
    'UND_ERR_CONNECT_TIMEOUT',
    '429',
    'Too Many Requests',
    '503',
    'Service Unavailable',
    '502',
    'Bad Gateway',
    '500',
    'Internal Server Error',
    'HTTPError'
  ];

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const errorCode = err.code || err.cause?.code;
      const errorMessage = err.message || '';
      const causeMessage = err.cause?.message || '';
      
      const isRetryable = retryableErrors.some(e => 
        errorCode === e || 
        errorMessage.includes(e) || 
        causeMessage.includes(e)
      );
      
      if (isRetryable && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2;
        continue;
      }
      throw err;
    }
  }
  return await fn(); // Final attempt
}
const authTokens = new Map<string, any>();

// Cache for API responses
const quoteCache = new Map<string, { data: any, timestamp: number }>();
const metadataCache = new Map<string, { data: any, timestamp: number }>();
const earningsCache = new Map<string, { data: any, timestamp: number }>();

const CACHE_TTL = 60 * 1000; // 1 minute
const METADATA_TTL = 24 * 60 * 60 * 1000; // 24 hours
const EARNINGS_TTL = 12 * 60 * 60 * 1000; // 12 hours

// Helper for fetching with retry (useful for DNS and network issues)
async function fetchWithRetry(url: string, options: any = {}, retries = 5, backoff = 2000): Promise<Response> {
  const retryableErrors = [
    'EAI_AGAIN',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'EPIPE'
  ];

  const urlObj = new URL(url);

  for (let i = 0; i < retries; i++) {
    try {
      // DNS Pre-warm: Try to resolve the hostname before fetching
      if (i > 0) {
        try {
          await dns.lookup(urlObj.hostname);
        } catch (dnsErr) {
          console.warn(`DNS pre-warm lookup failed for ${urlObj.hostname}:`, dnsErr);
        }
      }

      const controller = new AbortController();
      const timeoutMs = options.timeout || 20000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      const errorCode = err.code || err.cause?.code;
      const errorMessage = err.message || '';
      const causeMessage = err.cause?.message || '';
      
      const isRetryable = retryableErrors.some(e => 
        errorCode === e || 
        errorMessage.includes(e) || 
        causeMessage.includes(e)
      ) || err.name === 'AbortError';
      
      if (isRetryable && i < retries - 1) {
        if (!options.silent) {
          console.warn(`Fetch attempt ${i + 1} failed for ${url}. Error: ${errorCode || err.name}. Cause: ${causeMessage}. Retrying in ${backoff}ms...`);
        }
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2;
        continue;
      }
      
      if (!options.silent) {
        console.error(`Fetch failed for ${url} after ${i + 1} attempts. Final Error:`, {
          message: err.message,
          code: errorCode,
          name: err.name,
          cause: err.cause,
          stack: err.stack
        });
      }
      throw err;
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

dotenv.config();

const finnhubApiKey = process.env.FINNHUB_API_KEY;
console.log('Finnhub API Key present:', !!finnhubApiKey);

let finnhubClient: any = null;
try {
  if (finnhubApiKey) {
    finnhubClient = new finnhub.DefaultApi(finnhubApiKey);
    console.log('Finnhub client initialized successfully');
  }
} catch (err) {
  console.error('Error initializing Finnhub client:', err);
}

const upload = multer({ storage: multer.memoryStorage() });

let sqliteDb: Database.Database | null = null;
let mysqlPool: mysql.Pool | null = null;

const mysqlUrl = (process.env.MYSQL_URL || '').trim();
const isMysql = mysqlUrl.length > 0 && !mysqlUrl.includes('localhost') && !mysqlUrl.includes('127.0.0.1') && !mysqlUrl.startsWith('TODO');

// Database abstraction layer
const db = {
  async query(sql: string, params: any[] = []): Promise<any> {
    try {
      if (isMysql && mysqlPool) {
        const [rows] = await mysqlPool.execute(sql, params);
        return rows;
      } else if (sqliteDb) {
        return sqliteDb.prepare(sql).all(...params);
      }
    } catch (err: any) {
      console.error(`Database query error [${sql}]:`, err.message);
      throw err;
    }
    throw new Error('Database not initialized');
  },
  async get(sql: string, params: any[] = []): Promise<any> {
    try {
      if (isMysql && mysqlPool) {
        const [rows] = await mysqlPool.execute(sql, params) as any;
        return rows[0];
      } else if (sqliteDb) {
        return sqliteDb.prepare(sql).get(...params);
      }
    } catch (err: any) {
      console.error(`Database get error [${sql}]:`, err.message);
      throw err;
    }
    throw new Error('Database not initialized');
  },
  async run(sql: string, params: any[] = []): Promise<{ lastInsertRowid: number | string }> {
    try {
      if (isMysql && mysqlPool) {
        const [result] = await mysqlPool.execute(sql, params) as any;
        return { lastInsertRowid: result.insertId };
      } else if (sqliteDb) {
        const info = sqliteDb.prepare(sql).run(...params);
        return { lastInsertRowid: info.lastInsertRowid as number };
      }
    } catch (err: any) {
      console.error(`Database run error [${sql}]:`, err.message);
      throw err;
    }
    throw new Error('Database not initialized');
  },
  async exec(sql: string): Promise<void> {
    try {
      if (isMysql && mysqlPool) {
        const queries = sql.split(';').filter(q => q.trim());
        for (const q of queries) {
          await mysqlPool.execute(q);
        }
      } else if (sqliteDb) {
        sqliteDb.exec(sql);
      }
    } catch (err: any) {
      console.error(`Database exec error:`, err.message);
      throw err;
    }
  }
};

// Initialize table
async function initDb() {
  if (isMysql) {
    console.log('Initializing MySQL database...');
    try {
      mysqlPool = mysql.createPool(process.env.MYSQL_URL || '');
      await db.exec(`
        CREATE TABLE IF NOT EXISTS portfolio (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ticker VARCHAR(20) NOT NULL,
          shares DOUBLE NOT NULL,
          avg_price DOUBLE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          holding_id INT NOT NULL,
          type VARCHAR(10) NOT NULL,
          shares DOUBLE NOT NULL,
          price DOUBLE NOT NULL,
          date VARCHAR(50) NOT NULL,
          FOREIGN KEY(holding_id) REFERENCES portfolio(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS analyses (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ticker VARCHAR(20),
          result TEXT NOT NULL,
          sentiment VARCHAR(20),
          date VARCHAR(50) NOT NULL
        );
        CREATE TABLE IF NOT EXISTS historical_prices (
          ticker VARCHAR(20) NOT NULL,
          date VARCHAR(20) NOT NULL,
          close DOUBLE NOT NULL,
          PRIMARY KEY (ticker, date)
        );
      `);
      console.log('MySQL database initialized.');
    } catch (err) {
      console.error('Failed to initialize MySQL, falling back to SQLite:', err);
      // Fallback logic handled by isMysql check in db object if mysqlPool is null
    }
  }

  if (!mysqlPool) {
    console.log('Initializing SQLite database (ephemeral)...');
    try {
      sqliteDb = new Database('portfolio.db');
      // Set pragmas for performance and reliability
      sqliteDb.exec('PRAGMA journal_mode = WAL');
      sqliteDb.exec('PRAGMA synchronous = NORMAL');
      sqliteDb.exec('PRAGMA foreign_keys = ON');
      
      // Test integrity
      const check = sqliteDb.prepare('PRAGMA integrity_check').get() as any;
      if (check.integrity_check !== 'ok') {
        throw new Error(`Database integrity check failed: ${check.integrity_check}`);
      }
    } catch (dbErr: any) {
      console.error('SQLite database is corrupted or failed to open, recreating...', dbErr.message);
      if (sqliteDb) {
        try { sqliteDb.close(); } catch {}
        sqliteDb = null;
      }
      try {
        if (fs.existsSync('portfolio.db')) {
          fs.unlinkSync('portfolio.db');
          console.log('Deleted corrupted portfolio.db');
        }
        if (fs.existsSync('portfolio.db-wal')) fs.unlinkSync('portfolio.db-wal');
        if (fs.existsSync('portfolio.db-shm')) fs.unlinkSync('portfolio.db-shm');
      } catch (unlinkErr) {
        console.error('Failed to delete corrupted database files:', unlinkErr);
      }
      sqliteDb = new Database('portfolio.db');
      sqliteDb.exec('PRAGMA journal_mode = WAL');
      sqliteDb.exec('PRAGMA synchronous = NORMAL');
    }

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        shares REAL NOT NULL,
        avg_price REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        holding_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        shares REAL NOT NULL,
        price REAL NOT NULL,
        date TEXT NOT NULL,
        FOREIGN KEY(holding_id) REFERENCES portfolio(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT,
        result TEXT NOT NULL,
        sentiment TEXT,
        date TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS historical_prices (
        ticker TEXT NOT NULL,
        date TEXT NOT NULL,
        close REAL NOT NULL,
        PRIMARY KEY (ticker, date)
      );
    `);
    console.log('SQLite database initialized.');
  }

  // Seed data if empty
  const row = await db.get('SELECT COUNT(*) as count FROM portfolio');
  if (row && row.count === 0) {
    try {
      const seedData = JSON.parse(fs.readFileSync(path.resolve('portfolio.json'), 'utf-8'));
      for (const item of seedData) {
        await db.run('INSERT INTO portfolio (ticker, shares, avg_price) VALUES (?, ?, ?)', [item.ticker, item.shares, item.avg_price]);
      }
      console.log('Seeded database from portfolio.json');
    } catch (seedErr) {
      console.error('Failed to seed database:', seedErr);
    }
  }
}
initDb().catch(err => {
  console.error('Failed to initialize database:', err);
});

async function startServer() {
  console.log('Starting server...');
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/api/ws' });

  // Quick health check endpoint before any body-parsing or session middleware
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(express.json({ limit: '50mb' }));
  registerDataRoutes(app);
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.set('trust proxy', true);
  app.use(session({
    secret: process.env.SESSION_SECRET || 'super-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  app.get('/api/db-status', (req, res) => {
    res.json({ 
      persistent: isMysql && !!mysqlPool,
      type: isMysql ? 'MySQL' : 'SQLite (Ephemeral)'
    });
  });

  app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    try {
      const results = await yahooWithRetry(() => yahooFinance.search(q, {}, { validateResult: false }));
      res.json(results);
    } catch (error: any) {
      const errorCode = error.code || error.cause?.code;
      const errorMessage = error.message || '';
      if (errorCode === 'ECONNRESET' || errorCode === 'UND_ERR_CONNECT_TIMEOUT' || errorMessage.includes('fetch failed') || errorMessage.includes('socket hang up')) {
        console.warn(`Yahoo Finance search warning: ${errorCode || errorMessage}.`);
        res.status(503).json({ error: 'Service temporarily unavailable' });
      } else {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Failed to search stocks' });
      }
    }
  });

  // Auth Routes
  app.get('/api/auth/url', (req, res) => {
    const redirectUri = req.query.redirectUri as string;
    const params = new URLSearchParams({
      client_id: (process.env.GOOGLE_CLIENT_ID || '').trim(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: redirectUri
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  });

  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code, state, error } = req.query;
    const redirectUri = state as string;

    if (error) {
      return res.send(`
        <html>
          <body>
            <h3>Authentication Error</h3>
            <p>${error}</p>
          </body>
        </html>
      `);
    }

    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: (process.env.GOOGLE_CLIENT_ID || '').trim(),
          client_secret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
      });
      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error);
      }

      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = await userResponse.json();

      if (userData.error) {
        throw new Error(userData.error.message || 'Failed to fetch user info');
      }

      const token = crypto.randomBytes(32).toString('hex');
      authTokens.set(token, userData);

      (req as any).session.user = userData;
      (req as any).session.save((err: any) => {
        if (err) console.error('Session save error:', err);
        res.send(`
          <html>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ 
                    type: 'OAUTH_AUTH_SUCCESS', 
                    user: ${JSON.stringify(userData)},
                    token: '${token}'
                  }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              </script>
              <p>Authentication successful. This window should close automatically.</p>
            </body>
          </html>
        `);
      });
    } catch (error: any) {
      console.error('OAuth callback error:', error);
      res.status(500).send(`
        <html>
          <body>
            <h3>Authentication Failed</h3>
            <p>${error.message}</p>
            <p>Please check your Google Client ID and Secret configuration.</p>
          </body>
        </html>
      `);
    }
  });

  app.get('/api/auth/user', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const user = authTokens.get(token);
      if (user) {
        return res.json({ user });
      }
    }

    if ((req as any).session?.user) {
      res.json({ user: (req as any).session.user });
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      authTokens.delete(token);
    }
    
    (req as any).session.destroy(() => {
      res.json({ success: true });
    });
  });

  // Email route using Resend
  app.post('/api/send-email', async (req, res) => {
    const { to, subject, text } = req.body;
    
    if (!to || !subject || !text) {
      return res.status(400).json({ error: 'Missing to, subject, or text fields' });
    }

    if (!process.env.RESEND_API_KEY) {
      console.warn('Cannot send email: RESEND_API_KEY is missing from environment variables');
      return res.status(500).json({ error: 'Email configuration is missing on the server' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
      const data = await resend.emails.send({
        from: 'Stock Tracker <onboarding@resend.dev>',
        to: [to],
        subject: subject,
        text: text,
      });

      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('Failed to send email via Resend:', error);
      res.status(500).json({ error: 'Failed to send email' });
    }
  });


  // API Routes
  async function syncToFile() {
    try {
      const rows = await db.query('SELECT ticker, shares, avg_price FROM portfolio');
      fs.writeFileSync(path.resolve('portfolio.json'), JSON.stringify(rows, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error syncing portfolio to file:', error);
    }
  }

  app.get(['/api/bot/portfolio', '/api/portfolio/bot'], async (req, res) => {
    try {
      const asOf = new Date().toISOString();
      if (req.query.download === 'true') {
        res.setHeader('Content-Disposition', 'attachment; filename="bot_portfolio_export.json"');
      }
      res.json({
        as_of: asOf,
        market_open: true,
        cash_usd: 4085.63,
        position_value_usd: 6136.29,
        total_value_usd: 10221.92,
        positions: [
          {
            symbol: 'AMD',
            qty: 3,
            avg_cost: 617.85,
            price: 629.26,
            market_value: 1887.78,
            unrealized_pnl: 34.23,
            entry_date: '2026-09-22',
            stale_price: false
          }
        ]
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch bot portfolio' });
    }
  });

  app.get('/api/bot/openapi.json', (req, res) => {
    const specPath = path.resolve('tradingbot-portfolio-openapi.json');
    if (fs.existsSync(specPath)) {
      res.sendFile(specPath);
    } else {
      res.status(404).json({ error: 'OpenAPI specification not found' });
    }
  });

  app.get('/api/portfolio', async (req, res) => {
    if (req.query.format === 'bot') {
      const asOf = new Date().toISOString();
      if (req.query.download === 'true') {
        res.setHeader('Content-Disposition', 'attachment; filename="portfolio.json"');
      }
      return res.json({
        as_of: asOf,
        market_open: true,
        cash_usd: 4085.63,
        position_value_usd: 6136.29,
        total_value_usd: 10221.92,
        positions: [
          {
            symbol: 'AMD',
            qty: 3,
            avg_cost: 617.85,
            price: 629.26,
            market_value: 1887.78,
            unrealized_pnl: 34.23,
            entry_date: '2026-09-22',
            stale_price: false
          }
        ]
      });
    }
    try {
      const rows = await db.query('SELECT * FROM portfolio');
      res.json(rows);
    } catch (error) {
      console.error('Error fetching portfolio:', error);
      res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
  });

  app.post('/api/portfolio', async (req, res) => {
    const { ticker, shares, avg_price } = req.body;
    if (!ticker || !shares || !avg_price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
      const info = await db.run('INSERT INTO portfolio (ticker, shares, avg_price) VALUES (?, ?, ?)', [ticker.toUpperCase(), shares, avg_price]);
      
      await db.run('INSERT INTO transactions (holding_id, type, shares, price, date) VALUES (?, ?, ?, ?, ?)', [
        info.lastInsertRowid,
        'buy',
        shares,
        avg_price,
        new Date().toISOString()
      ]);

      await syncToFile();
      return res.json({ id: info.lastInsertRowid });
    } catch (error) {
      console.error('Error adding to portfolio:', error);
      res.status(500).json({ error: 'Failed to add to portfolio' });
    }
  });

  app.delete('/api/portfolio', async (req, res) => {
    try {
      await db.exec('DELETE FROM portfolio');
      await syncToFile();
      return res.json({ success: true });
    } catch (error) {
      console.error('Error clearing portfolio:', error);
      res.status(500).json({ error: 'Failed to clear portfolio' });
    }
  });

  app.delete('/api/portfolio/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM portfolio WHERE id = ?', [req.params.id]);
      await syncToFile();
      return res.json({ success: true });
    } catch (error) {
      console.error('Error deleting from portfolio:', error);
      res.status(500).json({ error: 'Failed to delete from portfolio' });
    }
  });

  app.put('/api/portfolio/:id', async (req, res) => {
    const { shares, avg_price } = req.body;
    if (shares === undefined || avg_price === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
      const old = await db.get('SELECT shares, avg_price FROM portfolio WHERE id = ?', [req.params.id]);
      
      await db.run('UPDATE portfolio SET shares = ?, avg_price = ? WHERE id = ?', [shares, avg_price, req.params.id]);

      if (old) {
        const diffShares = shares - old.shares;
        if (diffShares > 0) {
          await db.run('INSERT INTO transactions (holding_id, type, shares, price, date) VALUES (?, ?, ?, ?, ?)', [
            req.params.id, 'buy', diffShares, avg_price, new Date().toISOString()
          ]);
        } else if (diffShares < 0) {
          await db.run('INSERT INTO transactions (holding_id, type, shares, price, date) VALUES (?, ?, ?, ?, ?)', [
            req.params.id, 'sell', Math.abs(diffShares), avg_price, new Date().toISOString()
          ]);
        }
      }

      await syncToFile();
      return res.json({ success: true });
    } catch (error) {
      console.error('Error updating portfolio:', error);
      res.status(500).json({ error: 'Failed to update portfolio' });
    }
  });

  app.get('/api/portfolio/:id/transactions', async (req, res) => {
    try {
      const rows = await db.query('SELECT * FROM transactions WHERE holding_id = ? ORDER BY date DESC', [req.params.id]);
      res.json(rows);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  });

  app.post('/api/portfolio/save', async (req, res) => {
    try {
      const rows = await db.query('SELECT ticker, shares, avg_price FROM portfolio');
      fs.writeFileSync(path.resolve('portfolio.json'), JSON.stringify(rows, null, 2), 'utf-8');
      res.json({ success: true, count: rows.length });
    } catch (error) {
      console.error('Error saving portfolio to file:', error);
      res.status(500).json({ error: 'Failed to save portfolio to file' });
    }
  });

  app.get('/api/analyses', async (req, res) => {
    try {
      const ticker = req.query.ticker;
      if (ticker === 'portfolio') {
        const rows = await db.query("SELECT * FROM analyses WHERE ticker IS NULL OR ticker = '' ORDER BY date DESC");
        return res.json(rows);
      } else if (ticker) {
        const rows = await db.query('SELECT * FROM analyses WHERE ticker = ? ORDER BY date DESC', [ticker]);
        return res.json(rows);
      }
      const rows = await db.query('SELECT * FROM analyses ORDER BY date DESC');
      res.json(rows);
    } catch (error) {
      console.error('Error fetching analyses:', error);
      res.status(500).json({ error: 'Failed to fetch analyses' });
    }
  });

  app.post('/api/analyses', async (req, res) => {
    const { ticker, result, sentiment } = req.body;
    if (!result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
      const date = new Date().toISOString();
      const info = await db.run('INSERT INTO analyses (ticker, result, sentiment, date) VALUES (?, ?, ?, ?)', [
        ticker || null, result, sentiment || null, date
      ]);
      return res.json({ id: info.lastInsertRowid, success: true });
    } catch (error) {
      console.error('Error saving analysis:', error);
      res.status(500).json({ error: 'Failed to save analysis' });
    }
  });

  app.delete('/api/analyses/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM analyses WHERE id = ?', [req.params.id]);
      return res.json({ success: true });
    } catch (error) {
      console.error('Error deleting analysis:', error);
      res.status(500).json({ error: 'Failed to delete analysis' });
    }
  });

  // Helper for multi-provider AI analysis
  async function performAiAnalysis(params: {
    provider?: string;
    model?: string;
    prompt?: string;
    contents?: any;
    apiKey?: string;
    customEndpoint?: string;
    config?: any;
    tools?: any;
    systemPrompt?: string;
    allowFallback?: boolean;
  }) {
    let {
      provider,
      model = 'gemini-3.1-pro-preview',
      prompt,
      contents,
      apiKey,
      customEndpoint,
      config = {},
      tools,
      systemPrompt = 'You are a professional investment strategist and equity analyst.',
      allowFallback = true
    } = params;

    // Normalize prompt text if passed via contents
    let extractedText = prompt || '';
    let pdfBase64: string | null = null;
    let pdfMimeType: string = 'application/pdf';

    if (!extractedText && contents) {
      if (typeof contents === 'string') {
        extractedText = contents;
      } else if (Array.isArray(contents)) {
        for (const item of contents) {
          if (typeof item === 'string') {
            extractedText += (extractedText ? '\n\n' : '') + item;
          } else if (item?.text) {
            extractedText += (extractedText ? '\n\n' : '') + item.text;
          } else if (item?.inlineData?.data) {
            pdfBase64 = item.inlineData.data;
            pdfMimeType = item.inlineData.mimeType || 'application/pdf';
          }
        }
      } else if (contents.text) {
        extractedText = contents.text;
      }
    }

    // Auto-detect provider from model name if not explicitly set
    const lowerModel = (model || '').toLowerCase();
    if (!provider) {
      if (lowerModel.includes('claude')) {
        provider = 'anthropic';
      } else if (lowerModel.startsWith('gpt-') || lowerModel.startsWith('o1') || lowerModel.startsWith('o3') || lowerModel.includes('openai')) {
        provider = 'openai';
      } else if (lowerModel.includes('deepseek')) {
        provider = 'deepseek';
      } else {
        provider = 'gemini';
      }
    }

    // Inner helper for executing with Gemini with internal resilience
    const executeWithGemini = async (preferredGeminiModel: string = 'gemini-3.1-pro-preview', geminiApiKeyOverride?: string) => {
      const geminiKey = geminiApiKeyOverride || process.env.GEMINI_API_KEY;
      if (!geminiKey || geminiKey === "MY_GEMINI_API_KEY") {
        throw {
          status: 500,
          code: 'MISSING_API_KEY',
          error: 'Gemini API Key Required',
          details: 'GEMINI_API_KEY is not configured on the server. Please add a valid API key in Settings > AI Configuration or the AI Studio Secrets panel.',
          provider: 'gemini'
        };
      }

      const ai = new GoogleGenAI({ apiKey: geminiKey.trim() });
      const generationConfig: any = {
        responseMimeType: config.responseMimeType || "text/plain"
      };
      
      if (config.responseSchema) {
        generationConfig.responseSchema = config.responseSchema;
      }

      if (tools) {
        generationConfig.tools = tools;
      }

      const actualContents = contents || prompt || extractedText;
      const candidateModels = [
        preferredGeminiModel && preferredGeminiModel.includes('gemini') ? preferredGeminiModel : 'gemini-3.1-pro-preview',
        'gemini-2.5-flash',
        'gemini-2.5-pro'
      ];

      let lastGeminiErr: any = null;
      for (const geminiModel of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: geminiModel,
            contents: actualContents,
            config: generationConfig
          });

          // Extract grounding sources if available
          let sources: any[] = [];
          const groundingMetadata = (response.candidates?.[0] as any)?.groundingMetadata;
          if (groundingMetadata?.groundingChunks) {
            sources = groundingMetadata.groundingChunks
              .filter((c: any) => c.web?.uri)
              .map((c: any) => ({
                title: c.web.title || c.web.uri,
                uri: c.web.uri
              }));
          }

          return {
            text: response.text || '',
            model: geminiModel,
            provider: 'gemini' as const,
            candidates: response.candidates,
            usageMetadata: response.usageMetadata,
            sources
          };
        } catch (gErr: any) {
          lastGeminiErr = gErr;
          console.warn(`Gemini generation with ${geminiModel} failed, trying next fallback:`, gErr?.message || gErr);
        }
      }

      throw {
        status: 500,
        code: 'PROVIDER_ERROR',
        error: 'Gemini API Error',
        details: lastGeminiErr?.message || String(lastGeminiErr),
        provider: 'gemini'
      };
    };

    // 1. Anthropic (Claude) Provider
    if (provider === 'anthropic' || provider === 'claude') {
      const anthropicKey = apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      if (!anthropicKey || anthropicKey.trim() === '') {
        if (allowFallback && process.env.GEMINI_API_KEY) {
          console.warn('Anthropic API key missing, falling back to Gemini 3.1 Pro');
          const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
          return {
            ...geminiRes,
            fallbackNotice: 'Anthropic Claude requires an API Key in Settings. Ran analysis with Gemini 3.1 Pro.',
            originalProvider: 'anthropic',
            originalModel: model
          };
        }
        throw {
          status: 400,
          code: 'MISSING_API_KEY',
          error: 'Anthropic API Key Required',
          details: 'Please provide an Anthropic API Key in Settings > AI Configuration or configure ANTHROPIC_API_KEY in the AI Studio Secrets panel.',
          provider: 'anthropic'
        };
      }

      const claudeModel = model && model.includes('claude') ? model : 'claude-3-7-sonnet-20250219';
      
      const messageContent: any[] = [];
      if (pdfBase64) {
        messageContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: pdfMimeType,
            data: pdfBase64
          }
        });
      }
      messageContent.push({
        type: 'text',
        text: extractedText
      });

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey.trim(),
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: claudeModel,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: messageContent
              }
            ]
          })
        });

        const data: any = await response.json();
        if (!response.ok) {
          const errorMsg = data.error?.message || data.message || `Anthropic request failed (${response.status})`;
          const isQuota = response.status === 429 || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('credit') || errorMsg.toLowerCase().includes('rate limit');
          
          if (allowFallback && process.env.GEMINI_API_KEY) {
            console.warn(`Anthropic error (${errorMsg}), falling back to Gemini 3.1 Pro`);
            const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
            return {
              ...geminiRes,
              fallbackNotice: `Claude API reported "${errorMsg}". Ran analysis with Gemini 3.1 Pro.`,
              originalProvider: 'anthropic',
              originalModel: claudeModel
            };
          }

          throw {
            status: response.status,
            code: isQuota ? 'QUOTA_EXCEEDED' : 'PROVIDER_ERROR',
            error: isQuota ? 'Anthropic Quota / Rate Limit' : 'Anthropic API Error',
            details: errorMsg,
            provider: 'anthropic'
          };
        }

        const text = data.content?.[0]?.text || '';
        return {
          text,
          model: claudeModel,
          provider: 'anthropic',
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: data.usage
        };
      } catch (err: any) {
        if (err.status && err.code) throw err;
        if (allowFallback && process.env.GEMINI_API_KEY) {
          const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
          return {
            ...geminiRes,
            fallbackNotice: `Claude API connection error. Ran analysis with Gemini 3.1 Pro.`,
            originalProvider: 'anthropic',
            originalModel: claudeModel
          };
        }
        throw {
          status: 500,
          code: 'PROVIDER_ERROR',
          error: 'Anthropic Request Failed',
          details: err?.message || String(err),
          provider: 'anthropic'
        };
      }
    }

    // 2. OpenAI Provider
    if (provider === 'openai') {
      const openAiKey = apiKey || process.env.OPENAI_API_KEY;
      if (!openAiKey || openAiKey.trim() === '') {
        if (allowFallback && process.env.GEMINI_API_KEY) {
          console.warn('OpenAI API key missing, falling back to Gemini 3.1 Pro');
          const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
          return {
            ...geminiRes,
            fallbackNotice: 'OpenAI requires an API Key in Settings. Ran analysis with Gemini 3.1 Pro.',
            originalProvider: 'openai',
            originalModel: model
          };
        }
        throw {
          status: 400,
          code: 'MISSING_API_KEY',
          error: 'OpenAI API Key Required',
          details: 'Please provide an OpenAI API Key in Settings > AI Configuration or configure OPENAI_API_KEY in the AI Studio Secrets panel.',
          provider: 'openai'
        };
      }

      const openAiModel = model && (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) ? model : 'gpt-4o';

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAiKey.trim()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: openAiModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: extractedText }
            ],
            ...(config.responseMimeType === 'application/json' ? { response_format: { type: 'json_object' } } : {})
          })
        });

        const data: any = await response.json();
        if (!response.ok) {
          const errorMsg = data.error?.message || data.message || `OpenAI request failed (${response.status})`;
          const isQuota = response.status === 429 || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('plan and billing') || errorMsg.toLowerCase().includes('rate limit');
          
          if (allowFallback && process.env.GEMINI_API_KEY) {
            console.warn(`OpenAI error (${errorMsg}), falling back to Gemini 3.1 Pro`);
            const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
            return {
              ...geminiRes,
              fallbackNotice: `OpenAI reported: "${errorMsg}". Automatically ran with Gemini 3.1 Pro.`,
              originalProvider: 'openai',
              originalModel: openAiModel
            };
          }

          throw {
            status: response.status,
            code: isQuota ? 'QUOTA_EXCEEDED' : 'PROVIDER_ERROR',
            error: isQuota ? 'OpenAI Quota Exceeded' : 'OpenAI API Error',
            details: errorMsg,
            provider: 'openai'
          };
        }

        const text = data.choices?.[0]?.message?.content || '';
        return {
          text,
          model: openAiModel,
          provider: 'openai',
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: data.usage
        };
      } catch (err: any) {
        if (err.status && err.code) throw err;
        if (allowFallback && process.env.GEMINI_API_KEY) {
          const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
          return {
            ...geminiRes,
            fallbackNotice: `OpenAI request error. Ran analysis with Gemini 3.1 Pro.`,
            originalProvider: 'openai',
            originalModel: openAiModel
          };
        }
        throw {
          status: 500,
          code: 'PROVIDER_ERROR',
          error: 'OpenAI Request Failed',
          details: err?.message || String(err),
          provider: 'openai'
        };
      }
    }

    // 3. DeepSeek Provider
    if (provider === 'deepseek') {
      const deepseekKey = apiKey || process.env.DEEPSEEK_API_KEY;
      if (!deepseekKey || deepseekKey.trim() === '') {
        if (allowFallback && process.env.GEMINI_API_KEY) {
          console.warn('DeepSeek API key missing, falling back to Gemini 3.1 Pro');
          const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
          return {
            ...geminiRes,
            fallbackNotice: 'DeepSeek requires an API Key in Settings. Ran analysis with Gemini 3.1 Pro.',
            originalProvider: 'deepseek',
            originalModel: model
          };
        }
        throw {
          status: 400,
          code: 'MISSING_API_KEY',
          error: 'DeepSeek API Key Required',
          details: 'Please provide a DeepSeek API Key in Settings > AI Configuration or configure DEEPSEEK_API_KEY in the AI Studio Secrets panel.',
          provider: 'deepseek'
        };
      }

      const deepseekModel = model && model.includes('deepseek') ? model : 'deepseek-chat';

      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${deepseekKey.trim()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: deepseekModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: extractedText }
            ]
          })
        });

        const data: any = await response.json();
        if (!response.ok) {
          const errorMsg = data.error?.message || data.message || `DeepSeek request failed (${response.status})`;
          const isBalance = response.status === 402 || errorMsg.toLowerCase().includes('insufficient balance') || errorMsg.toLowerCase().includes('balance');
          const isQuota = response.status === 429 || errorMsg.toLowerCase().includes('rate limit') || errorMsg.toLowerCase().includes('quota');

          if (allowFallback && process.env.GEMINI_API_KEY) {
            console.warn(`DeepSeek error (${errorMsg}), falling back to Gemini 3.1 Pro`);
            const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
            return {
              ...geminiRes,
              fallbackNotice: `DeepSeek reported: "${errorMsg}". Automatically ran with Gemini 3.1 Pro.`,
              originalProvider: 'deepseek',
              originalModel: deepseekModel
            };
          }

          throw {
            status: response.status,
            code: isBalance ? 'INSUFFICIENT_BALANCE' : isQuota ? 'QUOTA_EXCEEDED' : 'PROVIDER_ERROR',
            error: isBalance ? 'DeepSeek Insufficient Balance' : isQuota ? 'DeepSeek Rate Limit' : 'DeepSeek API Error',
            details: errorMsg,
            provider: 'deepseek'
          };
        }

        const text = data.choices?.[0]?.message?.content || '';
        return {
          text,
          model: deepseekModel,
          provider: 'deepseek',
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: data.usage
        };
      } catch (err: any) {
        if (err.status && err.code) throw err;
        if (allowFallback && process.env.GEMINI_API_KEY) {
          const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
          return {
            ...geminiRes,
            fallbackNotice: `DeepSeek request error. Ran analysis with Gemini 3.1 Pro.`,
            originalProvider: 'deepseek',
            originalModel: deepseekModel
          };
        }
        throw {
          status: 500,
          code: 'PROVIDER_ERROR',
          error: 'DeepSeek Request Failed',
          details: err?.message || String(err),
          provider: 'deepseek'
        };
      }
    }

    // 4. Custom OpenAI-compatible Provider (e.g. Ollama, OpenRouter, Groq)
    if (provider === 'custom') {
      const endpoint = customEndpoint || 'https://api.openai.com/v1/chat/completions';
      const customKey = apiKey || '';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (customKey.trim()) {
        headers['Authorization'] = `Bearer ${customKey.trim()}`;
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model || 'default',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: extractedText }
            ]
          })
        });

        const data: any = await response.json();
        if (!response.ok) {
          const errorMsg = data.error?.message || data.message || `Custom AI endpoint failed (${response.status})`;
          if (allowFallback && process.env.GEMINI_API_KEY) {
            const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
            return {
              ...geminiRes,
              fallbackNotice: `Custom endpoint reported: "${errorMsg}". Ran with Gemini 3.1 Pro.`,
              originalProvider: 'custom',
              originalModel: model
            };
          }
          throw {
            status: response.status,
            code: 'PROVIDER_ERROR',
            error: 'Custom AI Endpoint Error',
            details: errorMsg,
            provider: 'custom'
          };
        }

        const text = data.choices?.[0]?.message?.content || data.response || data.text || '';
        return {
          text,
          model: model || 'custom',
          provider: 'custom',
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: data.usage
        };
      } catch (err: any) {
        if (err.status && err.code) throw err;
        if (allowFallback && process.env.GEMINI_API_KEY) {
          const geminiRes = await executeWithGemini('gemini-3.1-pro-preview');
          return {
            ...geminiRes,
            fallbackNotice: `Custom AI endpoint unreachable. Ran with Gemini 3.1 Pro.`,
            originalProvider: 'custom',
            originalModel: model
          };
        }
        throw {
          status: 500,
          code: 'PROVIDER_ERROR',
          error: 'Custom AI Request Failed',
          details: err?.message || String(err),
          provider: 'custom'
        };
      }
    }

    // 5. Default: Google Gemini Provider
    return executeWithGemini(model, apiKey);
  }

  // Unified Multi-Model AI Analysis Endpoint
  app.post(['/api/ai-analyze', '/api/gemini-analyze'], async (req, res) => {
    const { contents, prompt, model, provider, apiKey, customEndpoint, config = {}, tools, systemPrompt, allowFallback } = req.body;
    
    if (!contents && !prompt) {
      return res.status(400).json({ error: 'Contents or prompt is required' });
    }

    try {
      const result = await performAiAnalysis({
        provider,
        model,
        prompt,
        contents,
        apiKey,
        customEndpoint,
        config,
        tools,
        systemPrompt,
        allowFallback: allowFallback !== undefined ? allowFallback : true
      });

      res.json(result);
    } catch (error: any) {
      console.error('AI Analysis API error:', error);
      const statusCode = error.status || 500;
      const errorTitle = error.error || 'AI analysis failed';
      const errorDetails = error.details || error.message || String(error);
      const errorCode = error.code || 'UNKNOWN_ERROR';
      const errorProvider = error.provider || provider || 'unknown';

      res.status(statusCode).json({
        error: errorTitle,
        details: errorDetails,
        code: errorCode,
        provider: errorProvider,
        status: statusCode
      });
    }
  });

  app.get(['/api/historical-bulk', '/api/historical-bulk/'], async (req, res) => {
    const symbols = req.query.symbols as string;
    const period1Str = req.query.from as string;
    const period2Str = req.query.to as string;
    const forceRefresh = req.query.refresh === 'true';
    
    console.log(`[API] Historical bulk request for symbols: ${symbols} from ${period1Str} to ${period2Str}`);
    
    if (!symbols) return res.status(400).json({ error: 'Symbols required' });
    if (!period1Str) return res.status(400).json({ error: 'From date (period1) required' });

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(s => s && s !== 'CASH');
    
    // Ensure period1 and period2 are valid Date objects for yahooFinance
    const fromDate = new Date(period1Str);
    const toDate = period2Str ? new Date(period2Str) : new Date();
    
    if (isNaN(fromDate.getTime())) {
      return res.status(400).json({ error: 'Invalid start date (period1)' });
    }

    // Cap future dates as Yahoo Finance API will error on period2 > now
    const now = new Date();
    let finalToDate = isNaN(toDate.getTime()) ? now : toDate;
    if (finalToDate > now) finalToDate = now;

    // Ensure period1 is not after period2
    if (fromDate > finalToDate) {
      console.warn(`[API] Historical request: period1 (${fromDate.toISOString()}) is after period2 (${finalToDate.toISOString()}). Returning empty.`);
      const emptyResults: Record<string, any> = {};
      symbolList.forEach(s => emptyResults[s] = []);
      if (symbols.toUpperCase().includes('CASH')) emptyResults['CASH'] = [];
      return res.json(emptyResults);
    }

    const queryOptions: any = { 
      period1: fromDate,
      period2: finalToDate,
      interval: '1d'
    };

    try {
      const results: Record<string, any> = {};
      
      // Initialize CASH results if requested to avoid frontend hanging
      if (symbols.toUpperCase().includes('CASH')) {
        results['CASH'] = [];
      }
      
      // Batch processing to speed up requests while avoiding rate limits
      const BATCH_SIZE = 5;
      for (let i = 0; i < symbolList.length; i += BATCH_SIZE) {
        const batch = symbolList.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (sym) => {
          let cachedData: any[] = [];
          let needsFetch = forceRefresh;

          if (!forceRefresh) {
            try {
              // Check cache for this symbol and range
              const rows = await db.query(
                'SELECT date, close FROM historical_prices WHERE ticker = ? AND date >= ? AND date <= ? ORDER BY date ASC',
                [sym, period1Str, period2Str || new Date().toISOString().split('T')[0]]
              );
              
              if (rows && rows.length > 0) {
                const maxDateInStack = rows[rows.length - 1].date;
                const todayStr = new Date().toISOString().split('T')[0];
                
                if (maxDateInStack >= todayStr || (new Date().getDay() === 0 || new Date().getDay() === 6)) { 
                   cachedData = rows.map(r => ({ date: r.date, close: r.close }));
                } else {
                   needsFetch = true;
                }
              } else {
                needsFetch = true;
              }
            } catch (err) {
              console.error(`Cache read error for ${sym}:`, err);
              needsFetch = true;
            }
          }

          if (needsFetch) {
            try {
              console.log(`[API] Fetching from Yahoo for ${sym}...`);
              const chartData: any = await yahooWithRetry(() => yahooFinance.chart(sym, queryOptions, { validateResult: false }));
              const data = chartData?.quotes ? chartData.quotes.filter((q: any) => q.close !== null && q.close !== undefined) : [];
              const formattedData = Array.isArray(data) ? data : [];
              results[sym] = formattedData;

              // Update cache asynchronously in a single transaction for efficiency
              if (formattedData.length > 0) {
                (async () => {
                  try {
                    if (sqliteDb) {
                      const insertStmt = sqliteDb.prepare('INSERT OR REPLACE INTO historical_prices (ticker, date, close) VALUES (?, ?, ?)');
                      sqliteDb.transaction((data: any[]) => {
                        for (const p of data) {
                          if (p.date && p.close !== undefined) {
                            let d = '';
                            if (p.date instanceof Date) {
                              if (!isNaN(p.date.getTime())) {
                                d = p.date.toISOString().split('T')[0];
                              } else {
                                continue;
                              }
                            } else {
                              d = String(p.date).split('T')[0];
                            }
                            insertStmt.run(sym, d, p.close);
                          }
                        }
                      })(formattedData);
                    } else if (isMysql && mysqlPool) {
                      for (const p of formattedData) {
                        if (p.date && p.close !== undefined) {
                          let d = '';
                          if (p.date instanceof Date) {
                            if (!isNaN(p.date.getTime())) {
                              d = p.date.toISOString().split('T')[0];
                            } else {
                              continue;
                            }
                          } else {
                            d = String(p.date).split('T')[0];
                          }
                          await db.run(
                            'INSERT INTO historical_prices (ticker, date, close) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE close = VALUES(close)',
                            [sym, d, p.close]
                          ).catch(() => {});
                        }
                      }
                    }
                  } catch (cacheErr) {
                    console.error(`Failed to update cache for ${sym}:`, cacheErr);
                  }
                })();
              }
            } catch (err: any) {
              console.warn(`Failed getting historical for ${sym}: ${err.message}`);
              results[sym] = cachedData;
            }
          } else {
            results[sym] = cachedData;
          }
        }));
      }
      
      if (!res.headersSent) {
        res.json(results);
      }
    } catch (error: any) {
      console.error('[API] Historical data fetch error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to fetch historical data', details: error.message });
      }
    }
  });

  app.get('/api/quotes', async (req, res) => {
    const symbols = req.query.symbols as string;
    if (!symbols) return res.json({});

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(s => s && s !== 'CASH');
    const now = Date.now();
    const quotes: Record<string, any> = {};
    const symbolsToFetch: string[] = [];

    // Check cache first
    symbolList.forEach(symbol => {
      const cached = quoteCache.get(symbol);
      if (cached && (now - cached.timestamp < CACHE_TTL)) {
        quotes[symbol] = cached.data;
      } else {
        symbolsToFetch.push(symbol);
      }
    });

    if (symbolsToFetch.length === 0) {
      return res.json(quotes);
    }

    // Try Yahoo Finance first for bulk quotes (more reliable for multiple symbols)
    try {
      let quotesArray: any[] = [];
      try {
        const results = await yahooWithRetry(() => yahooFinance.quote(symbolsToFetch, {}, { validateResult: false }));
        quotesArray = Array.isArray(results) ? results : [results];
      } catch (bulkErr: any) {
        console.warn(`[API] Bulk Yahoo Finance quotes failed. Falling back to fetching individually. Error: ${bulkErr.message || bulkErr}`);
        for (const sym of symbolsToFetch) {
          try {
            const result = await yahooWithRetry(() => yahooFinance.quote(sym, {}, { validateResult: false }));
            if (result) {
              quotesArray.push(result);
            }
          } catch (individualErr: any) {
            console.log(`[API] Failed fetching individual ticker "${sym}": ${individualErr.message || individualErr}`);
          }
        }
      }
      
      const getCurrencyFromSymbol = (symbol: string) => {
        if (symbol.endsWith('.AX')) return 'AUD';
        if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return 'INR';
        if (symbol.endsWith('.L')) return 'GBP';
        if (symbol.endsWith('.TO')) return 'CAD';
        if (symbol.endsWith('.SI')) return 'SGD';
        if (symbol.endsWith('.DE') || symbol.endsWith('.PA') || symbol.endsWith('.MI') || symbol.endsWith('.AS') || symbol.endsWith('.MC')) return 'EUR';
        return 'USD';
      };

      quotesArray.forEach((quote: any) => {
        if (!quote || !quote.symbol) return;
        let price = quote.regularMarketPrice;
        let previousClose = quote.regularMarketPreviousClose;
        let marketState = quote.marketState || 'REGULAR';
        
        if (quote.marketState === 'PRE' && quote.preMarketPrice) {
          price = quote.preMarketPrice;
        } else if ((quote.marketState === 'POST' || quote.marketState === 'CLOSED' || quote.marketState === 'POSTPOST') && quote.postMarketPrice) {
          price = quote.postMarketPrice;
        }
        
        if (price !== undefined) {
          const quoteData = { 
            price, 
            previousClose, 
            marketState,
            changePercent: quote.regularMarketChangePercent,
            ytdReturn: quote.ytdReturn || (quote.fiftyDayAverageChangePercent ? quote.fiftyDayAverageChangePercent * 100 : 0),
            currency: quote.currency || getCurrencyFromSymbol(quote.symbol),
            marketCap: quote.marketCap
          };
          quotes[quote.symbol] = quoteData;
          quoteCache.set(quote.symbol, { data: quoteData, timestamp: now });
        }
      });
    } catch (error: any) {
      const errorCode = error.code || error.cause?.code;
      const errorMessage = error.message || '';
      if (errorCode === 'ECONNRESET' || errorCode === 'UND_ERR_CONNECT_TIMEOUT' || errorMessage.includes('fetch failed') || errorMessage.includes('socket hang up')) {
        console.warn(`Yahoo Finance bulk quote warning: ${errorCode || errorMessage}.`);
      } else {
        console.warn('Yahoo Finance quote fetching warning (gracefully handled):', error.message || error);
      }
    }

    // Fallback to Finnhub for any missing symbols if key is available
    const missingSymbols = symbolList.filter(s => !quotes[s]);
    if (missingSymbols.length > 0 && finnhubClient) {
      const getCurrencyFromSymbol = (symbol: string) => {
        if (symbol.endsWith('.AX')) return 'AUD';
        if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return 'INR';
        if (symbol.endsWith('.L')) return 'GBP';
        if (symbol.endsWith('.TO')) return 'CAD';
        if (symbol.endsWith('.SI')) return 'SGD';
        if (symbol.endsWith('.DE') || symbol.endsWith('.PA') || symbol.endsWith('.MI') || symbol.endsWith('.AS') || symbol.endsWith('.MC')) return 'EUR';
        return 'USD';
      };
      try {
        await Promise.all(missingSymbols.map(async (symbol) => {
          return new Promise<void>((resolve) => {
            finnhubClient.quote(symbol, (error: any, data: any) => {
              if (!error && data && data.c !== undefined) {
                const quoteData = {
                  price: data.c,
                  previousClose: data.pc,
                  marketState: 'REGULAR',
                  currency: getCurrencyFromSymbol(symbol)
                };
                quotes[symbol] = quoteData;
                quoteCache.set(symbol, { data: quoteData, timestamp: now });
              }
              resolve();
            });
          });
        }));
      } catch (err) {
        console.warn('Finnhub fallback quote error (transient/rate-limited):', err);
      }
    }

    return res.json(quotes);
  });

  const betaCache = new Map<string, { data: number | null, timestamp: number }>();
  const BETA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  app.get('/api/beta', async (req, res) => {
    const symbols = req.query.symbols as string;
    if (!symbols) return res.json({});

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(s => s && s !== 'CASH');
    const now = Date.now();
    const betas: Record<string, number | null> = {};
    const symbolsToFetch: string[] = [];

    symbolList.forEach(symbol => {
      const cached = betaCache.get(symbol);
      if (cached && (now - cached.timestamp < BETA_CACHE_TTL)) {
        betas[symbol] = cached.data;
      } else {
        symbolsToFetch.push(symbol);
      }
    });

    if (symbolsToFetch.length > 0) {
      await Promise.allSettled(symbolsToFetch.map(async (symbol) => {
        try {
          const result: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['summaryDetail'] }, { validateResult: false }));
          const beta = result?.summaryDetail?.beta ?? null;
          betas[symbol] = beta;
          betaCache.set(symbol, { data: beta, timestamp: now });
        } catch (err: any) {
          const msg = err?.message || String(err);
          if (!msg.includes('No fundamentals data found') && !msg.includes('Quote not found')) {
             console.log(`[API] Failed fetching beta for "${symbol}": ${msg}`);
          }
          betas[symbol] = null;
          betaCache.set(symbol, { data: null, timestamp: now });
        }
      }));
    }

    return res.json(betas);
  });

  app.get('/api/earnings', async (req, res) => {
    const symbols = req.query.symbols as string;
    if (!symbols) return res.json([]);

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
    const now = Date.now();
    const earnings: any[] = [];

    // Check cache
    const cacheKey = symbolList.sort().join(',');
    const cached = earningsCache.get(cacheKey);
    if (cached && (now - cached.timestamp < EARNINGS_TTL)) {
      return res.json(cached.data);
    }

    try {
      for (const symbol of symbolList) {
        let symbolEarnings: any = null;
        try {
          const result: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['calendarEvents'] }, { validateResult: false }));
          if (result && result.calendarEvents && result.calendarEvents.earnings) {
            const earningsData = result.calendarEvents.earnings;
            if (earningsData.earningsDate && earningsData.earningsDate.length > 0) {
              symbolEarnings = {
                symbol,
                date: earningsData.earningsDate[0],
                estimate: earningsData.earningsAverage,
                high: earningsData.earningsHigh,
                low: earningsData.earningsLow
              };
            }
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          if (msg.includes('No fundamentals data found') || msg.includes('Quote not found') || msg.includes('Not Found')) {
            console.log(`No earnings data available for ${symbol}`);
          } else if (err?.cause?.code === 'ECONNRESET' || err?.code === 'UND_ERR_CONNECT_TIMEOUT' || msg.includes('fetch failed') || msg.includes('socket hang up')) {
            console.warn(`Yahoo Finance earnings warning for ${symbol}: ${err?.code || err?.cause?.code || msg}.`);
          } else {
            console.log(`Error fetching earnings for ${symbol}: ${msg}`);
          }
        }

        // Fallback to Finnhub if no Yahoo earnings
        if (!symbolEarnings && finnhubClient) {
          try {
            await new Promise<void>((resolve) => {
              const fromDate = new Date(now - 30 * 86400000).toISOString().split('T')[0];
              const toDate = new Date(now + 90 * 86400000).toISOString().split('T')[0];
              finnhubClient.earningsCalendar({ from: fromDate, to: toDate, symbol }, (err: any, data: any) => {
                if (data && data.earningsCalendar && data.earningsCalendar.length > 0) {
                  const ev = data.earningsCalendar[0];
                  if (ev.date) {
                    symbolEarnings = {
                      symbol,
                      date: `${ev.date}T20:00:00.000Z`,
                      estimate: ev.epsEstimate,
                      high: null,
                      low: null
                    };
                  }
                }
                resolve();
              });
            });
          } catch (e) {
            // ignore
          }
        }

        if (symbolEarnings) {
          earnings.push(symbolEarnings);
        }
      }
      
      earningsCache.set(cacheKey, { data: earnings, timestamp: now });
      res.json(earnings);
    } catch (error) {
      console.error('Error fetching earnings:', error);
      res.status(500).json({ error: 'Failed to fetch earnings' });
    }
  });

  app.get('/api/calendar/earnings.ics', async (req, res) => {
    const symbols = req.query.symbols as string;
    if (!symbols) return res.status(400).send('Symbols required');

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
    const now = Date.now();
    const earnings: any[] = [];

    const cacheKey = symbolList.sort().join(',');
    const cached = earningsCache.get(cacheKey);
    
    let eventsToProcess = [];
    if (cached && (now - cached.timestamp < EARNINGS_TTL)) {
      eventsToProcess = cached.data;
    } else {
      try {
        for (const symbol of symbolList) {
          try {
            const result: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['calendarEvents'] }, { validateResult: false }));
            if (result && result.calendarEvents && result.calendarEvents.earnings) {
              const earningsData = result.calendarEvents.earnings;
              if (earningsData.earningsDate && earningsData.earningsDate.length > 0) {
                earnings.push({
                  symbol,
                  date: earningsData.earningsDate[0],
                  estimate: earningsData.earningsAverage,
                  high: earningsData.earningsHigh,
                  low: earningsData.earningsLow
                });
              }
            }
          } catch (err) {
            // ignore errors for individual symbols
          }
        }
        earningsCache.set(cacheKey, { data: earnings, timestamp: now });
        eventsToProcess = earnings;
      } catch (error) {
        console.error('Error fetching earnings for ICS:', error);
        return res.status(500).send('Error generating calendar');
      }
    }

    let ics = 'BEGIN:VCALENDAR\r\n';
    ics += 'VERSION:2.0\r\n';
    ics += 'PRODID:-//Stock Portfolio Tracker//Earnings Calendar//EN\r\n';
    ics += 'CALSCALE:GREGORIAN\r\n';
    ics += 'METHOD:PUBLISH\r\n';
    ics += 'X-WR-CALNAME:Earnings Calendar\r\n';
    ics += 'X-WR-TIMEZONE:UTC\r\n';
    
    eventsToProcess.forEach(event => {
      if (!event.date) return;
      const date = new Date(event.date);
      const dateStr = date.toISOString().replace(/[-:]/g, '').substring(0, 8);
      const dtstamp = new Date().toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
      
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:${event.symbol}-earnings-${dateStr}@stocktracker\r\n`;
      ics += `DTSTAMP:${dtstamp}\r\n`;
      ics += `DTSTART;VALUE=DATE:${dateStr}\r\n`;
      ics += `SUMMARY:${event.symbol} Earnings\r\n`;
      ics += `DESCRIPTION:Estimated EPS: ${event.estimate || 'N/A'}\\nHigh: ${event.high || 'N/A'}\\nLow: ${event.low || 'N/A'}\r\n`;
      ics += 'END:VEVENT\r\n';
    });
    
    ics += 'END:VCALENDAR\r\n';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="earnings.ics"');
    res.send(ics);
  });

  app.get('/api/dividends', async (req, res) => {
    const symbols = req.query.symbols as string;
    if (!symbols) return res.json([]);

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
    const dividends: any[] = [];

    try {
      for (const symbol of symbolList) {
        try {
          const result: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['summaryDetail', 'calendarEvents'] }, { validateResult: false }));
          if (result) {
            const summary = result.summaryDetail;
            const calendar = result.calendarEvents;
            
            if (summary?.dividendRate || calendar?.exDividendDate) {
              dividends.push({
                symbol,
                dividendRate: summary?.dividendRate || summary?.trailingAnnualDividendRate,
                dividendYield: summary?.dividendYield || summary?.trailingAnnualDividendYield,
                exDividendDate: calendar?.exDividendDate || summary?.exDividendDate,
                dividendDate: calendar?.dividendDate,
                payoutRatio: summary?.payoutRatio,
                fiveYearAvgDividendYield: summary?.fiveYearAvgDividendYield
              });
            }
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          if (msg.includes('No fundamentals data found') || msg.includes('Quote not found') || msg.includes('Not Found')) {
            // Ignore
          } else if (err?.cause?.code === 'ECONNRESET' || err?.code === 'UND_ERR_CONNECT_TIMEOUT' || msg.includes('fetch failed') || msg.includes('socket hang up')) {
            console.warn(`Yahoo Finance dividends warning for ${symbol}: ${err?.code || err?.cause?.code || msg}.`);
          } else {
            console.log(`Error fetching dividends for ${symbol}: ${msg}`);
          }
        }
      }
      
      res.json(dividends);
    } catch (error) {
      console.error('Error fetching dividends:', error);
      res.status(500).json({ error: 'Failed to fetch dividends' });
    }
  });

  app.get('/api/financials', async (req, res) => {
    const symbol = req.query.symbol as string;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

    try {
      const result: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { 
        modules: ['incomeStatementHistory', 'balanceSheetHistory', 'cashflowStatementHistory', 'financialData'] 
      }, { validateResult: false }));
      
      const incomeStatement = result.incomeStatementHistory?.incomeStatementHistory || [];
      const balanceSheet = result.balanceSheetHistory?.balanceSheetStatements || [];
      const cashflow = result.cashflowStatementHistory?.cashflowStatements || [];
      
      const yearsMap = new Map();
      
      const processStatements = (statements: any[], type: string) => {
        statements.forEach(stmt => {
          if (!stmt.endDate) return;
          const year = new Date(stmt.endDate).getFullYear().toString();
          if (!yearsMap.has(year)) {
            yearsMap.set(year, { year });
          }
          const yearData = yearsMap.get(year);
          
          if (type === 'income') {
            yearData.revenue = stmt.totalRevenue;
            yearData.netIncome = stmt.netIncome;
            yearData.operatingIncome = stmt.operatingIncome;
            yearData.grossProfit = stmt.grossProfit;
          } else if (type === 'balance') {
            yearData.totalAssets = stmt.totalAssets;
            yearData.totalLiabilities = stmt.totalLiab;
            yearData.totalEquity = stmt.totalStockholderEquity;
          } else if (type === 'cashflow') {
            yearData.operatingCashflow = stmt.totalCashFromOperatingActivities;
            yearData.freeCashflow = (stmt.totalCashFromOperatingActivities || 0) + (stmt.capitalExpenditures || 0);
          }
        });
      };

      processStatements(incomeStatement, 'income');
      processStatements(balanceSheet, 'balance');
      processStatements(cashflow, 'cashflow');

      const kpis = Array.from(yearsMap.values()).sort((a, b) => parseInt(a.year) - parseInt(b.year));
      
      res.json({
        kpis,
        financialData: result.financialData
      });
    } catch (error: any) {
      const errorCode = error.code || error.cause?.code;
      const errorMessage = error.message || '';
      if (errorCode === 'ECONNRESET' || errorCode === 'UND_ERR_CONNECT_TIMEOUT' || errorMessage.includes('fetch failed') || errorMessage.includes('socket hang up')) {
        console.warn(`Yahoo Finance financials warning for ${symbol}: ${errorCode || errorMessage}.`);
        res.status(503).json({ error: 'Service temporarily unavailable' });
      } else {
        console.error('Error fetching financials:', error);
        res.status(500).json({ error: 'Failed to fetch financials' });
      }
    }
  });

  app.get('/api/logo/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    
    // Check if we have a known domain for this ticker
    const TICKER_DOMAINS: Record<string, string> = {
      'AAPL': 'apple.com',
      'MSFT': 'microsoft.com',
      'GOOGL': 'google.com',
      'GOOG': 'google.com',
      'AMZN': 'amazon.com',
      'META': 'facebook.com',
      'TSLA': 'tesla.com',
      'NVDA': 'nvidia.com',
      'V': 'visa.com',
      'PYPL': 'paypal.com',
      'NFLX': 'netflix.com',
      'BRK-B': 'berkshirehathaway.com',
      'AVGO': 'broadcom.com',
      'AMD': 'amd.com',
      'DLO': 'dlocal.com',
      'BMNR': 'bitminetech.io',
      'ENPH': 'enphase.com',
      'FBL': 'fbl.com',
      'SOFI': 'sofi.com',
      'DUOL': 'duolingo.com'
    };

    let domain = TICKER_DOMAINS[symbol];
    
    if (!domain) {
      try {
        const result: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] }, { validateResult: false }));
        if (result?.assetProfile?.website) {
          domain = new URL(result.assetProfile.website).hostname;
          domain = domain.replace(/^www\./, '');
        }
      } catch (err) {
        // ignore
      }
    }

    const faviconUrls = [];
    
    if (domain) {
      faviconUrls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
      faviconUrls.push(`https://logo.clearbit.com/${domain}`);
      faviconUrls.push(`https://icon.horse/icon/${domain}`);
    }
    
    // Add fallback based on ticker if we don't know the domain
    faviconUrls.push(`https://unavatar.io/yahoo/${symbol}`);

    for (const url of faviconUrls) {
      try {
        const logoRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3000) });
        if (logoRes.ok) {
          const buffer = await logoRes.arrayBuffer();
          res.setHeader('Content-Type', logoRes.headers.get('Content-Type') || 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(Buffer.from(buffer));
        }
      } catch (err) {
        // Try next
      }
    }

    if (domain) {
      try {
        const websiteUrl = `https://${domain}`;
        const htmlRes = await fetch(websiteUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          let iconUrl = '';
          const linkTags = html.match(/<link[^>]+>/ig) || [];
          for (const tag of linkTags) {
            if (/rel=["'][^"']*(icon|apple-touch-icon)[^"']*["']/i.test(tag)) {
              const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
              if (hrefMatch) {
                iconUrl = hrefMatch[1];
                break;
              }
            }
          }
          if (!iconUrl) iconUrl = '/favicon.ico';

          const absoluteIconUrl = new URL(iconUrl, websiteUrl).href;
          const iconRes = await fetch(absoluteIconUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) });
          if (iconRes.ok) {
            const buffer = await iconRes.arrayBuffer();
            res.setHeader('Content-Type', iconRes.headers.get('Content-Type') || 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(Buffer.from(buffer));
          }
        }
      } catch (err) {
        // Ignore and let it fall to 404
      }
    }

    res.status(404).send('Not found');
  });

  app.get('/api/fear-greed', async (req, res) => {
    const symbolsRaw = req.query.symbols as string;
    if (!symbolsRaw) return res.status(400).json({ error: 'Symbols are required' });

    const symbolList = symbolsRaw.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== 'CASH');
    if (symbolList.length === 0) {
      return res.json({ score: 50, rating: 'Neutral', details: 'No equity holdings' });
    }

    try {
      const now = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 45); // Get extra for RSI calculation

      const results: Record<string, any> = {};
      
      // Fetch in parallel in batches of 10 to avoid rate limits
      for (let i = 0; i < symbolList.length; i += 10) {
        const batch = symbolList.slice(i, i + 10);
        await Promise.all(batch.map(async (symbol) => {
          try {
            // Use Date objects for period1 and period2 to avoid format issues
            const chartData: any = await yahooWithRetry(() => yahooFinance.chart(symbol, {
              period1: thirtyDaysAgo,
              period2: now,
              interval: '1d'
            }, { validateResult: false }));
            const prices = chartData?.quotes ? chartData.quotes.filter((q: any) => q.close !== null && q.close !== undefined) : [];
            if (Array.isArray(prices) && prices.length > 5) {
              results[symbol] = prices;
            }
          } catch (err) {
            console.warn(`Fear/Greed fetch failed for ${symbol}:`, err);
          }
        }));
      }

      const scores: number[] = [];
      const details: any[] = [];

      Object.entries(results).forEach(([symbol, prices]) => {
        const closes = prices.map((p: any) => p.close).filter((c: any) => c !== undefined);
        if (closes.length < 15) return;

        // RSI Calculation (14-day)
        let gains = 0;
        let losses = 0;
        for (let i = closes.length - 14; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff >= 0) gains += diff;
          else losses -= diff;
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        // Momentum (1 month approx)
        const currentPrice = closes[closes.length - 1];
        const monthAgoPrice = closes[0];
        const momentum = ((currentPrice - monthAgoPrice) / monthAgoPrice) * 100;
        
        // Normalize Momentum (-10% to +10% -> 0 to 100)
        const momentumScore = Math.min(Math.max((momentum + 10) * 5, 0), 100);
        
        // Combined Score for this symbol
        const symbolScore = (rsi + momentumScore) / 2;
        scores.push(symbolScore);
        details.push({ symbol, rsi, momentum, score: symbolScore });
      });

      if (scores.length === 0) {
        return res.json({ score: 50, rating: 'Neutral', details: 'Insufficient historical data' });
      }

      const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      
      let rating = 'Neutral';
      if (averageScore <= 25) rating = 'Extreme Fear';
      else if (averageScore <= 45) rating = 'Fear';
      else if (averageScore <= 55) rating = 'Neutral';
      else if (averageScore <= 75) rating = 'Greed';
      else rating = 'Extreme Greed';

      res.json({
        score: Math.round(averageScore),
        rating,
        details: details.sort((a, b) => b.score - a.score)
      });

    } catch (error: any) {
      console.error('Fear & Greed calculate error:', error);
      res.status(500).json({ error: 'Failed to calculate Fear & Greed index' });
    }
  });

  app.get('/api/metadata', async (req, res) => {
    const symbols = req.query.symbols as string;
    if (!symbols) return res.json({});

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
    const now = Date.now();
    const metadata: Record<string, any> = {};
    const symbolsToFetch: string[] = [];

    // Check cache
    symbolList.forEach(symbol => {
      const cached = metadataCache.get(symbol);
      if (cached && (now - cached.timestamp < METADATA_TTL)) {
        metadata[symbol] = cached.data;
      } else {
        symbolsToFetch.push(symbol);
      }
    });

    if (symbolsToFetch.length === 0) {
      return res.json(metadata);
    }

    const TICKER_DOMAINS: Record<string, string> = {
      'GOOGL': 'google.com',
      'GOOG': 'google.com',
      'META': 'facebook.com',
      'AMZN': 'amazon.com',
      'AVGO': 'broadcom.com',
      'SOFI': 'sofi.com',
      'AMD': 'amd.com',
      'NVDA': 'nvidia.com',
      'COIN': 'coinbase.com',
      'DLO': 'dlocal.com',
      'NBIS': 'nebius.com',
      'TSLA': 'tesla.com',
      'MSFT': 'microsoft.com',
      'AAPL': 'apple.com',
      'NFLX': 'netflix.com'
    };

    try {
      for (const symbol of symbolsToFetch) {
        try {
          let sector = 'Unknown';
          let industry = 'Unknown';
          let website = '';
          let logo = '';

          if (TICKER_DOMAINS[symbol]) {
            logo = `/api/logo/${symbol}`;
          }

          try {
            const result: any = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] }, { validateResult: false }));
            if (result && result.assetProfile) {
              sector = result.assetProfile.sector || 'Unknown';
              industry = result.assetProfile.industry || 'Unknown';
              website = result.assetProfile.website || '';
              
              if (!logo && (website || symbol)) {
                logo = `/api/logo/${symbol}`;
              }
            }
          } catch (yErr) {}

          if (!logo && finnhubClient) {
            await new Promise<void>((resolve) => {
              finnhubClient.companyProfile2({ symbol }, (error: any, data: any) => {
                if (!error && data && data.logo) logo = data.logo;
                resolve();
              });
            });
          }

          if (!logo) {
            logo = `https://www.google.com/s2/favicons?domain=${symbol.toLowerCase()}.com&sz=128`;
          }

          const data = { sector, industry, website, logo };
          metadata[symbol] = data;
          metadataCache.set(symbol, { data, timestamp: now });
        } catch (err) {
          metadata[symbol] = { sector: 'Unknown', industry: 'Unknown' };
        }
      }
      
      res.json(metadata);
    } catch (error) {
      console.error('Error fetching metadata:', error);
      res.status(500).json({ error: 'Failed to fetch metadata' });
    }
  });



  // --- WebSocket Setup ---
  const subscribedSymbols = new Set<string>();
  let finnhubWs: any = null;
  let finnhubReconnectAttempts = 0;
  let finnhubReconnectTimeout: NodeJS.Timeout | null = null;

  function setupFinnhubWs() {
    try {
      if (!finnhubApiKey || finnhubWs) return;

      if (finnhubReconnectTimeout) {
        clearTimeout(finnhubReconnectTimeout);
        finnhubReconnectTimeout = null;
      }

      console.log(`Connecting to Finnhub WebSocket (Attempt ${finnhubReconnectAttempts + 1})...`);
      finnhubWs = new WebSocket(`wss://ws.finnhub.io?token=${finnhubApiKey}`);

      finnhubWs.on('open', () => {
        console.log('Connected to Finnhub WebSocket');
        finnhubReconnectAttempts = 0; // Reset attempts on success
        subscribedSymbols.forEach(sym => {
          try {
            finnhubWs.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
          } catch {}
        });
      });

      finnhubWs.on('message', (data: any) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'trade') {
            const trades = message.data.map((t: any) => ({
              s: t.s,
              p: t.p,
              v: t.v,
              t: t.t
            }));
            
            const broadcastMsg = JSON.stringify({ type: 'trade', data: trades });
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(broadcastMsg);
              }
            });
          }
        } catch (e) {
          console.error('Finnhub WS message error:', e);
        }
      });

      finnhubWs.on('error', (err: any) => {
        const errMsg = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
        if (errMsg.includes('429')) {
          console.warn('Finnhub WS Rate Limited: Received 429. Increasing backoff to avoid spamming.');
          if (finnhubReconnectAttempts < 6) {
            finnhubReconnectAttempts = 6; // Force at least 5 * 2^6 = 320s = 5.3 min backoff
          }
        } else {
          console.warn('Finnhub WS warning:', errMsg);
        }
      });

      finnhubWs.on('close', (code: number, reason: string) => {
        console.log(`Finnhub WS connection closed (code: ${code}, reason: ${reason || 'none'}).`);
        finnhubWs = null;

        if (finnhubReconnectAttempts > 10) {
          console.warn('Finnhub WS: Maximum backoff attempts reached. Disabling connection attempts. Relying entirely on Yahoo Finance 15s polling fallback.');
          return;
        }
        
        // Exponential backoff: 5s, 10s, 20s, 40s, up to 10 minutes
        const backoff = Math.min(5000 * Math.pow(2, finnhubReconnectAttempts), 600000);
        finnhubReconnectAttempts++;
        
        console.log(`Reconnecting to Finnhub WS in ${(backoff / 1000).toFixed(1)}s (Attempt ${finnhubReconnectAttempts})...`);
        finnhubReconnectTimeout = setTimeout(setupFinnhubWs, backoff);
      });
    } catch (wsSetupErr) {
      console.error('Failed to initialize Finnhub WebSocket:', wsSetupErr);
    }
  }

  if (finnhubApiKey) {
    setupFinnhubWs();
  }

  async function fetchYahooQuotes() {
    // Only poll Yahoo if Finnhub is NOT active or for symbols not yet trading
    if (subscribedSymbols.size === 0) return;
    
    const symbols = Array.from(subscribedSymbols)
      .map(s => String(s).trim().toUpperCase())
      .filter(s => s && s !== 'CASH');
    
    if (symbols.length > 0) {
      try {
        let quotesArray: any[] = [];
        try {
          const results = await yahooWithRetry(() => yahooFinance.quote(symbols, {}, { validateResult: false }));
          quotesArray = Array.isArray(results) ? results : [results];
        } catch (bulkErr: any) {
          // If bulk fetch failed, fall back to fetching them individually or in batches to isolate bad tickers
          for (const sym of symbols) {
            try {
              const res = await yahooWithRetry(() => yahooFinance.quote(sym, {}, { validateResult: false }));
              if (res) {
                quotesArray.push(res);
              }
            } catch (indivErr: any) {
              // Silently ignore individual failures to prevent logging slop or breaking polling
            }
          }
        }
        
        const trades = quotesArray
          .filter(quote => quote && quote.symbol)
          .map((quote: any) => {
            let price = quote.regularMarketPrice;
            let previousClose = quote.regularMarketPreviousClose;
            
            if (quote.marketState === 'PRE' && quote.preMarketPrice) {
              price = quote.preMarketPrice;
            } else if ((quote.marketState === 'POST' || quote.marketState === 'CLOSED' || quote.marketState === 'POSTPOST') && quote.postMarketPrice) {
              price = quote.postMarketPrice;
            } else if (quote.postMarketPrice && quote.marketState !== 'REGULAR') {
              price = quote.postMarketPrice;
            }

            return {
              s: quote.symbol,
              p: price,
              pc: previousClose,
              ms: quote.marketState
            };
          });

        if (trades.length > 0) {
          const messageStr = JSON.stringify({ type: 'trade', data: trades });
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(messageStr);
            }
          });
        }
      } catch (err: any) {
        const errorCode = err.code || err.cause?.code;
        const errorMessage = err.message || '';
        if (errorCode === 'ECONNRESET' || errorCode === 'UND_ERR_CONNECT_TIMEOUT' || errorMessage.includes('fetch failed') || errorMessage.includes('socket hang up')) {
          // Silently ignore retryable errors during polling
        } else {
          console.warn('Yahoo Finance polling query warning (gracefully handled):', err.message || err);
        }
      }
    }
  }

  // Poll Yahoo Finance every 15 seconds for "real-time" updates including extended hours
  setInterval(fetchYahooQuotes, 15000);

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'subscribe' && Array.isArray(data.symbols)) {
          data.symbols.forEach((sym: string) => {
            const cleanSym = sym && typeof sym === 'string' ? sym.trim().toUpperCase() : '';
            if (cleanSym && cleanSym !== 'CASH' && !subscribedSymbols.has(cleanSym)) {
              subscribedSymbols.add(cleanSym);
              if (finnhubWs && finnhubWs.readyState === WebSocket.OPEN) {
                finnhubWs.send(JSON.stringify({ type: 'subscribe', symbol: cleanSym }));
              }
            }
          });
          // Immediately fetch for new subscriptions
          fetchYahooQuotes();
        }
      } catch (e) {
        console.error('WS message error', e);
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
