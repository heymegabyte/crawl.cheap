-- Migration 0007: Full D1 Durability for Scrape Snapshots, Idempotency Keys,
-- Multi-Turn Agent Threads/Traces/Snapshots, Deep Research, LLMs.txt, Threat Protection,
-- Interactive Browser Sessions, Feedback, Parse Uploads, and Workers AI Token Ledger.

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  key_id TEXT,
  url TEXT NOT NULL,
  document_json TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'http',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_team ON scrape_jobs(team_id, created_at);

CREATE TABLE IF NOT EXISTS crawl_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  team_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  key_id TEXT,
  prompt TEXT NOT NULL,
  urls_json TEXT NOT NULL DEFAULT '[]',
  schema_json TEXT,
  thread_id TEXT NOT NULL,
  thread_turn INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'processing',
  data_json TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  trace_json TEXT NOT NULL DEFAULT '[]',
  snapshots_json TEXT NOT NULL DEFAULT '{}',
  credits_used INTEGER NOT NULL DEFAULT 2,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_team ON agent_jobs(team_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_thread ON agent_jobs(thread_id, thread_turn);

CREATE TABLE IF NOT EXISTS deep_research_jobs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  key_id TEXT,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  current_depth INTEGER NOT NULL DEFAULT 1,
  max_depth INTEGER NOT NULL DEFAULT 3,
  total_urls INTEGER NOT NULL DEFAULT 0,
  final_analysis TEXT NOT NULL DEFAULT '',
  activities_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  summaries_json TEXT NOT NULL DEFAULT '[]',
  json_data TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS llmstxt_jobs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  key_id TEXT,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  llms_txt TEXT NOT NULL DEFAULT '',
  llms_full_txt TEXT NOT NULL DEFAULT '',
  processed_urls_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS threat_protection_policies (
  team_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'enforce',
  risk_score_threshold INTEGER NOT NULL DEFAULT 80,
  blacklist_json TEXT NOT NULL DEFAULT '[]',
  whitelist_json TEXT NOT NULL DEFAULT '[]',
  blocked_tlds_json TEXT NOT NULL DEFAULT '[]',
  failure_policy TEXT NOT NULL DEFAULT 'fail_closed',
  allow_request_overrides INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS interact_sessions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  key_id TEXT,
  url TEXT NOT NULL DEFAULT 'about:blank',
  status TEXT NOT NULL DEFAULT 'active',
  trace_json TEXT NOT NULL DEFAULT '[]',
  last_screenshot TEXT,
  created_at INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interact_sessions_team ON interact_sessions(team_id, status);

CREATE TABLE IF NOT EXISTS job_feedback (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  team_id TEXT NOT NULL DEFAULT 'default',
  key_id TEXT,
  endpoint TEXT,
  vote TEXT,
  rating INTEGER,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_job_feedback_team ON job_feedback(team_id, created_at);

CREATE TABLE IF NOT EXISTS token_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL,
  team_id TEXT NOT NULL DEFAULT 'default',
  operation TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_token_ledger_key ON token_ledger(key_id, created_at);

CREATE TABLE IF NOT EXISTS parse_uploads (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  key_id TEXT,
  filename TEXT NOT NULL DEFAULT 'document.pdf',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  r2_key TEXT,
  bytes_b64 TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at TEXT NOT NULL
);
