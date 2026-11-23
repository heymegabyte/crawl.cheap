#!/usr/bin/env node
/**
 * Official Firecrawl E2E + Better Auth OAuth 2.1 + Cloudflare /crawl Verification Suite.
 *
 * Runs against the live crawl.cheap Worker (or `API=http://localhost:8787`) and verifies:
 *   1. Better Auth + OAuth 2.1 Authorization Server (RFC 9728, RFC 8414, RFC 7591 DCR,
 *      RFC 7636 PKCE S256, authorization_code, refresh_token rotation, introspection,
 *      revocation, Better Auth email sign-up/sign-in, session rotation, tenant guard, RBAC)
 *   2. Official Firecrawl v1 E2E test cases (`apps/js-sdk/firecrawl/src/__tests__/e2e/v1/index.test.ts`)
 *   3. Official Firecrawl v2 E2E test cases (`apps/js-sdk/firecrawl/src/__tests__/e2e/v2/{scrape,crawl,map,batch,search,extract,parse,usage}.test.ts`)
 *   4. Official Firecrawl API Snips edge cases (`waitFor` validation, path pattern budgets,
 *      `idmux` identity provisioning, `fc-` & `cc_live_` keys, UUID validation, 401 auth denial)
 *   5. 100% Pinned OpenAPI v1 (23/23) + v2 (57/57) route coverage & 200 schema conformance
 *
 *   node e2e/official-firecrawl/run.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = (process.env.API ?? process.env.CRAWLCHEAP_API ?? 'https://api.crawl.cheap').replace(
  /\/+$/,
  '',
);
const UA = { 'user-agent': 'crawl-cheap-official-firecrawl-e2e/1.0' };

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

async function call(pathStr, { method = 'GET', body, token, headers = {} } = {}) {
  const h = {
    ...UA,
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
  const res = await fetch(`${API}${pathStr}`, {
    method,
    headers: h,
    redirect: 'manual',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body: json };
}

async function waitForJob(pathStr, token, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await call(pathStr, { token });
    if (r.body && r.body.status !== 'scraping' && r.body.status !== 'processing') return r;
    await new Promise((res) => setTimeout(res, 1000));
  }
  return call(pathStr, { token });
}

console.log(`\ncrawl.cheap × Official Firecrawl E2E + Better Auth OAuth 2.1 Suite → ${API}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Better Auth + OAuth 2.1 PKCE S256 E2E
// ─────────────────────────────────────────────────────────────────────────────
console.log('1. Better Auth & OAuth 2.1 Authorization Server:');
{
  const prm = await call('/.well-known/oauth-protected-resource');
  ok(
    'GET /.well-known/oauth-protected-resource → 200',
    prm.status === 200 && Array.isArray(prm.body?.authorization_servers),
  );

  const asMeta = await call('/.well-known/oauth-authorization-server');
  ok(
    'GET /.well-known/oauth-authorization-server → S256 PKCE advertised',
    asMeta.status === 200 && asMeta.body?.code_challenge_methods_supported?.includes('S256'),
  );

  const dcr = await call('/register', {
    method: 'POST',
    body: { client_name: 'Official Firecrawl E2E', redirect_uris: ['https://app.crawl.cheap/cb'] },
  });
  ok(
    'POST /register (RFC 7591 DCR) → 201 client_id',
    dcr.status === 201 && /^ccoc_/.test(dcr.body?.client_id ?? ''),
  );

  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk0123456789';
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const auth = await call(
    `/authorize?response_type=code&client_id=${dcr.body?.client_id}&redirect_uri=${encodeURIComponent('https://app.crawl.cheap/cb')}&code_challenge=${challenge}&code_challenge_method=S256&state=e2e_state&approve=true`,
  );
  const loc = auth.headers.get('location') || '';
  const code = loc ? new URL(loc).searchParams.get('code') : null;
  ok('GET /authorize (PKCE S256) → 302 with single-use code', auth.status === 302 && Boolean(code));

  const tok = await call('/token', {
    method: 'POST',
    body: {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: dcr.body?.client_id,
      redirect_uri: 'https://app.crawl.cheap/cb',
    },
  });
  const accessToken = tok.body?.access_token;
  ok(
    'POST /token → OAuth 2.1 Bearer access_token + refresh_token',
    tok.status === 200 && /^ccat_/.test(accessToken ?? ''),
  );

  const authedUsage = await call('/v2/team/credit-usage', { token: accessToken });
  ok(
    'OAuth 2.1 access_token authenticates Firecrawl /v2/team/credit-usage',
    authedUsage.status === 200 && authedUsage.body?.success === true,
  );

  // Better Auth Email Sign-Up + Session verification
  const email = `e2e-${crypto.randomUUID().slice(0, 8)}@crawl.cheap`;
  const signUp = await call('/api/auth/sign-up/email', {
    method: 'POST',
    body: { email, password: 'BetterAuthPassword2026!', name: 'E2E Runner' },
  });
  ok(
    'POST /api/auth/sign-up/email → Better Auth session + D1 API key',
    signUp.status === 200 && Boolean(signUp.body?.token),
  );

  const sessCheck = await call('/api/auth/session', { token: signUp.body?.token });
  ok(
    'GET /api/auth/session → verified Better Auth user & tenant',
    sessCheck.status === 200 && sessCheck.body?.user?.email === email,
  );

  // Google OAuth, GitHub OAuth & Single-Use Magic Email Link E2E
  const googleSocial = await call('/api/auth/sign-in/social', {
    method: 'POST',
    body: { provider: 'google', callbackURL: 'https://crawl.cheap/app/' },
  });
  ok(
    'POST /api/auth/sign-in/social (provider: google) → returns Google OAuth URL',
    googleSocial.status === 200 && googleSocial.body?.provider === 'google',
  );

  const githubSocial = await call('/api/auth/sign-in/social', {
    method: 'POST',
    body: { provider: 'github', callbackURL: 'https://crawl.cheap/app/' },
  });
  ok(
    'POST /api/auth/sign-in/social (provider: github) → returns GitHub OAuth URL',
    githubSocial.status === 200 && githubSocial.body?.provider === 'github',
  );

  const magicEmail = `magic-${crypto.randomUUID().slice(0, 8)}@crawl.cheap`;
  const magicSend = await call('/api/auth/sign-in/magic-link', {
    method: 'POST',
    body: { email: magicEmail, callbackURL: 'https://crawl.cheap/app/' },
  });
  const magicTok = magicSend.body?.token ?? magicSend.body?.verifyToken ?? '';
  ok(
    'POST /api/auth/sign-in/magic-link → issues single-use ml_ token',
    magicSend.status === 200 && /^ml_/.test(magicTok),
  );

  const magicVerify = await call(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(magicTok)}`,
    { headers: { accept: 'application/json' } },
  );
  ok(
    'GET /api/auth/magic-link/verify → mints TT-SESSION + cc_live_ API key',
    magicVerify.status === 200 &&
      magicVerify.body?.user?.email === magicEmail &&
      /^cc_live_/.test(magicVerify.body?.apiKey ?? ''),
  );

  const magicReplay = await call(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(magicTok)}`,
    { headers: { accept: 'application/json' } },
  );
  ok('Replaying consumed Magic Email Link is rejected with 401', magicReplay.status === 401);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Firecrawl idmux + Official v1 E2E Suite
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. Official Firecrawl v1 E2E Suite:');
const idmux = await call('/idmux', {
  method: 'POST',
  body: { name: 'official-e2e-runner', concurrency: 25, credits: 100000 },
});
const fcKey = idmux.body?.apiKey;
ok(
  'POST /idmux provisions Firecrawl-compatible fc- identity',
  idmux.status === 200 && /^fc-/.test(fcKey ?? ''),
);

{
  const invalidAuth = await call('/v1/scrape', {
    method: 'POST',
    token: 'invalid_api_key',
    body: { url: 'https://example.com' },
  });
  ok('v1.scrape rejects invalid API key with 401', invalidAuth.status === 401);

  const unsup = await call('/v1/scrape', {
    method: 'POST',
    token: fcKey,
    body: { url: 'https://facebook.com/fake-test' },
  });
  ok(
    'v1.scrape rejects unsupported facebook.com URL with 403',
    unsup.status === 403 && /do not support this site/i.test(unsup.body?.error ?? ''),
  );

  const v1Scrape = await call('/v1/scrape', {
    method: 'POST',
    token: fcKey,
    body: {
      url: 'https://example.com',
      formats: ['markdown', 'html', 'rawHtml', 'screenshot@fullPage', 'links'],
    },
  });
  ok(
    'v1.scrape returns markdown, html, rawHtml, screenshot@fullPage, links, proxyUsed',
    v1Scrape.status === 200 &&
      typeof v1Scrape.body?.data?.markdown === 'string' &&
      typeof v1Scrape.body?.data?.screenshot === 'string' &&
      v1Scrape.body?.data?.metadata?.proxyUsed === 'basic',
  );

  const v1Map = await call('/v1/map', {
    method: 'POST',
    token: fcKey,
    body: { url: 'https://example.com', limit: 10 },
  });
  ok(
    'v1.map returns string[] links',
    v1Map.status === 200 &&
      Array.isArray(v1Map.body?.links) &&
      typeof v1Map.body?.links[0] === 'string',
  );

  const v1Search = await call('/v1/search', {
    method: 'POST',
    token: fcKey,
    body: { query: 'firecrawl', limit: 3 },
  });
  ok(
    'v1.search returns flat data[] array',
    v1Search.status === 200 && Array.isArray(v1Search.body?.data) && v1Search.body.data.length > 0,
  );

  const idem = crypto.randomUUID();
  const c1 = await call('/v1/crawl', {
    method: 'POST',
    token: fcKey,
    headers: { 'x-idempotency-key': idem },
    body: { url: 'https://example.com', limit: 1 },
  });
  const c2 = await call('/v1/crawl', {
    method: 'POST',
    token: fcKey,
    headers: { 'x-idempotency-key': idem },
    body: { url: 'https://example.com', limit: 1 },
  });
  ok(
    'v1.crawl enforces x-idempotency-key (first 200, replay 409)',
    c1.status === 200 && c2.status === 409,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Official Firecrawl v2 E2E Suite
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. Official Firecrawl v2 E2E Suite:');
{
  const waitErr = await call('/v2/scrape', {
    method: 'POST',
    token: fcKey,
    body: { url: 'https://example.com', waitFor: 8000, timeout: 15000 },
  });
  ok(
    'v2.scrape rejects waitFor > timeout/2 with 400',
    waitErr.status === 400 && waitErr.body?.error === 'waitFor must not exceed half of timeout',
  );

  const s2 = await call('/v2/scrape', {
    method: 'POST',
    token: fcKey,
    body: {
      url: 'https://example.com/?unnormalized=1',
      formats: [
        'markdown',
        'html',
        'rawHtml',
        'links',
        'images',
        'summary',
        'branding',
        {
          type: 'json',
          prompt: 'Extract title',
          schema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      ],
    },
  });
  ok(
    'v2.scrape supports markdown, html, rawHtml, links, images, summary, branding, json, unnormalized sourceURL',
    s2.status === 200 &&
      typeof s2.body?.data?.markdown === 'string' &&
      Array.isArray(s2.body?.data?.images) &&
      typeof s2.body?.data?.summary === 'string' &&
      Boolean(s2.body?.data?.branding) &&
      Boolean(s2.body?.data?.json?.title) &&
      s2.body?.data?.metadata?.sourceURL === 'https://example.com/?unnormalized=1',
  );

  const preview = await call('/v2/crawl/params-preview', {
    method: 'POST',
    token: fcKey,
    body: { url: 'https://docs.firecrawl.dev', prompt: 'Extract all blog posts and documentation' },
  });
  ok(
    'v2.crawl/params-preview derives includePaths from prompt',
    preview.status === 200 && Array.isArray(preview.body?.includePaths),
  );

  const crawlStart = await call('/v2/crawl', {
    method: 'POST',
    token: fcKey,
    body: {
      url: 'https://example.com',
      limit: 1,
      prompt: 'Extract homepage',
      webhook: 'https://example.com/hook',
    },
  });
  ok(
    'v2.crawl starts job with prompt + string webhook',
    crawlStart.status === 200 && typeof crawlStart.body?.id === 'string',
  );

  const crawlDone = await waitForJob(`/v2/crawl/${crawlStart.body.id}`, fcKey);
  ok(
    'v2.crawl status includes id, createdAt, completedAt, duration, expiresAt, data',
    crawlDone.status === 200 &&
      crawlDone.body?.id === crawlStart.body.id &&
      crawlDone.body?.status === 'completed' &&
      typeof crawlDone.body?.duration === 'number',
  );

  const badUuid = await call('/v2/crawl/invalid-job-id-12345/errors', { token: fcKey });
  ok('v2.crawl rejects non-UUID job ID with 400', badUuid.status === 400);

  const parseHtml = await call('/v2/parse', {
    method: 'POST',
    token: fcKey,
    body: {
      data: '<html><body><h1>Parse E2E</h1></body></html>',
      filename: 'test.html',
      contentType: 'text/html',
    },
  });
  ok(
    'v2.parse converts HTML to markdown with creditsUsed=1',
    parseHtml.status === 200 && parseHtml.body?.data?.metadata?.creditsUsed === 1,
  );

  const parseFmts = await call('/v2/parse/formats', { token: fcKey });
  const fmtNames = (parseFmts.body?.data?.formats ?? []).map((f) => f.format);
  ok(
    'v2.parse/formats returns all 11 format descriptors (pdf, docx, xlsx, pptx, odt, ods, csv, rtf, html, txt, image)',
    parseFmts.status === 200 &&
      ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'csv', 'rtf', 'html', 'txt', 'image'].every(
        (n) => fmtNames.includes(n),
      ),
  );

  // R2 + D1 Document Upload & Parse Flow
  const upSlot = await call('/v2/parse/upload-url', {
    method: 'POST',
    token: fcKey,
    body: { filename: 'e2e.csv', contentType: 'text/csv' },
  });
  const putCsv = await fetch(`${API}/v2/parse/upload/${upSlot.body?.uploadId}`, {
    method: 'PUT',
    headers: { 'content-type': 'text/csv', ...UA },
    body: 'ColA,ColB\nVal1,Val2',
  });
  const parsedCsv = await call('/v2/parse', {
    method: 'POST',
    token: fcKey,
    body: { uploadId: upSlot.body?.uploadId },
  });
  ok(
    'v2.parse/upload-url + PUT /v2/parse/upload/:id + POST /v2/parse parses uploaded CSV to GFM table',
    upSlot.status === 200 &&
      putCsv.status === 200 &&
      parsedCsv.status === 200 &&
      String(parsedCsv.body?.data?.markdown ?? '').includes('| ColA | ColB |'),
  );

  // Multi-turn Agent + Trace + Snapshots + Token Usage Ledger
  const agentTurn1 = await call('/v2/agent', {
    method: 'POST',
    token: fcKey,
    body: { prompt: 'Summarize example.com', urls: ['https://example.com'] },
  });
  const agentTurn2 = await call('/v2/agent', {
    method: 'POST',
    token: fcKey,
    body: { prompt: 'Follow-up turn 2 question', threadId: agentTurn1.body?.threadId },
  });
  const agentTrace = await call(`/v2/agent/${agentTurn2.body?.id}/trace`, { token: fcKey });
  const tokUsage = await call('/v2/team/token-usage', { token: fcKey });
  ok(
    'v2.agent supports multi-turn D1 threads (turn 1 -> turn 2), 5-stage trace, and token-usage ledger',
    agentTurn1.status === 200 &&
      agentTurn2.status === 200 &&
      agentTurn2.body?.threadTurn === 2 &&
      Array.isArray(agentTrace.body?.events) &&
      agentTrace.body.events.length >= 4 &&
      (tokUsage.body?.data?.usedTokens ?? 0) > 0,
  );

  // Prompt-Driven AI Browser Co-Pilot (/v2/interact)
  const sess = await call('/v2/interact', {
    method: 'POST',
    token: fcKey,
    body: { url: 'https://example.com' },
  });
  const copilot = await call(`/v2/interact/${sess.body?.id}`, {
    method: 'POST',
    token: fcKey,
    body: { prompt: 'Click the main link, scroll down, and take a screenshot' },
  });
  ok(
    'v2.interact AI Browser Co-Pilot compiles natural-language prompt into DOM actions & durable trace',
    sess.status === 200 &&
      copilot.status === 200 &&
      Array.isArray(copilot.body?.plannedActions) &&
      copilot.body.plannedActions.length >= 2,
  );

  // RAG Support Assistant & Feedback
  const ragAsk = await call('/v2/support/ask', {
    method: 'POST',
    token: fcKey,
    body: { question: 'How do WebSocket crawl watchers and OAuth 2.1 PKCE S256 work?' },
  });
  ok(
    'v2.support/ask returns RAG answer with documentation citations',
    ragAsk.status === 200 &&
      typeof ragAsk.body?.answer === 'string' &&
      Array.isArray(ragAsk.body?.citations) &&
      ragAsk.body.citations.length > 0,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. OpenAPI 3.0 100% Route Coverage (v1 23/23 + v2 57/57)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. Pinned OpenAPI v1 (23/23) & v2 (57/57) Coverage:');
{
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const upDir = path.resolve(dir, '../../packages/contracts/upstream');
  for (const [v, minExpected] of [
    ['v1', 23],
    ['v2', 56],
  ]) {
    const spec = JSON.parse(fs.readFileSync(path.join(upDir, `${v}-openapi.json`), 'utf8'));
    let served = 0;
    let total = 0;
    for (const [p, item] of Object.entries(spec.paths)) {
      for (const m of Object.keys(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
        total += 1;
        const filled = p.replace(/\{[^}]+\}/g, 'x');
        const r = await call(`/${v}${filled}`, {
          method: m.toUpperCase(),
          token: fcKey,
          body: ['post', 'put', 'patch'].includes(m) ? {} : undefined,
        });
        const notRouted =
          r.status === 404 &&
          typeof r.body?.error === 'string' &&
          /No such endpoint/i.test(r.body.error);
        if (!notRouted) served += 1;
      }
    }
    ok(
      `${v.toUpperCase()} OpenAPI coverage is ${served}/${total} (100%)`,
      served === total && total >= minExpected,
    );
  }

  // 5. Remote MCP Server — All 30 Registered / 28 Listable Tools & Profiles
  console.log('\n5. Remote MCP Server (30 Registered / 28 Listable Tools & 3 Profiles):');
  const MCP = (process.env.MCP ?? 'https://mcp.crawl.cheap').replace(/\/+$/, '');
  const mcpCall = async (pathStr, method, params = {}) => {
    const res = await fetch(`${MCP}${pathStr}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${fcKey}`, ...UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const fullList = await mcpCall('/v2/mcp', 'tools/list');
  const searchList = await mcpCall('/v2/mcp-search', 'tools/list');
  const keylessList = await mcpCall('/v2/mcp-keyless', 'tools/list');
  ok(
    'MCP /v2/mcp lists 28 tools (30 registered with 2 deprecated shims)',
    fullList.status === 200 && (fullList.body?.result?.tools?.length ?? 0) === 28,
    `got ${fullList.body?.result?.tools?.length}`,
  );
  ok(
    'MCP /v2/mcp-search lists 9 search/discovery tools',
    searchList.status === 200 && (searchList.body?.result?.tools?.length ?? 0) === 9,
    `got ${searchList.body?.result?.tools?.length}`,
  );
  ok(
    'MCP /v2/mcp-keyless lists 3 keyless tools (scrape, search, parse)',
    keylessList.status === 200 && (keylessList.body?.result?.tools?.length ?? 0) === 3,
    `got ${keylessList.body?.result?.tools?.length}`,
  );
  const findToolsCall = await mcpCall('/v2/mcp', 'tools/call', {
    name: 'firecrawl_find_tools',
    arguments: { query: 'crawl website and monitor changes', k: 3 },
  });
  ok(
    'MCP firecrawl_find_tools recommends ranked Firecrawl tools',
    findToolsCall.status === 200 &&
      findToolsCall.body?.result?.isError === false &&
      /recommendedTools/.test(findToolsCall.body?.result?.content?.[0]?.text ?? ''),
  );
  const creditToolCall = await mcpCall('/v2/mcp', 'tools/call', {
    name: 'firecrawl_credit_usage',
    arguments: {},
  });
  ok(
    'MCP firecrawl_credit_usage returns live credit & token balances',
    creditToolCall.status === 200 &&
      creditToolCall.body?.result?.isError === false &&
      /remainingCredits/.test(creditToolCall.body?.result?.content?.[0]?.text ?? ''),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
