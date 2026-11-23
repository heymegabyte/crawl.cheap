import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { parseDocument, safeFetch, SsrfError } from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import { fail, parseBody } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();
const MAX_BYTES = 50 * 1024 * 1024;

function gate(c: Context<{ Bindings: Env; Variables: Vars }>): Response | null {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed) return null;
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
  return null;
}

const SUPPORTED_PARSE_FORMATS = [
  {
    format: 'pdf',
    kind: 'document',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
  },
  {
    format: 'html',
    kind: 'document',
    extensions: ['.html', '.htm', '.xhtml'],
    mimeTypes: ['text/html', 'application/xhtml+xml'],
  },
  {
    format: 'txt',
    kind: 'document',
    extensions: ['.txt', '.md', '.csv'],
    mimeTypes: ['text/plain', 'text/markdown', 'text/csv'],
  },
] as const;

/**
 * Document parse. Accepts a multipart `file` upload OR a JSON `{ url }` / `{ data, filename, contentType }`
 * to fetch + parse (SSRF-guarded). PDF/HTML/text → Markdown via unpdf + Cloudflare Workers AI `toMarkdown()`.
 */
route.post('/parse', async (c) => {
  const denied = gate(c);
  if (denied) return denied;

  const contentType = c.req.header('content-type') ?? '';
  let bytes: ArrayBuffer;
  let docContentType = '';
  let baseUrl = '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      const entry = form.get('file');
      if (!entry) {
        return fail(c, 400, 'multipart request must include a `file` field.', 'BAD_REQUEST');
      }
      if (typeof entry === 'string') {
        bytes = new TextEncoder().encode(entry).buffer as ArrayBuffer;
        docContentType = 'text/html';
      } else {
        const file = entry as unknown as {
          arrayBuffer(): Promise<ArrayBuffer>;
          size: number;
          type?: string;
          name?: string;
        };
        if (file.size > MAX_BYTES)
          return fail(c, 400, 'File exceeds the 50 MB limit.', 'BAD_REQUEST');
        bytes = await file.arrayBuffer();
        docContentType = file.type ?? '';
        baseUrl = file.name ?? '';
      }
    } else {
      const parsed = await parseBody(
        c,
        z
          .object({
            url: z.string().url().optional(),
            data: z.string().optional(),
            filename: z.string().optional(),
            contentType: z.string().optional(),
          })
          .refine((b) => b.url || b.data, 'Provide url or data'),
      );
      if (!parsed.ok) return parsed.response;
      if (parsed.data.data) {
        bytes = new TextEncoder().encode(parsed.data.data).buffer as ArrayBuffer;
        docContentType = parsed.data.contentType ?? 'text/html';
        baseUrl = parsed.data.filename ?? '';
      } else {
        const { response, finalUrl } = await safeFetch(parsed.data.url!, {
          userAgent: c.env.USER_AGENT,
          timeoutMs: 45000,
        });
        if (!response.ok)
          return fail(
            c,
            502,
            `Failed to fetch document (${response.status}).`,
            'SCRAPE_SITE_ERROR',
          );
        const len = Number(response.headers.get('content-length') ?? 0);
        if (len > MAX_BYTES)
          return fail(c, 400, 'Document exceeds the 50 MB limit.', 'BAD_REQUEST');
        bytes = await response.arrayBuffer();
        docContentType = response.headers.get('content-type') ?? '';
        baseUrl = finalUrl;
      }
    }
  } catch (err) {
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    return fail(
      c,
      400,
      err instanceof Error ? err.message : 'Invalid parse request',
      'BAD_REQUEST',
    );
  }

  try {
    const result = await parseDocument(bytes, docContentType, baseUrl, engineEnv(c.env));
    const metadata = {
      statusCode: 200,
      creditsUsed: 1,
      ...result.metadata,
    };
    const data: Record<string, unknown> = { markdown: result.markdown, metadata };
    if (result.pages && result.pages.length > 1) data.pages = result.pages;
    return c.json({ success: true as const, data });
  } catch (err) {
    return fail(
      c,
      422,
      err instanceof Error ? err.message : 'Failed to parse document',
      'BAD_REQUEST',
    );
  }
});

route.get('/parse/formats', (c) =>
  c.json({
    success: true as const,
    data: { formats: SUPPORTED_PARSE_FORMATS },
    formats: SUPPORTED_PARSE_FORMATS,
  }),
);

export default route;
