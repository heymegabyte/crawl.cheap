import { extractText, getDocumentProxy } from 'unpdf';
import { parseHtml, selectContent } from './extract-content';
import { htmlToMarkdown } from './html-to-markdown';
import { getLangfuseSafeClient } from './telemetry';
import type { EngineEnv } from './types';

/**
 * Document parsing → Markdown across 10 format families:
 *   - PDF (`application/pdf`) via `unpdf` + Cloudflare Workers AI `env.AI.toMarkdown()`
 *   - Microsoft Office: DOCX, XLSX, PPTX via `env.AI.toMarkdown()` + embedded XML/ZIP fallback
 *   - OpenDocument: ODT, ODS via `env.AI.toMarkdown()` + embedded XML/ZIP fallback
 *   - Spreadsheets & Tabular: CSV / TSV → Markdown GFM tables
 *   - Rich Text: RTF → clean Markdown
 *   - Web & Markup: HTML / XHTML / XML → Readability + HTML→Markdown
 *   - Images: PNG / JPEG / WebP / GIF via `env.AI.toMarkdown()` vision OCR
 *   - Plain Text & Markdown: TXT / MD / JSON passthrough
 */

export interface ParseResult {
  markdown: string;
  metadata: {
    contentType?: string;
    numPages?: number;
    title?: string;
    creditsUsed?: number;
    statusCode?: number;
    format?: string;
  };
  pages?: Array<{ pageNumber: number; markdown: string }>;
}

export function looksLikePdf(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 5));
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
}

export function looksLikeZip(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 4));
  return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05); // PK\x03\x04
}

function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype|html|head|body|h1|div|p|article|main|section|table)/i.test(text);
}

/** Convert CSV/TSV text into a clean GitHub-Flavored Markdown table. */
export function csvToMarkdownTable(csvText: string): string {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const delim = lines[0]!.includes('\t') && !lines[0]!.includes(',') ? '\t' : ',';
  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };
  const rows = lines.map(parseRow);
  const header = rows[0]!;
  const sep = header.map(() => '---');
  const body = rows.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${header.map((_, idx) => r[idx] ?? '').join(' | ')} |`),
  ].join('\n');
}

/** Convert RTF control sequences into clean readable text/Markdown. */
function rtfToMarkdown(rtf: string): string {
  return rtf
    .replace(/\\par\b/g, '\n\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\{\\\*\\[a-z]+[^}]*\\}/gi, '')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract readable text from uncompressed XML tags inside Office/OpenDocument containers or raw XML streams. */
function extractOfficeXmlText(bytes: ArrayBuffer): string {
  const raw = new TextDecoder().decode(bytes);
  // Look for <w:t> (DOCX), <a:t> (PPTX), <t> (XLSX sharedStrings), <text:p> (ODT/ODS)
  const matches: string[] = [];
  const tagRegex =
    /<(?:w:t|a:t|t|text:p|text:h)(?:\s[^>]*)?>([^<]+)<\/(?:w:t|a:t|t|text:p|text:h)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(raw)) !== null) {
    const val = m[1]?.trim();
    if (val) matches.push(val);
  }
  if (matches.length > 0) return matches.join(' ');
  // Fallback: extract printable ASCII/UTF-8 runs outside binary zip headers
  const printable = raw
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return printable.slice(0, 8000);
}

export async function parseDocument(
  bytes: ArrayBuffer,
  contentType: string,
  baseUrl = '',
  env?: EngineEnv,
): Promise<ParseResult> {
  const ct = (contentType || '').toLowerCase();
  const lowerUrl = (baseUrl || '').toLowerCase();

  // 1. PDF
  if (ct.includes('pdf') || lowerUrl.endsWith('.pdf') || looksLikePdf(bytes)) {
    let totalPages = 1;
    let pages: Array<{ pageNumber: number; markdown: string }> = [];
    let markdown = '';

    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const extracted = (await extractText(pdf, { mergePages: false })) as {
        totalPages: number;
        text: string | string[];
      };
      totalPages = extracted.totalPages;
      const pageTexts = Array.isArray(extracted.text) ? extracted.text : [String(extracted.text)];
      pages = pageTexts.map((t, i) => ({
        pageNumber: i + 1,
        markdown: (t ?? '').replace(/[ \t]+\n/g, '\n').trim(),
      }));
      markdown = pages
        .map((p) => p.markdown)
        .filter(Boolean)
        .join('\n\n')
        .trim();
    } catch {
      /* fallback to Workers AI toMarkdown below */
    }

    if (!markdown && env?.AI?.toMarkdown) {
      try {
        const converted = await env.AI.toMarkdown([
          { name: baseUrl || 'document.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) },
        ]);
        if (converted?.[0]?.data) {
          markdown = converted[0].data.trim();
        }
      } catch {
        /* keep unpdf result */
      }
    }

    return {
      markdown,
      metadata: {
        contentType: 'application/pdf',
        format: 'pdf',
        numPages: totalPages,
        creditsUsed: 1,
        statusCode: 200,
      },
      ...(pages.length > 0 ? { pages } : {}),
    };
  }

  // 2. CSV / TSV
  if (
    ct.includes('csv') ||
    ct.includes('tab-separated') ||
    lowerUrl.endsWith('.csv') ||
    lowerUrl.endsWith('.tsv')
  ) {
    const text = new TextDecoder().decode(bytes);
    return {
      markdown: csvToMarkdownTable(text),
      metadata: {
        contentType: 'text/csv',
        format: 'csv',
        creditsUsed: 1,
        statusCode: 200,
      },
    };
  }

  // 3. RTF
  if (ct.includes('rtf') || lowerUrl.endsWith('.rtf')) {
    const text = new TextDecoder().decode(bytes);
    return {
      markdown: rtfToMarkdown(text),
      metadata: {
        contentType: 'application/rtf',
        format: 'rtf',
        creditsUsed: 1,
        statusCode: 200,
      },
    };
  }

  // 4. Office & OpenDocument formats (DOCX, XLSX, PPTX, ODT, ODS)
  const isOfficeOrOdf =
    ct.includes('officedocument') ||
    ct.includes('msword') ||
    ct.includes('ms-excel') ||
    ct.includes('ms-powerpoint') ||
    ct.includes('opendocument') ||
    /\.(docx|xlsx|pptx|odt|ods)$/i.test(lowerUrl) ||
    looksLikeZip(bytes);

  if (isOfficeOrOdf) {
    const extMatch = lowerUrl.match(/\.(docx|xlsx|pptx|odt|ods)$/i);
    const fmt = extMatch
      ? extMatch[1]!.toLowerCase()
      : ct.includes('spreadsheet') || ct.includes('excel')
        ? 'xlsx'
        : ct.includes('presentation') || ct.includes('powerpoint')
          ? 'pptx'
          : ct.includes('opendocument.text')
            ? 'odt'
            : ct.includes('opendocument.spreadsheet')
              ? 'ods'
              : 'docx';

    if (env?.AI?.toMarkdown) {
      try {
        const t0 = Date.now();
        const converted = await env.AI.toMarkdown([
          {
            name: baseUrl || `document.${fmt}`,
            blob: new Blob([bytes], { type: ct || 'application/octet-stream' }),
          },
        ]);
        const lf = getLangfuseSafeClient({
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: env.LANGFUSE_HOST ?? env.LANGFUSE_BASEURL,
          serviceName: 'crawl-cheap-engine',
          environment: env.SENTRY_ENVIRONMENT ?? 'production',
        });
        void lf.traceSafe({
          name: 'workers_ai.to_markdown',
          model: 'cloudflare.toMarkdown',
          input: { format: fmt, byteLength: bytes.byteLength, baseUrl },
          output: { chars: converted?.[0]?.data?.length ?? 0 },
          durationMs: Math.max(1, Date.now() - t0),
          totalTokens: converted?.[0]?.tokens ?? 0,
        });
        if (converted?.[0]?.data) {
          return {
            markdown: converted[0].data.trim(),
            metadata: {
              contentType: ct || `application/vnd.openxmlformats-officedocument`,
              format: fmt,
              creditsUsed: 1,
              statusCode: 200,
            },
          };
        }
      } catch {
        /* fallback to embedded XML extraction below */
      }
    }

    const extractedText = extractOfficeXmlText(bytes);
    return {
      markdown: extractedText || `# Document (${fmt.toUpperCase()})`,
      metadata: {
        contentType: ct || 'application/vnd.openxmlformats-officedocument',
        format: fmt,
        creditsUsed: 1,
        statusCode: 200,
      },
    };
  }

  // 5. Images (PNG, JPEG, WebP, GIF) via Workers AI toMarkdown()
  if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(lowerUrl)) {
    if (env?.AI?.toMarkdown) {
      try {
        const converted = await env.AI.toMarkdown([
          {
            name: baseUrl || 'image.png',
            blob: new Blob([bytes], { type: ct || 'image/png' }),
          },
        ]);
        if (converted?.[0]?.data) {
          return {
            markdown: converted[0].data.trim(),
            metadata: {
              contentType: ct || 'image/png',
              format: 'image',
              creditsUsed: 1,
              statusCode: 200,
            },
          };
        }
      } catch {
        /* fallback */
      }
    }
    return {
      markdown: `![${baseUrl || 'Image'}](${baseUrl || 'image'})`,
      metadata: {
        contentType: ct || 'image/png',
        format: 'image',
        creditsUsed: 1,
        statusCode: 200,
      },
    };
  }

  // 6. HTML / XHTML / XML
  if (ct.includes('html') || ct === 'application/xml' || ct === 'text/xml' || ct.endsWith('+xml')) {
    const html = new TextDecoder().decode(bytes);
    const content = selectContent(parseHtml(html), { onlyMainContent: true });
    return {
      markdown: htmlToMarkdown(content, { baseUrl }),
      metadata: { contentType: 'text/html', format: 'html', creditsUsed: 1, statusCode: 200 },
    };
  }

  // 7. Plain text / Markdown / JSON
  if (ct.includes('text') || ct.includes('markdown') || ct.includes('json') || ct === '') {
    const decoded = new TextDecoder().decode(bytes);
    if (looksLikeHtml(decoded)) {
      const content = selectContent(parseHtml(decoded), { onlyMainContent: true });
      return {
        markdown: htmlToMarkdown(content, { baseUrl }),
        metadata: { contentType: 'text/html', format: 'html', creditsUsed: 1, statusCode: 200 },
      };
    }
    return {
      markdown: decoded.trim(),
      metadata: { contentType: ct || 'text/plain', format: 'txt', creditsUsed: 1, statusCode: 200 },
    };
  }

  throw new Error(
    `Unsupported document type "${ct}". Supported formats: pdf, docx, xlsx, pptx, odt, ods, csv, rtf, html, txt, image.`,
  );
}
