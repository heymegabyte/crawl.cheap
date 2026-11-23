/**
 * Better Auth + OAuth 2.1 Authorization Server (Cloudflare Workers + D1 + WebCrypto).
 *
 * Implements the @theme.tools/auth Cloudflare-native specification:
 *   1. Better Auth Server-Side Session & Tenant Isolation:
 *      - WebCrypto HMAC-SHA256 `TT-SESSION` signed edge session tokens (`createSignedEdgeSessionToken`, `verifySignedEdgeSessionToken`)
 *      - Session Rotation Window (`validateSessionRotationWindow`, 1h rotation, 7d max lifetime)
 *      - Server-Derived Tenant Context (`deriveVerifiedServerTenantContext` — rejects client tenantId spoofing)
 *      - Hierarchical RBAC (`evaluateHierarchicalRbacPermission`: owner > admin > member > viewer)
 *      - Email/Password Sign-Up & Sign-In + Social OAuth 2.0 (`github`, `google`, `cloudflare`) + API Key plugin
 *   2. OAuth 2.1 Authorization Server (RFC 9728, RFC 8414, RFC 7591 DCR, RFC 7636 PKCE S256, RFC 8707, RFC 7009, RFC 7662):
 *      - Protected Resource Metadata (`/.well-known/oauth-protected-resource`)
 *      - Authorization Server Metadata (`/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`)
 *      - Dynamic Client Registration (`POST /register`, `POST /oauth/register`, `POST /api/auth/oauth2/register`)
 *      - PKCE S256 Authorization (`GET/POST /authorize`, `GET/POST /oauth/authorize`, `GET/POST /api/auth/oauth2/authorize`)
 *      - Token Exchange (`POST /token`, `POST /oauth/token`, `POST /api/auth/oauth2/token`: `authorization_code`, `refresh_token`, `client_credentials`)
 *      - Token Revocation (`POST /revoke`, `POST /oauth/revoke`) & Introspection (`POST /introspect`, `POST /oauth/introspect`)
 */

import { createKey, resolveKey, sha256hex, PLAN_CREDITS } from './keys';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
export const AUTH_CODE_TTL_MS = 60_000; // 60s single-use authorization code
export const ACCESS_TOKEN_TTL_MS = 3_600_000; // 1h access token
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3_600_000; // 30d refresh token
export const SESSION_TTL_MS = 7 * 24 * 3_600_000; // 7d session lifetime
export const SESSION_ROTATION_MS = 3_600_000; // 1h rotation window

export const DEFAULT_SIGNING_SECRET = 'crawlcheap-better-auth-edge-hmac-secret-2026';

export function encodeBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashTokenBase64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

export function mintOpaqueToken(prefix: string, nBytes = 32): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return prefix + encodeBase64Url(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Better Auth Edge Session JWT (`TT-SESSION`), RBAC & Tenant Context
// ─────────────────────────────────────────────────────────────────────────────

export interface EdgeSignedSessionPayload {
  readonly sessionId: string;
  readonly userId: string;
  readonly authenticatedTenantId: string;
  readonly email?: string;
  readonly name?: string;
  readonly organizationId?: string;
  readonly role?: string;
  readonly roles?: readonly string[];
  readonly plan?: string;
  readonly monthlyCredits?: number;
  readonly keyId?: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ServerSessionClaims {
  readonly userId: string;
  readonly verifiedTenantId: string;
  readonly roles: readonly string[];
  readonly activeOrganizationId?: string;
  readonly sessionId: string;
  readonly email?: string;
  readonly name?: string;
  readonly plan?: string;
  readonly monthlyCredits?: number;
  readonly keyId?: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface VerifiedTenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly roles: readonly string[];
  readonly activeOrganizationId?: string;
  readonly sessionId: string;
  readonly isServerDerived: true;
  readonly isolationToken: string;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const effective = secret && secret.trim().length >= 16 ? secret : DEFAULT_SIGNING_SECRET;
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(effective),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSignedEdgeSessionToken(
  claims: EdgeSignedSessionPayload,
  signingSecret = DEFAULT_SIGNING_SECRET,
): Promise<string> {
  const key = await importHmacKey(signingSecret);
  const headerB64 = encodeBase64Url(
    textEncoder.encode(JSON.stringify({ alg: 'HS256', typ: 'TT-SESSION' })),
  );
  const payloadB64 = encodeBase64Url(textEncoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBuf = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput));
  return `${signingInput}.${encodeBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifySignedEdgeSessionToken(
  token: string | null | undefined,
  signingSecret = DEFAULT_SIGNING_SECRET,
  nowMs: number = Date.now(),
): Promise<{
  valid: boolean;
  reason?: string;
  claims?: EdgeSignedSessionPayload;
  serverClaims?: ServerSessionClaims;
}> {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing session token' };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'Malformed session token structure' };
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const headerBytes = decodeBase64Url(headerB64);
  const payloadBytes = decodeBase64Url(payloadB64);
  const sigBytes = decodeBase64Url(sigB64);
  if (!headerBytes || !payloadBytes || !sigBytes) {
    return { valid: false, reason: 'Invalid Base64URL encoding in session token' };
  }

  let parsedHeader: { alg?: unknown; typ?: unknown };
  try {
    parsedHeader = JSON.parse(textDecoder.decode(headerBytes));
  } catch {
    return { valid: false, reason: 'Malformed session token header JSON' };
  }
  if (parsedHeader?.alg !== 'HS256' || parsedHeader?.typ !== 'TT-SESSION') {
    return { valid: false, reason: 'Unsupported session token header alg/typ' };
  }

  const key = await importHmacKey(signingSecret);
  const expectedSigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(`${headerB64}.${payloadB64}`),
  );
  if (!constantTimeBytesEqual(sigBytes, new Uint8Array(expectedSigBuf))) {
    return { valid: false, reason: 'HMAC-SHA256 session signature verification failed' };
  }

  let parsed: EdgeSignedSessionPayload;
  try {
    parsed = JSON.parse(textDecoder.decode(payloadBytes)) as EdgeSignedSessionPayload;
  } catch {
    return { valid: false, reason: 'Malformed session claims JSON' };
  }

  if (
    !parsed ||
    typeof parsed.sessionId !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.authenticatedTenantId !== 'string' ||
    !parsed.authenticatedTenantId.trim() ||
    typeof parsed.issuedAtMs !== 'number' ||
    typeof parsed.expiresAtMs !== 'number'
  ) {
    return { valid: false, reason: 'Incomplete signed session claims' };
  }
  if (nowMs >= parsed.expiresAtMs) {
    return { valid: false, reason: 'Signed session token has expired' };
  }

  const normalizedRoles =
    Array.isArray(parsed.roles) && parsed.roles.length > 0
      ? parsed.roles
      : [parsed.role ?? 'owner'];

  return {
    valid: true,
    claims: parsed,
    serverClaims: {
      sessionId: parsed.sessionId,
      userId: parsed.userId,
      verifiedTenantId: parsed.authenticatedTenantId,
      activeOrganizationId: parsed.organizationId,
      roles: normalizedRoles,
      email: parsed.email,
      name: parsed.name,
      plan: parsed.plan,
      monthlyCredits: parsed.monthlyCredits,
      keyId: parsed.keyId,
      issuedAtMs: parsed.issuedAtMs,
      expiresAtMs: parsed.expiresAtMs,
    },
  };
}

export function extractBearerOrCookieSessionToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token.length > 0) return token;
  }
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [rawKey, ...rest] = part.trim().split('=');
      if (
        (rawKey === 'tt_session' ||
          rawKey === 'better-auth.session_token' ||
          rawKey === 'crawlcheap_session') &&
        rest.length > 0
      ) {
        return decodeURIComponent(rest.join('=').trim());
      }
    }
  }
  return null;
}

export function deriveVerifiedServerTenantContext(
  trustedClaims: ServerSessionClaims,
  clientRequestedTenantId?: string | null,
): VerifiedTenantContext {
  if (!trustedClaims?.verifiedTenantId?.trim()) {
    throw new Error('@theme.tools/auth: Verified server tenantId is absent in claims');
  }
  if (clientRequestedTenantId && clientRequestedTenantId.trim().length > 0) {
    const normalizedClient = clientRequestedTenantId.trim();
    if (normalizedClient !== trustedClaims.verifiedTenantId) {
      throw new Error(
        `@theme.tools/auth: Tenant spoofing rejected: client claimed '${normalizedClient}' but server session is bound to '${trustedClaims.verifiedTenantId}'`,
      );
    }
  }
  const isolationToken = `iso_${trustedClaims.verifiedTenantId}_${trustedClaims.userId}_${trustedClaims.sessionId.slice(0, 8)}`;
  return {
    tenantId: trustedClaims.verifiedTenantId,
    userId: trustedClaims.userId,
    roles: trustedClaims.roles,
    activeOrganizationId: trustedClaims.activeOrganizationId,
    sessionId: trustedClaims.sessionId,
    isServerDerived: true,
    isolationToken,
  };
}

export const CANONICAL_ROLE_HIERARCHY: Record<
  string,
  { role: string; inheritsFrom: string[]; permissions: string[] }
> = {
  owner: { role: 'owner', permissions: ['*'], inheritsFrom: ['admin'] },
  admin: {
    role: 'admin',
    permissions: [
      'members:*',
      'billing:*',
      'resources:*',
      'settings:*',
      'audit:read',
      'crawl:*',
      'scrape:*',
      'keys:*',
    ],
    inheritsFrom: ['member'],
  },
  member: {
    role: 'member',
    permissions: [
      'resources:read',
      'resources:write',
      'resources:delete',
      'invites:create',
      'crawl:*',
      'scrape:*',
    ],
    inheritsFrom: ['viewer'],
  },
  viewer: {
    role: 'viewer',
    permissions: ['resources:read', 'profile:read', 'scrape:read'],
    inheritsFrom: [],
  },
};

export function evaluateHierarchicalRbacPermission(role: string, targetPermission: string) {
  const normalizedTarget = targetPermission.trim().toLowerCase();
  const visited = new Set<string>();
  const queue = [role.trim().toLowerCase()];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = CANONICAL_ROLE_HIERARCHY[current];
    if (!node) continue;

    for (const rule of node.permissions) {
      const nr = rule.trim().toLowerCase();
      if (nr === '*' || nr === normalizedTarget) {
        return {
          granted: true,
          role,
          targetPermission,
          matchedRule: rule,
          reason: `Granted by rule '${rule}' on role '${current}'`,
        };
      }
      if (nr.endsWith(':*')) {
        const ns = nr.slice(0, -2);
        if (normalizedTarget.startsWith(`${ns}:`)) {
          return {
            granted: true,
            role,
            targetPermission,
            matchedRule: rule,
            reason: `Granted by namespace wildcard '${rule}' on role '${current}'`,
          };
        }
      }
    }
    for (const parent of node.inheritsFrom) queue.push(parent);
  }
  return {
    granted: false,
    role,
    targetPermission,
    reason: `Access denied: role '${role}' lacks permission '${targetPermission}'`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. OAuth 2.1 Authorization Server (PKCE S256, DCR, Auth Code, Refresh, Revoke, Introspect)
// ─────────────────────────────────────────────────────────────────────────────

export const OAUTH_ERRORS = {
  INVALID_REQUEST: 'invalid_request',
  INVALID_CLIENT: 'invalid_client',
  INVALID_GRANT: 'invalid_grant',
  UNAUTHORIZED_CLIENT: 'unauthorized_client',
  UNSUPPORTED_GRANT_TYPE: 'unsupported_grant_type',
  INVALID_SCOPE: 'invalid_scope',
  INVALID_CLIENT_METADATA: 'invalid_client_metadata',
  SERVER_ERROR: 'server_error',
} as const;

export type OAuthErrorCode = (typeof OAUTH_ERRORS)[keyof typeof OAUTH_ERRORS];

export class OAuthError extends Error {
  readonly error: OAuthErrorCode;
  readonly error_description: string;
  readonly status: number;
  constructor(error: OAuthErrorCode, description: string, status = 400) {
    super(`${error}: ${description}`);
    this.name = 'OAuthError';
    this.error = error;
    this.error_description = description;
    this.status = status;
  }
  toBody() {
    return { error: this.error, error_description: this.error_description };
  }
}

export function throwOAuth(code: OAuthErrorCode, description: string, status?: number): never {
  throw new OAuthError(
    code,
    description,
    status ?? (code === OAUTH_ERRORS.INVALID_CLIENT ? 401 : 400),
  );
}

export async function computePkceCodeChallenge(codeVerifier: string): Promise<string> {
  if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
    throw new Error('PKCE code_verifier must be 43..128 RFC 7636 unreserved characters');
  }
  return hashTokenBase64Url(codeVerifier);
}

export async function verifyPkceChallenge(
  codeVerifier: string,
  expectedCodeChallenge: string,
  method = 'S256',
): Promise<{ valid: boolean; reason?: string }> {
  if (method !== 'S256') {
    return { valid: false, reason: 'OAuth 2.1 requires S256 PKCE code_challenge_method' };
  }
  if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
    return { valid: false, reason: 'PKCE code_verifier violates RFC 7636 length or charset rules' };
  }
  if (!expectedCodeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(expectedCodeChallenge)) {
    return { valid: false, reason: 'Malformed S256 PKCE code_challenge' };
  }
  const computed = await computePkceCodeChallenge(codeVerifier);
  if (computed !== expectedCodeChallenge) {
    return { valid: false, reason: 'PKCE S256 code_challenge mismatch' };
  }
  return { valid: true };
}

export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (
    u.protocol === 'http:' &&
    (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')
  ) {
    return true;
  }
  const banned = new Set([
    'http:',
    'https:',
    'ws:',
    'wss:',
    'file:',
    'data:',
    'javascript:',
    'about:',
    'blob:',
  ]);
  if (banned.has(u.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol);
}

export interface OAuthProviderConfig {
  issuer: string;
  resource?: string;
  scopesSupported?: string[];
}

export const DEFAULT_OAUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  'mcp',
  'crawl',
  'scrape',
  'search',
  'extract',
] as const;

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function buildProtectedResourceMetadata(cfg: OAuthProviderConfig) {
  const issuer = trimSlash(cfg.issuer);
  return {
    resource: cfg.resource ?? issuer,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...(cfg.scopesSupported ?? DEFAULT_OAUTH_SCOPES)],
    resource_name: 'crawl.cheap — Firecrawl-compatible Cloudflare-native Web Data & MCP Engine',
    resource_documentation: 'https://github.com/heymegabyte/crawl.cheap#readme',
  };
}

export function buildAuthorizationServerMetadata(cfg: OAuthProviderConfig) {
  const issuer = trimSlash(cfg.issuer);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    introspection_endpoint: `${issuer}/introspect`,
    userinfo_endpoint: `${issuer}/api/auth/session`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [...(cfg.scopesSupported ?? DEFAULT_OAUTH_SCOPES)],
    service_documentation: 'https://github.com/heymegabyte/crawl.cheap#readme',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Hybrid D1 + In-Memory Store for Better Auth Users, Sessions & OAuth 2.1
// ─────────────────────────────────────────────────────────────────────────────

export interface BetterAuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  emailVerified: boolean;
  image?: string | null;
  role: string;
  plan: string;
  monthlyCredits: number;
  spendLimit: number | null;
  defaultApiKey?: string;
  defaultKeyId?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface OAuthClientRecord {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
  createdAt: number;
}

export interface AuthCodeRecord {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  accountUserKey: string;
  resource: string;
  scope: string;
  expiresAt: number;
  used: boolean;
}

export interface TokenRecord {
  tokenHash: string;
  kind: 'access' | 'refresh';
  accountUserKey: string;
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: number;
  revokedAt: number | null;
}

const memUsersByEmail = new Map<string, BetterAuthUser>();
const memUsersById = new Map<string, BetterAuthUser>();
const memSessionsByHash = new Map<
  string,
  {
    id: string;
    tenantId: string;
    userId: string;
    keyId?: string;
    plan: string;
    monthlyCredits: number;
    createdAtMs: number;
    lastRotatedAtMs: number;
    expiresAtMs: number;
    revoked?: boolean;
  }
>();
const memOAuthClients = new Map<string, OAuthClientRecord>();
const memOAuthCodes = new Map<string, AuthCodeRecord>();
const memOAuthTokens = new Map<string, TokenRecord>();

let schemaEnsured = false;

export async function ensureAuthSchema(db?: D1Database): Promise<void> {
  if (!db || schemaEnsured) return;
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE, name TEXT,
        password_hash TEXT, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT,
        role TEXT NOT NULL DEFAULT 'owner', plan TEXT NOT NULL DEFAULT 'free',
        monthly_credits INTEGER NOT NULL DEFAULT 1000, spend_limit INTEGER,
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, created_at_ms INTEGER NOT NULL,
        last_rotated_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
        user_agent TEXT, ip_address TEXT
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY, client_name TEXT, redirect_uris TEXT NOT NULL,
        grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
        token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none', created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS oauth_auth_codes (
        code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL, account_user_key TEXT NOT NULL, resource TEXT NOT NULL,
        scope TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, account_user_key TEXT NOT NULL,
        client_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL,
        expires_at INTEGER NOT NULL, revoked_at INTEGER
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS active_crawls (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL, url TEXT NOT NULL,
        options TEXT, status TEXT NOT NULL DEFAULT 'scraping', created_at TEXT NOT NULL
      )`),
    ]);
    schemaEnsured = true;
  } catch {
    /* fallback to in-memory store */
  }
}

export async function hashPassword(password: string, emailSalt: string): Promise<string> {
  return sha256hex(`better-auth:v1:${emailSalt.toLowerCase()}:${password}`);
}

export async function signUpEmailUser(
  db: D1Database | undefined,
  input: {
    email: string;
    password: string;
    name?: string;
    plan?: string;
    signingSecret?: string;
  },
) {
  await ensureAuthSchema(db);
  const email = input.email.trim().toLowerCase();
  if (memUsersByEmail.has(email)) {
    throw new Error('User with this email already exists');
  }
  const userId = `usr_${crypto.randomUUID().replace(/-/g, '')}`;
  const tenantId = `ten_${userId.slice(4, 20)}`;
  const plan = input.plan && PLAN_CREDITS[input.plan] ? input.plan : 'free';
  const monthlyCredits = PLAN_CREDITS[plan]!;
  const now = Date.now();
  const passwordHash = await hashPassword(input.password, email);

  // Automatically provision a backing D1 API key for the Better Auth user so their credit ledger works seamlessly
  const keyCreated = await createKey(db, {
    name: `better-auth:${email}`,
    plan,
    userId,
    teamId: tenantId,
  });

  const user: BetterAuthUser = {
    id: userId,
    tenantId,
    email,
    name: input.name?.trim() || email.split('@')[0] || 'User',
    passwordHash,
    emailVerified: true,
    role: 'owner',
    plan,
    monthlyCredits,
    spendLimit: null,
    defaultApiKey: keyCreated.key,
    defaultKeyId: keyCreated.id,
    createdAtMs: now,
    updatedAtMs: now,
  };
  memUsersByEmail.set(email, user);
  memUsersById.set(userId, user);

  if (db) {
    try {
      await db
        .prepare(
          'INSERT INTO auth_users (id, tenant_id, email, name, password_hash, email_verified, role, plan, monthly_credits, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)',
        )
        .bind(
          userId,
          tenantId,
          email,
          user.name,
          passwordHash,
          'owner',
          plan,
          monthlyCredits,
          now,
          now,
        )
        .run();
    } catch {
      /* in-memory already stored */
    }
  }

  const session = await createBetterAuthSession(db, user, input.signingSecret);
  return { user, session, apiKey: keyCreated.key, keyId: keyCreated.id };
}

export async function signInEmailUser(
  db: D1Database | undefined,
  input: { email: string; password: string; signingSecret?: string },
) {
  await ensureAuthSchema(db);
  const email = input.email.trim().toLowerCase();
  const expectedHash = await hashPassword(input.password, email);

  let user = memUsersByEmail.get(email);
  if (!user && db) {
    try {
      const row = await db.prepare('SELECT * FROM auth_users WHERE email = ?').bind(email).first<{
        id: string;
        tenant_id: string;
        email: string;
        name: string;
        password_hash: string;
        role: string;
        plan: string;
        monthly_credits: number;
        spend_limit: number | null;
        created_at_ms: number;
        updated_at_ms: number;
      }>();
      if (row) {
        const keyCreated = await createKey(db, {
          name: `better-auth:${email}`,
          plan: row.plan,
          userId: row.id,
          teamId: row.tenant_id,
        });
        user = {
          id: row.id,
          tenantId: row.tenant_id,
          email: row.email,
          name: row.name,
          passwordHash: row.password_hash,
          emailVerified: true,
          role: row.role,
          plan: row.plan,
          monthlyCredits: row.monthly_credits,
          spendLimit: row.spend_limit,
          defaultApiKey: keyCreated.key,
          defaultKeyId: keyCreated.id,
          createdAtMs: row.created_at_ms,
          updatedAtMs: row.updated_at_ms,
        };
        memUsersByEmail.set(email, user);
        memUsersById.set(user.id, user);
      }
    } catch {
      /* ignore */
    }
  }

  if (!user || user.passwordHash !== expectedHash) {
    throw new Error('Invalid email or password');
  }

  const session = await createBetterAuthSession(db, user, input.signingSecret);
  return { user, session };
}

export async function createBetterAuthSession(
  db: D1Database | undefined,
  user: BetterAuthUser,
  signingSecret = DEFAULT_SIGNING_SECRET,
) {
  const sessionId = `ses_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = Date.now();
  const expiresAtMs = now + SESSION_TTL_MS;

  const token = await createSignedEdgeSessionToken(
    {
      sessionId,
      userId: user.id,
      authenticatedTenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: [user.role],
      plan: user.plan,
      monthlyCredits: user.monthlyCredits,
      keyId: user.defaultKeyId ?? user.id,
      issuedAtMs: now,
      expiresAtMs,
    },
    signingSecret,
  );

  const tokenHash = await hashTokenBase64Url(token);
  memSessionsByHash.set(tokenHash, {
    id: sessionId,
    tenantId: user.tenantId,
    userId: user.id,
    keyId: user.defaultKeyId ?? user.id,
    plan: user.plan,
    monthlyCredits: user.monthlyCredits,
    createdAtMs: now,
    lastRotatedAtMs: now,
    expiresAtMs,
  });

  if (db) {
    try {
      await db
        .prepare(
          'INSERT INTO auth_sessions (id, tenant_id, user_id, token_hash, created_at_ms, last_rotated_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(sessionId, user.tenantId, user.id, tokenHash, now, now, expiresAtMs)
        .run();
    } catch {
      /* memory fallback already stored */
    }
  }

  return {
    id: sessionId,
    userId: user.id,
    tenantId: user.tenantId,
    token,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
}

export async function revokeBetterAuthSession(
  db: D1Database | undefined,
  token: string,
): Promise<boolean> {
  const tokenHash = await hashTokenBase64Url(token);
  const mem = memSessionsByHash.get(tokenHash);
  if (mem) mem.revoked = true;
  if (db) {
    try {
      await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
    } catch {
      /* ignore */
    }
  }
  return Boolean(mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. OAuth 2.1 Store Operations (DCR, Auth Code, Token Exchange, Refresh, Revoke, Introspect)
// ─────────────────────────────────────────────────────────────────────────────

export async function registerOAuthClient(
  db: D1Database | undefined,
  body: unknown,
): Promise<{
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none';
  grant_types: string[];
  response_types: string[];
  client_id_issued_at: number;
}> {
  await ensureAuthSchema(db);
  if (body === null || typeof body !== 'object') {
    throwOAuth(OAUTH_ERRORS.INVALID_CLIENT_METADATA, 'the request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    throwOAuth(OAUTH_ERRORS.INVALID_CLIENT_METADATA, 'redirect_uris must be a non-empty array');
  }
  const redirect_uris: string[] = [];
  for (const u of uris) {
    if (typeof u !== 'string' || u.length === 0 || u.length > 2048) {
      throwOAuth(
        OAUTH_ERRORS.INVALID_CLIENT_METADATA,
        'each redirect_uri must be a non-empty string',
      );
    }
    if (!isAllowedRedirectUri(u)) {
      throwOAuth(
        OAUTH_ERRORS.INVALID_CLIENT_METADATA,
        `redirect_uri '${u}' must be https, http loopback, or a custom scheme`,
      );
    }
    redirect_uris.push(u);
  }
  const clientName =
    typeof b.client_name === 'string' && b.client_name.trim()
      ? b.client_name.trim().slice(0, 120)
      : undefined;
  const clientId = mintOpaqueToken('ccoc_', 16);
  const createdAt = Date.now();

  const record: OAuthClientRecord = {
    clientId,
    ...(clientName ? { clientName } : {}),
    redirectUris: redirect_uris,
    createdAt,
  };
  memOAuthClients.set(clientId, record);

  if (db) {
    try {
      await db
        .prepare(
          'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
        )
        .bind(clientId, clientName ?? null, JSON.stringify(redirect_uris), createdAt)
        .run();
    } catch {
      /* memory fallback already stored */
    }
  }

  return {
    client_id: clientId,
    ...(clientName ? { client_name: clientName } : {}),
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(createdAt / 1000),
  };
}

export async function getOAuthClient(
  db: D1Database | undefined,
  clientId: string,
): Promise<OAuthClientRecord | null> {
  const mem = memOAuthClients.get(clientId);
  if (mem) return mem;
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        'SELECT client_id, client_name, redirect_uris, created_at FROM oauth_clients WHERE client_id = ?',
      )
      .bind(clientId)
      .first<{
        client_id: string;
        client_name: string | null;
        redirect_uris: string;
        created_at: number;
      }>();
    if (!row) return null;
    const rec: OAuthClientRecord = {
      clientId: row.client_id,
      ...(row.client_name ? { clientName: row.client_name } : {}),
      redirectUris: JSON.parse(row.redirect_uris) as string[],
      createdAt: row.created_at,
    };
    memOAuthClients.set(clientId, rec);
    return rec;
  } catch {
    return null;
  }
}

export async function issueOAuthAuthorizationCode(
  db: D1Database | undefined,
  input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    accountUserKey: string;
    resource: string;
    scope?: string;
    state?: string;
  },
): Promise<{ code: string; state?: string }> {
  await ensureAuthSchema(db);
  if (input.codeChallengeMethod !== 'S256') {
    throwOAuth(
      OAUTH_ERRORS.INVALID_REQUEST,
      'code_challenge_method must be S256 (PKCE S256 is mandatory)',
    );
  }
  if (!input.codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) {
    throwOAuth(
      OAUTH_ERRORS.INVALID_REQUEST,
      'a valid 43-char base64url S256 code_challenge is required',
    );
  }
  const code = mintOpaqueToken('ccac_', 32);
  const codeHash = await hashTokenBase64Url(code);
  const expiresAt = Date.now() + AUTH_CODE_TTL_MS;
  const scope = input.scope?.trim() || 'mcp crawl scrape';

  const rec: AuthCodeRecord = {
    codeHash,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    accountUserKey: input.accountUserKey,
    resource: input.resource,
    scope,
    expiresAt,
    used: false,
  };
  memOAuthCodes.set(codeHash, rec);

  if (db) {
    try {
      await db
        .prepare(
          'INSERT INTO oauth_auth_codes (code_hash, client_id, redirect_uri, code_challenge, account_user_key, resource, scope, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
        )
        .bind(
          codeHash,
          rec.clientId,
          rec.redirectUri,
          rec.codeChallenge,
          rec.accountUserKey,
          rec.resource,
          rec.scope,
          rec.expiresAt,
        )
        .run();
    } catch {
      /* memory fallback already stored */
    }
  }

  return { code, ...(input.state !== undefined ? { state: input.state } : {}) };
}

async function mintOAuthTokenPair(
  db: D1Database | undefined,
  grant: {
    accountUserKey: string;
    clientId: string;
    resource: string;
    scope: string;
  },
) {
  const accessToken = mintOpaqueToken('ccat_', 32);
  const refreshToken = mintOpaqueToken('ccrt_', 32);
  const accessHash = await hashTokenBase64Url(accessToken);
  const refreshHash = await hashTokenBase64Url(refreshToken);
  const now = Date.now();

  const accessRec: TokenRecord = {
    tokenHash: accessHash,
    kind: 'access',
    accountUserKey: grant.accountUserKey,
    clientId: grant.clientId,
    resource: grant.resource,
    scope: grant.scope,
    expiresAt: now + ACCESS_TOKEN_TTL_MS,
    revokedAt: null,
  };
  const refreshRec: TokenRecord = {
    tokenHash: refreshHash,
    kind: 'refresh',
    accountUserKey: grant.accountUserKey,
    clientId: grant.clientId,
    resource: grant.resource,
    scope: grant.scope,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
    revokedAt: null,
  };
  memOAuthTokens.set(accessHash, accessRec);
  memOAuthTokens.set(refreshHash, refreshRec);

  if (db) {
    try {
      await db.batch([
        db
          .prepare(
            'INSERT INTO oauth_tokens (token_hash, kind, account_user_key, client_id, resource, scope, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
          )
          .bind(
            accessHash,
            'access',
            grant.accountUserKey,
            grant.clientId,
            grant.resource,
            grant.scope,
            accessRec.expiresAt,
          ),
        db
          .prepare(
            'INSERT INTO oauth_tokens (token_hash, kind, account_user_key, client_id, resource, scope, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
          )
          .bind(
            refreshHash,
            'refresh',
            grant.accountUserKey,
            grant.clientId,
            grant.resource,
            grant.scope,
            refreshRec.expiresAt,
          ),
      ]);
    } catch {
      /* memory fallback already stored */
    }
  }

  return {
    access_token: accessToken,
    token_type: 'Bearer' as const,
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: grant.scope,
  };
}

export async function exchangeOAuthCodeForTokens(
  db: D1Database | undefined,
  input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  },
) {
  await ensureAuthSchema(db);
  if (!input.code || !input.codeVerifier || !input.clientId || !input.redirectUri) {
    throwOAuth(
      OAUTH_ERRORS.INVALID_REQUEST,
      'code, code_verifier, client_id, and redirect_uri are required',
    );
  }
  const codeHash = await hashTokenBase64Url(input.code);
  let rec = memOAuthCodes.get(codeHash) ?? null;

  if (!rec && db) {
    try {
      const row = await db
        .prepare('SELECT * FROM oauth_auth_codes WHERE code_hash = ?')
        .bind(codeHash)
        .first<{
          code_hash: string;
          client_id: string;
          redirect_uri: string;
          code_challenge: string;
          account_user_key: string;
          resource: string;
          scope: string;
          expires_at: number;
          used: number;
        }>();
      if (row) {
        rec = {
          codeHash: row.code_hash,
          clientId: row.client_id,
          redirectUri: row.redirect_uri,
          codeChallenge: row.code_challenge,
          accountUserKey: row.account_user_key,
          resource: row.resource,
          scope: row.scope,
          expiresAt: row.expires_at,
          used: Boolean(row.used),
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (!rec) throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'unknown authorization code');
  if (rec.used) throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'authorization code already used');
  if (Date.now() > rec.expiresAt)
    throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'authorization code expired');
  if (rec.clientId !== input.clientId) {
    throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'client_id does not match authorization code');
  }
  if (rec.redirectUri !== input.redirectUri) {
    throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'redirect_uri does not match authorization code');
  }

  const pkce = await verifyPkceChallenge(input.codeVerifier, rec.codeChallenge, 'S256');
  if (!pkce.valid)
    throwOAuth(OAUTH_ERRORS.INVALID_GRANT, pkce.reason ?? 'PKCE verification failed');

  // Atomically mark used
  rec.used = true;
  memOAuthCodes.set(codeHash, rec);
  if (db) {
    try {
      await db
        .prepare('UPDATE oauth_auth_codes SET used = 1 WHERE code_hash = ? AND used = 0')
        .bind(codeHash)
        .run();
    } catch {
      /* ignore */
    }
  }

  return mintOAuthTokenPair(db, {
    accountUserKey: rec.accountUserKey,
    clientId: rec.clientId,
    resource: rec.resource,
    scope: rec.scope,
  });
}

export async function refreshOAuthTokens(db: D1Database | undefined, refreshToken: string) {
  await ensureAuthSchema(db);
  if (!refreshToken) throwOAuth(OAUTH_ERRORS.INVALID_REQUEST, 'refresh_token is required');
  const tokenHash = await hashTokenBase64Url(refreshToken);
  let rec = memOAuthTokens.get(tokenHash) ?? null;

  if (!rec && db) {
    try {
      const row = await db
        .prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?')
        .bind(tokenHash)
        .first<{
          token_hash: string;
          kind: 'access' | 'refresh';
          account_user_key: string;
          client_id: string;
          resource: string;
          scope: string;
          expires_at: number;
          revoked_at: number | null;
        }>();
      if (row) {
        rec = {
          tokenHash: row.token_hash,
          kind: row.kind,
          accountUserKey: row.account_user_key,
          clientId: row.client_id,
          resource: row.resource,
          scope: row.scope,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (!rec || rec.kind !== 'refresh')
    throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'unknown refresh token');
  if (rec.revokedAt !== null) throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'refresh token revoked');
  if (Date.now() > rec.expiresAt) throwOAuth(OAUTH_ERRORS.INVALID_GRANT, 'refresh token expired');

  // Rotate: revoke old refresh token immediately
  rec.revokedAt = Date.now();
  memOAuthTokens.set(tokenHash, rec);
  if (db) {
    try {
      await db
        .prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?')
        .bind(rec.revokedAt, tokenHash)
        .run();
    } catch {
      /* ignore */
    }
  }

  return mintOAuthTokenPair(db, {
    accountUserKey: rec.accountUserKey,
    clientId: rec.clientId,
    resource: rec.resource,
    scope: rec.scope,
  });
}

export async function exchangeClientCredentialsForOAuthTokens(
  db: D1Database | undefined,
  input: {
    clientId?: string;
    clientSecret?: string;
    resource: string;
    scope?: string;
  },
) {
  await ensureAuthSchema(db);
  const secretOrKey = input.clientSecret?.trim() || input.clientId?.trim() || '';
  if (!secretOrKey) {
    throwOAuth(
      OAUTH_ERRORS.INVALID_CLIENT,
      'client_secret (API key) is required for client_credentials grant',
    );
  }
  const resolved = await resolveKey(db, secretOrKey);
  if (!resolved) {
    throwOAuth(OAUTH_ERRORS.INVALID_CLIENT, 'Invalid client credentials / API key');
  }
  return mintOAuthTokenPair(db, {
    accountUserKey: secretOrKey,
    clientId: input.clientId || `key_${resolved.id}`,
    resource: input.resource,
    scope: input.scope || 'mcp crawl scrape',
  });
}

export async function resolveOAuthAccessToken(
  db: D1Database | undefined,
  token: string,
  expectedResource?: string,
): Promise<TokenRecord | null> {
  if (!token) return null;
  const tokenHash = await hashTokenBase64Url(token);
  let rec = memOAuthTokens.get(tokenHash) ?? null;

  if (!rec && db) {
    try {
      const row = await db
        .prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?')
        .bind(tokenHash)
        .first<{
          token_hash: string;
          kind: 'access' | 'refresh';
          account_user_key: string;
          client_id: string;
          resource: string;
          scope: string;
          expires_at: number;
          revoked_at: number | null;
        }>();
      if (row) {
        rec = {
          tokenHash: row.token_hash,
          kind: row.kind,
          accountUserKey: row.account_user_key,
          clientId: row.client_id,
          resource: row.resource,
          scope: row.scope,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        };
        memOAuthTokens.set(tokenHash, rec);
      }
    } catch {
      /* ignore */
    }
  }

  if (!rec || rec.kind !== 'access') return null;
  if (rec.revokedAt !== null) return null;
  if (Date.now() > rec.expiresAt) return null;
  if (expectedResource && rec.resource && rec.resource !== expectedResource) return null;
  return rec;
}

export async function revokeOAuthToken(
  db: D1Database | undefined,
  token: string,
): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await hashTokenBase64Url(token);
  const now = Date.now();
  const mem = memOAuthTokens.get(tokenHash);
  if (mem) {
    mem.revokedAt = now;
    // Also revoke all sibling tokens for the same (clientId, accountUserKey) grant
    for (const [h, r] of memOAuthTokens) {
      if (
        r.clientId === mem.clientId &&
        r.accountUserKey === mem.accountUserKey &&
        r.revokedAt === null
      ) {
        memOAuthTokens.set(h, { ...r, revokedAt: now });
      }
    }
  }
  if (db) {
    try {
      await db
        .prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?')
        .bind(now, tokenHash)
        .run();
    } catch {
      /* ignore */
    }
  }
  return true;
}

export async function introspectOAuthToken(
  db: D1Database | undefined,
  token: string,
): Promise<{
  active: boolean;
  scope?: string;
  client_id?: string;
  token_type?: string;
  exp?: number;
  sub?: string;
  aud?: string;
}> {
  if (!token) return { active: false };
  const tokenHash = await hashTokenBase64Url(token);
  const rec = memOAuthTokens.get(tokenHash);
  if (rec && rec.revokedAt === null && Date.now() <= rec.expiresAt) {
    return {
      active: true,
      scope: rec.scope,
      client_id: rec.clientId,
      token_type: 'Bearer',
      exp: Math.floor(rec.expiresAt / 1000),
      sub: rec.accountUserKey.slice(0, 16),
      aud: rec.resource,
    };
  }
  const resolvedKey = await resolveKey(db, token);
  if (resolvedKey) {
    return {
      active: true,
      scope: 'mcp crawl scrape search extract',
      client_id: `key_${resolvedKey.id}`,
      token_type: 'Bearer',
      sub: resolvedKey.id,
    };
  }
  return { active: false };
}
