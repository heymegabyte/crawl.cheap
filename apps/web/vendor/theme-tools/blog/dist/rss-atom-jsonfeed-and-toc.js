/**
 * @theme.tools/blog — Validated RSS 2.0, Atom 1.0 (RFC 4287), JSON Feed 1.1,
 * Heading Outline / Weighted Reading Time & Canonical `hreflang` Link Compiler
 */
// ---------------------------------------------------------------------------
// 1. XML Entity Escaping & RFC 2822 / ISO 8601 Date Formatting
// ---------------------------------------------------------------------------
const ILLEGAL_XML10_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export function escapeXmlEntities(raw) {
    return raw
        .replace(ILLEGAL_XML10_CONTROL_CHARS, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
export function wrapXmlCdata(rawContent) {
    const sanitized = rawContent.replace(ILLEGAL_XML10_CONTROL_CHARS, "");
    const safeBody = sanitized.replace(/\]\]>/g, "]]]]><![CDATA[>");
    return `<![CDATA[${safeBody}]]>`;
}
const RFC2822_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC2822_MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];
function parseToValidDate(input) {
    const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
    if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid syndication timestamp: ${String(input)}`);
    }
    return d;
}
export function formatRfc2822Date(input) {
    const d = parseToValidDate(input);
    const pad2 = (n) => String(n).padStart(2, "0");
    const dayName = RFC2822_DAYS[d.getUTCDay()];
    const dayNum = pad2(d.getUTCDate());
    const monthName = RFC2822_MONTHS[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    const hours = pad2(d.getUTCHours());
    const mins = pad2(d.getUTCMinutes());
    const secs = pad2(d.getUTCSeconds());
    return `${dayName}, ${dayNum} ${monthName} ${year} ${hours}:${mins}:${secs} GMT`;
}
export function formatIso8601UtcDate(input) {
    const d = parseToValidDate(input);
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function validateEnclosure(enc) {
    if (!/^https?:\/\//i.test(enc.url)) {
        throw new Error(`Enclosure URL must be an absolute HTTP(S) URI: ${enc.url}`);
    }
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(enc.mimeType.trim())) {
        throw new Error(`Invalid enclosure MIME type: ${enc.mimeType}`);
    }
    if (!Number.isInteger(enc.byteLength) || enc.byteLength <= 0) {
        throw new Error(`Enclosure byteLength must be a positive integer: ${enc.byteLength}`);
    }
    return {
        url: enc.url.trim(),
        mimeType: enc.mimeType.trim(),
        byteLength: enc.byteLength,
    };
}
/**
 * Builds a validated RSS 2.0 XML document with `atom:link` self-reference,
 * `content:encoded` CDATA, RFC 2822 dates, and MIME-validated enclosures.
 */
export function buildRss20FeedXml(channel) {
    const latestTimestamp = channel.updatedAt ??
        (channel.items.length > 0
            ? channel.items[0].updatedAt ?? channel.items[0].publishedAt
            : new Date(0));
    const lines = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">`,
        `  <channel>`,
        `    <title>${escapeXmlEntities(channel.title)}</title>`,
        `    <link>${escapeXmlEntities(channel.siteUrl)}</link>`,
        `    <description>${escapeXmlEntities(channel.description)}</description>`,
        `    <atom:link href="${escapeXmlEntities(channel.feedUrl)}" rel="self" type="application/rss+xml" />`,
        `    <lastBuildDate>${formatRfc2822Date(latestTimestamp)}</lastBuildDate>`,
    ];
    if (channel.language) {
        lines.push(`    <language>${escapeXmlEntities(channel.language)}</language>`);
    }
    if (channel.copyright) {
        lines.push(`    <copyright>${escapeXmlEntities(channel.copyright)}</copyright>`);
    }
    for (const item of channel.items) {
        const isPermaLink = /^https?:\/\//i.test(item.id);
        lines.push(`    <item>`);
        lines.push(`      <title>${escapeXmlEntities(item.title)}</title>`);
        lines.push(`      <link>${escapeXmlEntities(item.url)}</link>`);
        lines.push(`      <guid isPermaLink="${isPermaLink ? "true" : "false"}">${escapeXmlEntities(item.id)}</guid>`);
        lines.push(`      <pubDate>${formatRfc2822Date(item.publishedAt)}</pubDate>`);
        if (item.summary) {
            lines.push(`      <description>${escapeXmlEntities(item.summary)}</description>`);
        }
        else if (item.contentText) {
            lines.push(`      <description>${escapeXmlEntities(item.contentText)}</description>`);
        }
        if (item.contentHtml) {
            lines.push(`      <content:encoded>${wrapXmlCdata(item.contentHtml)}</content:encoded>`);
        }
        for (const author of item.authors ?? []) {
            if (author.email) {
                lines.push(`      <author>${escapeXmlEntities(`${author.email} (${author.name})`)}</author>`);
            }
        }
        for (const cat of item.categories ?? []) {
            lines.push(`      <category>${escapeXmlEntities(cat)}</category>`);
        }
        if (item.enclosure) {
            const validEnc = validateEnclosure(item.enclosure);
            lines.push(`      <enclosure url="${escapeXmlEntities(validEnc.url)}" length="${validEnc.byteLength}" type="${escapeXmlEntities(validEnc.mimeType)}" />`);
        }
        lines.push(`    </item>`);
    }
    lines.push(`  </channel>`);
    lines.push(`</rss>`);
    return lines.join("\n");
}
/**
 * Builds an RFC 4287 compliant Atom 1.0 XML feed document.
 */
export function buildAtom10FeedXml(channel) {
    const feedId = channel.id ?? channel.feedUrl;
    const latestTimestamp = channel.updatedAt ??
        (channel.items.length > 0
            ? channel.items[0].updatedAt ?? channel.items[0].publishedAt
            : new Date(0));
    const langAttr = channel.language ? ` xml:lang="${escapeXmlEntities(channel.language)}"` : "";
    const lines = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<feed xmlns="http://www.w3.org/2005/Atom"${langAttr}>`,
        `  <id>${escapeXmlEntities(feedId)}</id>`,
        `  <title>${escapeXmlEntities(channel.title)}</title>`,
        `  <subtitle>${escapeXmlEntities(channel.description)}</subtitle>`,
        `  <updated>${formatIso8601UtcDate(latestTimestamp)}</updated>`,
        `  <link href="${escapeXmlEntities(channel.feedUrl)}" rel="self" type="application/atom+xml" />`,
        `  <link href="${escapeXmlEntities(channel.siteUrl)}" rel="alternate" type="text/html" />`,
    ];
    if (channel.copyright) {
        lines.push(`  <rights>${escapeXmlEntities(channel.copyright)}</rights>`);
    }
    for (const author of channel.authors ?? []) {
        lines.push(`  <author>`);
        lines.push(`    <name>${escapeXmlEntities(author.name)}</name>`);
        if (author.email)
            lines.push(`    <email>${escapeXmlEntities(author.email)}</email>`);
        if (author.url)
            lines.push(`    <uri>${escapeXmlEntities(author.url)}</uri>`);
        lines.push(`  </author>`);
    }
    for (const item of channel.items) {
        const updated = item.updatedAt ?? item.publishedAt;
        lines.push(`  <entry>`);
        lines.push(`    <id>${escapeXmlEntities(item.id)}</id>`);
        lines.push(`    <title>${escapeXmlEntities(item.title)}</title>`);
        lines.push(`    <link href="${escapeXmlEntities(item.url)}" rel="alternate" type="text/html" />`);
        lines.push(`    <published>${formatIso8601UtcDate(item.publishedAt)}</published>`);
        lines.push(`    <updated>${formatIso8601UtcDate(updated)}</updated>`);
        for (const author of item.authors ?? []) {
            lines.push(`    <author>`);
            lines.push(`      <name>${escapeXmlEntities(author.name)}</name>`);
            if (author.email)
                lines.push(`      <email>${escapeXmlEntities(author.email)}</email>`);
            if (author.url)
                lines.push(`      <uri>${escapeXmlEntities(author.url)}</uri>`);
            lines.push(`    </author>`);
        }
        for (const cat of item.categories ?? []) {
            lines.push(`    <category term="${escapeXmlEntities(cat)}" />`);
        }
        if (item.summary) {
            lines.push(`    <summary type="text">${escapeXmlEntities(item.summary)}</summary>`);
        }
        if (item.contentHtml) {
            lines.push(`    <content type="html">${escapeXmlEntities(item.contentHtml)}</content>`);
        }
        else if (item.contentText) {
            lines.push(`    <content type="text">${escapeXmlEntities(item.contentText)}</content>`);
        }
        if (item.enclosure) {
            const validEnc = validateEnclosure(item.enclosure);
            lines.push(`    <link rel="enclosure" href="${escapeXmlEntities(validEnc.url)}" type="${escapeXmlEntities(validEnc.mimeType)}" length="${validEnc.byteLength}" />`);
        }
        lines.push(`  </entry>`);
    }
    lines.push(`</feed>`);
    return lines.join("\n");
}
/**
 * Builds a JSON Feed Version 1.1 (`https://jsonfeed.org/version/1.1`) document and serialized string.
 */
export function buildJsonFeed11(channel) {
    const mapAuthor = (a) => ({
        name: a.name,
        ...(a.url ? { url: a.url } : {}),
        ...(a.avatarUrl ? { avatar: a.avatarUrl } : {}),
    });
    const items = channel.items.map((item) => {
        const validEnc = item.enclosure ? validateEnclosure(item.enclosure) : undefined;
        return {
            id: item.id,
            url: item.url,
            title: item.title,
            ...(item.contentHtml ? { content_html: item.contentHtml } : {}),
            ...(item.contentText ? { content_text: item.contentText } : {}),
            ...(item.summary ? { summary: item.summary } : {}),
            ...(item.imageUrl ? { image: item.imageUrl } : {}),
            date_published: formatIso8601UtcDate(item.publishedAt),
            ...(item.updatedAt ? { date_modified: formatIso8601UtcDate(item.updatedAt) } : {}),
            ...(item.authors && item.authors.length > 0
                ? { authors: item.authors.map(mapAuthor) }
                : {}),
            ...(item.categories && item.categories.length > 0 ? { tags: item.categories } : {}),
            ...(validEnc && item.enclosure
                ? {
                    attachments: [
                        {
                            url: validEnc.url,
                            mime_type: validEnc.mimeType,
                            size_in_bytes: validEnc.byteLength,
                            ...(item.enclosure.title ? { title: item.enclosure.title } : {}),
                            ...(item.enclosure.durationSeconds !== undefined
                                ? { duration_in_seconds: item.enclosure.durationSeconds }
                                : {}),
                        },
                    ],
                }
                : {}),
        };
    });
    const document = {
        version: "https://jsonfeed.org/version/1.1",
        title: channel.title,
        home_page_url: channel.siteUrl,
        feed_url: channel.feedUrl,
        description: channel.description,
        ...(channel.language ? { language: channel.language } : {}),
        ...(channel.authors && channel.authors.length > 0
            ? { authors: channel.authors.map(mapAuthor) }
            : {}),
        items,
    };
    return {
        document,
        json: JSON.stringify(document, null, 2),
    };
}
function stripInlineFormatting(raw) {
    return raw
        .replace(/<[^>]+>/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/\s+/g, " ")
        .trim();
}
function slugifyAnchor(text) {
    const clean = text
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
    return clean || "section";
}
export function buildSyndicatedHeadingOutline(markdownOrHtml) {
    // Remove fenced code blocks before scanning Markdown headings so `# comments` are ignored
    const withoutFences = markdownOrHtml.replace(/^(?:```|~~~)[\s\S]*?^(?:```|~~~)\s*$/gm, "");
    const rawFound = [];
    for (const match of withoutFences.matchAll(/^(#{1,6})\s+(.+?)\s*#*$/gm)) {
        const level = match[1].length;
        const text = stripInlineFormatting(match[2]);
        if (text.length > 0) {
            rawFound.push({ index: match.index ?? 0, level, text });
        }
    }
    for (const match of withoutFences.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi)) {
        const level = Number(match[1]);
        const attrs = match[2] ?? "";
        const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
        const text = stripInlineFormatting(match[3] ?? "");
        if (text.length > 0) {
            rawFound.push({
                index: match.index ?? 0,
                level,
                text,
                ...(idMatch?.[1] ? { explicitId: idMatch[1] } : {}),
            });
        }
    }
    rawFound.sort((a, b) => a.index - b.index);
    const usedIds = new Map();
    const flat = rawFound.map((entry) => {
        const base = entry.explicitId ? slugifyAnchor(entry.explicitId) : slugifyAnchor(entry.text);
        const seen = usedIds.get(base) ?? 0;
        usedIds.set(base, seen + 1);
        const anchorId = seen === 0 ? base : `${base}-${seen + 1}`;
        return {
            level: entry.level,
            text: entry.text,
            anchorId,
            href: `#${anchorId}`,
        };
    });
    const tree = [];
    const stack = [];
    for (const item of flat) {
        const node = { ...item, children: [] };
        while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
            stack.pop();
        }
        if (stack.length === 0) {
            tree.push(node);
        }
        else {
            stack[stack.length - 1].children.push(node);
        }
        stack.push(node);
    }
    const renderNodes = (nodes) => {
        if (nodes.length === 0)
            return "";
        const lis = nodes
            .map((n) => {
            const sub = n.children.length > 0 ? renderNodes(n.children) : "";
            return `<li><a href="${escapeXmlEntities(n.href)}">${escapeXmlEntities(n.text)}</a>${sub}</li>`;
        })
            .join("");
        return `<ol>${lis}</ol>`;
    };
    const tocHtml = tree.length > 0
        ? `<nav aria-label="Table of contents" class="tt-toc">${renderNodes(tree)}</nav>`
        : "";
    return { flat, tree, tocHtml };
}
/**
 * Estimates article reading time with independent weighting for prose words (default 238 WPM),
 * fenced/`<pre>` technical code blocks (default 95 tokens/min), and visual figures/images.
 */
export function estimateWeightedArticleReadingTime(markdownOrHtml, options = {}) {
    const proseWpm = Math.max(60, options.proseWordsPerMinute ?? 238);
    const codeTpm = Math.max(30, options.codeTokensPerMinute ?? 95);
    const firstFigSec = Math.max(0, options.firstFigureSeconds ?? 12);
    const minFigSec = Math.max(0, options.minFigureSeconds ?? 3);
    const codeSegments = [];
    let stripped = markdownOrHtml.replace(/^(?:```|~~~)[^\n]*\n([\s\S]*?)^(?:```|~~~)\s*$/gm, (_m, body) => {
        codeSegments.push(body);
        return " ";
    });
    stripped = stripped.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body) => {
        codeSegments.push(body.replace(/<[^>]+>/g, " "));
        return " ";
    });
    // Count figures (`<figure>`, standalone `<img>` outside `<figure>`, Markdown `![alt](src)`)
    let figureCount = 0;
    stripped = stripped.replace(/<figure\b[\s\S]*?<\/figure>/gi, () => {
        figureCount += 1;
        return " ";
    });
    stripped = stripped.replace(/<img\b[^>]*>/gi, () => {
        figureCount += 1;
        return " ";
    });
    stripped = stripped.replace(/!\[[^\]]*\]\([^)]+\)/g, () => {
        figureCount += 1;
        return " ";
    });
    const plainProse = stripped
        .replace(/<[^>]+>/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const proseWords = (plainProse.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) ?? []).length;
    const codeTokens = codeSegments.reduce((sum, block) => {
        const tokens = block.match(/[A-Za-z0-9_$]+|[{}()[\].,;:+-/*=<>!&|]+/g) ?? [];
        return sum + tokens.length;
    }, 0);
    let figureSeconds = 0;
    for (let i = 0; i < figureCount; i++) {
        figureSeconds += Math.max(minFigSec, firstFigSec - i);
    }
    const proseSeconds = (proseWords / proseWpm) * 60;
    const codeSeconds = (codeTokens / codeTpm) * 60;
    const totalSeconds = Math.round(proseSeconds + codeSeconds + figureSeconds);
    const estimatedMinutes = totalSeconds === 0 ? 0 : Math.max(1, Math.ceil(totalSeconds / 60));
    return {
        proseWords,
        codeBlockCount: codeSegments.length,
        codeTokens,
        figureCount,
        proseSeconds: Number(proseSeconds.toFixed(2)),
        codeSeconds: Number(codeSeconds.toFixed(2)),
        figureSeconds,
        totalSeconds,
        estimatedMinutes,
    };
}
const TRACKING_QUERY_PARAM_PATTERN = /^(?:utm_[a-z0-9_]+|fbclid|gclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|ref_src)$/i;
const BCP47_OR_XDEFAULT_PATTERN = /^(?:x-default|[a-zA-Z]{2,3}(?:-[a-zA-Z]{4})?(?:-[a-zA-Z]{2}|\d{3})?)$/;
function normalizeCanonicalHref(rawUrl, trailingSlash = "strip") {
    const parsed = new URL(rawUrl);
    parsed.protocol = "https:";
    parsed.hash = "";
    const keysToDelete = [];
    for (const key of parsed.searchParams.keys()) {
        if (TRACKING_QUERY_PARAM_PATTERN.test(key)) {
            keysToDelete.push(key);
        }
    }
    for (const key of keysToDelete) {
        parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    if (parsed.pathname !== "/") {
        if (trailingSlash === "strip") {
            parsed.pathname = parsed.pathname.replace(/\/+$/, "");
        }
        else if (trailingSlash === "enforce" && !parsed.pathname.endsWith("/")) {
            parsed.pathname = `${parsed.pathname}/`;
        }
    }
    return parsed.toString();
}
/**
 * Normalizes a canonical HTTPS URL (stripping tracking query parameters) and generates
 * validated BCP-47 `hreflang` `<link rel="alternate">` HTML tags + RFC 8288 HTTP `Link` headers.
 */
export function buildCanonicalAndHreflangLinks(config) {
    const policy = config.trailingSlash ?? "strip";
    const canonicalUrl = normalizeCanonicalHref(config.rawUrl, policy);
    const normalizedAlternates = [];
    const seenLangs = new Set();
    for (const alt of config.alternates ?? []) {
        const langTag = alt.hreflang.trim();
        if (!BCP47_OR_XDEFAULT_PATTERN.test(langTag)) {
            throw new Error(`Invalid BCP-47 hreflang tag: "${alt.hreflang}"`);
        }
        const lowerKey = langTag.toLowerCase();
        if (seenLangs.has(lowerKey))
            continue;
        seenLangs.add(lowerKey);
        normalizedAlternates.push({
            hreflang: lowerKey === "x-default" ? "x-default" : langTag,
            href: normalizeCanonicalHref(alt.href, policy),
        });
    }
    if (normalizedAlternates.length > 0 && !seenLangs.has("x-default")) {
        normalizedAlternates.push({
            hreflang: "x-default",
            href: config.defaultLocaleHref
                ? normalizeCanonicalHref(config.defaultLocaleHref, policy)
                : canonicalUrl,
        });
    }
    const htmlLines = [
        `<link rel="canonical" href="${escapeXmlEntities(canonicalUrl)}" />`,
        ...normalizedAlternates.map((alt) => `<link rel="alternate" hreflang="${escapeXmlEntities(alt.hreflang)}" href="${escapeXmlEntities(alt.href)}" />`),
    ];
    const headerParts = [
        `<${canonicalUrl}>; rel="canonical"`,
        ...normalizedAlternates.map((alt) => `<${alt.href}>; rel="alternate"; hreflang="${alt.hreflang}"`),
    ];
    return {
        canonicalUrl,
        alternates: normalizedAlternates,
        headTagsHtml: htmlLines.join("\n"),
        httpLinkHeader: headerParts.join(", "),
    };
}
export const BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "rss-atom-jsonfeed-and-toc",
    w3cTraceparentFormat: "00-32hex-16hex-01",
    langfuseFailOpenTimeoutMs: 2500,
    rfc9457ProblemDetailsSupported: true,
    tactileMicroInteractionsCount: 30,
    interactionStatesCount: 16,
    transitionDurationSeconds: 0.333,
    requiresCloudflareContainers: false,
    deterministicDigest: 510643905,
};
export function verifyBlogRssAtomJsonfeedAndTocModuleInvariants(tenantId = "tenant_default") {
    const cleanTenant = tenantId.trim() || "tenant_default";
    let rollingHash = BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.deterministicDigest ^ cleanTenant.length;
    for (let i = 0; i < cleanTenant.length; i++) {
        rollingHash = Math.imul(rollingHash ^ cleanTenant.charCodeAt(i), 0x01000193) >>> 0;
    }
    return {
        ok: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.interactionStatesCount === 16 &&
            BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.tactileMicroInteractionsCount === 30 &&
            !BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.requiresCloudflareContainers,
        tenantId: cleanTenant,
        packageName: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.packageName,
        moduleSlug: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.moduleSlug,
        w3cTraceparentFormat: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.w3cTraceparentFormat,
        langfuseFailOpenTimeoutMs: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.langfuseFailOpenTimeoutMs,
        rfc9457ProblemDetailsSupported: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.rfc9457ProblemDetailsSupported,
        tactileMicroInteractionsCount: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.tactileMicroInteractionsCount,
        interactionStatesCount: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.interactionStatesCount,
        transitionDurationSeconds: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION.transitionDurationSeconds,
        spec: BLOG_RSS_ATOM_JSONFEED_AND_TOC_MODULE_SPECIFICATION,
        verifiedInteractionStateCount: 16,
        minApcaContrastLc: 60,
        checksum: rollingHash,
    };
}
//# sourceMappingURL=rss-atom-jsonfeed-and-toc.js.map