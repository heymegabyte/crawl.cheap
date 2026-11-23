import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { requireAuth, type Vars } from '../lib/auth';
import { fail, parseBody } from '../lib/respond';
import { setSpendLimit } from '../lib/keys';
import { creditsUsedThisPeriod, usageHistory, periodStartIso, effectiveCap } from '../lib/ledger';
import { getActiveConcurrencyForTeam } from '../crawl-do';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

interface ThreatProtectionPolicy {
  mode: 'off' | 'monitor' | 'enforce';
  riskScoreThreshold: number;
  blacklist: string[];
  whitelist: string[];
  blockedTlds: string[];
  failurePolicy: 'fail_open' | 'fail_closed';
  allowRequestOverrides: boolean;
}

const threatPolicies = new Map<string, ThreatProtectionPolicy>();

const DEFAULT_THREAT_POLICY: ThreatProtectionPolicy = {
  mode: 'enforce',
  riskScoreThreshold: 80,
  blacklist: [],
  whitelist: [],
  blockedTlds: [],
  failurePolicy: 'fail_closed',
  allowRequestOverrides: true,
};

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

route.get('/team/token-usage', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const authed = p.authed;
  return c.json({
    success: true as const,
    data: {
      remainingTokens: authed ? 1500000 : 15000,
      planTokens: authed ? 1500000 : 15000,
      billingPeriodStart: null,
      billingPeriodEnd: null,
    },
  });
});

route.get('/team/token-usage/historical', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  return c.json({
    success: true as const,
    periods: [
      {
        startDate: periodStartIso(),
        endDate: new Date().toISOString(),
        totalTokens: 0,
      },
    ],
    data: [],
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
  if (p.authed && p.keyId && c.env.DB) {
    const rows = await usageHistory(c.env.DB, p.keyId, 50);
    return c.json({
      success: true as const,
      data: rows.map((r) => ({
        endpoint: r.operation,
        credits: r.credits,
        url: r.url,
        jobId: r.job_id,
        success: Boolean(r.success),
        createdAt: r.created_at,
      })),
      cursor: null,
      has_more: false,
    });
  }
  return c.json({
    success: true as const,
    data: [],
    cursor: null,
    has_more: false,
  });
});

route.get('/team/threat-protection', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const teamKey = p.teamId ?? p.keyId ?? 'default';
  const policy = threatPolicies.get(teamKey) ?? DEFAULT_THREAT_POLICY;
  return c.json({ success: true as const, data: policy });
});

route.put('/team/threat-protection', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z.object({
      mode: z.enum(['off', 'monitor', 'enforce']).optional(),
      riskScoreThreshold: z.number().min(0).max(100).optional(),
      blacklist: z.array(z.string()).optional(),
      whitelist: z.array(z.string()).optional(),
      blockedTlds: z.array(z.string()).optional(),
      failurePolicy: z.enum(['fail_open', 'fail_closed']).optional(),
      allowRequestOverrides: z.boolean().optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const teamKey = p.teamId ?? p.keyId ?? 'default';
  const current = threatPolicies.get(teamKey) ?? DEFAULT_THREAT_POLICY;
  const updated: ThreatProtectionPolicy = { ...current, ...parsed.data };
  threatPolicies.set(teamKey, updated);
  return c.json({ success: true as const, data: updated });
});

route.get('/keyless/eligibility', (c) =>
  c.json({
    success: true as const,
    eligible: c.env.DEMO_MODE === 'true',
    remainingRequests: 20,
  }),
);

export default route;
