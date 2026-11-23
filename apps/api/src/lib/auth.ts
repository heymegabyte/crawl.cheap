import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { resolveKey } from './keys';
import {
  DEFAULT_SIGNING_SECRET,
  extractBearerOrCookieSessionToken,
  resolveOAuthAccessToken,
  verifySignedEdgeSessionToken,
} from './better-auth';

export interface Principal {
  authed: boolean;
  /** True when the request explicitly sent an Authorization header or session token that failed verification. */
  invalidCredentials?: boolean;
  authMethod?: 'api-key' | 'oauth2' | 'better-auth-session' | 'env-key' | 'demo';
  key?: string;
  keyId?: string;
  userId?: string;
  tenantId?: string;
  teamId?: string;
  role?: string;
  plan?: string;
  monthlyCredits?: number;
  maxConcurrency?: number;
  spendLimit?: number | null;
  mode: 'authenticated' | 'demo';
}

export type Vars = { principal: Principal };

/**
 * Resolve the caller across all supported Cloudflare-native authentication methods:
 *   1. Static admin keys in `API_KEYS`
 *   2. D1 / in-memory API keys (`cc_live_...` and `fc-...` issued by crawl.cheap / Better Auth / idmux)
 *   3. OAuth 2.1 Bearer access tokens (`ccat_...` / `dtat_...`) minted via `/token`
 *   4. Better Auth signed edge session tokens (`TT-SESSION` JWT via Bearer header or `tt_session` / `better-auth.session_token` cookie)
 *   5. Absent any credentials, falls back to demo mode. If credentials WERE explicitly supplied in `Authorization`
 *      and failed all checks, sets `invalidCredentials: true` so API routes reject with 401 (Firecrawl parity).
 */
export async function principal(c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) {
  const header = c.req.header('authorization') ?? '';
  const bearerToken = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const hasExplicitAuthHeader = header.trim().length > 0;
  const accepted = (c.env.API_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 1. Static env API_KEYS
  if (bearerToken && accepted.includes(bearerToken)) {
    c.set('principal', {
      authed: true,
      authMethod: 'env-key',
      key: bearerToken,
      keyId: 'env-admin',
      teamId: 'env-admin',
      mode: 'authenticated',
      plan: 'scale',
      monthlyCredits: 1_000_000,
      maxConcurrency: 100,
    });
    await next();
    return;
  }

  // 2. D1 / memory API key (`cc_live_...` or `fc-...`)
  if (bearerToken) {
    const resolved = await resolveKey(c.env.DB, bearerToken);
    if (resolved) {
      c.set('principal', {
        authed: true,
        authMethod: 'api-key',
        key: bearerToken,
        keyId: resolved.id,
        teamId: resolved.teamId,
        userId: resolved.userId,
        plan: resolved.plan,
        monthlyCredits: resolved.monthlyCredits,
        maxConcurrency: resolved.maxConcurrency,
        spendLimit: resolved.spendLimit,
        mode: 'authenticated',
      });
      await next();
      return;
    }

    // 3. OAuth 2.1 Access Token (`ccat_...` or `dtat_...`)
    const oauthTok = await resolveOAuthAccessToken(c.env.DB, bearerToken);
    if (oauthTok) {
      const underlyingKey = await resolveKey(c.env.DB, oauthTok.accountUserKey);
      c.set('principal', {
        authed: true,
        authMethod: 'oauth2',
        key: oauthTok.accountUserKey,
        keyId: underlyingKey?.id ?? oauthTok.clientId,
        teamId: underlyingKey?.teamId ?? oauthTok.clientId,
        plan: underlyingKey?.plan ?? 'free',
        monthlyCredits: underlyingKey?.monthlyCredits ?? 1000,
        maxConcurrency: underlyingKey?.maxConcurrency ?? 25,
        spendLimit: underlyingKey?.spendLimit ?? null,
        mode: 'authenticated',
      });
      await next();
      return;
    }
  }

  // 4. Better Auth Signed Session Token (from Bearer or Cookie)
  const sessionCandidate = bearerToken ?? extractBearerOrCookieSessionToken(c.req.raw);
  if (sessionCandidate && sessionCandidate.includes('.')) {
    const secret = c.env.AUTH_SIGNING_SECRET ?? c.env.WEBHOOK_SECRET ?? DEFAULT_SIGNING_SECRET;
    const verified = await verifySignedEdgeSessionToken(sessionCandidate, secret);
    if (verified.valid && verified.serverClaims) {
      const sc = verified.serverClaims;
      c.set('principal', {
        authed: true,
        authMethod: 'better-auth-session',
        keyId: sc.keyId ?? sc.userId,
        userId: sc.userId,
        tenantId: sc.verifiedTenantId,
        teamId: sc.verifiedTenantId,
        role: sc.roles[0] ?? 'owner',
        plan: sc.plan ?? 'free',
        monthlyCredits: sc.monthlyCredits ?? 1000,
        maxConcurrency: 25,
        mode: 'authenticated',
      });
      await next();
      return;
    }
  }

  // 5. Unauthenticated or explicitly invalid credentials
  c.set('principal', {
    authed: false,
    invalidCredentials: hasExplicitAuthHeader,
    authMethod: 'demo',
    mode: 'demo',
  });
  await next();
}

/** Guard a route that requires an authenticated principal. */
export function requireAuth(c: Context<{ Bindings: Env; Variables: Vars }>): Response | null {
  const p = c.get('principal');
  if (p.authed) return null;
  return c.json(
    {
      success: false as const,
      error: p.invalidCredentials
        ? 'Unauthorized: Invalid token'
        : 'This endpoint requires authentication. Use a crawl.cheap API key (`POST /v2/keys`), a Better Auth session (`/api/auth/sign-in/email`), or an OAuth 2.1 access token (`/token`).',
      code: 'BAD_REQUEST' as const,
    },
    401,
  );
}
