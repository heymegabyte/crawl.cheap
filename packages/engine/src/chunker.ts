import type { HTMLElement } from 'node-html-parser';

export interface RagChunk {
  index: number;
  id: string;
  sectionPath: string[];
  heading: string | null;
  text: string;
  approxTokens: number;
  charCount: number;
  metadata: {
    url?: string;
    title?: string;
    jsonLdTypes?: string[];
  };
}

export interface TokenStats {
  rawHtmlTokens: number;
  markdownTokens: number;
  savingsTokens: number;
  savingsPercent: number;
  chunkCount?: number;
}

export interface ChunkMarkdownOptions {
  maxTokens?: number;
  overlapTokens?: number;
  url?: string;
  title?: string;
  jsonLd?: unknown[];
}

/**
 * Model-agnostic sub-word token estimator calibrated for cl100k_base / o200k_base / Llama-3.
 * Combines whitespace word splitting with punctuation/code symbol weighting.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const symbols = (text.match(/[{}[\]()<>:;,.!?/\\|=+*&^%$#@~`"'-]/g) || []).length;
  const charEst = Math.ceil(text.length / 4);
  const wordEst = Math.ceil(words * 1.32 + symbols * 0.35);
  return Math.max(1, Math.round((charEst + wordEst) / 2));
}

export function computeTokenStats(
  markdown: string,
  rawHtml?: string,
  chunkCount?: number,
): TokenStats {
  const markdownTokens = estimateTokens(markdown);
  const rawHtmlTokens = rawHtml
    ? Math.max(markdownTokens, estimateTokens(rawHtml))
    : markdownTokens * 4;
  const savingsTokens = Math.max(0, rawHtmlTokens - markdownTokens);
  const savingsPercent =
    rawHtmlTokens > 0 ? Math.min(99, Math.round((savingsTokens / rawHtmlTokens) * 100)) : 0;
  return {
    rawHtmlTokens,
    markdownTokens,
    savingsTokens,
    savingsPercent,
    ...(chunkCount !== undefined ? { chunkCount } : {}),
  };
}

/**
 * Extract all embedded `<script type="application/ld+json">` structured data objects from HTML.
 */
export function extractJsonLd(root: HTMLElement): Record<string, unknown>[] {
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  const results: Record<string, unknown>[] = [];
  for (const s of scripts) {
    const raw = (s.text || s.innerHTML || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') results.push(item as Record<string, unknown>);
        }
      } else if (parsed && typeof parsed === 'object') {
        results.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* ignore malformed JSON-LD blocks */
    }
  }
  return results;
}

/**
 * Structure-Aware Recursive Markdown Chunker (256–512 token sweet spot with overlap).
 * Preserves Markdown heading hierarchies (`#`, `##`, `###`) as `sectionPath` breadcrumbs
 * and attaches JSON-LD schema types for hybrid RAG vector retrieval.
 */
export function chunkMarkdown(markdown: string, options: ChunkMarkdownOptions = {}): RagChunk[] {
  const maxTokens = Math.max(64, Math.min(4096, options.maxTokens ?? 400));
  const overlapTokens = Math.max(
    0,
    Math.min(Math.floor(maxTokens / 2), options.overlapTokens ?? 50),
  );
  const clean = (markdown || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const jsonLdTypes: string[] = [];
  if (Array.isArray(options.jsonLd)) {
    for (const item of options.jsonLd) {
      if (item && typeof item === 'object' && '@type' in item) {
        const t = (item as { '@type'?: unknown })['@type'];
        if (typeof t === 'string') jsonLdTypes.push(t);
        else if (Array.isArray(t)) {
          for (const st of t) if (typeof st === 'string') jsonLdTypes.push(st);
        }
      }
    }
  }

  // Split into structural blocks (headings + paragraphs/code blocks)
  const lines = clean.split('\n');
  const sections: Array<{ path: string[]; heading: string | null; paragraphs: string[] }> = [];
  let h1: string | null = null;
  let h2: string | null = null;
  let h3: string | null = null;
  let currentPath: string[] = [];
  let currentHeading: string | null = null;
  let currentParagraphs: string[] = [];
  let buffer: string[] = [];

  const flushParagraph = () => {
    const p = buffer.join('\n').trim();
    if (p) currentParagraphs.push(p);
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      flushParagraph();
      if (currentParagraphs.length > 0) {
        sections.push({
          path: [...currentPath],
          heading: currentHeading,
          paragraphs: currentParagraphs,
        });
        currentParagraphs = [];
      }
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!.trim();
      if (level === 1) {
        h1 = text;
        h2 = null;
        h3 = null;
      } else if (level === 2) {
        h2 = text;
        h3 = null;
      } else {
        h3 = text;
      }
      currentPath = [h1, h2, h3].filter((x): x is string => Boolean(x));
      currentHeading = text;
      currentParagraphs.push(line.trim());
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      buffer.push(line);
    }
  }
  flushParagraph();
  if (currentParagraphs.length > 0) {
    sections.push({
      path: [...currentPath],
      heading: currentHeading,
      paragraphs: currentParagraphs,
    });
  }

  const chunks: RagChunk[] = [];
  let overlapTail = '';

  const pushChunk = (text: string, path: string[], heading: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const idx = chunks.length;
    chunks.push({
      index: idx,
      id: `chk_${idx + 1}`,
      sectionPath: path,
      heading,
      text: trimmed,
      approxTokens: estimateTokens(trimmed),
      charCount: trimmed.length,
      metadata: {
        ...(options.url ? { url: options.url } : {}),
        ...(options.title ? { title: options.title } : {}),
        ...(jsonLdTypes.length > 0 ? { jsonLdTypes } : {}),
      },
    });
    if (overlapTokens > 0) {
      const words = trimmed.split(/\s+/);
      const tailWordsCount = Math.max(4, Math.floor(overlapTokens * 0.75));
      overlapTail = words.slice(-tailWordsCount).join(' ');
    }
  };

  for (const sec of sections) {
    let acc = overlapTail ? `${overlapTail}\n\n` : '';
    for (const para of sec.paragraphs) {
      const candidate = acc ? `${acc}\n\n${para}`.trim() : para;
      if (estimateTokens(candidate) <= maxTokens) {
        acc = candidate;
      } else {
        if (acc && acc !== overlapTail) {
          pushChunk(acc, sec.path, sec.heading);
        }
        // If single paragraph exceeds maxTokens, split by sentence/word budget
        if (estimateTokens(para) > maxTokens) {
          const words = para.split(/\s+/);
          const wordsPerChunk = Math.max(20, Math.floor(maxTokens * 0.75));
          for (let i = 0; i < words.length; i += wordsPerChunk) {
            const slice = words.slice(i, i + wordsPerChunk).join(' ');
            pushChunk(slice, sec.path, sec.heading);
          }
          acc = '';
        } else {
          acc = overlapTail ? `${overlapTail}\n\n${para}` : para;
        }
      }
    }
    if (acc && acc.trim() !== overlapTail.trim()) {
      pushChunk(acc, sec.path, sec.heading);
    }
  }

  return chunks;
}
