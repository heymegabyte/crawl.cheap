import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { computePkceCodeChallenge } from '../src/lib/better-auth';
import type { Env } from '../src/env';

const TEST_ENV: Env = {
  DEMO_MODE: 'true',
  SERVICE_ORIGIN: 'https://api.crawl.cheap',
  AUTH_SIGNING_SECRET: 'test-better-auth-signing-secret-2026-cloudflare',
};

async function req(
  path: string,
  init: RequestInit = {},
  env: Env = TEST_ENV,
): Promise<{ status: number; headers: Headers; body: any }> {
  const r = await app.fetch(new Request(`https://api.crawl.cheap${path}`, init), env);
  const body = await r.json().catch(() => null);
  return { status: r.status, headers: r.headers, body };
}

describe('Better Auth + OAuth 2.1 Cloudflare-native Authentication & Firecrawl Compatibility', () => {
  it('serves RFC 9728 Protected Resource Metadata and RFC 8414 Authorization Server Metadata', async () => {
    const prm = await req('/.well-known/oauth-protected-resource');
    expect(prm.status).toBe(200);
    expect(prm.body.resource).toBe('https://api.crawl.cheap');
    expect(prm.body.authorization_servers).toEqual(['https://api.crawl.cheap']);
    expect(prm.body.bearer_methods_supported).toEqual(['header']);

    const asMeta = await req('/.well-known/oauth-authorization-server');
    expect(asMeta.status).toBe(200);
    expect(asMeta.body.issuer).toBe('https://api.crawl.cheap');
    expect(asMeta.body.authorization_endpoint).toBe('https://api.crawl.cheap/authorize');
    expect(asMeta.body.token_endpoint).toBe('https://api.crawl.cheap/token');
    expect(asMeta.body.registration_endpoint).toBe('https://api.crawl.cheap/register');
    expect(asMeta.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(asMeta.body.grant_types_supported).toContain('authorization_code');
    expect(asMeta.body.grant_types_supported).toContain('refresh_token');
    expect(asMeta.body.grant_types_supported).toContain('client_credentials');
  });

  it('implements RFC 7591 Dynamic Client Registration (DCR) and validates redirect_uris schemes', async () => {
    const bad = await req('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example.com/cb'] }),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_client_metadata');

    const good = await req('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Firecrawl MCP Client',
        redirect_uris: ['https://app.example.com/oauth/cb', 'http://127.0.0.1:4321/cb'],
      }),
    });
    expect(good.status).toBe(201);
    expect(good.body.client_id).toMatch(/^ccoc_/);
    expect(good.body.token_endpoint_auth_method).toBe('none');
    expect(good.body.redirect_uris).toEqual([
      'https://app.example.com/oauth/cb',
      'http://127.0.0.1:4321/cb',
    ]);
  });

  it('completes full OAuth 2.1 authorization_code + PKCE S256 flow, refresh rotation, introspection, revocation, and authenticates Firecrawl endpoints', async () => {
    // 1. Register client
    const reg = await req('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'E2E PKCE Client',
        redirect_uris: ['https://app.example.com/cb'],
      }),
    });
    const clientId = reg.body.client_id;

    // 2. PKCE S256 verifier + challenge
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk0123456789';
    const challenge = await computePkceCodeChallenge(verifier);

    // Reject plain PKCE
    const plainRes = await req(
      `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent('https://app.example.com/cb')}&code_challenge=${challenge}&code_challenge_method=plain`,
    );
    expect(plainRes.status).toBe(400);
    expect(plainRes.body.error).toBe('invalid_request');

    // 3. Authorize and obtain single-use code
    const authRes = await req(
      `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent('https://app.example.com/cb')}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz123&approve=true`,
    );
    expect(authRes.status).toBe(302);
    const loc = new URL(authRes.headers.get('location')!);
    const code = loc.searchParams.get('code')!;
    expect(code).toMatch(/^ccac_/);
    expect(loc.searchParams.get('state')).toBe('xyz123');

    // 4. Wrong verifier must fail with invalid_grant
    const badTok = await req('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier-123456',
        client_id: clientId,
        redirect_uri: 'https://app.example.com/cb',
      }),
    });
    expect(badTok.status).toBe(400);
    expect(badTok.body.error).toBe('invalid_grant');

    // 5. Exchange code with valid verifier
    const tokRes = await req('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: 'https://app.example.com/cb',
      }),
    });
    expect(tokRes.status).toBe(200);
    expect(tokRes.body.token_type).toBe('Bearer');
    expect(tokRes.body.access_token).toMatch(/^ccat_/);
    expect(tokRes.body.refresh_token).toMatch(/^ccrt_/);

    // 6. Replaying the consumed authorization code is rejected
    const replayRes = await req('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: 'https://app.example.com/cb',
      }),
    });
    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe('invalid_grant');

    // 7. Use the OAuth 2.1 access_token as Bearer token on Firecrawl v2 endpoints
    const usageRes = await req('/v2/team/credit-usage', {
      headers: { authorization: `Bearer ${tokRes.body.access_token}` },
    });
    expect(usageRes.status).toBe(200);
    expect(usageRes.body.success).toBe(true);
    expect(typeof usageRes.body.data.remainingCredits).toBe('number');

    // 8. Refresh token rotation
    const refreshRes = await req('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: tokRes.body.refresh_token,
      }),
    });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toMatch(/^ccat_/);
    expect(refreshRes.body.access_token).not.toBe(tokRes.body.access_token);

    // Old refresh token is now invalid
    const oldRefresh = await req('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: tokRes.body.refresh_token,
      }),
    });
    expect(oldRefresh.status).toBe(400);
    expect(oldRefresh.body.error).toBe('invalid_grant');

    // 9. Introspect & Revoke
    const introActive = await req('/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: refreshRes.body.access_token }),
    });
    expect(introActive.body.active).toBe(true);

    await req('/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: refreshRes.body.access_token }),
    });

    const introAfter = await req('/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: refreshRes.body.access_token }),
    });
    expect(introAfter.body.active).toBe(false);

    // Revoked OAuth token must now be rejected with 401 on Firecrawl endpoints
    const afterRevokeApi = await req('/v2/team/credit-usage', {
      headers: { authorization: `Bearer ${refreshRes.body.access_token}` },
    });
    expect(afterRevokeApi.status).toBe(401);
  });

  it('implements Better Auth sign-up, sign-in, session rotation, tenant spoofing guard, RBAC, and API key plugin', async () => {
    const email = `alice-${crypto.randomUUID().slice(0, 8)}@crawl.cheap`;
    const signUp = await req('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'SuperSecretPassword123!',
        name: 'Alice Edge',
        plan: 'hobby',
      }),
    });
    expect(signUp.status).toBe(200);
    expect(signUp.body.success).toBe(true);
    expect(signUp.body.token).toBeTruthy();
    expect(signUp.body.apiKey).toMatch(/^cc_live_/);
    expect(signUp.headers.get('set-cookie')).toContain('tt_session=');

    const sessionToken = signUp.body.token;
    const tenantId = signUp.body.user.tenantId;

    // Verify session via Bearer
    const sess = await req('/api/auth/session', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(sess.status).toBe(200);
    expect(sess.body.user.email).toBe(email);
    expect(sess.body.user.tenantId).toBe(tenantId);

    // Tenant verification succeeds for matching tenantId and rejects spoofing
    const tenantOk = await req('/api/auth/verify-tenant', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ clientTenantId: tenantId }),
    });
    expect(tenantOk.status).toBe(200);
    expect(tenantOk.body.ok).toBe(true);
    expect(tenantOk.body.context.isServerDerived).toBe(true);

    const tenantSpoof = await req('/api/auth/verify-tenant', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ clientTenantId: 'ten_spoofed_other_org' }),
    });
    expect(tenantSpoof.status).toBe(403);
    expect(tenantSpoof.body.ok).toBe(false);

    // Hierarchical RBAC evaluation
    const rbacAllow = await req('/api/auth/evaluate-permission', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', permission: 'crawl:write' }),
    });
    expect(rbacAllow.status).toBe(200);
    expect(rbacAllow.body.granted).toBe(true);

    const rbacDeny = await req('/api/auth/evaluate-permission', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer', permission: 'billing:manage' }),
    });
    expect(rbacDeny.status).toBe(403);
    expect(rbacDeny.body.granted).toBe(false);

    // Mint a Firecrawl-compatible `fc-` API key via Better Auth API key plugin
    const fcKeyRes = await req('/api/auth/api-key/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ name: 'firecrawl-sdk-key', prefix: 'fc-' }),
    });
    expect(fcKeyRes.status).toBe(200);
    expect(fcKeyRes.body.apiKey).toMatch(/^fc-/);

    // Authenticate Firecrawl endpoints with BOTH the Better Auth session token AND the `fc-` key
    const creditViaSession = await req('/v2/team/credit-usage', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(creditViaSession.status).toBe(200);
    expect(creditViaSession.body.data.planCredits).toBe(5000); // hobby plan

    const creditViaFcKey = await req('/v2/team/credit-usage', {
      headers: { authorization: `Bearer ${fcKeyRes.body.apiKey}` },
    });
    expect(creditViaFcKey.status).toBe(200);
    expect(creditViaFcKey.body.success).toBe(true);
  });
});
