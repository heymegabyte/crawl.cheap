-- crawl.cheap — Better Auth + OAuth 2.1 Authorization Server + Active Crawl Registry (Cloudflare D1)

CREATE TABLE IF NOT EXISTS auth_users (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  password_hash   TEXT,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  image           TEXT,
  role            TEXT NOT NULL DEFAULT 'owner',
  plan            TEXT NOT NULL DEFAULT 'free',
  monthly_credits INTEGER NOT NULL DEFAULT 1000,
  spend_limit     INTEGER,
  created_at_ms   INTEGER NOT NULL,
  updated_at_ms   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_users_tenant ON auth_users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  token_hash         TEXT NOT NULL UNIQUE,
  created_at_ms      INTEGER NOT NULL,
  last_rotated_at_ms INTEGER NOT NULL,
  expires_at_ms      INTEGER NOT NULL,
  user_agent         TEXT,
  ip_address         TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_tenant_user ON auth_sessions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions (token_hash);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  provider_id   TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_accounts_provider ON auth_accounts (provider_id, account_id);

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  actor_user_id   TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_resource TEXT NOT NULL,
  decision        TEXT NOT NULL,
  timestamp_ms    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_tenant_time ON auth_audit_log (tenant_id, timestamp_ms DESC);

-- OAuth 2.1 Authorization Server (RFC 7591 DCR, RFC 7636 PKCE S256, RFC 8707 Resource Indicators)
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  client_name                TEXT,
  redirect_uris              TEXT NOT NULL, -- JSON array
  grant_types                TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at                 INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code_hash         TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL,
  redirect_uri      TEXT NOT NULL,
  code_challenge    TEXT NOT NULL,
  account_user_key  TEXT NOT NULL,
  resource          TEXT NOT NULL,
  scope             TEXT NOT NULL,
  expires_at        INTEGER NOT NULL,
  used              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash       TEXT PRIMARY KEY,
  kind             TEXT NOT NULL, -- 'access' | 'refresh'
  account_user_key TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  resource         TEXT NOT NULL,
  scope            TEXT NOT NULL,
  expires_at       INTEGER NOT NULL,
  revoked_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_account ON oauth_tokens (account_user_key, client_id);

-- Active crawl registry for cross-DO /crawl/active & /crawl/ongoing enumeration
CREATE TABLE IF NOT EXISTS active_crawls (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  url        TEXT NOT NULL,
  options    TEXT,
  status     TEXT NOT NULL DEFAULT 'scraping',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_crawls_team_status ON active_crawls (team_id, status);
