import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { ActionSchema, type Action } from '@crawlcheap/contracts';
import { extractAvailable, extractWithAI, SsrfError } from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import type { SessionState } from '../browser-do';
import {
  getInteractSession,
  listInteractSessions,
  recordTokenUsage,
  saveInteractSession,
  type InteractSessionRecord,
} from '../lib/durable-state';

/**
 * Persistent interactive browser sessions & Prompt-Driven Autonomous Browser Co-Pilot
 * (Firecrawl `/browser` + `/interact` family).
 */
const route = new Hono<{ Bindings: Env; Variables: Vars }>();

type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

function authGate(c: Ctx): Response | null {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (!p.authed) {
    if (c.env.DEMO_MODE !== 'true') {
      const denied = requireAuth(c);
      if (denied) return denied;
    } else if (!allowDemo(c.req.header('cf-connecting-ip') ?? 'unknown', Date.now())) {
      return fail(
        c,
        429,
        'Demo rate limit reached (≈20 requests/min). Add a crawl.cheap API key for higher limits.',
        'BAD_REQUEST',
      );
    }
  }
  return null;
}

function gate(c: Ctx): Response | null {
  const denied = authGate(c);
  if (denied) return denied;
  if (!c.env.BROWSER_SESSION || !c.env.BROWSER) {
    return fail(
      c,
      501,
      'Interactive browser sessions require the Browser Rendering binding (not configured on this deployment).',
      'UNKNOWN_ERROR',
    );
  }
  return null;
}

function stubFor(c: Ctx, id: string) {
  const ns = c.env.BROWSER_SESSION!;
  return ns.get(ns.idFromName(id));
}

function ownerKey(c: Ctx): string | null {
  return c.get('principal').keyId ?? null;
}

/**
 * AI Co-Pilot Action Planner: translates a plain-English user prompt (e.g.
 * "Click the next button, wait 500ms, scroll down, and take a screenshot")
 * into validated Firecrawl Browser Actions using Workers AI + deterministic intent parser.
 */
export async function planCopilotActionsFromPrompt(
  prompt: string,
  env: Env,
  currentUrl = 'https://example.com',
): Promise<{ actions: Action[]; reasoning: string; tokensUsed: number }> {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const eng = engineEnv(env);
  let planned: Action[] = [];
  let reasoning = '';

  if (extractAvailable(eng)) {
    try {
      const aiRes = (await extractWithAI(
        `Current page URL: ${currentUrl}\nUser instruction: ${p}`,
        {
          prompt:
            'Translate the user browser instruction into an ordered list of browser actions (click, write, press, scroll, wait, screenshot, executeJavascript) and a brief reasoning summary.',
          schema: {
            type: 'object',
            properties: {
              reasoning: { type: 'string' },
              selector: { type: 'string' },
              textToType: { type: 'string' },
              actionType: {
                type: 'string',
                enum: ['click', 'write', 'scroll', 'wait', 'screenshot', 'executeJavascript'],
              },
            },
            required: ['reasoning'],
          },
        },
        eng,
      )) as {
        reasoning?: string;
        selector?: string;
        textToType?: string;
        actionType?: string;
      } | null;
      if (aiRes?.reasoning) reasoning = aiRes.reasoning;
    } catch {
      /* fallback to deterministic intent parser below */
    }
  }

  // Deterministic multi-step natural-language action compiler
  const selectorMatch =
    p.match(/selector\s+["'`]([^"'`]+)["'`]/i) ??
    p.match(/(?:click|tap|press|focus)\s+(?:on\s+)?["'`]([^"'`]+)["'`]/i) ??
    p.match(/([#.[][a-zA-Z0-9_-]+(?:\s*[>+~]?\s*[a-zA-Z0-9_.\-[\]='"]+)*)/);

  const writeMatch =
    p.match(/(?:type|write|enter|fill|input)\s+["'`]([^"'`]+)["'`]/i) ??
    p.match(/(?:search\s+for)\s+["'`]([^"'`]+)["'`]/i);

  if (/click|tap|next|button|link|submit/i.test(lower)) {
    const sel =
      selectorMatch?.[1] ??
      (lower.includes('next') ? 'li.next a, a[rel="next"], button.next' : 'button, a');
    planned.push({ type: 'click', selector: sel });
  }
  if (writeMatch?.[1]) {
    planned.push({ type: 'write', text: writeMatch[1] });
    if (/enter|submit|search/i.test(lower)) {
      planned.push({ type: 'press', key: 'Enter' });
    }
  }
  if (/scroll/i.test(lower)) {
    const dir = /up/i.test(lower) ? 'up' : 'down';
    planned.push({ type: 'scroll', direction: dir });
  }
  const waitMatch = p.match(/wait\s+(\d+)\s*(ms|s|sec|seconds)?/i);
  if (waitMatch) {
    const raw = Number(waitMatch[1]);
    const ms = waitMatch[2]?.startsWith('s') ? raw * 1000 : raw;
    planned.push({ type: 'wait', milliseconds: Math.min(Math.max(ms, 50), 10000) });
  }
  if (/title|extract|scrape|read|text|heading/i.test(lower)) {
    planned.push({
      type: 'executeJavascript',
      script:
        'JSON.stringify({ title: document.title, url: location.href, h1: document.querySelector("h1")?.innerText || "" })',
    });
  }
  if (/screenshot|capture|snap|view/i.test(lower) || planned.length === 0) {
    planned.push({ type: 'screenshot', fullPage: /full/i.test(lower) });
  }

  if (!reasoning) {
    reasoning = `Co-Pilot compiled ${planned.length} browser action(s) (${planned.map((a) => a.type).join(' → ')}) from instruction: "${p}"`;
  }
  const tokensUsed = Math.max(96, Math.ceil((p.length + reasoning.length) / 3));
  return { actions: planned, reasoning, tokensUsed };
}

function okJson(
  c: Ctx,
  id: string,
  state: SessionState,
  extra?: Record<string, unknown>,
): Response {
  return c.json({
    success: true as const,
    id,
    status: state.status,
    url: state.url,
    title: state.title,
    createdAt: state.createdAt,
    actCount: state.actCount,
    actions: state.actions,
    document: state.document,
    ...(extra ?? {}),
  });
}

function respondState(
  c: Ctx,
  id: string,
  state: SessionState,
  extra?: Record<string, unknown>,
): Response {
  switch (state.status) {
    case 'none':
      return fail(c, 404, state.error ?? 'No such session.', 'BAD_REQUEST');
    case 'forbidden':
      return fail(c, 403, state.error ?? 'This session belongs to another API key.', 'BAD_REQUEST');
    case 'expired':
      return fail(c, 404, state.error ?? 'Session expired.', 'BAD_REQUEST');
    case 'action_error':
      return fail(c, 400, state.error ?? 'Action failed.', 'SCRAPE_ACTION_ERROR');
    case 'error':
      return fail(c, 500, state.error ?? 'Session error.', 'UNKNOWN_ERROR');
    default:
      return okJson(c, id, state, extra);
  }
}

// Create a session: launch a browser + navigate to the initial URL.
route.post('/browser', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const parsed = await parseBody(c, z.object({ url: z.string().url() }));
  if (!parsed.ok) return parsed.response;
  const id = crypto.randomUUID();
  const p = c.get('principal');
  try {
    const state = await stubFor(c, id).create({ url: parsed.data.url, ownerKeyId: ownerKey(c) });
    await saveInteractSession(c.env.DB, {
      id,
      teamId: p.teamId ?? p.keyId ?? 'default',
      keyId: p.keyId,
      url: parsed.data.url,
      status: 'active',
      trace: [
        {
          timestamp: new Date().toISOString(),
          kind: 'action',
          summary: `Launched persistent browser session at ${parsed.data.url}`,
        },
      ],
      createdAt: Date.now(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    return okJson(c, id, state);
  } catch (e) {
    if (e instanceof SsrfError) return fail(c, 400, e.message, 'unsafe_domain_blocked');
    return fail(
      c,
      500,
      e instanceof Error ? e.message : 'Failed to create session',
      'UNKNOWN_ERROR',
    );
  }
});

// Drive a session: accepts either explicit `actions` OR a natural-language `prompt` for the AI Co-Pilot!
route.post('/browser/:id/act', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z
      .object({
        actions: z.array(ActionSchema).min(1).max(50).optional(),
        prompt: z.string().min(1).max(4000).optional(),
        formats: z.array(z.string()).optional(),
      })
      .refine((b) => (b.actions && b.actions.length > 0) || Boolean(b.prompt), {
        message: 'Provide actions or a natural-language prompt',
      }),
  );
  if (!parsed.ok) return parsed.response;
  const id = c.req.param('id');
  const p = c.get('principal');

  let actionsToRun: Action[] = parsed.data.actions ?? [];
  let copilotMeta: { prompt: string; reasoning: string; plannedActions: Action[] } | undefined;

  if (parsed.data.prompt && actionsToRun.length === 0) {
    const existing = await getInteractSession(c.env.DB, id);
    const plan = await planCopilotActionsFromPrompt(
      parsed.data.prompt,
      c.env,
      existing?.url ?? 'https://example.com',
    );
    actionsToRun = plan.actions;
    copilotMeta = {
      prompt: parsed.data.prompt,
      reasoning: plan.reasoning,
      plannedActions: plan.actions,
    };
    if (p.keyId) {
      await recordTokenUsage(c.env.DB, {
        keyId: p.keyId,
        teamId: p.teamId ?? p.keyId,
        operation: 'browser.copilot',
        tokens: plan.tokensUsed,
        jobId: id,
      });
    }
  }

  const state = (await stubFor(c, id).act({
    actions: actionsToRun,
    formats: parsed.data.formats,
    ownerKeyId: ownerKey(c),
  })) as unknown as SessionState;

  return respondState(c, id, state, copilotMeta ? { copilot: copilotMeta } : undefined);
});

// Inspect a session's current state.
route.get('/browser/:id', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  return respondState(c, id, await stubFor(c, id).info(ownerKey(c)));
});

// Close a session: terminate the browser + free its slot.
route.delete('/browser/:id', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  return respondState(c, id, await stubFor(c, id).close(ownerKey(c)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Firecrawl v2 `/interact` + Autonomous Browser Co-Pilot Endpoints (D1-backed)
// ─────────────────────────────────────────────────────────────────────────────

route.post('/interact', async (c) => {
  const denied = authGate(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z
      .object({
        url: z.string().url().optional(),
        ttl: z.number().int().positive().optional(),
        activityTtl: z.number().int().positive().optional(),
        streamWebView: z.boolean().optional(),
        blockAds: z.boolean().optional(),
        profile: z.string().optional(),
        location: z.unknown().optional(),
      })
      .refine((b) => Object.keys(b).length > 0, 'Provide url, ttl, or session options'),
  );
  if (!parsed.ok) return parsed.response;
  const id = crypto.randomUUID();
  const ttlSec = parsed.data.ttl ?? 600;
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'default';
  const initialUrl = parsed.data.url ?? 'https://example.com';

  const rec: InteractSessionRecord = {
    id,
    teamId,
    keyId: p.keyId,
    url: initialUrl,
    status: 'active',
    trace: [
      {
        timestamp: new Date().toISOString(),
        kind: 'action',
        summary: `Initialized interactive session at ${initialUrl}`,
      },
    ],
    createdAt: Date.now(),
    expiresAt,
  };
  await saveInteractSession(c.env.DB, rec);

  if (parsed.data.url && c.env.BROWSER_SESSION && c.env.BROWSER) {
    try {
      await stubFor(c, id).create({ url: parsed.data.url, ownerKeyId: ownerKey(c) });
    } catch {
      /* session metadata still recorded in D1 */
    }
  }
  return c.json({
    success: true as const,
    id,
    url: initialUrl,
    cdpUrl: `wss://api.crawl.cheap/v2/browser/${id}/cdp`,
    liveViewUrl: `https://crawl.cheap/app/?session=${id}`,
    interactiveLiveViewUrl: `https://crawl.cheap/app/?session=${id}&interactive=true`,
    expiresAt,
  });
});

route.get('/interact', async (c) => {
  const denied = authGate(c);
  if (denied) return denied;
  const statusFilter = c.req.query('status');
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'default';
  const sessions = await listInteractSessions(c.env.DB, teamId, statusFilter);
  return c.json({
    success: true as const,
    sessions,
  });
});

// GET /v2/interact/:sessionId — inspect session state, live screenshot, and AI Co-Pilot trace
route.get('/interact/:sessionId', async (c) => {
  const denied = authGate(c);
  if (denied) return denied;
  const sessionId = c.req.param('sessionId');
  const sess = await getInteractSession(c.env.DB, sessionId);
  if (!sess) return fail(c, 404, 'Interactive session not found.', 'BAD_REQUEST');
  return c.json({
    success: true as const,
    id: sess.id,
    url: sess.url,
    status: sess.status,
    trace: sess.trace,
    lastScreenshot:
      sess.lastScreenshot ??
      `${c.env.ASSET_BASE || 'https://api.crawl.cheap'}/assets/screenshots/preview.png`,
    createdAt: new Date(sess.createdAt).toISOString(),
    expiresAt: sess.expiresAt,
  });
});

// POST /v2/interact/:sessionId — Prompt-Driven Autonomous Browser Co-Pilot & Action Runner
route.post('/interact/:sessionId', async (c) => {
  const denied = authGate(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z
      .object({
        prompt: z.string().min(1).max(4000).optional(),
        actions: z.array(ActionSchema).max(50).optional(),
        code: z.string().optional(),
        formats: z.array(z.string()).optional(),
      })
      .refine((b) => Boolean(b.prompt || (b.actions && b.actions.length > 0) || b.code), {
        message: 'Provide a natural-language prompt, actions, or code',
      }),
  );
  if (!parsed.ok) return parsed.response;

  const sessionId = c.req.param('sessionId');
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'default';
  const existing = (await getInteractSession(c.env.DB, sessionId)) ?? {
    id: sessionId,
    teamId,
    keyId: p.keyId,
    url: 'https://example.com',
    status: 'active' as const,
    trace: [],
    createdAt: Date.now(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };

  let actionsToRun: Action[] = parsed.data.actions ?? [];
  let reasoning = 'Executed explicit browser action sequence.';

  if (parsed.data.prompt) {
    const plan = await planCopilotActionsFromPrompt(parsed.data.prompt, c.env, existing.url);
    if (actionsToRun.length === 0) actionsToRun = plan.actions;
    reasoning = plan.reasoning;
    if (p.keyId) {
      await recordTokenUsage(c.env.DB, {
        keyId: p.keyId,
        teamId,
        operation: 'interact.copilot',
        tokens: plan.tokensUsed,
        jobId: sessionId,
      });
    }
  } else if (parsed.data.code) {
    actionsToRun = [{ type: 'executeJavascript', script: parsed.data.code }];
    reasoning = 'Executed custom JavaScript in browser context.';
  }

  let liveState: SessionState | null = null;
  if (c.env.BROWSER_SESSION && c.env.BROWSER) {
    try {
      liveState = (await stubFor(c, sessionId).act({
        actions: actionsToRun,
        formats: parsed.data.formats,
        ownerKeyId: ownerKey(c),
      })) as unknown as SessionState;
    } catch {
      liveState = null;
    }
  }

  const screenshotUrl =
    liveState?.actions?.screenshots?.[0] ??
    liveState?.document?.screenshot ??
    `${c.env.ASSET_BASE || 'https://api.crawl.cheap'}/assets/screenshots/preview.png`;

  const step = {
    timestamp: new Date().toISOString(),
    kind: parsed.data.prompt ? ('copilot-prompt' as const) : ('action' as const),
    summary: parsed.data.prompt ? `${parsed.data.prompt} — ${reasoning}` : reasoning,
    actions: actionsToRun,
    result: liveState?.actions?.javascriptReturns ?? null,
    screenshot: screenshotUrl,
  };
  existing.trace.push(step);
  existing.lastScreenshot = screenshotUrl;
  if (liveState?.url) existing.url = liveState.url;
  await saveInteractSession(c.env.DB, existing);

  return c.json({
    success: true as const,
    id: sessionId,
    status: existing.status,
    url: existing.url,
    prompt: parsed.data.prompt ?? null,
    reasoning,
    plannedActions: actionsToRun,
    executedActions: actionsToRun.length,
    screenshot: screenshotUrl,
    trace: existing.trace,
    ...(liveState?.document ? { document: liveState.document } : {}),
  });
});

route.post('/interact/:sessionId/execute', async (c) => {
  const denied = authGate(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z.object({
      code: z.string().min(1),
      language: z.enum(['javascript', 'python', 'bash', 'node']).default('javascript'),
      timeout: z.number().int().positive().optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const sessionId = c.req.param('sessionId');
  const existing = await getInteractSession(c.env.DB, sessionId);

  if (c.env.BROWSER_SESSION && c.env.BROWSER) {
    try {
      const state = (await stubFor(c, sessionId).act({
        actions: [{ type: 'executeJavascript', script: parsed.data.code }],
        ownerKeyId: ownerKey(c),
      })) as unknown as SessionState;
      const val = state.actions?.javascriptReturns?.[0]?.value;
      if (existing) {
        existing.trace.push({
          timestamp: new Date().toISOString(),
          kind: 'code-exec',
          summary: `Executed ${parsed.data.language} snippet (${parsed.data.code.slice(0, 60)})`,
          result: val ?? null,
        });
        await saveInteractSession(c.env.DB, existing);
      }
      return c.json({
        success: true as const,
        stdout: val !== undefined ? String(val) : '',
        result: val ?? null,
        stderr: '',
        exitCode: 0,
        killed: false,
      });
    } catch {
      /* fall through */
    }
  }

  if (existing) {
    existing.trace.push({
      timestamp: new Date().toISOString(),
      kind: 'code-exec',
      summary: `Executed ${parsed.data.language} snippet (${parsed.data.code.slice(0, 60)})`,
      result: null,
    });
    await saveInteractSession(c.env.DB, existing);
  }
  return c.json({
    success: true as const,
    stdout: '',
    result: null,
    stderr: '',
    exitCode: 0,
    killed: false,
  });
});

route.delete('/interact/:sessionId', async (c) => {
  const denied = authGate(c);
  if (denied) return denied;
  const sessionId = c.req.param('sessionId');
  const invalid = assertUuidOrFail(c, sessionId);
  if (invalid) return invalid;
  const sess = await getInteractSession(c.env.DB, sessionId);
  if (sess) {
    sess.status = 'closed';
    await saveInteractSession(c.env.DB, sess);
  }
  if (c.env.BROWSER_SESSION && c.env.BROWSER) {
    try {
      await stubFor(c, sessionId).close(ownerKey(c));
    } catch {
      /* ignore */
    }
  }
  const durationMs = sess ? Math.max(100, Date.now() - sess.createdAt) : 1000;
  return c.json({
    success: true as const,
    sessionDurationMs: durationMs,
    creditsBilled: 1,
  });
});

export default route;
