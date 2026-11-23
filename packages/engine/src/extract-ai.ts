import { getLangfuseSafeClient } from './telemetry';
import type { EngineEnv } from './types';

/**
 * Structured JSON extraction over markdown/text.
 * Primary path: Workers AI (`env.AI.run`) with JSON-mode / schema prompt.
 * Fallback: Browser Rendering `/json` quickAction when `env.BROWSER` (or REST creds)
 * is present and a URL is supplied.
 *
 * Every Workers AI / Browser Rendering LLM call is automatically traced to Langfuse
 * via `LangfuseSafeClient` with a strict `2500ms` fail-open timeout (`AbortSignal.timeout(2500)`),
 * 3-strike circuit breaker, and local spool fallback.
 */

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MAX_INPUT_CHARS = 24_000;

export interface ExtractOptions {
  prompt?: string;
  schema?: Record<string, unknown>;
  systemPrompt?: string;
}

export function extractAvailable(env: EngineEnv): boolean {
  return Boolean(env.AI);
}

export async function extractWithAI(
  markdown: string,
  opts: ExtractOptions,
  env: EngineEnv,
): Promise<unknown> {
  if (!env.AI) return null;

  const t0 = Date.now();
  const truncated = markdown.slice(0, MAX_INPUT_CHARS);
  const schemaInstruction = opts.schema
    ? `Respond ONLY with valid JSON conforming to this JSON Schema:\n${JSON.stringify(opts.schema)}`
    : 'Respond ONLY with a single valid JSON object. No prose, no markdown fences.';
  const userTask = opts.prompt ?? 'Extract the key structured information from the content below.';

  const system = [
    opts.systemPrompt ??
      'You are a precise data-extraction engine. Output raw JSON only — never wrap in ```json fences or add commentary.',
    schemaInstruction,
  ].join('\n\n');

  const user = `${userTask}\n\n---\nCONTENT:\n${truncated}`;
  const lf = getLangfuseSafeClient({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_HOST ?? env.LANGFUSE_BASEURL,
    serviceName: 'crawl-cheap-engine',
    environment: env.SENTRY_ENVIRONMENT ?? 'production',
  });

  try {
    const raw = (await env.AI.run(DEFAULT_MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 1024,
      temperature: 0,
      ...(opts.schema
        ? { response_format: { type: 'json_schema', json_schema: opts.schema } }
        : {}),
    })) as { response?: unknown } | string | null;

    const parsed = parseAiResponse(raw);
    const durationMs = Math.max(1, Date.now() - t0);
    const promptTokens = Math.ceil((system.length + user.length) / 4);
    const completionTokens = Math.ceil(JSON.stringify(parsed ?? raw ?? '').length / 4);

    // Non-blocking fail-open Langfuse trace (2500ms timeout + 3-strike circuit breaker)
    void lf.traceSafe({
      name: 'workers_ai.extract',
      model: DEFAULT_MODEL,
      input: { prompt: userTask, schema: opts.schema, contentChars: truncated.length },
      output: parsed,
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    });

    return parsed;
  } catch (err) {
    const durationMs = Math.max(1, Date.now() - t0);
    void lf.traceSafe({
      name: 'workers_ai.extract',
      model: DEFAULT_MODEL,
      input: { prompt: userTask, schema: opts.schema, contentChars: truncated.length },
      output: { error: err instanceof Error ? err.message : 'extract_failed' },
      durationMs,
      level: 'ERROR',
      statusMessage: err instanceof Error ? err.message : 'extract_failed',
    });
    throw err;
  }
}

/** Workers AI may return `{ response: string | object }` or a raw string; normalize and
 *  strip ```json fences if the model ignored the system prompt. */
export function parseAiResponse(raw: unknown): unknown {
  if (raw == null) return null;
  const candidate =
    typeof raw === 'object' && 'response' in (raw as Record<string, unknown>)
      ? (raw as { response: unknown }).response
      : raw;
  if (typeof candidate === 'object' && candidate !== null) return candidate;
  if (typeof candidate !== 'string') return { value: candidate };

  const cleaned = candidate
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Last-chance: find the first `{...}` or `[...]` block in the response.
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        /* fall through */
      }
    }
    return { text: cleaned };
  }
}
