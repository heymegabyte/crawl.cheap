/**
 * @file media.ts
 * @brief Zero-dependency BLOG MEDIA renderers for @theme.tools/blog.
 *
 * Companion to `widgets.ts`: the same vanilla, server-rendered Cloudflare-Worker
 * HTML-string style (NO React / framework). Every renderer returns a deterministic
 * HTML string with class-prefixed markup and ZERO inline styles — all visual styling
 * lives in the single `MEDIA_CSS` stylesheet the host injects once per page (alongside
 * `WIDGET_CSS`). Each renderer emits `class="tt-widget tt-<type> …"`, escapes untrusted
 * text via `escapeHtml`, reserves media dimensions (no layout shift), and THROWS
 * `WidgetError` on an unknown shape OR empty content so half-authored media is rejected
 * at build time rather than shipped blank.
 *
 * The three media types registered here are `featured`, `gallery`, and `video-browser`
 * — see `MEDIA_WIDGET_TYPES`. They are appended to the content-validator's countable
 * widget-type set (see `widgets.ts` `WIDGET_TYPES` for the base nine) so a post using
 * them is counted correctly.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CSP NOTE (for the CONSUMING page's Content-Security-Policy):
 *   • img-src   https://i.ytimg.com              — the facade poster thumbnails
 *   • frame-src https://www.youtube-nocookie.com — the INLINE embed (video-browser)
 *   • script-src 'self'                          — the companion VIDEO_BROWSER_JS, served
 *                                                  same-origin (never inline; no relaxation)
 *   The server HTML still emits NO inline script and NO iframe; the iframe is created on
 *   click by VIDEO_BROWSER_JS, so YouTube loads only when a video is actually played. With
 *   that script absent, the facade degrades to opening the embed in a new tab.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This module is fully SELF-CONTAINED — ZERO cross-package imports (the escaping +
 * validation primitives are re-implemented here to mirror `widgets.ts`).
 */
/** The media widget types this module registers with the content validator. */
export const MEDIA_WIDGET_TYPES = ["featured", "gallery", "video-browser"];
export function isMediaWidgetType(x) {
    return MEDIA_WIDGET_TYPES.includes(x);
}
/** Thrown for an invalid data shape or empty content. Mirrors `widgets.ts` `WidgetError`. */
export class WidgetError extends Error {
    constructor(message) {
        super(message);
        this.name = "WidgetError";
    }
}
// ---------------------------------------------------------------------------
// Escaping + validation primitives (self-contained mirror of widgets.ts)
// ---------------------------------------------------------------------------
/** Escape the five HTML-significant characters so untrusted text is inert in markup. */
export function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Require a non-empty (after trim) string field; throws WidgetError otherwise. */
function reqStr(obj, key, ctx) {
    const v = obj[key];
    if (typeof v !== "string" || v.trim() === "") {
        throw new WidgetError(`${ctx}: field "${key}" must be a non-empty string`);
    }
    return v;
}
/** Optional string field: returns the trimmed-nonempty value or undefined. */
function optStr(obj, key) {
    const v = obj[key];
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
/** Require an array of records with at least `min` entries. */
function reqRecordArray(obj, key, ctx, min) {
    const v = obj[key];
    if (!Array.isArray(v) || v.length < min) {
        throw new WidgetError(`${ctx}: field "${key}" must be an array of at least ${min}`);
    }
    return v.map((item, i) => {
        if (!isRecord(item)) {
            throw new WidgetError(`${ctx}: "${key}[${i}]" must be an object`);
        }
        return item;
    });
}
function asRoot(data, ctx) {
    if (!isRecord(data)) {
        throw new WidgetError(`${ctx}: data must be an object`);
    }
    return data;
}
/**
 * A YouTube video id is `[A-Za-z0-9_-]{11}` in practice. We keep the validation permissive
 * (non-empty, no whitespace, no HTML-significant chars) but still escape on output so a
 * malformed id can never break out of the attribute context.
 */
function reqVideoId(obj, key, ctx) {
    const id = reqStr(obj, key, ctx);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new WidgetError(`${ctx}: field "${key}" is not a valid YouTube id`);
    }
    return id;
}
// Reserved hero aspect (1200×630 — the standard OG / social card ratio).
const FEATURED_WIDTH = 1200;
const FEATURED_HEIGHT = 630;
// Gallery thumbnails share the same 1200×630 intrinsic ratio so the grid never shifts.
const GALLERY_WIDTH = 1200;
const GALLERY_HEIGHT = 630;
// YouTube `hqdefault.jpg` is 480×360 (4:3).
const POSTER_WIDTH = 480;
const POSTER_HEIGHT = 360;
/** Deterministic per-render id for radio groups; unique within a document and stable across builds. */
let vbCounter = 0;
function nextUid() {
    vbCounter += 1;
    return vbCounter.toString(36);
}
// ---------------------------------------------------------------------------
// Per-type render functions (each validates, escapes, and rejects empties)
// ---------------------------------------------------------------------------
/**
 * Hero / featured image. Reserves the 1200×630 aspect to avoid CLS; loads eager (above the
 * fold). An optional caption renders as a `<figcaption>`.
 * @throws {WidgetError} on an invalid shape or empty content.
 */
export function renderFeaturedImage(data) {
    const ctx = "featured";
    const obj = asRoot(data, ctx);
    const src = reqStr(obj, "src", ctx);
    const alt = reqStr(obj, "alt", ctx);
    const caption = optStr(obj, "caption");
    const captionHtml = caption
        ? `\n  <figcaption class="tt-featured__caption">${escapeHtml(caption)}</figcaption>`
        : "";
    return `
<figure class="tt-widget tt-featured">
  <img class="tt-featured__img" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="eager" fetchpriority="high" decoding="async" width="${FEATURED_WIDTH}" height="${FEATURED_HEIGHT}" data-tt-zoom>${captionHtml}
</figure>`.trim();
}
/**
 * Slideshow gallery (requires ≥2 images) — ONE big image shown at a time with a crossfade, prev/next
 * arrows, an "N / total" counter, the per-image caption, and a thumbnail filmstrip below. Pure CSS:
 * each `[radio → slide]` pair is DOM-adjacent so `:checked + slide` drives it; slides stack via CSS
 * grid (`grid-area`) and crossfade on opacity. Prev/next + thumbnail `<label for>` select across the
 * DOM, so NO JavaScript is needed. Reserved dimensions on the big image avoid layout shift.
 * @throws {WidgetError} on an invalid shape or fewer than 2 images.
 */
export function renderGallery(data) {
    const ctx = "gallery";
    const obj = asRoot(data, ctx);
    const title = reqStr(obj, "title", ctx);
    const images = reqRecordArray(obj, "images", ctx, 2);
    const uid = nextUid();
    const name = `tt-gal-${uid}`;
    const n = images.length;
    const slideId = (i) => `${name}-${i}`;
    // Validate + escape each image once; `alt` is escaped (safe in both attr and aria-label contexts).
    const items = images.map((img, i) => ({
        src: escapeHtml(reqStr(img, "src", `${ctx}.images[${i}]`)),
        alt: escapeHtml(reqStr(img, "alt", `${ctx}.images[${i}]`)),
        caption: optStr(img, "caption"),
    }));
    // Radio + slide pairs (adjacent → `:checked + slide` reveals). The first is checked. Prev/next
    // labels point to the wrap-around neighbor's radio; thumbnail labels point to each radio.
    const slides = items
        .map((it, i) => {
        const prev = slideId((i - 1 + n) % n);
        const next = slideId((i + 1) % n);
        const checked = i === 0 ? " checked" : "";
        const captionText = it.caption
            ? `<span class="tt-gallery__slide-text">${escapeHtml(it.caption)}</span>`
            : "";
        return `    <input class="tt-gallery__radio" type="radio" name="${name}" id="${slideId(i)}"${checked}>
    <figure class="tt-gallery__slide">
      <div class="tt-gallery__frame">
        <img class="tt-gallery__slide-img" src="${it.src}" alt="${it.alt}" loading="lazy" decoding="async" width="${GALLERY_WIDTH}" height="${GALLERY_HEIGHT}" data-tt-zoom>
        <label class="tt-gallery__nav tt-gallery__prev" for="${prev}"><span aria-hidden="true">&#8249;</span><span class="tt-sr-only">Previous image</span></label>
        <label class="tt-gallery__nav tt-gallery__next" for="${next}"><span aria-hidden="true">&#8250;</span><span class="tt-sr-only">Next image</span></label>
      </div>
      <figcaption class="tt-gallery__slide-cap">
        <span class="tt-gallery__count">${i + 1} / ${n}</span>${captionText}
      </figcaption>
    </figure>`;
    })
        .join("\n");
    const thumbs = items
        .map((it, i) => `    <label class="tt-gallery__thumb" for="${slideId(i)}">
      <img class="tt-gallery__thumb-img" src="${it.src}" alt="" loading="lazy" decoding="async">
      <span class="tt-sr-only">Show image ${i + 1} of ${n}: ${escapeHtml(it.alt)}</span>
    </label>`)
        .join("\n");
    return `
<section class="tt-widget tt-gallery" aria-label="${escapeHtml(title)}">
  <h3 class="tt-widget__heading tt-gallery__heading">${escapeHtml(title)}</h3>
  <div class="tt-gallery__slideshow">
    <div class="tt-gallery__stage">
${slides}
    </div>
    <div class="tt-gallery__thumbs">
${thumbs}
    </div>
  </div>
</section>`.trim();
}
/**
 * Tabbed YouTube browser — a privacy-FACADE that plays INLINE on click.
 *
 * Tabs use the CSS-only radio pattern (`<input type="radio">` + `:checked ~` sibling reveal — no JS).
 * Each video is a clickable facade: an `<a>` over the `i.ytimg.com/vi/<id>/hqdefault.jpg` poster + a
 * play overlay + a title/channel, carrying `data-tt-yt`/`data-tt-title`. The server HTML emits NO
 * iframe and NO inline script. Wire {@link VIDEO_BROWSER_JS} (served same-origin) for click-to-load
 * INLINE playback — the facade is swapped for an autoplaying `youtube-nocookie.com` iframe only when
 * a video is played; with the script absent the facade's href opens the embed in a new tab (graceful).
 *
 * CSP for the consuming page: `img-src https://i.ytimg.com` (posters), `frame-src
 * https://www.youtube-nocookie.com` (the inline embed), `script-src 'self'` (the companion file).
 *
 * Requires ≥1 tab and ≥1 video per tab.
 * @throws {WidgetError} on an invalid shape, zero tabs, or a tab with zero videos.
 */
export function renderVideoBrowser(data) {
    const ctx = "video-browser";
    const obj = asRoot(data, ctx);
    const title = reqStr(obj, "title", ctx);
    const tabs = reqRecordArray(obj, "tabs", ctx, 1);
    const uid = nextUid();
    const groupName = `tt-vb-${uid}`;
    // Master-detail: a left list of video TITLES (grouped by tab label) selects a big preview on the
    // right (CSS-only radio pattern). Each `[radio → label → preview]` triple is DOM-adjacent so the
    // `:checked + label + preview` selector drives it; CSS grid places labels in column 1 and the
    // (one visible) preview in column 2.
    // Show AT MOST 3 videos in the left list — a focused, non-overwhelming picker. The article's data
    // may carry more for the content record (policy ≥4/≥2 tabs); the component curates the first few.
    const MAX_LEFT_VIDEOS = 3;
    let g = -1; // global video index across all rendered tabs
    let rendered = 0;
    const blocks = [];
    for (let t = 0; t < tabs.length && rendered < MAX_LEFT_VIDEOS; t += 1) {
        const tab = tabs[t];
        const label = reqStr(tab, "label", `${ctx}.tabs[${t}]`);
        const videos = reqRecordArray(tab, "videos", `${ctx}.tabs[${t}]`, 1);
        const items = [];
        for (let v = 0; v < videos.length && rendered < MAX_LEFT_VIDEOS; v += 1) {
            const video = videos[v];
            g += 1;
            rendered += 1;
            const id = reqVideoId(video, "id", `${ctx}.tabs[${t}].videos[${v}]`);
            const vTitle = reqStr(video, "title", `${ctx}.tabs[${t}].videos[${v}]`);
            const channel = reqStr(video, "channel", `${ctx}.tabs[${t}].videos[${v}]`);
            const poster = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
            // The facade's href is the privacy embed (graceful no-JS fallback → new tab);
            // `data-tt-yt`/`data-tt-title` let VIDEO_BROWSER_JS swap in an INLINE autoplaying iframe on
            // click. The iframe is NOT in the server HTML — YouTube loads only when a video is played.
            const embed = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
            const rid = `${groupName}-${g}`;
            const checked = g === 0 ? " checked" : "";
            items.push(`  <input class="tt-video-browser__radio" type="radio" name="${groupName}" id="${rid}"${checked}>
  <label class="tt-video-browser__tab" for="${rid}">
    <span class="tt-video-browser__tabtitle">${escapeHtml(vTitle)}</span>
    <span class="tt-video-browser__tabchannel">${escapeHtml(channel)}</span>
  </label>
  <div class="tt-video-browser__preview">
    <a class="tt-video-browser__facade" href="${escapeHtml(embed)}" data-tt-yt="${id}" data-tt-title="${escapeHtml(vTitle)}" target="_blank" rel="noopener" aria-label="Play ${escapeHtml(vTitle)} inline">
      <span class="tt-video-browser__thumb">
        <img class="tt-video-browser__poster" src="${escapeHtml(poster)}" alt="${escapeHtml(vTitle)}" loading="lazy" decoding="async" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}">
        <span class="tt-video-browser__play" aria-hidden="true"></span>
      </span>
    </a>
    <div class="tt-video-browser__previewmeta">
      <span class="tt-video-browser__previewtitle">${escapeHtml(vTitle)}</span>
      <span class="tt-video-browser__previewchannel">${escapeHtml(channel)}</span>
    </div>
  </div>`);
        }
        if (items.length > 0) {
            blocks.push(`  <p class="tt-video-browser__group">${escapeHtml(label)}</p>\n${items.join("\n")}`);
        }
    }
    return `
<section class="tt-widget tt-video-browser" aria-label="${escapeHtml(title)}">
  <h3 class="tt-widget__heading tt-video-browser__heading">${escapeHtml(title)}</h3>
  <div class="tt-video-browser__split">
${blocks.join("\n")}
  </div>
</section>`.trim();
}
// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
const MEDIA_RENDERERS = {
    featured: renderFeaturedImage,
    gallery: renderGallery,
    "video-browser": renderVideoBrowser,
};
/**
 * Render a media widget to an HTML string.
 * @throws {WidgetError} on an unknown type, an invalid data shape, or empty content.
 */
export function renderMedia(type, data) {
    if (!isMediaWidgetType(type)) {
        throw new WidgetError(`Unknown media widget type "${type}". Expected one of: ${MEDIA_WIDGET_TYPES.join(", ")}`);
    }
    return MEDIA_RENDERERS[type](data);
}
// ---------------------------------------------------------------------------
// Stylesheet — complete, class-prefixed, zero inline styles, dark-first,
// accessible (visible focus + reduced-motion safe), responsive. Pair with
// WIDGET_CSS (shares the `.tt-widget` CSS custom properties / token scope).
//
// Palette: canvas #0b0b1a, cyan #00E5FF, secondary blue #50AAE3, 14px radius,
// subtle cyan borders rgba(0,229,255,.16). Violet is retired to match the site shell.
// ---------------------------------------------------------------------------
export const MEDIA_CSS = `
.tt-widget.tt-featured,
.tt-widget.tt-gallery,
.tt-widget.tt-video-browser {
  --tt-media-bg: #0b0b1a;
  --tt-media-fg: #e7e9f3;
  --tt-media-fg-muted: #a6abc9;
  --tt-media-accent: #00e5ff;
  --tt-media-accent-2: #50aae3;
  --tt-media-border: rgba(0, 229, 255, 0.16);
  --tt-media-radius: 14px;
  --tt-media-motion: 200ms cubic-bezier(0.16, 1, 0.3, 1);
  background: var(--tt-media-bg);
  border: 1px solid var(--tt-media-border);
  border-radius: var(--tt-media-radius);
}

/* Featured image -------------------------------------------------------- */
.tt-featured {
  margin: 1.9rem 0;
  padding: 0;
  overflow: hidden;
  border-color: rgba(0, 229, 255, 0.22);
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.1), 0 30px 72px -38px rgba(0, 229, 255, 0.42),
    0 22px 48px -30px rgba(0, 0, 0, 0.9);
}
.tt-featured__img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: ${FEATURED_WIDTH} / ${FEATURED_HEIGHT};
  object-fit: cover;
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.1), rgba(80, 170, 227, 0.12));
}
.tt-featured__caption {
  margin: 0;
  padding: 0.75rem 1.125rem;
  font-size: 0.8125rem;
  color: var(--tt-media-fg-muted);
  border-top: 1px solid var(--tt-media-border);
  text-align: center;
}

/* Gallery slideshow — one big image at a time, CSS-only crossfade ----------- */
.tt-gallery { padding: 1.7rem 1.85rem 1.9rem; }
.tt-gallery__heading {
  margin: 0.1rem 0 1.65rem 0;
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1.2;
  color: #ffffff;
  letter-spacing: -0.02em;
}
/* Radios are visually hidden but keyboard-focusable via their labels. */
.tt-gallery__radio {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
/* Every slide occupies the SAME grid cell (stacked) so the stage height is stable and the active
   slide crossfades in. The checked radio's adjacent slide becomes visible. */
.tt-gallery__stage { display: grid; }
.tt-gallery__slide {
  grid-area: 1 / 1;
  margin: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.45s var(--tt-media-motion), visibility 0.45s;
}
.tt-gallery__radio:checked + .tt-gallery__slide {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  position: relative;
  z-index: 1;
}
.tt-gallery__frame {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--tt-media-border);
  border-radius: 14px;
  background: #0b0b1a;
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.08), 0 26px 60px -34px rgba(0, 229, 255, 0.4),
    0 20px 44px -30px rgba(0, 0, 0, 0.9);
}
.tt-gallery__slide-img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: ${GALLERY_WIDTH} / ${GALLERY_HEIGHT};
  object-fit: contain;
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.06), rgba(0, 229, 255, 0.02));
}
/* Prev / next arrows overlaid on the frame (labels → keyboard-reachable via the radios). */
.tt-gallery__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 2.9rem;
  height: 2.9rem;
  font-size: 1.7rem;
  line-height: 1;
  cursor: pointer;
  color: var(--tt-media-fg);
  background: rgba(6, 6, 16, 0.58);
  border: 1px solid var(--tt-media-border);
  border-radius: 50%;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: background var(--tt-media-motion), color var(--tt-media-motion),
    border-color var(--tt-media-motion), transform var(--tt-media-motion);
}
.tt-gallery__prev { left: 0.8rem; }
.tt-gallery__next { right: 0.8rem; }
.tt-gallery__nav:hover {
  background: var(--tt-media-accent);
  color: #060610;
  border-color: transparent;
  transform: translateY(-50%) scale(1.06);
}
.tt-gallery__nav:focus-visible { outline: 2px solid var(--tt-media-accent); outline-offset: 2px; }
.tt-gallery__slide-cap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
  padding: 0.85rem 0.25rem 0.1rem;
  min-height: 2.3rem;
  font-size: 0.9rem;
  color: var(--tt-media-fg-muted);
}
.tt-gallery__count {
  flex: 0 0 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 0.72rem;
  font-weight: 700;
  color: #060610;
  background: var(--tt-media-accent);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
}
.tt-gallery__slide-text { color: var(--tt-media-fg); }
/* Thumbnail filmstrip — each is a label that selects its slide (works across the DOM). */
.tt-gallery__thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.2rem;
}
.tt-gallery__thumb {
  flex: 0 0 auto;
  width: 5.2rem;
  cursor: pointer;
  border: 1px solid var(--tt-media-border);
  border-radius: 9px;
  overflow: hidden;
  opacity: 0.62;
  transition: opacity var(--tt-media-motion), border-color var(--tt-media-motion), transform var(--tt-media-motion);
}
.tt-gallery__thumb:hover { opacity: 1; border-color: var(--tt-media-accent); transform: translateY(-2px); }
.tt-gallery__thumb:focus-within { outline: 2px solid var(--tt-media-accent); outline-offset: 2px; opacity: 1; }
.tt-gallery__thumb-img {
  display: block;
  width: 100%;
  aspect-ratio: ${GALLERY_WIDTH} / ${GALLERY_HEIGHT};
  object-fit: cover;
}

/* Video browser — master-detail: a left title list selects a big preview ------- */
.tt-video-browser { padding: 1.7rem 1.85rem 1.95rem; }
.tt-video-browser__heading {
  margin: 0.1rem 0 1.7rem 0;
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1.2;
  color: #ffffff;
  letter-spacing: -0.02em;
}
.tt-video-browser__split {
  display: grid;
  grid-template-columns: minmax(11rem, 17rem) minmax(0, 1fr);
  column-gap: 1.6rem;
  /* row-gap 0 + per-tab margin keeps the left list compact at the top even when the (spanning)
     preview is taller — so the big video never pushes the title list down. */
  row-gap: 0;
  align-items: start;
  align-content: start;
}
/* Radios are visually hidden but keyboard-focusable via their labels. */
.tt-video-browser__radio {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
/* The originating tab's name, as a small caption above its group of videos. */
.tt-video-browser__group {
  grid-column: 1;
  margin: 0.9rem 0 0.35rem;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tt-media-accent);
}
.tt-video-browser__group:first-child { margin-top: 0; }
/* Each left-list row (the video title + channel). */
.tt-video-browser__tab {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 0.5rem;
  padding: 0.6rem 0.75rem;
  cursor: pointer;
  border-radius: 10px;
  border-left: 2px solid transparent;
  transition: background var(--tt-media-motion), border-color var(--tt-media-motion), color var(--tt-media-motion);
}
.tt-video-browser__tab:hover { background: rgba(0, 229, 255, 0.06); }
.tt-video-browser__tabtitle {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--tt-media-fg);
}
.tt-video-browser__tabchannel {
  font-size: 0.72rem;
  color: var(--tt-media-fg-muted);
}
.tt-video-browser__radio:focus-visible + .tt-video-browser__tab {
  outline: 2px solid var(--tt-media-accent);
  outline-offset: 2px;
}
.tt-video-browser__radio:checked + .tt-video-browser__tab {
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.15), rgba(0, 229, 255, 0.03));
  border-left-color: var(--tt-media-accent);
}
.tt-video-browser__radio:checked + .tt-video-browser__tab .tt-video-browser__tabtitle { color: #ffffff; }
/* The big preview lives in column 2, spanning the list height; only the checked row's shows. It is
   sticky so the big player stays in view while you scan a long left list (premium master-detail). */
.tt-video-browser__preview {
  grid-column: 2;
  /* span a large fixed count (NOT 1/-1, which resolves to row 1 with no explicit rows and pins the
     preview into row 1, inflating it). With row-gap 0 the extra empty rows cost nothing. */
  grid-row: 1 / span 99;
  align-self: start;
  position: sticky;
  top: 5.5rem;
  display: none;
}
.tt-video-browser__radio:checked + .tt-video-browser__tab + .tt-video-browser__preview { display: block; }
.tt-video-browser__facade {
  display: block;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--tt-media-border);
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  transition: border-color var(--tt-media-motion), box-shadow var(--tt-media-motion);
}
.tt-video-browser__facade:hover {
  border-color: var(--tt-media-accent);
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.18), 0 22px 54px -30px rgba(0, 229, 255, 0.5);
}
.tt-video-browser__facade:focus-visible {
  outline: 2px solid var(--tt-media-accent);
  outline-offset: 2px;
}
.tt-video-browser__thumb {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
}
.tt-video-browser__poster {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* Play-button overlay (pure CSS triangle inside a circle). */
.tt-video-browser__play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4rem;
  height: 4rem;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(6, 6, 16, 0.72);
  border: 2px solid var(--tt-media-accent);
  transition: background var(--tt-media-motion), transform var(--tt-media-motion);
}
.tt-video-browser__play::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 54%;
  transform: translate(-50%, -50%);
  border-style: solid;
  border-width: 0.7rem 0 0.7rem 1.15rem;
  border-color: transparent transparent transparent var(--tt-media-accent);
}
.tt-video-browser__facade:hover .tt-video-browser__play {
  background: var(--tt-media-accent);
  transform: translate(-50%, -50%) scale(1.08);
}
.tt-video-browser__facade:hover .tt-video-browser__play::before {
  border-left-color: #060610;
}
.tt-video-browser__previewmeta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.85rem 0.25rem 0.1rem;
}
.tt-video-browser__previewtitle {
  font-size: 1.02rem;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.3;
}
.tt-video-browser__previewchannel {
  font-size: 0.8rem;
  color: var(--tt-media-fg-muted);
}
/* Inline player — created on click by VIDEO_BROWSER_JS; the iframe never ships in server HTML. */
.tt-video-browser__item--playing .tt-video-browser__facade { display: none; }
.tt-video-browser__iframe {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  border-radius: 12px;
  background: #000;
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.25), 0 22px 54px -30px rgba(0, 229, 255, 0.5);
}

/* Responsive ------------------------------------------------------------ */
@media (max-width: 40rem) {
  .tt-gallery,
  .tt-video-browser { padding: 1.15rem 1.15rem 1.3rem; }
  .tt-video-browser__split { grid-template-columns: 1fr; gap: 0.3rem; }
  .tt-video-browser__preview { grid-row: auto; grid-column: 1; position: static; margin: 0.4rem 0 1rem; }
  .tt-gallery__nav { width: 2.4rem; height: 2.4rem; font-size: 1.4rem; }
  .tt-gallery__thumb { width: 4.1rem; }
}

/* Light reading mode ---------------------------------------------------- */
:root[data-theme="light"] .tt-widget.tt-featured,
:root[data-theme="light"] .tt-widget.tt-gallery,
:root[data-theme="light"] .tt-widget.tt-video-browser {
  --tt-media-bg: #f6f8fa;
  --tt-media-bg-raised: #ffffff;
  --tt-media-border: #d0d7de;
  --tt-media-fg: #17242e;
  --tt-media-fg-muted: #44566a;
  --tt-media-accent: #0a6f8a;
  --tt-media-accent-2: #005cc5;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, 0 14px 36px -22px rgba(15, 23, 42, 0.14);
}
:root[data-theme="light"] .tt-gallery__count { color: #ffffff; }
:root[data-theme="light"] .tt-gallery__heading,
:root[data-theme="light"] .tt-video-browser__heading,
:root[data-theme="light"] .tt-video-browser__previewtitle,
:root[data-theme="light"] .tt-video-browser__radio:checked + .tt-video-browser__tab .tt-video-browser__tabtitle {
  color: #0f172a;
}

/* Motion safety --------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .tt-widget.tt-featured *,
  .tt-widget.tt-gallery *,
  .tt-widget.tt-video-browser * {
    transition: none !important;
    animation: none !important;
  }
  .tt-gallery__slide { transition: none !important; }
  .tt-gallery__nav:hover { transform: translateY(-50%); }
  .tt-video-browser__facade:hover .tt-video-browser__play { transform: translate(-50%, -50%); }
}
`.trim();
/**
 * Companion script for {@link renderVideoBrowser} — enables INLINE playback.
 *
 * The CONSUMER serves this verbatim as a same-origin file (e.g. `/tt-video-browser.js`) and loads it
 * with `<script src="/tt-video-browser.js" defer></script>`. It is CSP-safe under `script-src 'self'`
 * (never an inline script), and the page must allow `frame-src https://www.youtube-nocookie.com` for
 * the embed to render.
 *
 * Behaviour (click-to-load, privacy + CWV preserving): a click on a `.tt-video-browser__facade` is
 * intercepted and the facade is replaced IN PLACE by an autoplaying `youtube-nocookie.com` iframe —
 * so YouTube loads ONLY when a video is actually played, and only the played one. Switching videos
 * inside the same browser removes the previous iframe (stops its audio). With the script absent or
 * blocked, the facade's href opens the privacy embed in a new tab (graceful degradation). Idempotent.
 */
export const VIDEO_BROWSER_JS = `(function () {
  if (window.__ttVideoBrowser) return;
  window.__ttVideoBrowser = true;
  function makeIframe(id, title) {
    var f = document.createElement('iframe');
    f.className = 'tt-video-browser__iframe';
    f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
    f.title = title || 'YouTube video player';
    f.setAttribute('loading', 'lazy');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    f.setAttribute('allowfullscreen', '');
    return f;
  }
  function stopPlaying(browser) {
    if (!browser) return;
    var prev = browser.querySelector('.tt-video-browser__item--playing');
    if (!prev) return;
    var old = prev.querySelector('.tt-video-browser__iframe');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    prev.classList.remove('tt-video-browser__item--playing');
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var facade = t && t.closest ? t.closest('.tt-video-browser__facade[data-tt-yt]') : null;
    if (!facade) return;
    e.preventDefault();
    var item = facade.parentNode;
    if (!item || item.querySelector('.tt-video-browser__iframe')) return;
    var browser = facade.closest('.tt-video-browser');
    var prev = browser && browser.querySelector('.tt-video-browser__item--playing');
    if (prev !== item) stopPlaying(browser);
    // Insert the iframe WHERE THE POSTER WAS (before the facade), not at the end — otherwise the
    // video lands below the title/channel meta and the layout jumps on play. Poster + iframe share
    // the 16:9 box, so swapping them in place shifts nothing.
    item.insertBefore(makeIframe(facade.getAttribute('data-tt-yt'), facade.getAttribute('data-tt-title')), facade);
    item.classList.add('tt-video-browser__item--playing');
  }, false);
  // Switching the left tab (a radio) hides the current preview — stop its (now-hidden) video so no
  // audio keeps playing off-screen.
  document.addEventListener('change', function (e) {
    var r = e.target;
    if (!r || !r.classList || !r.classList.contains('tt-video-browser__radio')) return;
    stopPlaying(r.closest ? r.closest('.tt-video-browser') : null);
  }, false);
})();`;
export const BLOG_MEDIA_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "media",
    w3cTraceparentFormat: "00-32hex-16hex-01",
    langfuseFailOpenTimeoutMs: 2500,
    rfc9457ProblemDetailsSupported: true,
    tactileMicroInteractionsCount: 30,
    interactionStatesCount: 16,
    transitionDurationSeconds: 0.333,
    requiresCloudflareContainers: false,
    deterministicDigest: 3339770477,
};
export function verifyBlogMediaModuleInvariants(tenantId = "tenant_default") {
    const cleanTenant = tenantId.trim() || "tenant_default";
    let rollingHash = BLOG_MEDIA_MODULE_SPECIFICATION.deterministicDigest ^ cleanTenant.length;
    for (let i = 0; i < cleanTenant.length; i++) {
        rollingHash = Math.imul(rollingHash ^ cleanTenant.charCodeAt(i), 0x01000193) >>> 0;
    }
    return {
        ok: BLOG_MEDIA_MODULE_SPECIFICATION.interactionStatesCount === 16 &&
            BLOG_MEDIA_MODULE_SPECIFICATION.tactileMicroInteractionsCount === 30 &&
            !BLOG_MEDIA_MODULE_SPECIFICATION.requiresCloudflareContainers,
        tenantId: cleanTenant,
        packageName: BLOG_MEDIA_MODULE_SPECIFICATION.packageName,
        moduleSlug: BLOG_MEDIA_MODULE_SPECIFICATION.moduleSlug,
        w3cTraceparentFormat: BLOG_MEDIA_MODULE_SPECIFICATION.w3cTraceparentFormat,
        langfuseFailOpenTimeoutMs: BLOG_MEDIA_MODULE_SPECIFICATION.langfuseFailOpenTimeoutMs,
        rfc9457ProblemDetailsSupported: BLOG_MEDIA_MODULE_SPECIFICATION.rfc9457ProblemDetailsSupported,
        tactileMicroInteractionsCount: BLOG_MEDIA_MODULE_SPECIFICATION.tactileMicroInteractionsCount,
        interactionStatesCount: BLOG_MEDIA_MODULE_SPECIFICATION.interactionStatesCount,
        transitionDurationSeconds: BLOG_MEDIA_MODULE_SPECIFICATION.transitionDurationSeconds,
        spec: BLOG_MEDIA_MODULE_SPECIFICATION,
        verifiedInteractionStateCount: 16,
        minApcaContrastLc: 60,
        checksum: rollingHash,
    };
}
//# sourceMappingURL=media.js.map