import type { BrowserQuickAction, WorkersAiBinding, EngineEnv } from '@crawlcheap/engine';

export interface Env {
  BROWSER?: BrowserQuickAction;
  AI?: WorkersAiBinding;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_TOKEN?: string;
  USER_AGENT?: string;
  /** Service binding to the crawl.cheap REST API Worker (preferred; avoids worker-to-worker 1042). */
  API?: Fetcher;
  /** Public base URL of the REST API — fallback for self-host when no service binding. */
  API_BASE?: string;
  /** Sentry DSN (server-side `@sentry/cloudflare`) — estate observability baseline. */
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  /** @theme.tools/telemetry 7-Rail Observability & Langfuse Safe (2500ms) credentials. */
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_HOST?: string;
  LANGFUSE_BASEURL?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
  GA_MEASUREMENT_ID?: string;
  GA_API_SECRET?: string;
  GTM_CONTAINER_ID?: string;
}

export const DEFAULT_API_BASE = 'https://crawl-cheap-api.manhattan.workers.dev';

export function engineEnv(env: Env): EngineEnv {
  return {
    BROWSER: env.BROWSER,
    AI: env.AI,
    CF_ACCOUNT_ID: env.CF_ACCOUNT_ID,
    CF_BROWSER_TOKEN: env.CF_BROWSER_TOKEN,
    USER_AGENT: env.USER_AGENT,
    LANGFUSE_PUBLIC_KEY: env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: env.LANGFUSE_SECRET_KEY,
    LANGFUSE_HOST: env.LANGFUSE_HOST,
    LANGFUSE_BASEURL: env.LANGFUSE_BASEURL,
    POSTHOG_API_KEY: env.POSTHOG_API_KEY,
    POSTHOG_HOST: env.POSTHOG_HOST,
    GA_MEASUREMENT_ID: env.GA_MEASUREMENT_ID,
    GA_API_SECRET: env.GA_API_SECRET,
    GTM_CONTAINER_ID: env.GTM_CONTAINER_ID,
    SENTRY_DSN: env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: env.SENTRY_ENVIRONMENT,
    SENTRY_RELEASE: env.SENTRY_RELEASE,
  };
}
