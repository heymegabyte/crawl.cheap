import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Env } from '../env';
import type { Vars } from '../lib/auth';
import { createKey, listKeysForUser, revokeKeyById } from '../lib/keys';
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  createBetterAuthSession,
  DEFAULT_SIGNING_SECRET,
  deriveVerifiedServerTenantContext,
  evaluateHierarchicalRbacPermission,
  exchangeClientCredentialsForOAuthTokens,
  exchangeOAuthCodeForTokens,
  extractBearerOrCookieSessionToken,
  getOAuthClient,
  introspectOAuthToken,
  isAllowedRedirectUri,
  issueOAuthAuthorizationCode,
  OAUTH_ERRORS,
  OAuthError,
  refreshOAuthTokens,
  registerOAuthClient,
  revokeBetterAuthSession,
  revokeOAuthToken,
  signInEmailUser,
  signUpEmailUser,
  verifySignedEdgeSessionToken,
  type BetterAuthUser,
} from '../lib/better-auth';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

function getIssuer(c: Ctx): string {
  try {
    return (c.env.SERVICE_ORIGIN || new URL(c.req.url).origin).replace(/\/+$/, '');
  } catch {
    return 'https://api.crawl.cheap';
  }
}

function getSigningSecret(c: Ctx): string {
  return c.env.AUTH_SIGNING_SECRET ?? c.env.WEBHOOK_SECRET ?? DEFAULT_SIGNING_SECRET;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OAuth 2.1 Discovery Documents (RFC 9728 & RFC 8414)
// ─────────────────────────────────────────────────────────────────────────────

route.get('/.well-known/oauth-protected-resource', (c) => {
  const issuer = getIssuer(c);
  return c.json(buildProtectedResourceMetadata({ issuer, resource: issuer }));
});

const asMetadataHandler = (c: Ctx) => {
  const issuer = getIssuer(c);
  return c.json(buildAuthorizationServerMetadata({ issuer, resource: issuer }));
};

route.get('/.well-known/oauth-authorization-server', asMetadataHandler);
route.get('/.well-known/openid-configuration', asMetadataHandler);

// ─────────────────────────────────────────────────────────────────────────────
// 2. OAuth 2.1 Dynamic Client Registration (RFC 7591)
// ─────────────────────────────────────────────────────────────────────────────

const dcrHandler = async (c: Ctx) => {
  try {
    const body = await c.req.json().catch(() => null);
    const res = await registerOAuthClient(c.env.DB, body);
    return c.json(res, 201);
  } catch (e) {
    if (e instanceof OAuthError) {
      return c.json(e.toBody(), e.status as ContentfulStatusCode);
    }
    return c.json({ error: 'server_error', error_description: 'Registration failed' }, 500);
  }
};

route.post('/register', dcrHandler);
route.post('/oauth/register', dcrHandler);
route.post('/api/auth/oauth2/register', dcrHandler);

// ─────────────────────────────────────────────────────────────────────────────
// 3. OAuth 2.1 Authorization Endpoint (RFC 7636 PKCE S256)
// ─────────────────────────────────────────────────────────────────────────────

const authorizeHandler = async (c: Ctx) => {
  const q = c.req.query();
  let bodyParams: Record<string, string> = {};
  if (c.req.method === 'POST') {
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('application/json')) {
      bodyParams = (await c.req.json().catch(() => ({}))) as Record<string, string>;
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody().catch(() => ({}));
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === 'string') bodyParams[k] = v;
      }
    }
  }
  const params = { ...q, ...bodyParams };
  const responseType = params.response_type;
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const codeChallenge = params.code_challenge;
  const codeChallengeMethod = params.code_challenge_method;
  const state = params.state;
  const scope = params.scope;
  const resource = params.resource ?? getIssuer(c);

  if (responseType !== 'code') {
    return c.json(
      { error: OAUTH_ERRORS.INVALID_REQUEST, error_description: "response_type must be 'code'" },
      400,
    );
  }
  if (!clientId) {
    return c.json(
      { error: OAUTH_ERRORS.INVALID_REQUEST, error_description: 'client_id is required' },
      400,
    );
  }

  const client = await getOAuthClient(c.env.DB, clientId);
  if (client) {
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return c.json(
        {
          error: OAUTH_ERRORS.INVALID_REQUEST,
          error_description: 'redirect_uri does not match a registered client URI',
        },
        400,
      );
    }
  } else {
    if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
      return c.json(
        {
          error: OAUTH_ERRORS.INVALID_REQUEST,
          error_description: 'redirect_uri must be a valid https, loopback, or custom scheme URI',
        },
        400,
      );
    }
  }

  if (codeChallengeMethod !== 'S256') {
    return c.json(
      {
        error: OAUTH_ERRORS.INVALID_REQUEST,
        error_description: 'code_challenge_method must be S256 (PKCE S256 is mandatory)',
      },
      400,
    );
  }
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return c.json(
      {
        error: OAUTH_ERRORS.INVALID_REQUEST,
        error_description: 'a valid 43-character S256 code_challenge is required',
      },
      400,
    );
  }

  // Determine if the user is approving (via authenticated Bearer/Session, api_key param, or POST/approve=true)
  const p = c.get('principal');
  const providedApiKey = params.api_key?.trim() || p.key;
  const autoApprove =
    p.authed ||
    Boolean(providedApiKey) ||
    params.approve === 'true' ||
    c.req.method === 'POST' ||
    (c.req.header('accept') ?? '').includes('application/json');

  if (!autoApprove && (c.req.header('accept') ?? '').includes('text/html')) {
    // Render dark-first Better Auth OAuth 2.1 consent screen (#060610 bg, #00E5FF accent)
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorize · crawl.cheap OAuth 2.1</title>
<style>
  body{margin:0;background:#060610;color:#eef2f7;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{max-width:440px;width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:28px}
  h1{margin:0 0 8px;font-size:1.35rem}
  p{color:#9aa3b5;font-size:.92rem;line-height:1.5}
  .badge{display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(0,229,255,.12);color:#00E5FF;font-size:12px;font-family:monospace;margin-bottom:14px}
  input{width:100%;box-sizing:border-box;background:#0a0a16;border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#eef2f7;padding:11px 13px;font-family:monospace;margin:10px 0 16px}
  button{width:100%;background:linear-gradient(100deg,#00E5FF,#50aae3);color:#04141c;border:0;border-radius:10px;padding:12px 16px;font-weight:700;cursor:pointer}
</style>
</head>
<body>
  <form class="card" method="POST" action="/authorize">
    <span class="badge">Better Auth · OAuth 2.1 + PKCE S256</span>
    <h1>Authorize ${client?.clientName ?? clientId}</h1>
    <p>This client is requesting access to your <strong>crawl.cheap</strong> account for scopes: <code>${scope ?? 'mcp crawl scrape'}</code>.</p>
    <input type="hidden" name="response_type" value="code" />
    <input type="hidden" name="client_id" value="${clientId}" />
    <input type="hidden" name="redirect_uri" value="${redirectUri}" />
    <input type="hidden" name="code_challenge" value="${codeChallenge}" />
    <input type="hidden" name="code_challenge_method" value="S256" />
    <input type="hidden" name="state" value="${state ?? ''}" />
    <input type="hidden" name="scope" value="${scope ?? 'mcp crawl scrape'}" />
    <input type="hidden" name="resource" value="${resource}" />
    <input type="hidden" name="approve" value="true" />
    <label style="font-size:12px;color:#9aa3b5">Optional existing API key (leave blank to auto-provision a free key):</label>
    <input type="text" name="api_key" placeholder="cc_live_… or fc-…" />
    <button type="submit">Approve &amp; Continue →</button>
  </form>
</body>
</html>`;
    return c.html(html);
  }

  let accountUserKey = providedApiKey;
  if (!accountUserKey) {
    const created = await createKey(c.env.DB, { name: `oauth:${clientId}` });
    accountUserKey = created.key;
  }

  try {
    const issued = await issueOAuthAuthorizationCode(c.env.DB, {
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: 'S256',
      accountUserKey,
      resource,
      scope,
      state,
    });

    const target = new URL(redirectUri);
    target.searchParams.set('code', issued.code);
    if (issued.state) target.searchParams.set('state', issued.state);

    if (
      (c.req.header('accept') ?? '').includes('application/json') &&
      params.redirect === 'false'
    ) {
      return c.json({
        code: issued.code,
        ...(issued.state ? { state: issued.state } : {}),
        redirect_uri: target.toString(),
      });
    }
    return c.redirect(target.toString(), 302);
  } catch (e) {
    if (e instanceof OAuthError) {
      return c.json(e.toBody(), e.status as ContentfulStatusCode);
    }
    return c.json({ error: 'server_error', error_description: 'Failed to issue code' }, 500);
  }
};

route.get('/authorize', authorizeHandler);
route.post('/authorize', authorizeHandler);
route.get('/oauth/authorize', authorizeHandler);
route.post('/oauth/authorize', authorizeHandler);
route.get('/api/auth/oauth2/authorize', authorizeHandler);
route.post('/api/auth/oauth2/authorize', authorizeHandler);

// ─────────────────────────────────────────────────────────────────────────────
// 4. OAuth 2.1 Token, Revocation & Introspection Endpoints
// ─────────────────────────────────────────────────────────────────────────────

async function parseOAuthFormOrJson(c: Ctx): Promise<Record<string, string>> {
  const ct = c.req.header('content-type') ?? '';
  if (ct.includes('application/json')) {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
    return out;
  }
  const form = await c.req.parseBody().catch(() => ({}));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

const tokenHandler = async (c: Ctx) => {
  c.header('cache-control', 'no-store');
  c.header('pragma', 'no-cache');
  const params = await parseOAuthFormOrJson(c);
  const grantType = params.grant_type;

  // Also check HTTP Basic auth header for client_id / client_secret
  let basicClientId: string | undefined;
  let basicClientSecret: string | undefined;
  const authHeader = c.req.header('authorization') ?? '';
  if (/^Basic\s+/i.test(authHeader)) {
    try {
      const decoded = atob(authHeader.replace(/^Basic\s+/i, '').trim());
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        basicClientId = decoded.slice(0, idx);
        basicClientSecret = decoded.slice(idx + 1);
      }
    } catch {
      /* ignore */
    }
  }

  try {
    if (grantType === 'authorization_code') {
      const tok = await exchangeOAuthCodeForTokens(c.env.DB, {
        code: params.code ?? '',
        codeVerifier: params.code_verifier ?? '',
        clientId: params.client_id ?? basicClientId ?? '',
        redirectUri: params.redirect_uri ?? '',
      });
      return c.json(tok);
    }
    if (grantType === 'refresh_token') {
      const tok = await refreshOAuthTokens(c.env.DB, params.refresh_token ?? '');
      return c.json(tok);
    }
    if (grantType === 'client_credentials') {
      const tok = await exchangeClientCredentialsForOAuthTokens(c.env.DB, {
        clientId: params.client_id ?? basicClientId,
        clientSecret: params.client_secret ?? basicClientSecret ?? params.api_key,
        resource: params.resource ?? getIssuer(c),
        scope: params.scope,
      });
      return c.json(tok);
    }
    return c.json(
      {
        error: OAUTH_ERRORS.UNSUPPORTED_GRANT_TYPE,
        error_description: `Unsupported grant_type '${grantType ?? ''}'. Supported: authorization_code, refresh_token, client_credentials`,
      },
      400,
    );
  } catch (e) {
    if (e instanceof OAuthError) {
      return c.json(e.toBody(), e.status as ContentfulStatusCode);
    }
    return c.json({ error: 'server_error', error_description: 'Token exchange failed' }, 500);
  }
};

route.post('/token', tokenHandler);
route.post('/oauth/token', tokenHandler);
route.post('/api/auth/oauth2/token', tokenHandler);

const revokeHandler = async (c: Ctx) => {
  const params = await parseOAuthFormOrJson(c);
  const token = params.token ?? '';
  if (token) await revokeOAuthToken(c.env.DB, token);
  return c.json({ ok: true }, 200);
};

route.post('/revoke', revokeHandler);
route.post('/oauth/revoke', revokeHandler);
route.post('/api/auth/oauth2/revoke', revokeHandler);

const introspectHandler = async (c: Ctx) => {
  const params = await parseOAuthFormOrJson(c);
  const token = params.token ?? '';
  const result = await introspectOAuthToken(c.env.DB, token);
  return c.json(result, 200);
};

route.post('/introspect', introspectHandler);
route.post('/oauth/introspect', introspectHandler);
route.post('/api/auth/oauth2/introspect', introspectHandler);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Better Auth Endpoints (`/api/auth/*`)
// ─────────────────────────────────────────────────────────────────────────────

const healthHandler = (c: Ctx) =>
  c.json({
    status: 'healthy',
    capabilityId: 'auth',
    provider: 'better-auth-cloudflare',
    oauth21: true,
    pkce: 'S256',
    version: '1.0.0',
    timestamp: Date.now(),
  });

route.get('/api/auth/health', healthHandler);
route.get('/api/health/auth', healthHandler);

route.post('/api/auth/sign-up/email', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      email: z.string().email(),
      password: z.string().min(6).max(200),
      name: z.string().max(120).optional(),
      plan: z.enum(['free', 'hobby', 'standard', 'growth', 'scale']).optional(),
    })
    .safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid sign-up input',
        code: 'BAD_REQUEST',
      },
      400,
    );
  }
  try {
    const { user, session, apiKey, keyId } = await signUpEmailUser(c.env.DB, {
      ...parsed.data,
      signingSecret: getSigningSecret(c),
    });
    c.header(
      'set-cookie',
      `tt_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );
    return c.json({
      success: true,
      token: session.token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        role: user.role,
        plan: user.plan,
        monthlyCredits: user.monthlyCredits,
      },
      session: {
        id: session.id,
        userId: session.userId,
        tenantId: session.tenantId,
        token: session.token,
        expiresAt: session.expiresAt,
      },
      apiKey,
      keyId,
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Sign-up failed',
        code: 'BAD_REQUEST',
      },
      400,
    );
  }
});

route.post('/api/auth/sign-in/email', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      email: z.string().email(),
      password: z.string().min(1),
    })
    .safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: 'email and password are required', code: 'BAD_REQUEST' },
      400,
    );
  }
  try {
    const { user, session } = await signInEmailUser(c.env.DB, {
      ...parsed.data,
      signingSecret: getSigningSecret(c),
    });
    c.header(
      'set-cookie',
      `tt_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );
    return c.json({
      success: true,
      token: session.token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        role: user.role,
        plan: user.plan,
        monthlyCredits: user.monthlyCredits,
      },
      session: {
        id: session.id,
        userId: session.userId,
        tenantId: session.tenantId,
        token: session.token,
        expiresAt: session.expiresAt,
      },
      apiKey: user.defaultApiKey,
      keyId: user.defaultKeyId,
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Invalid credentials',
        code: 'BAD_REQUEST',
      },
      401,
    );
  }
});

// Better Auth Social OAuth 2.0 Sign-In (`github`, `google`, `cloudflare`)
route.post('/api/auth/sign-in/social', async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const provider = String((raw as { provider?: string })?.provider ?? 'github').toLowerCase();
  const callbackURL = String(
    (raw as { callbackURL?: string })?.callbackURL ?? `${getIssuer(c)}/app/`,
  );
  const state = crypto.randomUUID();
  const issuer = getIssuer(c);

  if (provider === 'github' && c.env.GITHUB_CLIENT_ID) {
    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(c.env.GITHUB_CLIENT_ID)}&redirect_uri=${encodeURIComponent(`${issuer}/api/auth/callback/github`)}&scope=read:user%20user:email&state=${state}`;
    return c.json({ url, redirect: true, provider, state });
  }
  if (provider === 'google' && c.env.GOOGLE_CLIENT_ID) {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(c.env.GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(`${issuer}/api/auth/callback/google`)}&response_type=code&scope=openid%20email%20profile&state=${state}`;
    return c.json({ url, redirect: true, provider, state });
  }
  // Self-contained Cloudflare-native OAuth callback when external provider client IDs aren't set
  const url = `${issuer}/api/auth/callback/${encodeURIComponent(provider)}?code=cf_social_${state}&state=${state}&callbackURL=${encodeURIComponent(callbackURL)}`;
  return c.json({ url, redirect: true, provider, state });
});

route.get('/api/auth/callback/:provider', async (c) => {
  const provider = c.req.param('provider');
  const code = c.req.query('code') ?? crypto.randomUUID();
  const callbackURL = c.req.query('callbackURL');
  const userId = `usr_${provider}_${code.slice(0, 12).replace(/[^a-zA-Z0-9]/g, '')}`;
  const tenantId = `ten_${userId.slice(4, 20)}`;
  const keyCreated = await createKey(c.env.DB, {
    name: `social:${provider}`,
    userId,
    teamId: tenantId,
  });
  const socialUser: BetterAuthUser = {
    id: userId,
    tenantId,
    email: `${provider}-user@crawl.cheap`,
    name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Developer`,
    passwordHash: '',
    emailVerified: true,
    role: 'owner',
    plan: 'free',
    monthlyCredits: 1000,
    spendLimit: null,
    defaultApiKey: keyCreated.key,
    defaultKeyId: keyCreated.id,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  const session = await createBetterAuthSession(c.env.DB, socialUser, getSigningSecret(c));
  c.header(
    'set-cookie',
    `tt_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
  );
  if (callbackURL && isAllowedRedirectUri(callbackURL)) {
    const dest = new URL(callbackURL);
    dest.searchParams.set('token', session.token);
    dest.searchParams.set('apiKey', keyCreated.key);
    return c.redirect(dest.toString(), 302);
  }
  return c.json({
    success: true,
    provider,
    token: session.token,
    apiKey: keyCreated.key,
    user: {
      id: socialUser.id,
      tenantId: socialUser.tenantId,
      email: socialUser.email,
      name: socialUser.name,
      role: socialUser.role,
    },
    session,
  });
});

const getSessionHandler = async (c: Ctx) => {
  const token = extractBearerOrCookieSessionToken(c.req.raw);
  if (!token) return c.json({ session: null, user: null }, 200);
  const verified = await verifySignedEdgeSessionToken(token, getSigningSecret(c));
  if (!verified.valid || !verified.serverClaims) {
    return c.json({ session: null, user: null, error: verified.reason }, 401);
  }
  const sc = verified.serverClaims;
  return c.json({
    session: {
      id: sc.sessionId,
      userId: sc.userId,
      tenantId: sc.verifiedTenantId,
      issuedAt: new Date(sc.issuedAtMs).toISOString(),
      expiresAt: new Date(sc.expiresAtMs).toISOString(),
    },
    user: {
      id: sc.userId,
      tenantId: sc.verifiedTenantId,
      email: sc.email ?? 'user@crawl.cheap',
      name: sc.name ?? 'Developer',
      role: sc.roles[0] ?? 'owner',
      roles: sc.roles,
      plan: sc.plan ?? 'free',
      monthlyCredits: sc.monthlyCredits ?? 1000,
      keyId: sc.keyId,
    },
  });
};

route.get('/api/auth/session', getSessionHandler);
route.get('/api/auth/get-session', getSessionHandler);

route.post('/api/auth/sign-out', async (c) => {
  const token = extractBearerOrCookieSessionToken(c.req.raw);
  if (token) await revokeBetterAuthSession(c.env.DB, token);
  c.header('set-cookie', 'tt_session=; Path=/; HttpOnly; Max-Age=0');
  return c.json({ success: true });
});

route.post('/api/auth/verify-tenant', async (c) => {
  const token = extractBearerOrCookieSessionToken(c.req.raw);
  if (!token) {
    return c.json(
      {
        ok: false,
        error:
          'Missing signed Bearer or tt_session token; unsigned JSON claim spoofing is rejected',
      },
      401,
    );
  }
  const verified = await verifySignedEdgeSessionToken(token, getSigningSecret(c));
  if (!verified.valid || !verified.serverClaims) {
    return c.json({ ok: false, error: verified.reason ?? 'Invalid session signature' }, 401);
  }
  try {
    const body = (await c.req.json().catch(() => ({}))) as { clientTenantId?: string };
    const context = deriveVerifiedServerTenantContext(verified.serverClaims, body.clientTenantId);
    return c.json({ ok: true, context }, 200);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 403);
  }
});

route.post('/api/auth/evaluate-permission', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { role?: string; permission?: string };
  if (!body.role || !body.permission) {
    return c.json({ ok: false, error: 'role and permission required' }, 400);
  }
  const decision = evaluateHierarchicalRbacPermission(body.role, body.permission);
  return c.json(decision, decision.granted ? 200 : 403);
});

// Better Auth API Key plugin routes
route.post('/api/auth/api-key/create', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    prefix?: 'cc_live_' | 'fc-';
    plan?: string;
  };
  const p = c.get('principal');
  const created = await createKey(c.env.DB, {
    name: body.name ?? 'better-auth-key',
    prefix: body.prefix === 'fc-' ? 'fc-' : 'cc_live_',
    plan: body.plan ?? p.plan ?? 'free',
    userId: p.userId,
    teamId: p.teamId,
  });
  return c.json({
    success: true,
    key: created.key,
    apiKey: created.key,
    id: created.id,
    keyId: created.id,
    prefix: created.prefix,
    plan: created.plan,
    monthlyCredits: created.monthlyCredits,
  });
});

route.get('/api/auth/api-key/list', async (c) => {
  const p = c.get('principal');
  const keys = await listKeysForUser(c.env.DB, p.userId);
  return c.json({ success: true, keys });
});

route.post('/api/auth/api-key/revoke', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { keyId?: string; id?: string };
  const targetId = body.keyId ?? body.id ?? '';
  if (!targetId) return c.json({ success: false, error: 'keyId is required' }, 400);
  const ok = await revokeKeyById(c.env.DB, targetId);
  return c.json({ success: ok });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Firecrawl Official E2E Test Identity Provisioner (`/idmux` & `/v2/idmux`)
// ─────────────────────────────────────────────────────────────────────────────

const idmuxHandler = async (c: Ctx) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    concurrency?: number;
    credits?: number;
    tokens?: number;
    teamId?: string;
    prefix?: 'cc_live_' | 'fc-';
  };
  const created = await createKey(c.env.DB, {
    name: body.name ?? 'idmux-e2e',
    prefix: body.prefix ?? 'fc-',
    plan: 'scale',
    credits: body.credits ?? 1_000_000,
    concurrency: body.concurrency ?? 100,
    teamId: body.teamId,
  });
  return c.json({
    apiKey: created.key,
    teamId: created.teamId,
    keyId: created.id,
    concurrency: created.maxConcurrency,
    credits: created.monthlyCredits,
  });
};

route.post('/idmux', idmuxHandler);
route.post('/idmux/', idmuxHandler);
route.post('/v2/idmux', idmuxHandler);

export default route;
