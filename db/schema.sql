-- Portfolio data, one row set per Neon Auth user (user_id = JWT `sub`).
-- Idempotent: safe to re-run via `npm run db:migrate`. Later additions are applied
-- with ADD COLUMN IF NOT EXISTS so existing databases upgrade in place.

CREATE TABLE IF NOT EXISTS holdings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  ticker             text NOT NULL,
  shares             double precision NOT NULL DEFAULT 0,
  avg_price          double precision NOT NULL DEFAULT 0,
  avg_price_currency text,
  portfolio_type     text NOT NULL DEFAULT 'global',
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Position of the holding within its portfolio tab (drag-and-drop ordering).
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sort_order double precision;
CREATE INDEX IF NOT EXISTS holdings_user_portfolio_idx ON holdings (user_id, portfolio_type);

CREATE TABLE IF NOT EXISTS transactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  holding_id uuid NOT NULL REFERENCES holdings (id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('buy', 'sell')),
  shares     double precision NOT NULL,
  price      double precision NOT NULL,
  date       timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- For a sell matched to a specific buy lot: the id of that buy transaction.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS lot_id text;
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions (user_id);
CREATE INDEX IF NOT EXISTS transactions_holding_idx ON transactions (holding_id);

CREATE TABLE IF NOT EXISTS alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  ticker       text NOT NULL,
  condition    text NOT NULL,
  target_price double precision NOT NULL,
  is_triggered boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_user_idx ON alerts (user_id);

-- Investment thesis per holding: a summary plus measurable rules (jsonb), and the
-- last evaluated status so a worsening can be alerted once.
CREATE TABLE IF NOT EXISTS theses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  ticker            text NOT NULL,
  portfolio_type    text NOT NULL DEFAULT 'global',
  summary           text,
  rules             jsonb NOT NULL DEFAULT '[]',
  manual_status     text,
  last_status       text,
  status_changed_at timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS theses_user_ticker_idx ON theses (user_id, portfolio_type, ticker);
ALTER TABLE theses ADD COLUMN IF NOT EXISTS last_logged_at timestamptz;

-- Each thesis check, logged when the status changes and otherwise at most daily:
-- status plus every rule's value at the time.
CREATE TABLE IF NOT EXISTS thesis_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  thesis_id    uuid NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
  ticker       text NOT NULL,
  status       text NOT NULL,
  results      jsonb NOT NULL DEFAULT '[]',
  evaluated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thesis_history_thesis_idx ON thesis_history (user_id, thesis_id, evaluated_at);

-- One settings document per user (tabs, profile, AI config, layout, calendar...),
-- stored whole as JSON because its shape changes with the UI.
CREATE TABLE IF NOT EXISTS settings (
  user_id    text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}';

-- Single-slot undo buffer for "Reset portfolio", also a JSON document.
CREATE TABLE IF NOT EXISTS backups (
  user_id    text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE backups ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}';

-- Company fundamentals from SEC EDGAR, normalised (server-fundamentals.ts).
-- Shared by all users: this is public company data, not personal data.
CREATE TABLE IF NOT EXISTS company_fundamentals (
  ticker     text PRIMARY KEY,
  source     text NOT NULL,
  payload    jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Segment, product and geography revenue from filings' XBRL (server-segments.ts).
-- Shared public company data; rebuilt when the company files a new 10-Q/10-K.
CREATE TABLE IF NOT EXISTS company_segments (
  ticker           text PRIMARY KEY,
  latest_accession text,
  payload          jsonb NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);
