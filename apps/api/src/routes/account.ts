import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { requireAuth, type Vars } from '../lib/auth';
import { fail, parseBody } from '../lib/respond';
import { setSpendLimit, listAuditLogs, recordAuditLog } from '../lib/keys';
import { creditsUsedThisPeriod, usageHistory, periodStartIso, effectiveCap } from '../lib/ledger';
import { getActiveConcurrencyForTeam } from '../crawl-do';
import {
  deleteThreatPolicy,
  getThreatPolicy,
  listAgentJobs,
  listInteractSessions,
  saveThreatPolicy,
  tokensUsedThisPeriod,
  tokenUsageHistory,
  type ThreatProtectionPolicy,
} from '../lib/durable-state';
import { PLAN_CREDITS } from '../lib/keys';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

route.get('/team/credit-usage', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed && p.keyId && c.env.DB) {
    const used = await creditsUsedThisPeriod(c.env.DB, p.keyId);
    const plan = p.monthlyCredits ?? 1000;
    const cap = effectiveCap(plan, p.spendLimit);
    return c.json({
      success: true as const,
      data: {
        remainingCredits: Math.max(0, cap - used),
        planCredits: plan,
        spendLimit: p.spendLimit ?? null,
        billingPeriodStart: periodStartIso(),
        billingPeriodEnd: null,
      },
    });
  }
  const authed = p.authed;
  return c.json({
    success: true as const,
    data: {
      remainingCredits: authed ? (p.monthlyCredits ?? 100000) : 1000,
      planCredits: authed ? (p.monthlyCredits ?? 100000) : 1000,
      billingPeriodStart: null,
      billingPeriodEnd: null,
    },
  });
});

route.get('/team/credit-usage/historical', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed && p.keyId && c.env.DB) {
    const rows = await usageHistory(c.env.DB, p.keyId);
    const totalCredits = rows.reduce((s, r) => s + r.credits, 0);
    return c.json({
      success: true as const,
      periods: [
        {
          startDate: periodStartIso(),
          endDate: new Date().toISOString(),
          apiKey: p.keyId,
          totalCredits,
        },
      ],
      data: rows.map((r) => ({
        operation: r.operation,
        credits: r.credits,
        url: r.url,
        jobId: r.job_id,
        success: Boolean(r.success),
        createdAt: r.created_at,
      })),
    });
  }
  return c.json({ success: true as const, periods: [], data: [] });
});

route.get('/team/token-usage', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const authed = p.authed;
  const planTokens = authed ? 1_500_000 : 15_000;
  const used = await tokensUsedThisPeriod(c.env.DB, p.keyId);
  return c.json({
    success: true as const,
    data: {
      remainingTokens: Math.max(0, planTokens - used),
      planTokens,
      usedTokens: used,
      billingPeriodStart: periodStartIso(),
      billingPeriodEnd: null,
    },
  });
});

route.get('/team/token-usage/historical', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const rows = await tokenUsageHistory(c.env.DB, p.keyId);
  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  return c.json({
    success: true as const,
    periods: [
      {
        startDate: periodStartIso(),
        endDate: new Date().toISOString(),
        totalTokens,
      },
    ],
    data: rows,
  });
});

route.get('/concurrency-check', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const authed = p.authed;
  const maxConcurrency = authed ? (p.maxConcurrency ?? 25) : 2;
  const concurrency = Math.min(getActiveConcurrencyForTeam(p.teamId), maxConcurrency);
  return c.json({
    success: true as const,
    concurrency,
    maxConcurrency,
    data: {
      active: concurrency,
      concurrency,
      maxConcurrency,
    },
  });
});

route.get('/team/spend-limit', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  return c.json({
    success: true as const,
    data: { spendLimit: p.spendLimit ?? null, planCredits: p.monthlyCredits ?? null },
  });
});

route.post('/team/spend-limit', async (c) => {
  const p = c.get('principal');
  if (!p.authed || !p.keyId) {
    return fail(
      c,
      401,
      'Setting a hard spend limit requires a crawl.cheap API key.',
      'BAD_REQUEST',
    );
  }
  const parsed = await parseBody(c, z.object({ limit: z.number().int().nonnegative().nullable() }));
  if (!parsed.ok) return parsed.response;
  await setSpendLimit(c.env.DB, p.keyId, parsed.data.limit);
  return c.json({ success: true as const, data: { spendLimit: parsed.data.limit } });
});

route.get('/team/queue-status', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const authed = p.authed;
  const maxConcurrency = authed ? (p.maxConcurrency ?? 25) : 2;
  const active = Math.min(getActiveConcurrencyForTeam(p.teamId), maxConcurrency);
  return c.json({
    success: true as const,
    jobsInQueue: active,
    activeJobsInQueue: active,
    waitingJobsInQueue: 0,
    maxConcurrency,
    mostRecentSuccess: new Date().toISOString(),
  });
});

route.get('/team/activity', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const teamId = p.teamId ?? p.keyId ?? 'default';
  const [usageRows, agentRows, interactRows] = await Promise.all([
    p.authed && p.keyId && c.env.DB ? usageHistory(c.env.DB, p.keyId, 50) : Promise.resolve([]),
    listAgentJobs(c.env.DB, teamId),
    listInteractSessions(c.env.DB, teamId),
  ]);

  const items = [
    ...usageRows.map((r) => ({
      id: r.job_id ?? `usg_${r.created_at}`,
      endpoint: r.operation,
      credits: r.credits,
      creditsUsed: r.credits,
      url: r.url ?? 'https://example.com',
      jobId: r.job_id,
      status: r.success ? 'completed' : 'failed',
      success: Boolean(r.success),
      createdAt: r.created_at,
    })),
    ...agentRows.map((a) => ({
      id: a.id,
      endpoint: 'agent',
      credits: a.creditsUsed,
      creditsUsed: a.creditsUsed,
      url: a.prompt.slice(0, 120),
      jobId: a.id,
      status: a.cancelled ? 'cancelled' : a.status,
      success: a.status !== 'failed',
      createdAt: a.createdAt,
    })),
    ...interactRows.map((s) => ({
      id: s.id,
      endpoint: 'interact',
      credits: 2,
      creditsUsed: 2,
      url: s.url,
      jobId: s.id,
      status: s.status,
      success: true,
      createdAt: new Date(s.createdAt).toISOString(),
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const slice = items.slice(0, 60);
  return c.json({
    success: true as const,
    data: slice,
    activity: slice,
    cursor: null,
    has_more: false,
  });
});

route.post('/team/plan', async (c) => {
  const p = c.get('principal');
  if (!p.authed || !p.keyId) {
    return fail(
      c,
      401,
      'Changing plan requires an authenticated API key or session.',
      'BAD_REQUEST',
    );
  }
  const parsed = await parseBody(
    c,
    z.object({
      plan: z.enum(['free', 'hobby', 'standard', 'growth', 'scale']),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const credits = PLAN_CREDITS[parsed.data.plan] ?? 1000;
  if (c.env.DB) {
    try {
      await c.env.DB.prepare('UPDATE api_keys SET plan = ?, monthly_credits = ? WHERE id = ?')
        .bind(parsed.data.plan, credits, p.keyId)
        .run();
    } catch {
      /* ignore */
    }
  }
  const PLAN_PRICES: Record<string, number> = {
    free: 0,
    hobby: 9.5,
    standard: 49.5,
    growth: 199.5,
    scale: 374.5,
  };
  return c.json({
    success: true as const,
    data: {
      plan: parsed.data.plan,
      monthlyCredits: credits,
      priceMonthly: PLAN_PRICES[parsed.data.plan] ?? 0,
    },
  });
});

route.get('/team/threat-protection', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const teamKey = p.teamId ?? p.keyId ?? 'default';
  const policy = await getThreatPolicy(c.env.DB, teamKey);
  return c.json({ success: true as const, data: policy });
});

route.put('/team/threat-protection', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z
      .object({
        mode: z.enum(['off', 'monitor', 'enforce']).optional(),
        riskScoreThreshold: z.number().min(0).max(100).optional(),
        blacklist: z.array(z.string()).optional(),
        whitelist: z.array(z.string()).optional(),
        blockedTlds: z.array(z.string()).optional(),
        failurePolicy: z.enum(['fail_open', 'fail_closed']).optional(),
        allowRequestOverrides: z.boolean().optional(),
      })
      .refine((b) => Object.keys(b).length > 0, 'Provide at least one threat-protection field'),
  );
  if (!parsed.ok) return parsed.response;
  const teamKey = p.teamId ?? p.keyId ?? 'default';
  const current = await getThreatPolicy(c.env.DB, teamKey);
  const updated: ThreatProtectionPolicy = { ...current, ...parsed.data };
  await saveThreatPolicy(c.env.DB, teamKey, updated);
  return c.json({ success: true as const, data: updated });
});

route.delete('/team/threat-protection', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const teamKey = p.teamId ?? p.keyId ?? 'default';
  await deleteThreatPolicy(c.env.DB, teamKey);
  return c.json({ success: true as const, deleted: true });
});

route.get('/keyless/eligibility', (c) =>
  c.json({
    success: true as const,
    eligible: c.env.DEMO_MODE === 'true',
    remainingRequests: 20,
  }),
);

// GET /v2/team/audit-log — Tamper-evident team security & API key rotation audit trail
route.get('/team/audit-log', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  return c.json({
    success: true as const,
    entries: listAuditLogs(40),
  });
});

// GET /v2/team/invoices — Monthly billing receipts & 50% Firecrawl savings statement
route.get('/team/invoices', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const plan = p.plan ?? 'free';
  const PLAN_PRICES: Record<string, { crawlCheap: number; firecrawl: number; credits: number }> = {
    free: { crawlCheap: 0, firecrawl: 0, credits: 1000 },
    hobby: { crawlCheap: 9.5, firecrawl: 19, credits: 5000 },
    standard: { crawlCheap: 49.5, firecrawl: 99, credits: 100000 },
    growth: { crawlCheap: 199.5, firecrawl: 399, credits: 500000 },
    scale: { crawlCheap: 374.5, firecrawl: 749, credits: 1000000 },
  };
  const tier = PLAN_PRICES[plan] ?? PLAN_PRICES.free!;
  const used = p.authed && p.keyId && c.env.DB ? await creditsUsedThisPeriod(c.env.DB, p.keyId) : 0;
  recordAuditLog({
    action: 'billing.invoices.viewed',
    actor: p.teamId ?? p.keyId ?? 'anon',
    detail: `Inspected billing invoices for ${plan} plan`,
  });
  return c.json({
    success: true as const,
    invoices: [
      {
        id: `inv_${periodStartIso().slice(0, 7).replace('-', '')}_01`,
        periodStart: periodStartIso(),
        plan,
        includedCredits: tier.credits,
        usedCredits: used,
        amountUsd: tier.crawlCheap,
        firecrawlEquivalentUsd: tier.firecrawl,
        savingsUsd: Number((tier.firecrawl - tier.crawlCheap).toFixed(2)),
        status: 'paid',
      },
    ],
  });
});

export default route;
