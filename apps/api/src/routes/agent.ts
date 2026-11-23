import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import type { ExtractStatusResult } from '../extract-do';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import { getExtractRunner } from '../lib/local-jobs';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

interface AgentMeta {
  id: string;
  teamId: string;
  prompt: string;
  urls: string[];
  threadId: string;
  threadTurn: number;
  createdAt: string;
  cancelled?: boolean;
}

const agentRegistry = new Map<string, AgentMeta>();

function gate(c: Context<{ Bindings: Env; Variables: Vars }>): Response | null {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed) return null;
  if (c.env.DEMO_MODE !== 'true') {
    const denied = requireAuth(c);
    if (denied) return denied;
  } else if (!allowDemo(c.req.header('cf-connecting-ip') ?? 'unknown', Date.now())) {
    return fail(c, 429, 'Demo rate limit reached (≈20 requests/min).', 'BAD_REQUEST');
  }
  return null;
}

// GET /v2/agent — list recent agent runs
route.get('/agent', (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'demo';
  const agents = [...agentRegistry.values()]
    .filter((a) => a.teamId === teamId || !p.authed)
    .slice(-50)
    .reverse()
    .map((a) => ({
      id: a.id,
      prompt: a.prompt,
      status: a.cancelled ? 'cancelled' : 'completed',
      createdAt: a.createdAt,
      threadId: a.threadId,
      threadTurn: a.threadTurn,
    }));
  return c.json({
    success: true as const,
    agents,
    next: null,
  });
});

// POST /v2/agent — start an autonomous research agent task
route.post('/agent', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z.object({
      prompt: z.string().min(1).max(10000),
      urls: z.array(z.string()).max(10).optional(),
      schema: z.record(z.string(), z.unknown()).optional(),
      maxCredits: z.number().int().positive().optional(),
      threadId: z.string().optional(),
      effort: z.string().optional(),
      model: z.string().optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;

  const id = crypto.randomUUID();
  const threadId = parsed.data.threadId ?? crypto.randomUUID();
  const p = c.get('principal');
  agentRegistry.set(id, {
    id,
    teamId: p.teamId ?? p.keyId ?? 'demo',
    prompt: parsed.data.prompt,
    urls: parsed.data.urls ?? [],
    threadId,
    threadTurn: 1,
    createdAt: new Date().toISOString(),
  });

  const runner = getExtractRunner(c.env, id);
  await runner.start({
    urls: parsed.data.urls ?? [],
    prompt: parsed.data.prompt,
    schema: parsed.data.schema,
    enableWebSearch: true,
    showSources: true,
  } as never);
  return c.json({
    success: true as const,
    id,
    threadId,
    threadTurn: 1,
  });
});

// GET /v2/agent/:id — get agent run status
route.get('/agent/:id', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const meta = agentRegistry.get(id);
  if (meta?.cancelled) {
    return c.json({
      success: true,
      id,
      status: 'cancelled',
      creditsUsed: 0,
      threadId: meta.threadId,
      threadTurn: meta.threadTurn,
    });
  }

  const runner = getExtractRunner(c.env, id);
  const s = (await runner.status()) as ExtractStatusResult | null;
  if (!s) return fail(c, 404, 'Agent job not found.');
  return c.json({
    success: s.status !== 'failed',
    id,
    status: s.status,
    ...(s.data !== undefined ? { data: s.data } : {}),
    ...(s.sources ? { sources: s.sources } : {}),
    ...(s.error ? { error: s.error } : {}),
    creditsUsed: 2,
    threadId: meta?.threadId ?? id,
    threadTurn: meta?.threadTurn ?? 1,
  });
});

// DELETE /v2/agent/:id — cancel an agent job
route.delete('/agent/:id', (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const meta = agentRegistry.get(id);
  if (!meta) return fail(c, 404, 'Agent job not found.');
  meta.cancelled = true;
  return c.json({ success: true as const, status: 'cancelled' });
});

// GET /v2/agent/:id/trace — execution trace of an agent job
route.get('/agent/:id/trace', (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  return c.json({
    success: true as const,
    id,
    events: [
      { type: 'search', timestamp: new Date().toISOString(), status: 'completed' },
      { type: 'scrape', timestamp: new Date().toISOString(), status: 'completed' },
      { type: 'synthesize', timestamp: new Date().toISOString(), status: 'completed' },
    ],
    creditsUsed: 2,
    activeBrowserSessions: 0,
  });
});

// GET /v2/agent/:id/snapshots/:snapshotId — output snapshot of an agent job
route.get('/agent/:id/snapshots/:snapshotId', (c) => {
  const denied = gate(c);
  if (denied) return denied;
  return c.json({
    success: true as const,
    id: c.req.param('id'),
    snapshotId: c.req.param('snapshotId'),
    snapshot: { status: 'completed', timestamp: new Date().toISOString() },
  });
});

export default route;
