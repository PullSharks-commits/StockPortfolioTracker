import express from 'express';
console.log('Server file loading...');
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import multer from 'multer';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const finnhub = require('finnhub');
import fs from 'fs';
import path from 'path';
import session from 'express-session';
import crypto from 'crypto';
import dns from 'node:dns/promises';

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
    'UND_ERR_CONNECT_TIMEOUT'
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
const economicCache = new Map<string, { data: any, timestamp: number }>();

const CACHE_TTL = 60 * 1000; // 1 minute
const METADATA_TTL = 24 * 60 * 60 * 1000; // 24 hours
const EARNINGS_TTL = 12 * 60 * 60 * 1000; // 12 hours
const ECONOMIC_TTL = 6 * 60 * 60 * 1000; // 6 hours

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
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout
      
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
        console.warn(`Fetch attempt ${i + 1} failed for ${url}. Error: ${errorCode || err.name}. Cause: ${causeMessage}. Retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2;
        continue;
      }
      
      console.error(`Fetch failed for ${url} after ${i + 1} attempts. Final Error:`, {
        message: err.message,
        code: errorCode,
        name: err.name,
        cause: err.cause,
        stack: err.stack
      });
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

const mysqlUrl = (process.env.MYSQL_URL || process.env.DATABASE_URL || '').trim();
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
      mysqlPool = mysql.createPool(process.env.MYSQL_URL || process.env.DATABASE_URL || '');
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
    sqliteDb = new Database('portfolio.db');
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
  if (row.count === 0) {
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

  app.use(express.json());

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
      const results = await yahooWithRetry(() => yahooFinance.search(q));
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


  // API Routes
  async function syncToFile() {
    try {
      const rows = await db.query('SELECT ticker, shares, avg_price FROM portfolio');
      fs.writeFileSync(path.resolve('portfolio.json'), JSON.stringify(rows, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error syncing portfolio to file:', error);
    }
  }

  app.get('/api/portfolio', async (req, res) => {
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

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/calendar/economic.ics', async (req, res) => {
    const from = req.query.from as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = req.query.to as string || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
      // Use existing internal logic to fetch economic events
      // Since it's a GET request, we can just call the endpoint code or similar
      // For simplicity, let's just use fetch internally or duplicate logic
      const response = await fetch(`http://localhost:3000/api/economic-events?from=${from}&to=${to}`);
      if (!response.ok) throw new Error('Failed to fetch events');
      const events: any[] = await response.json();

      let ics = 'BEGIN:VCALENDAR\r\n';
      ics += 'VERSION:2.0\r\n';
      ics += 'PRODID:-//Stock Portfolio Tracker//Economic Calendar//EN\r\n';
      ics += 'CALSCALE:GREGORIAN\r\n';
      ics += 'METHOD:PUBLISH\r\n';
      ics += 'X-WR-CALNAME:Economic Calendar\r\n';
      ics += 'X-WR-TIMEZONE:UTC\r\n';
      
      events.forEach(event => {
        if (!event.time) return;
        const date = new Date(event.time);
        const dateStr = date.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        const dtstamp = new Date().toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        // Add 30 mins duration
        const endDate = new Date(date.getTime() + 30 * 60000);
        const endDateStr = endDate.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
        
        ics += 'BEGIN:VEVENT\r\n';
        ics += `UID:econ-${event.event.replace(/\s+/g, '-')}-${dateStr}@stocktracker\r\n`;
        ics += `DTSTAMP:${dtstamp}\r\n`;
        ics += `DTSTART:${dateStr}\r\n`;
        ics += `DTEND:${endDateStr}\r\n`;
        ics += `SUMMARY:Economic: ${event.event}\r\n`;
        ics += `DESCRIPTION:Country: ${event.country}\\nImpact: ${event.impact}\\nEstimate: ${event.estimate || 'N/A'}${event.unit || ''}\\nPrevious: ${event.previous || 'N/A'}${event.unit || ''}\r\n`;
        ics += 'END:VEVENT\r\n';
      });
      
      ics += 'END:VCALENDAR\r\n';

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="economic_events.ics"');
      res.send(ics);
    } catch (error) {
      console.error('Error generating economic ics:', error);
      res.status(500).send('Error generating calendar');
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

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const queryOptions: any = { period1: period1Str };
    if (period2Str) queryOptions.period2 = period2Str;
    queryOptions.interval = '1d';

    try {
      const results: Record<string, any> = {};
      
      for (const sym of symbolList) {
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
              // Check if the range is fully covered (rough check: if we have any data and it's not force-refresh)
              // For a more robust cache, we might want to check the max date in cache vs today
              const maxDateInStack = rows[rows.length - 1].date;
              const todayStr = new Date().toISOString().split('T')[0];
              
              if (maxDateInStack >= todayStr || (new Date().getDay() === 0 || new Date().getDay() === 6)) { // Weekends
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
            const data = await yahooWithRetry(() => yahooFinance.historical(sym, queryOptions));
            const formattedData = Array.isArray(data) ? data : [];
            results[sym] = formattedData;

            // Update cache asynchronously
            if (formattedData.length > 0) {
              (async () => {
                try {
                  for (const p of formattedData) {
                    if (p.date && p.close !== undefined) {
                      const d = p.date instanceof Date ? p.date.toISOString().split('T')[0] : p.date.split('T')[0];
                      await db.run(
                        'INSERT OR REPLACE INTO historical_prices (ticker, date, close) VALUES (?, ?, ?)',
                        [sym, d, p.close]
                      ).catch(e => {
                        // For MySQL it might be INSERT INTO ... ON DUPLICATE KEY UPDATE
                        if (isMysql) {
                           db.run(
                            'INSERT INTO historical_prices (ticker, date, close) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE close = VALUES(close)',
                            [sym, d, p.close]
                          ).catch(() => {});
                        }
                      });
                    }
                  }
                } catch (cacheErr) {
                  console.error(`Failed to update cache for ${sym}:`, cacheErr);
                }
              })();
            }
          } catch (err: any) {
            console.warn(`Failed getting historical for ${sym}: ${err.message}`);
            results[sym] = cachedData; // Fallback to whatever we had
          }
        } else {
          results[sym] = cachedData;
        }
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

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
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
      const results = await yahooWithRetry(() => yahooFinance.quote(symbolsToFetch));
      const quotesArray = Array.isArray(results) ? results : [results];
      
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
        console.error('Yahoo Finance bulk quote error:', error);
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
        console.error('Finnhub fallback quote error:', err);
      }
    }

    return res.json(quotes);
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
        try {
          const result = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['calendarEvents'] }));
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
            const result = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['calendarEvents'] }));
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
          const result = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['summaryDetail', 'calendarEvents'] }));
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

  app.get('/api/economic-events', async (req, res) => {
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      return res.status(400).json({ error: 'Missing from or to date' });
    }

    const now = Date.now();
    const cacheKey = `economic-${from}-${to}`;
    const cached = economicCache.get(cacheKey);
    if (cached && (now - cached.timestamp < ECONOMIC_TTL)) {
      return res.json(cached.data);
    }

    try {
      // 1. Try Finnhub if client is available
      if (finnhubClient) {
        try {
          const finnhubData = await new Promise<any>((resolve, reject) => {
            finnhubClient.economicCalendar({ from, to }, (error: any, data: any) => {
              if (error) reject(error);
              else resolve(data);
            });
          });

          if (finnhubData && Array.isArray(finnhubData.economicCalendar)) {
            const events = finnhubData.economicCalendar
              .filter((e: any) => e.country === 'United States')
              .map((e: any) => ({
                actual: e.actual || null,
                country: e.country,
                estimate: e.estimate || null,
                event: e.event,
                impact: e.impact === 'high' ? 'High' : e.impact === 'medium' ? 'Medium' : 'Low',
                previous: e.prev || null,
                time: e.time ? (e.time.includes('Z') ? e.time : `${e.time.replace(' ', 'T')}Z`) : null,
                unit: e.unit || ''
              })).filter((e: any) => e.time !== null);
            
            if (events.length > 0) {
              economicCache.set(cacheKey, { data: events, timestamp: now });
              return res.json(events);
            }
          }
        } catch (fErr) {
          console.warn('Finnhub economic calendar fetch failed:', fErr);
        }
      }

      // 2. Fallback to Trading Economics (Country specific)
      try {
        const response = await fetchWithRetry(`https://api.tradingeconomics.com/calendar/country/united%20states/${from}/${to}?c=guest:guest&f=json`);
        
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            const usEvents = data.map((event: any) => ({
              actual: event.Actual || null,
              country: event.Country,
              estimate: event.Forecast || event.TEForecast || null,
              event: event.Event,
              impact: event.Importance === 3 ? 'High' : event.Importance === 2 ? 'Medium' : 'Low',
              previous: event.Previous || null,
              time: event.Date ? `${event.Date}Z` : null,
              unit: event.Unit || ''
            })).filter(e => e.time !== null);

            economicCache.set(cacheKey, { data: usEvents, timestamp: now });
            return res.json(usEvents);
          }
        } else if (response.status === 410 || response.status === 403) {
           console.warn(`Trading Economics API returned ${response.status}. Trying generic calendar...`);
           
           // 3. Last ditch effort: Generic Trading Economics calendar (upcoming)
           const genericRes = await fetchWithRetry(`https://api.tradingeconomics.com/calendar?c=guest:guest&f=json`);
           if (genericRes.ok) {
             const gData = await genericRes.json();
             if (Array.isArray(gData)) {
               const gEvents = gData.map((event: any) => ({
                 actual: event.Actual || null,
                 country: event.Country,
                 estimate: event.Forecast || null,
                 event: event.Event,
                 impact: event.Importance === 3 ? 'High' : event.Importance === 2 ? 'Medium' : 'Low',
                 previous: event.Previous || null,
                 time: event.Date ? `${event.Date}Z` : null,
                 unit: event.Unit || ''
               })).filter(e => e.time !== null && e.country === 'United States');
               
               economicCache.set(cacheKey, { data: gEvents, timestamp: now });
               return res.json(gEvents);
             }
           }
        }
      } catch (teErr) {
        console.error('Trading Economics fetch failed:', teErr);
      }

      // If all failed, return empty array instead of 500
      res.json([]);
    } catch (error) {
      console.error('General error fetching economic events:', error);
      res.status(500).json({ error: 'Failed to fetch economic events' });
    }
  });

  app.get('/api/financials', async (req, res) => {
    const symbol = req.query.symbol as string;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

    try {
      const result = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { 
        modules: ['incomeStatementHistory', 'balanceSheetHistory', 'cashflowStatementHistory', 'financialData'] 
      }));
      
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
      'BMNR': 'beimani.com',
      'ENPH': 'enphase.com',
      'FBL': 'fbl.com',
      'SOFI': 'sofi.com',
      'DUOL': 'duolingo.com'
    };

    let domain = TICKER_DOMAINS[symbol];
    
    if (!domain) {
      try {
        const result = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] }));
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
            const result = await yahooWithRetry(() => yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] }));
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
        finnhubWs.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
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
      console.error('Finnhub WS error:', err.message || err);
      // If it's a 429, we should definitely back off
      if (err.message && err.message.includes('429')) {
        console.warn('Finnhub WS: Rate limited (429). Increasing backoff.');
        // Jump to a higher attempt count to force a longer wait
        if (finnhubReconnectAttempts < 3) finnhubReconnectAttempts = 3;
      }
    });

    finnhubWs.on('close', (code: number, reason: string) => {
      console.log(`Finnhub WS closed (code: ${code}, reason: ${reason}). Reconnecting...`);
      finnhubWs = null;
      
      // Exponential backoff: 5s, 10s, 20s, 40s, up to 60s
      const backoff = Math.min(5000 * Math.pow(2, finnhubReconnectAttempts), 60000);
      finnhubReconnectAttempts++;
      
      console.log(`Reconnecting to Finnhub WS in ${backoff}ms...`);
      finnhubReconnectTimeout = setTimeout(setupFinnhubWs, backoff);
    });
  }

  if (finnhubApiKey) {
    setupFinnhubWs();
  }

  async function fetchYahooQuotes() {
    // Only poll Yahoo if Finnhub is NOT active or for symbols not yet trading
    if (subscribedSymbols.size === 0) return;
    
    const symbols = Array.from(subscribedSymbols);
    
    if (symbols.length > 0) {
      try {
        const results = await yahooWithRetry(() => yahooFinance.quote(symbols));
        const quotesArray = Array.isArray(results) ? results : [results];
        
        const trades = quotesArray.map((quote: any) => {
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
          console.error('Yahoo Finance polling error:', err);
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
            if (!subscribedSymbols.has(sym)) {
              subscribedSymbols.add(sym);
              if (finnhubWs && finnhubWs.readyState === WebSocket.OPEN) {
                finnhubWs.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
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
