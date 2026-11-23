import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { assertSafeUrl, SsrfError } from '@crawlcheap/engine';
import type { Env } from '../env';
import { fail, parseBody } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import {
  createMonitor,
  listMonitors,
  getMonitor,
  deleteMonitor,
  listChecks,
  runMonitor,
  type Monitor,
} from '../lib/monitor';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();
const memoryMonitors = new Map<string, Monitor>();

/** Monitors require an authenticated key/session. */
function authScope(c: Context<{ Bindings: Env; Variables: Vars }>): {
  denied?: Response;
  scope?: string;
} {
  const p = c.get('principal');
  if (!p.authed || p.invalidCredentials) return { denied: requireAuth(c)! };
  return { scope: p.keyId ?? p.userId ?? p.teamId ?? 'default' };
}

route.post('/monitor', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z
      .object({
        url: z.string().url().optional(),
        name: z.string().max(120).optional(),
        tag: z.string().max(60).optional(),
        webhook: z
          .union([
            z.string().url(),
            z.object({
              url: z.string().url(),
              headers: z.record(z.string(), z.string()).optional(),
            }),
          ])
          .optional(),
        webhookHeaders: z.record(z.string(), z.string()).optional(),
        schedule: z.object({ cron: z.string(), timezone: z.string().optional() }).optional(),
        targets: z
          .array(
            z.object({
              type: z.enum(['scrape', 'crawl', 'search']),
              url: z.string().url().optional(),
              urls: z.array(z.string().url()).optional(),
              queries: z.array(z.string()).optional(),
            }),
          )
          .optional(),
      })
      .refine(
        (b) =>
          Boolean(b.url) ||
          Boolean(
            b.targets?.some(
              (t) => t.url || (t.urls && t.urls.length > 0) || (t.queries && t.queries.length > 0),
            ),
          ),
        'Provide url or targets',
      ),
  );
  if (!parsed.ok) return parsed.response;

  const targetUrl =
    parsed.data.url ??
    parsed.data.targets?.[0]?.url ??
    parsed.data.targets?.[0]?.urls?.[0] ??
    'https://example.com';

  const webhookUrl =
    typeof parsed.data.webhook === 'string' ? parsed.data.webhook : parsed.data.webhook?.url;
  const webhookHeaders =
    parsed.data.webhookHeaders ??
    (typeof parsed.data.webhook === 'object' ? parsed.data.webhook.headers : undefined);

  try {
    assertSafeUrl(targetUrl);
    if (webhookUrl) assertSafeUrl(webhookUrl);
  } catch (e) {
    if (e instanceof SsrfError) return fail(c, 400, e.message, 'unsafe_domain_blocked');
  }

  if (c.env.DB) {
    const monitor = await createMonitor(c.env.DB, {
      scope: scope!,
      url: targetUrl,
      name: parsed.data.name,
      tag: parsed.data.tag,
      webhook: webhookUrl,
      webhookHeaders,
    });
    memoryMonitors.set(monitor.id, monitor);
    return c.json({ success: true as const, monitor, id: monitor.id });
  }

  const monitor: Monitor = {
    id: crypto.randomUUID(),
    scope: scope!,
    url: targetUrl,
    name: parsed.data.name ?? null,
    tag: parsed.data.tag ?? 'default',
    status: 'active',
    created_at: new Date().toISOString(),
    last_check_at: null,
    webhook_url: webhookUrl ?? null,
    webhook_headers: webhookHeaders ? JSON.stringify(webhookHeaders) : null,
  };
  memoryMonitors.set(monitor.id, monitor);
  return c.json({ success: true as const, monitor, id: monitor.id });
});

route.get('/monitor', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  if (c.env.DB) {
    return c.json({ success: true as const, monitors: await listMonitors(c.env.DB, scope!) });
  }
  const monitors = [...memoryMonitors.values()].filter((m) => m.scope === scope);
  return c.json({ success: true as const, monitors });
});

route.get('/monitor/:id', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const m = c.env.DB ? await getMonitor(c.env.DB, id, scope!) : (memoryMonitors.get(id) ?? null);
  if (!m || m.scope !== scope) return fail(c, 404, 'Monitor not found.');
  return c.json({ success: true as const, monitor: m });
});

// PATCH /v2/monitor/:id — update a monitor
route.patch('/monitor/:id', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const parsed = await parseBody(
    c,
    z.object({
      name: z.string().max(120).optional(),
      status: z.enum(['active', 'paused']).optional(),
      tag: z.string().max(60).optional(),
      webhook: z.union([z.string().url(), z.object({ url: z.string().url() })]).optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;

  const m = c.env.DB ? await getMonitor(c.env.DB, id, scope!) : (memoryMonitors.get(id) ?? null);
  if (!m || m.scope !== scope) return fail(c, 404, 'Monitor not found.');

  if (parsed.data.name !== undefined) m.name = parsed.data.name;
  if (parsed.data.status !== undefined) m.status = parsed.data.status;
  if (parsed.data.tag !== undefined) m.tag = parsed.data.tag;
  if (parsed.data.webhook !== undefined) {
    m.webhook_url =
      typeof parsed.data.webhook === 'string' ? parsed.data.webhook : parsed.data.webhook.url;
  }
  memoryMonitors.set(id, m);
  if (c.env.DB) {
    await c.env.DB.prepare(
      'UPDATE monitors SET name = ?, status = ?, tag = ?, webhook_url = ? WHERE id = ? AND scope = ?',
    )
      .bind(m.name, m.status, m.tag, m.webhook_url, id, scope!)
      .run();
  }
  return c.json({ success: true as const, monitor: m });
});

route.delete('/monitor/:id', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const memDeleted = memoryMonitors.delete(id);
  const dbDeleted = c.env.DB ? await deleteMonitor(c.env.DB, id, scope!) : false;
  if (!memDeleted && !dbDeleted) return fail(c, 404, 'Monitor not found.');
  return c.json({ success: true as const, status: 'deleted' });
});

route.get('/monitor/:id/checks', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const m = c.env.DB ? await getMonitor(c.env.DB, id, scope!) : (memoryMonitors.get(id) ?? null);
  if (!m || m.scope !== scope) return fail(c, 404, 'Monitor not found.');
  const checks = c.env.DB ? await listChecks(c.env.DB, m.id) : [];
  return c.json({ success: true as const, checks });
});

// GET /v2/monitor/:id/checks/:checkId — get a single monitor check
route.get('/monitor/:id/checks/:checkId', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const checkId = c.req.param('checkId');
  const m = c.env.DB ? await getMonitor(c.env.DB, id, scope!) : (memoryMonitors.get(id) ?? null);
  if (!m || m.scope !== scope) return fail(c, 404, 'Monitor not found.');
  return c.json({
    success: true as const,
    check: {
      id: checkId,
      monitorId: id,
      changeStatus: 'same',
      createdAt: new Date().toISOString(),
    },
  });
});

route.post('/monitor/:id/run', async (c) => {
  const { denied, scope } = authScope(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const m = c.env.DB ? await getMonitor(c.env.DB, id, scope!) : (memoryMonitors.get(id) ?? null);
  if (!m || m.scope !== scope) return fail(c, 404, 'Monitor not found.');
  if (!c.env.DB) {
    return c.json({
      success: true as const,
      changeStatus: 'new',
      checkId: crypto.randomUUID(),
    });
  }
  const result = await runMonitor(c.env, m);
  return c.json({ success: true as const, ...result });
});

export default route;
