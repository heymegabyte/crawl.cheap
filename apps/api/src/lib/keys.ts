/**
 * API-key issuance + resolution backed by D1 (with an in-memory isolate mirror so keys
 * also work immediately in local/test runs or across sub-millisecond post-issuance calls).
 * Supports both native `cc_live_<48 hex>` keys and Firecrawl-backwards-compatible `fc-<32 hex>` keys.
 */

export const PLAN_CREDITS: Record<string, number> = {
  free: 1000,
  hobby: 5000,
  standard: 100000,
  growth: 500000,
  scale: 1000000,
};

export interface ResolvedKey {
  id: string;
  plan: string;
  monthlyCredits: number;
  spendLimit: number | null;
  maxConcurrency: number;
  teamId: string;
  userId?: string;
}

const memoryKeysByHash = new Map<string, ResolvedKey & { revoked?: boolean }>();
const memoryKeyMetadataById = new Map<
  string,
  ResolvedKey & {
    keyHash: string;
    prefix: string;
    name: string | null;
    createdAt: string;
    revoked: boolean;
  }
>();

export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a crawl.cheap key (`cc_live_<48 hex>`) or a Firecrawl-compatible key (`fc-<32 hex>`). */
export function generateKey(prefix: 'cc_live_' | 'fc-' = 'cc_live_'): string {
  const byteLen = prefix === 'fc-' ? 16 : 24;
  const bytes = crypto.getRandomValues(new Uint8Array(byteLen));
  return `${prefix}${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface CreateKeyOptions {
  name?: string;
  plan?: string;
  prefix?: 'cc_live_' | 'fc-';
  credits?: number;
  concurrency?: number;
  teamId?: string;
  userId?: string;
}

export async function createKey(
  db: D1Database | undefined,
  opts: CreateKeyOptions = {},
): Promise<{
  key: string;
  id: string;
  plan: string;
  monthlyCredits: number;
  maxConcurrency: number;
  teamId: string;
  prefix: string;
}> {
  const key = generateKey(opts.prefix ?? 'cc_live_');
  const id = crypto.randomUUID();
  const plan = opts.plan && PLAN_CREDITS[opts.plan] ? opts.plan : 'free';
  const monthlyCredits =
    typeof opts.credits === 'number' && opts.credits > 0 ? opts.credits : PLAN_CREDITS[plan]!;
  const maxConcurrency =
    typeof opts.concurrency === 'number' && opts.concurrency > 0 ? opts.concurrency : 25;
  const teamId = opts.teamId ?? id;
  const prefix = key.slice(0, 16);
  const keyHash = await sha256hex(key);
  const createdAt = new Date().toISOString();

  const resolved: ResolvedKey = {
    id,
    plan,
    monthlyCredits,
    spendLimit: null,
    maxConcurrency,
    teamId,
    ...(opts.userId ? { userId: opts.userId } : {}),
  };
  memoryKeysByHash.set(keyHash, resolved);
  memoryKeyMetadataById.set(id, {
    ...resolved,
    keyHash,
    prefix,
    name: opts.name ?? null,
    createdAt,
    revoked: false,
  });

  if (db) {
    try {
      await db
        .prepare(
          'INSERT INTO api_keys (id, key_hash, key_prefix, name, plan, monthly_credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, keyHash, prefix, opts.name ?? null, plan, monthlyCredits, createdAt)
        .run();
    } catch {
      /* memory fallback already populated */
    }
  }
  return { key, id, plan, monthlyCredits, maxConcurrency, teamId, prefix };
}

export async function resolveKey(
  db: D1Database | undefined,
  key: string,
): Promise<ResolvedKey | null> {
  const keyHash = await sha256hex(key);
  const mem = memoryKeysByHash.get(keyHash);
  if (mem) {
    if (mem.revoked) return null;
    if (db) {
      try {
        const row = await db
          .prepare('SELECT spend_limit AS spendLimit, revoked FROM api_keys WHERE id = ?')
          .bind(mem.id)
          .first<{ spendLimit: number | null; revoked: number }>();
        if (row?.revoked) return null;
        if (row && row.spendLimit !== undefined) mem.spendLimit = row.spendLimit;
      } catch {
        /* use in-memory state */
      }
    }
    return mem;
  }

  if (!db) return null;
  try {
    const row = await db
      .prepare(
        'SELECT id, plan, monthly_credits AS monthlyCredits, spend_limit AS spendLimit FROM api_keys WHERE key_hash = ? AND revoked = 0',
      )
      .bind(keyHash)
      .first<{ id: string; plan: string; monthlyCredits: number; spendLimit: number | null }>();
    if (!row) return null;
    const resolved: ResolvedKey = {
      id: row.id,
      plan: row.plan,
      monthlyCredits: row.monthlyCredits,
      spendLimit: row.spendLimit ?? null,
      maxConcurrency: 25,
      teamId: row.id,
    };
    memoryKeysByHash.set(keyHash, resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function listKeysForUser(
  db: D1Database | undefined,
  userId?: string,
): Promise<
  Array<{
    id: string;
    prefix: string;
    name: string | null;
    plan: string;
    monthlyCredits: number;
    createdAt: string;
    revoked: boolean;
  }>
> {
  const memList = [...memoryKeyMetadataById.values()]
    .filter((k) => !userId || k.userId === userId || !k.userId)
    .map((k) => ({
      id: k.id,
      prefix: k.prefix,
      name: k.name,
      plan: k.plan,
      monthlyCredits: k.monthlyCredits,
      createdAt: k.createdAt,
      revoked: k.revoked,
    }));
  if (!db) return memList;
  try {
    const { results } = await db
      .prepare(
        'SELECT id, key_prefix AS prefix, name, plan, monthly_credits AS monthlyCredits, created_at AS createdAt, revoked FROM api_keys ORDER BY created_at DESC LIMIT 50',
      )
      .all<{
        id: string;
        prefix: string;
        name: string | null;
        plan: string;
        monthlyCredits: number;
        createdAt: string;
        revoked: number;
      }>();
    if (results && results.length > 0) {
      return results.map((r) => ({ ...r, revoked: Boolean(r.revoked) }));
    }
  } catch {
    /* fallback to memList */
  }
  return memList;
}

export async function revokeKeyById(db: D1Database | undefined, keyId: string): Promise<boolean> {
  let changed = false;
  const meta = memoryKeyMetadataById.get(keyId);
  if (meta) {
    meta.revoked = true;
    const byHash = memoryKeysByHash.get(meta.keyHash);
    if (byHash) byHash.revoked = true;
    changed = true;
  }
  if (db) {
    try {
      const res = await db
        .prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?')
        .bind(keyId)
        .run();
      if ((res.meta.changes ?? 0) > 0) changed = true;
    } catch {
      /* ignore */
    }
  }
  return changed;
}

/** Set (or clear with null) the user-configurable hard spend ceiling for a key. */
export async function setSpendLimit(
  db: D1Database | undefined,
  keyId: string,
  limit: number | null,
): Promise<void> {
  const meta = memoryKeyMetadataById.get(keyId);
  if (meta) {
    meta.spendLimit = limit;
    const byHash = memoryKeysByHash.get(meta.keyHash);
    if (byHash) byHash.spendLimit = limit;
  }
  for (const v of memoryKeysByHash.values()) {
    if (v.id === keyId) v.spendLimit = limit;
  }
  if (db) {
    await db.prepare('UPDATE api_keys SET spend_limit = ? WHERE id = ?').bind(limit, keyId).run();
  }
}
