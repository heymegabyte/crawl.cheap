import { parse, type HTMLElement } from 'node-html-parser';

/** Inert/dangerous elements always removed before extraction. */
const STRIP_ALWAYS = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe'];
/** Boilerplate removed only when onlyMainContent is on. */
const STRIP_BOILERPLATE = ['nav', 'footer', 'header', 'aside', 'form'];

export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false });
}

function resolveUrl(href: string | undefined, baseUrl: string): string {
  if (!href) return '';
  const t = href.trim();
  if (!t || t.startsWith('javascript:') || t.startsWith('#') || t.startsWith('mailto:')) return '';
  try {
    return new URL(t, baseUrl).toString();
  } catch {
    return '';
  }
}

/** Collect every absolute http(s) link on the page (deduped), before boilerplate stripping. */
export function extractLinks(root: HTMLElement, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const a of root.querySelectorAll('a')) {
    const resolved = resolveUrl(a.getAttribute('href'), baseUrl);
    if (resolved && /^https?:/i.test(resolved)) out.add(resolved);
  }
  return [...out];
}

/** Collect every absolute http(s) image URL on the page (img src/srcset, picture source, meta og:image/twitter:image, icons). */
export function extractImages(root: HTMLElement, baseUrl: string): string[] {
  const out = new Set<string>();
  const addUrl = (raw: string | undefined) => {
    const resolved = resolveUrl(raw, baseUrl);
    if (resolved && /^https?:/i.test(resolved)) out.add(resolved);
  };
  const addSrcset = (srcset: string | undefined) => {
    if (!srcset) return;
    for (const part of srcset.split(',')) {
      const urlPart = part.trim().split(/\s+/)[0];
      if (urlPart) addUrl(urlPart);
    }
  };

  for (const img of root.querySelectorAll('img')) {
    addUrl(img.getAttribute('src'));
    addUrl(img.getAttribute('data-src'));
    addUrl(img.getAttribute('data-lazy-src'));
    addSrcset(img.getAttribute('srcset'));
    addSrcset(img.getAttribute('data-srcset'));
  }
  for (const source of root.querySelectorAll('source')) {
    addSrcset(source.getAttribute('srcset'));
    addUrl(source.getAttribute('src'));
  }
  for (const meta of root.querySelectorAll('meta')) {
    const key = (
      meta.getAttribute('property') ??
      meta.getAttribute('name') ??
      meta.getAttribute('itemprop') ??
      ''
    ).toLowerCase();
    if (
      key === 'og:image' ||
      key === 'og:image:url' ||
      key === 'og:image:secure_url' ||
      key === 'twitter:image' ||
      key === 'twitter:image:src' ||
      key === 'image'
    ) {
      addUrl(meta.getAttribute('content'));
    }
  }
  for (const link of root.querySelectorAll('link')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase();
    if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel === 'image_src') {
      addUrl(link.getAttribute('href'));
    }
  }
  return [...out];
}

/** Extract arbitrary DOM attributes matching CSS selectors (`{ type: 'attributes', selectors }`). */
export function extractAttributes(
  root: HTMLElement,
  selectors: Array<{ selector: string; attribute: string }>,
): Array<{ selector: string; attribute: string; values: string[] }> {
  return selectors.map(({ selector, attribute }) => {
    const values: string[] = [];
    try {
      for (const el of root.querySelectorAll(selector)) {
        const val =
          attribute === 'text' || attribute === 'textContent' || attribute === 'innerText'
            ? el.text.trim()
            : el.getAttribute(attribute);
        if (val !== undefined && val !== null && val !== '') values.push(val);
      }
    } catch {
      /* ignore invalid selector */
    }
    return { selector, attribute, values };
  });
}

/** Extract structured branding signals (logo, favicon, colors, fonts, brand name) from HTML. */
export function extractBranding(
  root: HTMLElement,
  baseUrl: string,
  meta: { title?: string; ogSiteName?: string; favicon?: string; ogImage?: string },
): Record<string, unknown> {
  const themeColor =
    root.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '#00E5FF';
  let logoUrl: string | undefined;
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const alt = (img.getAttribute('alt') ?? '').toLowerCase();
    const cls = (img.getAttribute('class') ?? '').toLowerCase();
    if (
      src &&
      (src.toLowerCase().includes('logo') || alt.includes('logo') || cls.includes('logo'))
    ) {
      logoUrl = resolveUrl(src, baseUrl) || undefined;
      if (logoUrl) break;
    }
  }
  return {
    brandName: meta.ogSiteName ?? meta.title ?? new URL(baseUrl).hostname,
    logo: logoUrl ?? meta.favicon ?? meta.ogImage ?? null,
    favicon: meta.favicon ?? null,
    colors: {
      primary: themeColor,
      background: '#ffffff',
      textPrimary: '#111111',
    },
    typography: {
      fontFamilies: { primary: 'sans-serif' },
    },
  };
}

function textLength(el: HTMLElement): number {
  return (el.text ?? '').replace(/\s+/g, ' ').trim().length;
}

function linkDensity(el: HTMLElement): number {
  const total = textLength(el);
  if (!total) return 1;
  const linkText = el.querySelectorAll('a').reduce((n, a) => n + textLength(a), 0);
  return linkText / total;
}

function scoreCandidate(el: HTMLElement): number {
  const paragraphs = el.querySelectorAll('p').length;
  return textLength(el) * (1 - linkDensity(el)) + paragraphs * 30;
}

export interface SelectOptions {
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
}

/**
 * Choose the content subtree to convert. Mutates `root` (removes inert + boilerplate),
 * so call extractLinks/extractMetadata on `root` BEFORE this. Readability-lite: prefer
 * <main>/<article>, else the highest text-density container.
 */
export function selectContent(root: HTMLElement, opts: SelectOptions): HTMLElement {
  for (const sel of STRIP_ALWAYS) for (const el of root.querySelectorAll(sel)) el.remove();
  const body = root.querySelector('body') ?? root;

  if (opts.excludeTags?.length) {
    for (const sel of opts.excludeTags) {
      try {
        for (const el of body.querySelectorAll(sel)) el.remove();
      } catch {
        /* invalid selector — ignore */
      }
    }
  }

  if (opts.includeTags?.length) {
    const container = parse('<div id="crawl-cheap-root"></div>').querySelector(
      '#crawl-cheap-root',
    )!;
    for (const sel of opts.includeTags) {
      try {
        for (const el of body.querySelectorAll(sel)) container.appendChild(el);
      } catch {
        /* ignore */
      }
    }
    if (textLength(container) > 0) return container;
  }

  if (opts.onlyMainContent === false) return body;

  for (const sel of STRIP_BOILERPLATE) for (const el of body.querySelectorAll(sel)) el.remove();

  const semantic = body.querySelector('main') ?? body.querySelector('article');
  if (semantic && textLength(semantic) > 200) return semantic;

  let best = body;
  let bestScore = scoreCandidate(body);
  for (const el of body.querySelectorAll('article, main, section, div')) {
    const s = scoreCandidate(el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return best;
}
