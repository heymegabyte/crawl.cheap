import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { parseDocument, safeFetch, SsrfError } from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import {
  createParseUploadSlot,
  getParseUploadBytes,
  storeParseUploadBytes,
} from '../lib/durable-state';

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

function origin(c: Context<{ Bindings: Env; Variables: Vars }>): string {
  try {
    return c.env.SERVICE_ORIGIN || new URL(c.req.url).origin;
  } catch {
    return 'https://api.crawl.cheap';
  }
}

export const SUPPORTED_PARSE_FORMATS = [
  {
    format: 'pdf',
    kind: 'document',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
  },
  {
    format: 'docx',
    kind: 'document',
    extensions: ['.docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  {
    format: 'xlsx',
    kind: 'spreadsheet',
    extensions: ['.xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  {
    format: 'pptx',
    kind: 'presentation',
    extensions: ['.pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  },
  {
    format: 'odt',
    kind: 'document',
    extensions: ['.odt'],
    mimeTypes: ['application/vnd.oasis.opendocument.text'],
  },
  {
    format: 'ods',
    kind: 'spreadsheet',
    extensions: ['.ods'],
    mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'],
  },
  {
    format: 'csv',
    kind: 'spreadsheet',
    extensions: ['.csv', '.tsv'],
    mimeTypes: ['text/csv', 'text/tab-separated-values'],
  },
  {
    format: 'rtf',
    kind: 'document',
    extensions: ['.rtf'],
    mimeTypes: ['application/rtf', 'text/rtf'],
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
    extensions: ['.txt', '.md'],
    mimeTypes: ['text/plain', 'text/markdown'],
  },
  {
    format: 'image',
    kind: 'image',
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
] as const;

// POST /v2/parse/upload-url — generate an R2 + D1 backed presigned upload URL for document parsing
route.post('/parse/upload-url', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z
      .object({
        filename: z.string().optional(),
        contentType: z.string().optional(),
      })
      .refine((b) => Boolean(b.filename || b.contentType), 'Provide filename or contentType'),
  );
  if (!parsed.ok) return parsed.response;
  const p = c.get('principal');
  const uploadId = crypto.randomUUID();
  const slot = await createParseUploadSlot(c.env.DB, {
    id: uploadId,
    teamId: p.teamId ?? p.keyId ?? 'default',
    keyId: p.keyId,
    filename: parsed.data.filename ?? 'document.pdf',
    contentType: parsed.data.contentType ?? 'application/pdf',
  });
  const uploadUrl = `${origin(c)}/v2/parse/upload/${uploadId}`;
  return c.json({
    success: true as const,
    uploadId,
    uploadUrl,
    url: uploadUrl,
    expiresAt: slot.expiresAt,
  });
});

// PUT /v2/parse/upload/:id — store raw document bytes in R2 (`ARTIFACTS`) and D1 (`parse_uploads`)
route.put('/parse/upload/:id', async (c) => {
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;
  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return fail(c, 400, 'File exceeds the 50 MB limit.', 'BAD_REQUEST');
  }
  await storeParseUploadBytes(c.env.DB, c.env.ARTIFACTS, id, bytes, contentType);
  return c.json({
    success: true as const,
    id,
    sizeBytes: bytes.byteLength,
    status: 'uploaded',
  });
});

/**
 * Document parse. Accepts:
 *   - a multipart `file` upload, OR
 *   - `{ uploadId }` referencing a file uploaded to `PUT /v2/parse/upload/:id`, OR
 *   - `{ url }` (including `.../v2/parse/upload/:id`) or `{ data, filename, contentType }`
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
            uploadId: z.string().optional(),
            data: z.string().optional(),
            filename: z.string().optional(),
            contentType: z.string().optional(),
          })
          .refine((b) => b.url || b.data || b.uploadId, 'Provide url, uploadId, or data'),
      );
      if (!parsed.ok) return parsed.response;

      const uploadMatch =
        parsed.data.uploadId ??
        parsed.data.url?.match(/\/v2\/parse\/upload\/([0-9a-fA-F-]{8,})/)?.[1];

      if (uploadMatch) {
        const uploaded = await getParseUploadBytes(c.env.DB, c.env.ARTIFACTS, uploadMatch);
        if (!uploaded) {
          return fail(c, 404, `Uploaded document "${uploadMatch}" not found.`, 'BAD_REQUEST');
        }
        bytes = uploaded.bytes;
        docContentType = parsed.data.contentType ?? uploaded.contentType;
        baseUrl = parsed.data.filename ?? uploaded.filename;
      } else if (parsed.data.data) {
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
