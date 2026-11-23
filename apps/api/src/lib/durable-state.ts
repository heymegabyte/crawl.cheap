import type { Document } from '@crawlcheap/contracts';
import { periodStartIso } from './ledger';

/**
 * Durable D1 + R2 State Manager with transparent in-memory mirror for local/test isolates.
 * Eliminates all isolate-local-only state for:
 *   - `/v2/scrape/:jobId` snapshots
 *   - `x-idempotency-key` crawl deduplication
 *   - `/v2/agent*` multi-turn threads, execution traces, and snapshots
 *   - `/v1/deep-research*` and `/v1/llmstxt*` jobs
 *   - `/v2/team/threat-protection*` policies and live URL enforcement
 *   - `/v2/interact*` sessions and Co-Pilot action traces
 *   - `/v2/feedback` persistence and search
 *   - `/v2/team/token-usage*` & `/v1/team/token-usage*` Workers AI token ledger
 *   - `/v2/parse/upload-url` & `PUT /v2/parse/upload/:id` R2 + D1 document uploads
 */

let schemaBootstrapped = false;

export async function ensureDurableStateSchema(db?: D1Database): Promise<void> {
  if (!db || schemaBootstrapped) return;
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS scrape_jobs (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL DEFAULT 'default',
        key_id TEXT,
        url TEXT NOT NULL,
        document_json TEXT NOT NULL,
        strategy TEXT NOT NULL DEFAULT 'http',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS crawl_idempotency_keys (
        idempotency_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        team_id TEXT NOT NULL DEFAULT 'default',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS agent_jobs (
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
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS deep_research_jobs (
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
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS llmstxt_jobs (
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
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS threat_protection_policies (
        team_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'enforce',
        risk_score_threshold INTEGER NOT NULL DEFAULT 80,
        blacklist_json TEXT NOT NULL DEFAULT '[]',
        whitelist_json TEXT NOT NULL DEFAULT '[]',
        blocked_tlds_json TEXT NOT NULL DEFAULT '[]',
        failure_policy TEXT NOT NULL DEFAULT 'fail_closed',
        allow_request_overrides INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS interact_sessions (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL DEFAULT 'default',
        key_id TEXT,
        url TEXT NOT NULL DEFAULT 'about:blank',
        status TEXT NOT NULL DEFAULT 'active',
        trace_json TEXT NOT NULL DEFAULT '[]',
        last_screenshot TEXT,
        created_at INTEGER NOT NULL,
        expires_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS job_feedback (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        team_id TEXT NOT NULL DEFAULT 'default',
        key_id TEXT,
        endpoint TEXT,
        vote TEXT,
        rating INTEGER,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS token_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        team_id TEXT NOT NULL DEFAULT 'default',
        operation TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
        job_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS parse_uploads (
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
      )`),
    ]);
    schemaBootstrapped = true;
  } catch {
    /* ignore if already migrated */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Scrape Job Snapshots (`POST /v2/scrape` -> `GET /v2/scrape/:jobId`)
// ─────────────────────────────────────────────────────────────────────────────
const memScrapeJobs = new Map<
  string,
  { id: string; document: Document; strategy: string; createdAt: string }
>();

export async function saveScrapeJob(
  db: D1Database | undefined,
  record: {
    id: string;
    teamId?: string;
    keyId?: string;
    url: string;
    document: Document;
    strategy: string;
  },
): Promise<void> {
  const createdAt = new Date().toISOString();
  memScrapeJobs.set(record.id, {
    id: record.id,
    document: record.document,
    strategy: record.strategy,
    createdAt,
  });
  if (memScrapeJobs.size > 500) {
    const oldest = memScrapeJobs.keys().next().value;
    if (oldest) memScrapeJobs.delete(oldest);
  }
  if (!db) return;
  try {
    await ensureDurableStateSchema(db);
    await db
      .prepare(
        `INSERT OR REPLACE INTO scrape_jobs (id, team_id, key_id, url, document_json, strategy, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        record.id,
        record.teamId ?? 'default',
        record.keyId ?? null,
        record.url,
        JSON.stringify(record.document),
        record.strategy,
        createdAt,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}

export async function getScrapeJob(
  db: D1Database | undefined,
  id: string,
): Promise<{ id: string; document: Document; strategy: string; createdAt: string } | null> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const row = await db
        .prepare(`SELECT id, document_json, strategy, created_at FROM scrape_jobs WHERE id = ?1`)
        .bind(id)
        .first<{ id: string; document_json: string; strategy: string; created_at: string }>();
      if (row) {
        return {
          id: row.id,
          document: JSON.parse(row.document_json) as Document,
          strategy: row.strategy,
          createdAt: row.created_at,
        };
      }
    } catch {
      /* fallback */
    }
  }
  return memScrapeJobs.get(id) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Crawl Idempotency Keys (`x-idempotency-key`)
// ─────────────────────────────────────────────────────────────────────────────
const memIdempotencyKeys = new Map<string, string>();

/** Claims an idempotency key for a crawl job. Returns `{ conflict: true, existingJobId }` if already used. */
export async function claimIdempotencyKey(
  db: D1Database | undefined,
  idempotencyKey: string,
  jobId: string,
  teamId = 'default',
): Promise<{ conflict: boolean; existingJobId?: string }> {
  const existingMem = memIdempotencyKeys.get(idempotencyKey);
  if (existingMem) return { conflict: true, existingJobId: existingMem };

  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const existingRow = await db
        .prepare(`SELECT job_id FROM crawl_idempotency_keys WHERE idempotency_key = ?1`)
        .bind(idempotencyKey)
        .first<{ job_id: string }>();
      if (existingRow) {
        memIdempotencyKeys.set(idempotencyKey, existingRow.job_id);
        return { conflict: true, existingJobId: existingRow.job_id };
      }
      await db
        .prepare(
          `INSERT INTO crawl_idempotency_keys (idempotency_key, job_id, team_id, created_at)
           VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(idempotencyKey, jobId, teamId, new Date().toISOString())
        .run();
    } catch {
      /* race conflict */
      const raced = await db
        .prepare(`SELECT job_id FROM crawl_idempotency_keys WHERE idempotency_key = ?1`)
        .bind(idempotencyKey)
        .first<{ job_id: string }>()
        .catch(() => null);
      if (raced) return { conflict: true, existingJobId: raced.job_id };
    }
  }

  memIdempotencyKeys.set(idempotencyKey, jobId);
  return { conflict: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Threat Protection Policies & Live Enforcement
// ─────────────────────────────────────────────────────────────────────────────
export interface ThreatProtectionPolicy {
  mode: 'off' | 'monitor' | 'enforce';
  riskScoreThreshold: number;
  blacklist: string[];
  whitelist: string[];
  blockedTlds: string[];
  failurePolicy: 'fail_open' | 'fail_closed';
  allowRequestOverrides: boolean;
}

export const DEFAULT_THREAT_POLICY: ThreatProtectionPolicy = {
  mode: 'enforce',
  riskScoreThreshold: 80,
  blacklist: [],
  whitelist: [],
  blockedTlds: [],
  failurePolicy: 'fail_closed',
  allowRequestOverrides: true,
};

const memThreatPolicies = new Map<string, ThreatProtectionPolicy>();

export async function getThreatPolicy(
  db: D1Database | undefined,
  teamId = 'default',
): Promise<ThreatProtectionPolicy> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const row = await db
        .prepare(`SELECT * FROM threat_protection_policies WHERE team_id = ?1`)
        .bind(teamId)
        .first<{
          mode: 'off' | 'monitor' | 'enforce';
          risk_score_threshold: number;
          blacklist_json: string;
          whitelist_json: string;
          blocked_tlds_json: string;
          failure_policy: 'fail_open' | 'fail_closed';
          allow_request_overrides: number;
        }>();
      if (row) {
        return {
          mode: row.mode,
          riskScoreThreshold: row.risk_score_threshold,
          blacklist: JSON.parse(row.blacklist_json) as string[],
          whitelist: JSON.parse(row.whitelist_json) as string[],
          blockedTlds: JSON.parse(row.blocked_tlds_json) as string[],
          failurePolicy: row.failure_policy,
          allowRequestOverrides: Boolean(row.allow_request_overrides),
        };
      }
    } catch {
      /* fallback */
    }
  }
  return memThreatPolicies.get(teamId) ?? { ...DEFAULT_THREAT_POLICY };
}

export async function saveThreatPolicy(
  db: D1Database | undefined,
  teamId: string,
  policy: ThreatProtectionPolicy,
): Promise<ThreatProtectionPolicy> {
  memThreatPolicies.set(teamId, policy);
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      await db
        .prepare(
          `INSERT OR REPLACE INTO threat_protection_policies
           (team_id, mode, risk_score_threshold, blacklist_json, whitelist_json, blocked_tlds_json, failure_policy, allow_request_overrides, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          teamId,
          policy.mode,
          policy.riskScoreThreshold,
          JSON.stringify(policy.blacklist),
          JSON.stringify(policy.whitelist),
          JSON.stringify(policy.blockedTlds),
          policy.failurePolicy,
          policy.allowRequestOverrides ? 1 : 0,
          new Date().toISOString(),
        )
        .run();
    } catch {
      /* fallback */
    }
  }
  return policy;
}

export async function deleteThreatPolicy(
  db: D1Database | undefined,
  teamId: string,
): Promise<void> {
  memThreatPolicies.delete(teamId);
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      await db
        .prepare(`DELETE FROM threat_protection_policies WHERE team_id = ?1`)
        .bind(teamId)
        .run();
    } catch {
      /* ignore */
    }
  }
}

export class ThreatBlockedError extends Error {
  readonly code = 'THREAT_POLICY_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'ThreatBlockedError';
  }
}

function hostMatchesEntry(hostname: string, entry: string): boolean {
  const clean = entry
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\*\./, '');
  if (!clean) return false;
  return hostname === clean || hostname.endsWith(`.${clean}`);
}

export async function assertThreatPolicyAllowed(
  db: D1Database | undefined,
  teamId: string | undefined,
  targetUrl: string,
): Promise<void> {
  if (!teamId) return;
  const policy = await getThreatPolicy(db, teamId);
  if (policy.mode !== 'enforce') return;
  let u: URL;
  try {
    u = new URL(targetUrl);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase();
  if (policy.whitelist.length > 0) {
    const allowed = policy.whitelist.some((w) => hostMatchesEntry(host, w));
    if (!allowed) {
      throw new ThreatBlockedError(
        `URL host "${host}" is not in the team threat-protection whitelist.`,
      );
    }
  }
  if (policy.blacklist.some((b) => hostMatchesEntry(host, b))) {
    throw new ThreatBlockedError(
      `URL host "${host}" is blocked by the team threat-protection blacklist.`,
    );
  }
  for (const tld of policy.blockedTlds) {
    const cleanTld = tld.trim().toLowerCase().replace(/^\./, '');
    if (cleanTld && (host === cleanTld || host.endsWith(`.${cleanTld}`))) {
      throw new ThreatBlockedError(
        `URL TLD ".${cleanTld}" is blocked by the team threat-protection policy.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Multi-Turn Agent Jobs, Traces & Snapshots (`/v2/agent*`)
// ─────────────────────────────────────────────────────────────────────────────
export interface AgentTraceEvent {
  type: 'plan' | 'search' | 'scrape' | 'verify' | 'synthesize';
  timestamp: string;
  status: 'completed' | 'failed';
  detail?: string;
  url?: string;
  durationMs?: number;
}

export interface AgentJobRecord {
  id: string;
  teamId: string;
  keyId?: string;
  prompt: string;
  urls: string[];
  schema?: Record<string, unknown>;
  threadId: string;
  threadTurn: number;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  data?: unknown;
  sources: string[];
  trace: AgentTraceEvent[];
  snapshots: Record<string, unknown>;
  creditsUsed: number;
  tokensUsed: number;
  error?: string;
  cancelled: boolean;
  createdAt: string;
  completedAt?: string;
}

const memAgentJobs = new Map<string, AgentJobRecord>();

export async function getThreadNextTurn(
  db: D1Database | undefined,
  threadId: string,
): Promise<{ nextTurn: number; priorContext: string }> {
  const memMatches = [...memAgentJobs.values()]
    .filter((a) => a.threadId === threadId)
    .sort((a, b) => a.threadTurn - b.threadTurn);

  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const rows = await db
        .prepare(
          `SELECT prompt, data_json, thread_turn FROM agent_jobs WHERE thread_id = ?1 ORDER BY thread_turn ASC`,
        )
        .bind(threadId)
        .all<{ prompt: string; data_json: string | null; thread_turn: number }>();
      const list = rows.results ?? [];
      if (list.length > 0) {
        const lastTurn = list[list.length - 1]!.thread_turn;
        const priorContext = list
          .map((r) => `Turn ${r.thread_turn} Q: ${r.prompt}\nA: ${r.data_json ?? ''}`)
          .join('\n---\n');
        return { nextTurn: lastTurn + 1, priorContext };
      }
    } catch {
      /* fallback */
    }
  }

  if (memMatches.length > 0) {
    const lastTurn = memMatches[memMatches.length - 1]!.threadTurn;
    const priorContext = memMatches
      .map((r) => `Turn ${r.threadTurn} Q: ${r.prompt}\nA: ${JSON.stringify(r.data ?? '')}`)
      .join('\n---\n');
    return { nextTurn: lastTurn + 1, priorContext };
  }
  return { nextTurn: 1, priorContext: '' };
}

export async function saveAgentJob(db: D1Database | undefined, rec: AgentJobRecord): Promise<void> {
  memAgentJobs.set(rec.id, rec);
  if (!db) return;
  try {
    await ensureDurableStateSchema(db);
    await db
      .prepare(
        `INSERT OR REPLACE INTO agent_jobs
         (id, team_id, key_id, prompt, urls_json, schema_json, thread_id, thread_turn, status, data_json, sources_json, trace_json, snapshots_json, credits_used, tokens_used, error, cancelled, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
      )
      .bind(
        rec.id,
        rec.teamId,
        rec.keyId ?? null,
        rec.prompt,
        JSON.stringify(rec.urls),
        rec.schema ? JSON.stringify(rec.schema) : null,
        rec.threadId,
        rec.threadTurn,
        rec.status,
        rec.data !== undefined ? JSON.stringify(rec.data) : null,
        JSON.stringify(rec.sources),
        JSON.stringify(rec.trace),
        JSON.stringify(rec.snapshots),
        rec.creditsUsed,
        rec.tokensUsed,
        rec.error ?? null,
        rec.cancelled ? 1 : 0,
        rec.createdAt,
        rec.completedAt ?? null,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}

export async function getAgentJob(
  db: D1Database | undefined,
  id: string,
): Promise<AgentJobRecord | null> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const r = await db
        .prepare(`SELECT * FROM agent_jobs WHERE id = ?1`)
        .bind(id)
        .first<Record<string, unknown>>();
      if (r) {
        return {
          id: String(r.id),
          teamId: String(r.team_id ?? 'default'),
          keyId: r.key_id ? String(r.key_id) : undefined,
          prompt: String(r.prompt ?? ''),
          urls: JSON.parse(String(r.urls_json ?? '[]')) as string[],
          schema: r.schema_json
            ? (JSON.parse(String(r.schema_json)) as Record<string, unknown>)
            : undefined,
          threadId: String(r.thread_id ?? id),
          threadTurn: Number(r.thread_turn ?? 1),
          status: (r.cancelled
            ? 'cancelled'
            : String(r.status ?? 'completed')) as AgentJobRecord['status'],
          data: r.data_json ? JSON.parse(String(r.data_json)) : undefined,
          sources: JSON.parse(String(r.sources_json ?? '[]')) as string[],
          trace: JSON.parse(String(r.trace_json ?? '[]')) as AgentTraceEvent[],
          snapshots: JSON.parse(String(r.snapshots_json ?? '{}')) as Record<string, unknown>,
          creditsUsed: Number(r.credits_used ?? 2),
          tokensUsed: Number(r.tokens_used ?? 0),
          error: r.error ? String(r.error) : undefined,
          cancelled: Boolean(r.cancelled),
          createdAt: String(r.created_at ?? new Date().toISOString()),
          completedAt: r.completed_at ? String(r.completed_at) : undefined,
        };
      }
    } catch {
      /* fallback */
    }
  }
  return memAgentJobs.get(id) ?? null;
}

export async function listAgentJobs(
  db: D1Database | undefined,
  teamId: string,
): Promise<AgentJobRecord[]> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const rows = await db
        .prepare(`SELECT id FROM agent_jobs WHERE team_id = ?1 ORDER BY created_at DESC LIMIT 50`)
        .bind(teamId)
        .all<{ id: string }>();
      if (rows.results && rows.results.length > 0) {
        const loaded = await Promise.all(rows.results.map((r) => getAgentJob(db, r.id)));
        return loaded.filter((x): x is AgentJobRecord => x !== null);
      }
    } catch {
      /* fallback */
    }
  }
  return [...memAgentJobs.values()]
    .filter((a) => a.teamId === teamId || teamId === 'demo')
    .slice(-50)
    .reverse();
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Deep Research (`/v1/deep-research*`) & LLMs.txt (`/v1/llmstxt*`)
// ─────────────────────────────────────────────────────────────────────────────
export interface DeepResearchRecord {
  id: string;
  teamId: string;
  keyId?: string;
  query: string;
  status: 'processing' | 'completed' | 'failed';
  currentDepth: number;
  maxDepth: number;
  totalUrls: number;
  finalAnalysis: string;
  activities: Array<{
    type: string;
    status: string;
    message: string;
    timestamp: string;
    depth: number;
  }>;
  sources: Array<{ url: string; title: string; description: string }>;
  summaries: string[];
  json?: unknown;
  createdAt: string;
  updatedAt: string;
}

const memDeepResearch = new Map<string, DeepResearchRecord>();

export async function saveDeepResearchJob(
  db: D1Database | undefined,
  rec: DeepResearchRecord,
): Promise<void> {
  memDeepResearch.set(rec.id, rec);
  if (!db) return;
  try {
    await ensureDurableStateSchema(db);
    await db
      .prepare(
        `INSERT OR REPLACE INTO deep_research_jobs
         (id, team_id, key_id, query, status, current_depth, max_depth, total_urls, final_analysis, activities_json, sources_json, summaries_json, json_data, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      )
      .bind(
        rec.id,
        rec.teamId,
        rec.keyId ?? null,
        rec.query,
        rec.status,
        rec.currentDepth,
        rec.maxDepth,
        rec.totalUrls,
        rec.finalAnalysis,
        JSON.stringify(rec.activities),
        JSON.stringify(rec.sources),
        JSON.stringify(rec.summaries),
        rec.json !== undefined ? JSON.stringify(rec.json) : null,
        rec.createdAt,
        rec.updatedAt,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}

export async function getDeepResearchJob(
  db: D1Database | undefined,
  id: string,
): Promise<DeepResearchRecord | null> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const r = await db
        .prepare(`SELECT * FROM deep_research_jobs WHERE id = ?1`)
        .bind(id)
        .first<Record<string, unknown>>();
      if (r) {
        return {
          id: String(r.id),
          teamId: String(r.team_id ?? 'default'),
          keyId: r.key_id ? String(r.key_id) : undefined,
          query: String(r.query ?? ''),
          status: String(r.status ?? 'completed') as DeepResearchRecord['status'],
          currentDepth: Number(r.current_depth ?? 1),
          maxDepth: Number(r.max_depth ?? 3),
          totalUrls: Number(r.total_urls ?? 0),
          finalAnalysis: String(r.final_analysis ?? ''),
          activities: JSON.parse(String(r.activities_json ?? '[]')),
          sources: JSON.parse(String(r.sources_json ?? '[]')),
          summaries: JSON.parse(String(r.summaries_json ?? '[]')),
          json: r.json_data ? JSON.parse(String(r.json_data)) : undefined,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        };
      }
    } catch {
      /* fallback */
    }
  }
  return memDeepResearch.get(id) ?? null;
}

export interface LlmsTxtRecord {
  id: string;
  teamId: string;
  keyId?: string;
  url: string;
  status: 'processing' | 'completed' | 'failed';
  llmsTxt: string;
  llmsFullTxt: string;
  processedUrls: string[];
  expiresAt: string;
  createdAt: string;
}

const memLlmsTxt = new Map<string, LlmsTxtRecord>();

export async function saveLlmsTxtJob(
  db: D1Database | undefined,
  rec: LlmsTxtRecord,
): Promise<void> {
  memLlmsTxt.set(rec.id, rec);
  if (!db) return;
  try {
    await ensureDurableStateSchema(db);
    await db
      .prepare(
        `INSERT OR REPLACE INTO llmstxt_jobs
         (id, team_id, key_id, url, status, llms_txt, llms_full_txt, processed_urls_json, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        rec.id,
        rec.teamId,
        rec.keyId ?? null,
        rec.url,
        rec.status,
        rec.llmsTxt,
        rec.llmsFullTxt,
        JSON.stringify(rec.processedUrls),
        rec.expiresAt,
        rec.createdAt,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}

export async function getLlmsTxtJob(
  db: D1Database | undefined,
  id: string,
): Promise<LlmsTxtRecord | null> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const r = await db
        .prepare(`SELECT * FROM llmstxt_jobs WHERE id = ?1`)
        .bind(id)
        .first<Record<string, unknown>>();
      if (r) {
        return {
          id: String(r.id),
          teamId: String(r.team_id ?? 'default'),
          keyId: r.key_id ? String(r.key_id) : undefined,
          url: String(r.url ?? ''),
          status: String(r.status ?? 'completed') as LlmsTxtRecord['status'],
          llmsTxt: String(r.llms_txt ?? ''),
          llmsFullTxt: String(r.llms_full_txt ?? ''),
          processedUrls: JSON.parse(String(r.processed_urls_json ?? '[]')) as string[],
          expiresAt: String(r.expires_at),
          createdAt: String(r.created_at),
        };
      }
    } catch {
      /* fallback */
    }
  }
  return memLlmsTxt.get(id) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Interactive Browser Sessions (`/v2/interact*`)
// ─────────────────────────────────────────────────────────────────────────────
export interface InteractTraceStep {
  timestamp: string;
  kind: 'action' | 'copilot-prompt' | 'code-exec';
  summary: string;
  actions?: unknown[];
  result?: unknown;
  screenshot?: string;
}

export interface InteractSessionRecord {
  id: string;
  teamId: string;
  keyId?: string;
  url: string;
  status: 'active' | 'closed';
  trace: InteractTraceStep[];
  lastScreenshot?: string;
  createdAt: number;
  expiresAt: string;
}

const memInteractSessions = new Map<string, InteractSessionRecord>();

export async function saveInteractSession(
  db: D1Database | undefined,
  rec: InteractSessionRecord,
): Promise<void> {
  memInteractSessions.set(rec.id, rec);
  if (!db) return;
  try {
    await ensureDurableStateSchema(db);
    await db
      .prepare(
        `INSERT OR REPLACE INTO interact_sessions
         (id, team_id, key_id, url, status, trace_json, last_screenshot, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        rec.id,
        rec.teamId,
        rec.keyId ?? null,
        rec.url,
        rec.status,
        JSON.stringify(rec.trace),
        rec.lastScreenshot ?? null,
        rec.createdAt,
        rec.expiresAt,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}

export async function getInteractSession(
  db: D1Database | undefined,
  id: string,
): Promise<InteractSessionRecord | null> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const r = await db
        .prepare(`SELECT * FROM interact_sessions WHERE id = ?1`)
        .bind(id)
        .first<Record<string, unknown>>();
      if (r) {
        return {
          id: String(r.id),
          teamId: String(r.team_id ?? 'default'),
          keyId: r.key_id ? String(r.key_id) : undefined,
          url: String(r.url ?? 'about:blank'),
          status: String(r.status ?? 'active') as 'active' | 'closed',
          trace: JSON.parse(String(r.trace_json ?? '[]')) as InteractTraceStep[],
          lastScreenshot: r.last_screenshot ? String(r.last_screenshot) : undefined,
          createdAt: Number(r.created_at ?? Date.now()),
          expiresAt: String(r.expires_at ?? new Date(Date.now() + 600_000).toISOString()),
        };
      }
    } catch {
      /* fallback */
    }
  }
  return memInteractSessions.get(id) ?? null;
}

export async function listInteractSessions(
  db: D1Database | undefined,
  teamId: string,
  statusFilter?: string,
): Promise<InteractSessionRecord[]> {
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const rows = await db
        .prepare(
          `SELECT id FROM interact_sessions WHERE team_id = ?1 ORDER BY created_at DESC LIMIT 50`,
        )
        .bind(teamId)
        .all<{ id: string }>();
      if (rows.results && rows.results.length > 0) {
        const list = (
          await Promise.all(rows.results.map((r) => getInteractSession(db, r.id)))
        ).filter((x): x is InteractSessionRecord => x !== null);
        return statusFilter ? list.filter((s) => s.status === statusFilter) : list;
      }
    } catch {
      /* fallback */
    }
  }
  return [...memInteractSessions.values()].filter(
    (s) =>
      (s.teamId === teamId || teamId === 'default') && (!statusFilter || s.status === statusFilter),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Job Feedback (`/v2/feedback` & MCP `firecrawl_feedback` / `firecrawl_search_feedback`)
// ─────────────────────────────────────────────────────────────────────────────
export interface FeedbackRecord {
  id: string;
  jobId?: string;
  teamId: string;
  keyId?: string;
  endpoint?: string;
  vote?: string;
  rating?: number;
  comment?: string;
  createdAt: string;
}

const memFeedback: FeedbackRecord[] = [];

export async function saveJobFeedback(
  db: D1Database | undefined,
  rec: FeedbackRecord,
): Promise<void> {
  memFeedback.push(rec);
  if (!db) return;
  try {
    await ensureDurableStateSchema(db);
    await db
      .prepare(
        `INSERT OR REPLACE INTO job_feedback
         (id, job_id, team_id, key_id, endpoint, vote, rating, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        rec.id,
        rec.jobId ?? null,
        rec.teamId,
        rec.keyId ?? null,
        rec.endpoint ?? null,
        rec.vote ?? null,
        rec.rating ?? null,
        rec.comment ?? null,
        rec.createdAt,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}

export async function searchJobFeedback(
  db: D1Database | undefined,
  teamId: string,
  query = '',
  limit = 20,
): Promise<FeedbackRecord[]> {
  const q = query.trim().toLowerCase();
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const rows = await db
        .prepare(`SELECT * FROM job_feedback WHERE team_id = ?1 ORDER BY created_at DESC LIMIT ?2`)
        .bind(teamId, limit)
        .all<Record<string, unknown>>();
      if (rows.results) {
        const mapped = rows.results.map((r) => ({
          id: String(r.id),
          jobId: r.job_id ? String(r.job_id) : undefined,
          teamId: String(r.team_id),
          keyId: r.key_id ? String(r.key_id) : undefined,
          endpoint: r.endpoint ? String(r.endpoint) : undefined,
          vote: r.vote ? String(r.vote) : undefined,
          rating: r.rating !== null && r.rating !== undefined ? Number(r.rating) : undefined,
          comment: r.comment ? String(r.comment) : undefined,
          createdAt: String(r.created_at),
        }));
        return q
          ? mapped.filter(
              (f) =>
                (f.comment ?? '').toLowerCase().includes(q) ||
                (f.endpoint ?? '').toLowerCase().includes(q) ||
                (f.jobId ?? '').toLowerCase().includes(q),
            )
          : mapped;
      }
    } catch {
      /* fallback */
    }
  }
  return memFeedback
    .filter(
      (f) =>
        (f.teamId === teamId || teamId === 'default') &&
        (!q ||
          (f.comment ?? '').toLowerCase().includes(q) ||
          (f.endpoint ?? '').toLowerCase().includes(q)),
    )
    .slice(-limit)
    .reverse();
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Workers AI Token Usage Ledger (`/v2/team/token-usage*` & `/v1/team/token-usage*`)
// ─────────────────────────────────────────────────────────────────────────────
export interface TokenUsageEntry {
  keyId: string;
  teamId?: string;
  operation: string;
  tokens: number;
  model?: string;
  jobId?: string;
  createdAt?: string;
}

const memTokenLedger: Array<Required<TokenUsageEntry>> = [];

export async function recordTokenUsage(
  db: D1Database | undefined,
  entry: TokenUsageEntry,
): Promise<void> {
  const createdAt = entry.createdAt ?? new Date().toISOString();
  memTokenLedger.push({
    keyId: entry.keyId,
    teamId: entry.teamId ?? 'default',
    operation: entry.operation,
    tokens: entry.tokens,
    model: entry.model ?? '@cf/meta/llama-3.1-8b-instruct',
    jobId: entry.jobId ?? '',
    createdAt,
  });
  if (!db) return;
  try {
    await ensureDurableStateSchema(db);
    await db
      .prepare(
        `INSERT INTO token_ledger (key_id, team_id, operation, tokens, model, job_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        entry.keyId,
        entry.teamId ?? 'default',
        entry.operation,
        entry.tokens,
        entry.model ?? '@cf/meta/llama-3.1-8b-instruct',
        entry.jobId ?? null,
        createdAt,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}

export async function tokensUsedThisPeriod(
  db: D1Database | undefined,
  keyId?: string,
): Promise<number> {
  if (!keyId) return 0;
  const since = periodStartIso();
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const row = await db
        .prepare(
          `SELECT COALESCE(SUM(tokens), 0) AS used FROM token_ledger WHERE key_id = ?1 AND created_at >= ?2`,
        )
        .bind(keyId, since)
        .first<{ used: number }>();
      if (row) return row.used ?? 0;
    } catch {
      /* fallback */
    }
  }
  return memTokenLedger
    .filter((e) => e.keyId === keyId && e.createdAt >= since)
    .reduce((sum, e) => sum + e.tokens, 0);
}

export async function tokenUsageHistory(
  db: D1Database | undefined,
  keyId?: string,
  limit = 50,
): Promise<
  Array<{
    operation: string;
    tokens: number;
    model: string;
    jobId: string | null;
    createdAt: string;
  }>
> {
  if (!keyId) return [];
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const rows = await db
        .prepare(
          `SELECT operation, tokens, model, job_id, created_at FROM token_ledger
           WHERE key_id = ?1 ORDER BY id DESC LIMIT ?2`,
        )
        .bind(keyId, limit)
        .all<{
          operation: string;
          tokens: number;
          model: string;
          job_id: string | null;
          created_at: string;
        }>();
      if (rows.results) {
        return rows.results.map((r) => ({
          operation: r.operation,
          tokens: r.tokens,
          model: r.model,
          jobId: r.job_id,
          createdAt: r.created_at,
        }));
      }
    } catch {
      /* fallback */
    }
  }
  return memTokenLedger
    .filter((e) => e.keyId === keyId)
    .slice(-limit)
    .reverse()
    .map((e) => ({
      operation: e.operation,
      tokens: e.tokens,
      model: e.model,
      jobId: e.jobId || null,
      createdAt: e.createdAt,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Document Parse R2 + D1 Uploads (`/v2/parse/upload-url` & `PUT /v2/parse/upload/:id`)
// ─────────────────────────────────────────────────────────────────────────────
const memParseUploads = new Map<
  string,
  { id: string; filename: string; contentType: string; bytes?: ArrayBuffer; expiresAt: string }
>();

export async function createParseUploadSlot(
  db: D1Database | undefined,
  opts: { id: string; teamId?: string; keyId?: string; filename: string; contentType: string },
): Promise<{ id: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  memParseUploads.set(opts.id, {
    id: opts.id,
    filename: opts.filename,
    contentType: opts.contentType,
    expiresAt,
  });
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      await db
        .prepare(
          `INSERT OR REPLACE INTO parse_uploads
           (id, team_id, key_id, filename, content_type, r2_key, size_bytes, status, created_at, expires_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'pending', ?7, ?8)`,
        )
        .bind(
          opts.id,
          opts.teamId ?? 'default',
          opts.keyId ?? null,
          opts.filename,
          opts.contentType,
          `uploads/${opts.id}`,
          new Date().toISOString(),
          expiresAt,
        )
        .run();
    } catch {
      /* non-fatal */
    }
  }
  return { id: opts.id, expiresAt };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function storeParseUploadBytes(
  db: D1Database | undefined,
  r2: R2Bucket | undefined,
  id: string,
  bytes: ArrayBuffer,
  contentType = 'application/octet-stream',
): Promise<void> {
  const existing = memParseUploads.get(id);
  memParseUploads.set(id, {
    id,
    filename: existing?.filename ?? 'upload.bin',
    contentType: contentType || existing?.contentType || 'application/octet-stream',
    bytes,
    expiresAt: existing?.expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
  });
  const r2Key = `uploads/${id}`;
  if (r2) {
    try {
      await r2.put(r2Key, bytes, { httpMetadata: { contentType } });
    } catch {
      /* fallback to D1 bytes_b64 for small files */
    }
  }
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const b64 = bytes.byteLength <= 1_000_000 ? arrayBufferToBase64(bytes) : null;
      await db
        .prepare(
          `UPDATE parse_uploads SET content_type = ?2, r2_key = ?3, bytes_b64 = ?4, size_bytes = ?5, status = 'uploaded' WHERE id = ?1`,
        )
        .bind(id, contentType, r2Key, b64, bytes.byteLength)
        .run();
    } catch {
      /* non-fatal */
    }
  }
}

export async function getParseUploadBytes(
  db: D1Database | undefined,
  r2: R2Bucket | undefined,
  id: string,
): Promise<{ bytes: ArrayBuffer; contentType: string; filename: string } | null> {
  const mem = memParseUploads.get(id);
  if (mem?.bytes) {
    return { bytes: mem.bytes, contentType: mem.contentType, filename: mem.filename };
  }
  if (r2) {
    try {
      const obj = await r2.get(`uploads/${id}`);
      if (obj) {
        return {
          bytes: await obj.arrayBuffer(),
          contentType:
            obj.httpMetadata?.contentType ?? mem?.contentType ?? 'application/octet-stream',
          filename: mem?.filename ?? id,
        };
      }
    } catch {
      /* fallback to D1 */
    }
  }
  if (db) {
    try {
      await ensureDurableStateSchema(db);
      const row = await db
        .prepare(`SELECT filename, content_type, bytes_b64 FROM parse_uploads WHERE id = ?1`)
        .bind(id)
        .first<{ filename: string; content_type: string; bytes_b64: string | null }>();
      if (row && row.bytes_b64) {
        return {
          bytes: base64ToArrayBuffer(row.bytes_b64),
          contentType: row.content_type,
          filename: row.filename,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
