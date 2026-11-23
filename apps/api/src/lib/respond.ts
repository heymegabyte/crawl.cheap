import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { ErrorCode } from '@crawlcheap/contracts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/** Validate that a job ID path parameter is a well-formed UUID (Firecrawl v1/v2 contract). */
export function assertUuidOrFail(c: Context, id: string): Response | null {
  if (isValidUuid(id)) return null;
  return fail(c, 400, 'Invalid job ID format. Job ID must be a valid UUID.', 'BAD_REQUEST');
}

/** Emit a Firecrawl-compatible error envelope. */
export function fail(
  c: Context,
  status: number,
  error: string,
  code?: ErrorCode,
  details?: unknown,
) {
  return c.json(
    {
      success: false as const,
      error,
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    },
    status as ContentfulStatusCode,
  );
}

/** Validate a request body with a Zod schema, returning a typed value or a 400 Response. */
export async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: fail(c, 400, 'Invalid JSON in request body', 'BAD_REQUEST_INVALID_JSON'),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') || '(root)';
    const message =
      first?.code === 'custom'
        ? (first.message ?? 'Validation failed')
        : `Invalid request: ${path} — ${first?.message ?? 'validation failed'}`;
    return {
      ok: false,
      response: fail(c, 400, message, 'BAD_REQUEST', result.error.issues),
    };
  }
  return { ok: true, data: result.data };
}
