/**
 * @file components-registry.ts
 * @brief Unified component registry so a build/consumer can NATURALLY SELECT any blog component.
 *
 * The blog package historically exposed TWO dispatchers — `renderWidget(type, data)` (14 content
 * widgets in `widgets.ts`) and `renderMedia(type, data)` (3 media widgets in `media.ts`) — plus a
 * set of standalone renderers in `multimedia.ts` / `elements.ts` that were NOT reachable from any
 * dispatcher (responsive-picture, cf-stream-embed, interactive-code-block, callout-block,
 * breadcrumbs, audio-narration, author-bio, social-share, reading-progress, related-articles-grid,
 * og-card-svg, custom-element). This module indexes EVERY one of them under a stable string key so
 * the render pipeline can enumerate + select the full catalog, not just the markdown widgets.
 *
 * Contract: every registered component is a `(data: unknown) => string` renderer (the two legacy
 * `(type, data)` dispatchers are adapted to this shape). `renderComponent(type, data)` dispatches;
 * `COMPONENT_TYPES` lists every key; `ALL_BLOG_CSS` is the single combined stylesheet that covers
 * every component; `BLOG_COMPONENT_MANIFEST` documents each key. `renderWidget` / `renderMedia`
 * keep working unchanged (full back-compat) — this is a superset, not a replacement.
 *
 * Zero-dependency HTML-string SSR, matching `widgets.ts` / `media.ts` house style.
 */
import { WIDGET_TYPES, WIDGET_CSS, renderWidget, } from "./widgets.js";
import { MEDIA_WIDGET_TYPES, MEDIA_CSS, renderMedia, } from "./media.js";
import { renderResponsivePicture, renderCloudflareStreamEmbed, renderInteractiveCodeBlock, renderCalloutBlock, renderBreadcrumbs, renderAudioNarrationPlayer, renderAuthorBioCard, renderSocialShareBar, renderReadingProgressBar, renderRelatedArticlesGrid, renderOpenGraphCardSvg, } from "./multimedia.js";
import { renderCustomElementShadowDom, } from "./elements.js";
/** Thrown for an unknown component key. */
export class ComponentError extends Error {
    constructor(message) {
        super(message);
        this.name = "ComponentError";
    }
}
// ---------------------------------------------------------------------------
// Adapters — normalize the two `(type, data)` dispatchers to `(data) => string`
// by currying the type. The standalone multimedia/elements renderers already take
// a single argument, so they register directly (cast to the uniform contract).
// ---------------------------------------------------------------------------
function widgetEntry(type, description) {
    return {
        render: (data) => renderWidget(type, data),
        cssVar: "WIDGET_CSS",
        module: "widgets",
        description,
    };
}
function mediaEntry(type, description) {
    return {
        render: (data) => renderMedia(type, data),
        cssVar: "MEDIA_CSS",
        module: "media",
        description,
    };
}
const WIDGET_DESCRIPTIONS = {
    callout: "Coloured note/aside (info · warning · success · tip).",
    takeaways: "Key-takeaways bullet summary box.",
    comparison: "Side-by-side comparison table of options.",
    steps: "Ordered how-to step sequence.",
    faq: "Accessible Q&A accordion (FAQPage-ready).",
    timeline: "Vertical dated timeline of events/milestones.",
    "stat-cards": "Grid of headline stat cards (value + label).",
    "pros-cons": "Two-column pros vs cons list.",
    glossary: "Term → definition glossary list.",
    pullquote: "Emphasised pull-quote with optional attribution.",
    "platform-tabs": "Tabbed per-platform content (Windows/macOS/Linux).",
    "spec-table": "Technical specification key/value table.",
    scorecard: "Weighted scorecard with criteria + overall rating.",
    accordion: "Generic expand/collapse accordion of sections.",
    pricing: "Pricing-tier card (tier + price + features + optional CTA).",
    cta: "Call-to-action card (title + body + primary/secondary action buttons).",
    "link-card": "Whole-card link (title + optional description + badge).",
};
const MEDIA_DESCRIPTIONS = {
    featured: "Hero / featured image with optional caption (CLS-safe 1200×630).",
    gallery: "Lightbox-ready responsive image gallery grid.",
    "video-browser": "Tabbed YouTube video browser with click-to-play facades.",
};
// ---------------------------------------------------------------------------
// The registry — EVERY reachable blog component, indexed by stable string key.
// ---------------------------------------------------------------------------
export const BLOG_COMPONENTS = {
    // --- 14 content widgets (widgets.ts, via renderWidget) ---
    ...Object.fromEntries(WIDGET_TYPES.map((t) => [t, widgetEntry(t, WIDGET_DESCRIPTIONS[t])])),
    // --- 3 media widgets (media.ts, via renderMedia) ---
    ...Object.fromEntries(MEDIA_WIDGET_TYPES.map((t) => [t, mediaEntry(t, MEDIA_DESCRIPTIONS[t])])),
    // --- Standalone multimedia renderers (previously UNWIRED) ---
    "responsive-picture": {
        render: (d) => renderResponsivePicture(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "AVIF/WebP responsive <picture> with aspect-ratio CLS guard + optional caption.",
    },
    "cf-stream-embed": {
        render: (d) => renderCloudflareStreamEmbed(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Cloudflare Stream video embed with optional transcript disclosure.",
    },
    "code-block": {
        render: (d) => renderInteractiveCodeBlock(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Syntax-labelled code block with filename + language header.",
    },
    "callout-block": {
        render: (d) => renderCalloutBlock(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Rich inline-HTML callout (info · tip · warning · alert · key-takeaways).",
    },
    breadcrumbs: {
        render: (d) => renderBreadcrumbs(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "schema.org BreadcrumbList trail (accepts a BreadcrumbItem[]).",
    },
    "audio-narration": {
        render: (d) => renderAudioNarrationPlayer(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Listen-to-this-article audio player with transcript/download links.",
    },
    "author-bio": {
        render: (d) => renderAuthorBioCard(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Author bio card with avatar + sameAs entity badges (ORCID/GitHub/etc).",
    },
    "social-share": {
        render: (d) => renderSocialShareBar(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Share-this-post bar (X · LinkedIn · Hacker News).",
    },
    "reading-progress": {
        render: (_d) => renderReadingProgressBar(),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Scroll-driven reading-progress bar (CSS scroll timeline; ignores data).",
    },
    "related-articles-grid": {
        render: (d) => renderRelatedArticlesGrid(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Topic-cluster related-articles card grid (accepts a RelatedArticleConfig[]).",
    },
    "og-card-svg": {
        render: (d) => renderOpenGraphCardSvg(d),
        cssVar: "SELF_CONTAINED",
        module: "multimedia",
        description: "Branded 1200×630 Open Graph card as inline SVG.",
    },
    // --- Custom element shadow DOM (elements.ts, previously UNWIRED) ---
    "article-reader": {
        render: (d) => renderCustomElementShadowDom(d),
        cssVar: "SELF_CONTAINED",
        module: "elements",
        description: "<tt-article-reader> shadow-DOM reader shell with table-of-contents.",
    },
};
/** Every component key the build can enumerate + select from. */
export const COMPONENT_TYPES = Object.keys(BLOG_COMPONENTS);
/** True when `type` is a registered blog component key. */
export function isComponentType(type) {
    return Object.prototype.hasOwnProperty.call(BLOG_COMPONENTS, type);
}
/**
 * Dispatch to ANY registered blog component by its stable key.
 *
 * Covers the full catalog — the 14 content widgets, the 3 media widgets, every previously-unwired
 * multimedia renderer, and the custom-element shell — through one entry point, so a build can
 * "naturally select" from `COMPONENT_TYPES` rather than being limited to the markdown widgets.
 *
 * @throws {ComponentError} on an unknown key. The underlying renderer may additionally throw its
 *   own validation error (e.g. `WidgetError`) on an invalid/empty data shape — those propagate.
 */
export function renderComponent(type, data) {
    const entry = BLOG_COMPONENTS[type];
    if (!entry) {
        throw new ComponentError(`Unknown component "${type}". Expected one of: ${COMPONENT_TYPES.join(", ")}`);
    }
    return entry.render(data);
}
/**
 * One combined stylesheet covering EVERY registered component. Self-contained renderers
 * (multimedia/elements) ship their styles inline in their own markup, so the only shared
 * sheets a consumer must inject once are `WIDGET_CSS` + `MEDIA_CSS`; concatenating them here
 * means a consumer injects ONE `<style>` and gets the full catalog styled.
 */
export const ALL_BLOG_CSS = `${WIDGET_CSS}\n${MEDIA_CSS}`;
/** The individual shared stylesheets, in case a consumer wants to inject them separately. */
export const BLOG_CSS_PARTS = [WIDGET_CSS, MEDIA_CSS];
/**
 * Exported manifest the build "naturally selects" from — every component key, its source module,
 * which stylesheet covers it, and a one-line description. Stable + deterministic (insertion order).
 */
export const BLOG_COMPONENT_MANIFEST = COMPONENT_TYPES.map((type) => {
    const e = BLOG_COMPONENTS[type];
    return { type, module: e.module, cssVar: e.cssVar, description: e.description };
});
export const BLOG_COMPONENTS_REGISTRY_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "components-registry",
    backCompatRenderWidget: true,
    backCompatRenderMedia: true,
    requiresCloudflareContainers: false,
};
//# sourceMappingURL=components-registry.js.map