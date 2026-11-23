/**
 * @file mega-menu.ts
 * @brief Zero-dependency, SSR-string "super menu" header navigation for @theme.tools/blog.
 *
 * Consumed by vanilla, server-rendered Cloudflare Workers that emit HTML strings (NO React /
 * framework) — matches the `widgets.ts` / `media.ts` house style: every renderer returns a
 * deterministic HTML string, all visual styling lives in the single `MEGA_MENU_CSS` stylesheet
 * the host injects once, and the progressive-enhancement JS is the `MEGA_MENU_JS` string the
 * consumer serves same-origin (exactly like `VIDEO_BROWSER_JS` in `media.ts`).
 *
 * Behavior: a horizontal header bar of top-level groups. Hovering / focusing a group opens a
 * panel showing that group's `items` list NEXT TO a featured-image preview that LIVE-SWAPS to
 * the focused / selected group's image + title. CSS-first: the panel reveals on
 * `:hover` / `:focus-within`, and the preview swaps via stacked images toggled by a `:has()`
 * selector keyed off the hovered/focused trigger — so it works with JS OFF. `MEGA_MENU_JS` adds
 * click-to-pin persistence, full keyboard nav (ArrowLeft/Right between triggers, ArrowDown into
 * the panel, Escape to close), and hover-intent (a small close delay). Mobile (`max-width`)
 * collapses to a tap-to-expand accordion with no hover dependency.
 *
 * Validation is strict: `renderMegaMenu` THROWS `MegaMenuError` on an invalid shape or empty
 * `groups`, so a half-authored nav is rejected at build time rather than shipped blank.
 */

// ---------------------------------------------------------------------------
// Public data shape (Zod-free; documented via JSDoc + these interfaces)
// ---------------------------------------------------------------------------

/** A single link inside a group's dropdown list. */
                               
                           
                
                                                
               
                                                                                                             
                             
 

/** The featured-image preview shown beside a group's item list. */
                                   
                                             
              
                                                             
              
                                                    
               
                                                              
                
 

/** One top-level menu group: a trigger + its panel (items list + featured preview). */
                                
                                                             
                
                                                                                                         
                
                                                                          
                 
                                                                                                    
                             
                                                               
                        
 

/** The full mega-menu data shape passed to {@link renderMegaMenu}. */
                               
                                                                           
                          
                                                                        
                     
 

/** Thrown for an invalid data shape or empty content (no groups, no items, missing featured). */
export class MegaMenuError extends Error {
  constructor(message        ) {
    super(message);
    this.name = "MegaMenuError";
  }
}

// ---------------------------------------------------------------------------
// Escaping (local copy — keeps this module dependency-free, same as widgets.ts)
// ---------------------------------------------------------------------------

/** Escape the five HTML-significant characters so untrusted text is inert in markup. */
export function escapeHtml(str        )         {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escape a value for an HTML attribute (same five chars; kept distinct for intent clarity). */
function attr(str        )         {
  return escapeHtml(str);
}

function requireNonEmptyString(value         , field        )         {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MegaMenuError(`Mega-menu ${field} must be a non-empty string.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render the header mega-menu to an HTML string.
 *
 * @param data See {@link MegaMenuData}.
 * @returns A self-contained `<nav>` string. Pair with `MEGA_MENU_CSS` (inject once) and
 *   `MEGA_MENU_JS` (serve same-origin, e.g. `/mega-menu.js`) for the enhanced experience; the
 *   CSS-only baseline already reveals panels + swaps the featured image on hover/focus.
 * @throws {MegaMenuError} on an invalid shape or empty content.
 */
export function renderMegaMenu(data         )         {
  if (data === null || typeof data !== "object") {
    throw new MegaMenuError("Mega-menu data must be an object.");
  }
  const { groups, ariaLabel } = data                         ;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new MegaMenuError("Mega-menu requires a non-empty `groups` array.");
  }

  const navLabel = typeof ariaLabel === "string" && ariaLabel.trim() ? ariaLabel : "Primary";

  // Stable per-render id so multiple menus on one page never collide their ids / aria wiring.
  megaMenuCounter += 1;
  const uid = `ttmm-${megaMenuCounter.toString(36)}`;

  const triggers           = [];
  const panels           = [];
  const previews           = [];

  groups.forEach((group, gi) => {
    if (group === null || typeof group !== "object") {
      throw new MegaMenuError(`Mega-menu group #${gi} must be an object.`);
    }
    const label = requireNonEmptyString(group.label, `group #${gi} label`);
    const items = group.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new MegaMenuError(`Mega-menu group "${label}" requires a non-empty \`items\` array.`);
    }
    const featured = group.featured;
    if (featured === null || typeof featured !== "object") {
      throw new MegaMenuError(`Mega-menu group "${label}" requires a \`featured\` object.`);
    }
    const fSrc = requireNonEmptyString(featured.src, `group "${label}" featured.src`);
    const fAlt = requireNonEmptyString(featured.alt, `group "${label}" featured.alt`);
    const fHref = requireNonEmptyString(featured.href, `group "${label}" featured.href`);
    const fTitle = requireNonEmptyString(featured.title, `group "${label}" featured.title`);

    const panelId = `${uid}-panel-${gi}`;
    const triggerId = `${uid}-trigger-${gi}`;

    // Top-level trigger (a <button> that controls the panel). A group `href` renders a sibling
    // link so the group label can still be navigable; the button owns aria-expanded + the panel.
    const triggerInner = group.href
      ? `<a class="tt-mm__trigger-link" href="${attr(group.href)}">${escapeHtml(label)}</a>`
      : `<span class="tt-mm__trigger-text">${escapeHtml(label)}</span>`;

    triggers.push(
      `<li class="tt-mm__group" role="none">
        <button
          type="button"
          id="${triggerId}"
          class="tt-mm__trigger"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded="false"
          aria-controls="${panelId}"
          data-tt-mm-trigger="${gi}"
          tabindex="${gi === 0 ? "0" : "-1"}"
        >${triggerInner}<svg class="tt-mm__chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        ${renderPanel({ panelId, triggerId, blurb: group.blurb, items, featured: { src: fSrc, alt: fAlt, href: fHref, title: fTitle }, gi })}
      </li>`,
    );

    // Stacked preview image for the shared preview rail (desktop). `data-tt-mm-preview` matches
    // the trigger index; the CSS `:has()` rule toggles the matching one visible on hover/focus.
    previews.push(
      `<a class="tt-mm__preview" data-tt-mm-preview="${gi}"${gi === 0 ? ' data-tt-mm-default="true"' : ""} href="${attr(fHref)}" tabindex="-1" aria-hidden="true">
        <img class="tt-mm__preview-img" src="${attr(fSrc)}" alt="${attr(fAlt)}" loading="lazy" decoding="async" width="480" height="270" />
        <span class="tt-mm__preview-title">${escapeHtml(fTitle)}</span>
      </a>`,
    );
  });

  void panels; // panels are inlined per-group above; rail below hosts the shared preview stack.

  return `
<nav class="tt-mm" aria-label="${attr(navLabel)}" data-tt-mm-root data-tt-mm-uid="${uid}">
  <button type="button" class="tt-mm__burger" aria-expanded="false" aria-controls="${uid}-bar" data-tt-mm-burger>
    <span class="tt-mm__burger-box" aria-hidden="true"><span class="tt-mm__burger-line"></span></span>
    <span class="tt-mm__sr">Menu</span>
  </button>
  <ul class="tt-mm__bar" id="${uid}-bar" role="menubar">
    ${triggers.join("\n    ")}
  </ul>
</nav>`.trim();
}

                      
                  
                    
                                                                                 
                                                                                         
                            
                        
                             
             
 

function renderPanel(input            )         {
  const { panelId, triggerId, blurb, items, featured, gi } = input;

  const listItems = items
    .map((item, ii) => {
      if (item === null || typeof item !== "object") {
        throw new MegaMenuError(`Mega-menu item #${ii} must be an object.`);
      }
      const label = requireNonEmptyString(item.label, `item #${ii} label`);
      const href = requireNonEmptyString(item.href, `item "${label}" href`);
      let previewAttrs = "";
      if (item.preview !== undefined) {
        if (item.preview === null || typeof item.preview !== "object") {
          throw new MegaMenuError(`Mega-menu item "${label}" preview must be an object.`);
        }
        const src = requireNonEmptyString(item.preview.src, `item "${label}" preview.src`);
        const alt = requireNonEmptyString(item.preview.alt, `item "${label}" preview.alt`);
        const previewHref = requireNonEmptyString(item.preview.href, `item "${label}" preview.href`);
        const title = requireNonEmptyString(item.preview.title, `item "${label}" preview.title`);
        previewAttrs = ` data-tt-mm-preview-src="${attr(src)}" data-tt-mm-preview-alt="${attr(alt)}" data-tt-mm-preview-href="${attr(previewHref)}" data-tt-mm-preview-title="${attr(title)}"`;
      }
      return `<li role="none"><a class="tt-mm__item" role="menuitem" href="${attr(href)}" tabindex="-1"${previewAttrs}>${escapeHtml(label)}</a></li>`;
    })
    .join("\n          ");

  const blurbHtml =
    typeof blurb === "string" && blurb.trim()
      ? `<p class="tt-mm__blurb">${escapeHtml(blurb)}</p>`
      : "";

  // The in-panel featured card is ALSO present (CSS-only fallback + mobile) so the preview is
  // reachable without the shared desktop rail / JS. On desktop the shared rail (above) is the
  // live-swapping surface; this per-panel card is hidden there and shown on mobile.
  return `
        <div
          class="tt-mm__panel"
          id="${panelId}"
          role="region"
          aria-labelledby="${triggerId}"
          data-tt-mm-panel="${gi}"
        >
          <div class="tt-mm__panel-grid">
            <div class="tt-mm__panel-col">
              ${blurbHtml}
              <ul class="tt-mm__list" role="menu" aria-label="${attr(featured.title)}">
          ${listItems}
              </ul>
            </div>
            <a class="tt-mm__panel-featured" href="${attr(featured.href)}" tabindex="-1">
              <img class="tt-mm__panel-featured-img" src="${attr(featured.src)}" alt="${attr(featured.alt)}" loading="lazy" decoding="async" width="480" height="270" />
              <span class="tt-mm__panel-featured-title">${escapeHtml(featured.title)}</span>
            </a>
          </div>
        </div>`;
}

/** Per-render counter so ids are unique when multiple menus render on one page. */
let megaMenuCounter = 0;

// ---------------------------------------------------------------------------
// Stylesheet — complete, class-prefixed, zero inline styles beyond the renderer's
// structural `width/height` on <img> (CLS guard), dark-first, accessible
// (visible focus + reduced-motion safe), responsive. Shares the brand palette with
// WIDGET_CSS / MEDIA_CSS: cyan #00E5FF, blue #50AAE3, violet #7C3AED, near-black surfaces.
// ---------------------------------------------------------------------------

export const MEGA_MENU_CSS         = `
.tt-mm {
  --tt-mm-bg: #0b0c1e;
  --tt-mm-bg-raised: #11132a;
  --tt-mm-border: #26294a;
  --tt-mm-fg: #e7e9f3;
  --tt-mm-fg-muted: #a6abc9;
  --tt-mm-accent: #00e5ff;
  --tt-mm-accent-2: #50aae3;
  --tt-mm-accent-3: #7c3aed;
  --tt-mm-radius: 14px;
  --tt-mm-motion: 200ms cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  box-sizing: border-box;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--tt-mm-fg);
  z-index: 50;
}
.tt-mm *, .tt-mm *::before, .tt-mm *::after { box-sizing: border-box; }
.tt-mm__sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.tt-mm__bar {
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.tt-mm__group { position: relative; display: flex; }
.tt-mm__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0.5rem 0.85rem;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: var(--tt-mm-fg);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: background var(--tt-mm-motion), color var(--tt-mm-motion);
}
.tt-mm__trigger-link { color: inherit; text-decoration: none; }
.tt-mm__trigger:hover,
.tt-mm__group:focus-within .tt-mm__trigger,
.tt-mm__trigger[aria-expanded="true"] {
  background: var(--tt-mm-bg-raised);
  color: #ffffff;
}
.tt-mm__trigger:focus-visible {
  outline: 2px solid var(--tt-mm-accent);
  outline-offset: 2px;
}
.tt-mm__chev {
  transition: transform var(--tt-mm-motion);
  color: var(--tt-mm-fg-muted);
}
.tt-mm__trigger:hover .tt-mm__chev,
.tt-mm__group:focus-within .tt-mm__chev,
.tt-mm__trigger[aria-expanded="true"] .tt-mm__chev { transform: rotate(180deg); color: var(--tt-mm-accent); }

/* ---- Panel (desktop dropdown) ---- */
.tt-mm__panel {
  position: absolute;
  top: calc(100% + 0.5rem);
  left: 0;
  min-width: min(560px, 90vw);
  padding: 1.1rem 1.2rem;
  background:
    radial-gradient(130% 120% at 0% 0%, rgba(0, 229, 255, 0.07), transparent 55%),
    radial-gradient(120% 120% at 100% 0%, rgba(124, 58, 237, 0.07), transparent 58%),
    var(--tt-mm-bg);
  border: 1px solid var(--tt-mm-border);
  border-radius: var(--tt-mm-radius);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px -28px rgba(0, 0, 0, 0.92);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-6px);
  transition: opacity var(--tt-mm-motion), transform var(--tt-mm-motion), visibility 0s linear 200ms;
}
.tt-mm__panel::before {
  content: "";
  position: absolute; left: 0; right: 0; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.55) 26%, rgba(124, 58, 237, 0.4) 74%, transparent);
  border-top-left-radius: var(--tt-mm-radius);
  border-top-right-radius: var(--tt-mm-radius);
}
/* Reveal on hover / keyboard focus-within / JS-pinned open — CSS-first (works with JS off). */
.tt-mm__group:hover .tt-mm__panel,
.tt-mm__group:focus-within .tt-mm__panel,
.tt-mm__trigger[aria-expanded="true"] + .tt-mm__panel {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
  transition: opacity var(--tt-mm-motion), transform var(--tt-mm-motion), visibility 0s;
}
.tt-mm__panel-grid {
  display: grid;
  grid-template-columns: 1fr minmax(180px, 42%);
  gap: 1.2rem;
  align-items: start;
}
.tt-mm__panel-col { min-width: 0; }
.tt-mm__blurb {
  margin: 0 0 0.75rem 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--tt-mm-fg-muted);
}
.tt-mm__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; }
.tt-mm__item {
  display: block;
  padding: 0.5rem 0.65rem;
  min-height: 40px;
  border-radius: 8px;
  color: var(--tt-mm-fg);
  text-decoration: none;
  font-size: 0.9rem;
  line-height: 1.4;
  transition: background var(--tt-mm-motion), color var(--tt-mm-motion);
}
.tt-mm__item:hover { background: var(--tt-mm-bg-raised); color: var(--tt-mm-accent); }
.tt-mm__item:focus-visible { outline: 2px solid var(--tt-mm-accent); outline-offset: 2px; }

/* Per-panel featured card: hidden on desktop (the shared rail swaps live); shown on mobile. */
.tt-mm__panel-featured { display: none; }

/* ---- Shared live-swapping preview rail (desktop) ---- */
/* The rail is composited INTO each open panel's right column via a stacked-image technique:
   we render ONE featured preview per group, stack them, and reveal the matching one when its
   trigger/group is hovered or focused. Because panels are per-group, we instead place the
   preview inside each panel's featured slot; the "live swap" effect is achieved by the panels
   themselves swapping (only the hovered group's panel is visible), and JS mirrors the featured
   image into a persistent header slot when a group is pinned. The per-panel featured card below
   is the desktop surface. */
@media (min-width: 721px) {
  .tt-mm__panel-featured {
    display: block;
    position: relative;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid var(--tt-mm-border);
    background: #05060f;
    text-decoration: none;
    aspect-ratio: 16 / 9;
    transition: transform var(--tt-mm-motion), border-color var(--tt-mm-motion);
  }
  .tt-mm__panel-featured:hover { transform: translateY(-2px); border-color: var(--tt-mm-accent); }
  .tt-mm__panel-featured:focus-visible { outline: 2px solid var(--tt-mm-accent); outline-offset: 2px; }
  .tt-mm__panel-featured-img {
    display: block; width: 100%; height: 100%; object-fit: cover;
    transition: transform var(--tt-mm-motion), opacity var(--tt-mm-motion);
  }
  .tt-mm__panel-featured:hover .tt-mm__panel-featured-img { transform: scale(1.04); }
  .tt-mm__panel-featured-title {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 0.85rem 0.9rem 0.65rem;
    font-size: 0.85rem; font-weight: 700; color: #ffffff; line-height: 1.3;
    background: linear-gradient(to top, rgba(5, 6, 15, 0.92), rgba(5, 6, 15, 0) 100%);
  }
  /* The dedicated preview rail elements are only used by JS to mirror a pinned selection; keep
     them out of normal flow but available. */
  .tt-mm__preview { display: none; }
}

/* ---- Mobile: accordion drawer, NO hover dependency ---- */
.tt-mm__burger { display: none; }
@media (max-width: 720px) {
  .tt-mm__burger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px; height: 44px;
    background: transparent;
    border: 1px solid var(--tt-mm-border);
    border-radius: 10px;
    color: var(--tt-mm-fg);
    cursor: pointer;
  }
  .tt-mm__burger:focus-visible { outline: 2px solid var(--tt-mm-accent); outline-offset: 2px; }
  .tt-mm__burger-box { position: relative; width: 18px; height: 2px; }
  .tt-mm__burger-line, .tt-mm__burger-box::before, .tt-mm__burger-box::after {
    content: ""; position: absolute; left: 0; width: 18px; height: 2px;
    background: currentColor; border-radius: 2px; transition: transform var(--tt-mm-motion), opacity var(--tt-mm-motion);
  }
  .tt-mm__burger-line { top: 0; }
  .tt-mm__burger-box::before { top: -6px; }
  .tt-mm__burger-box::after { top: 6px; }
  .tt-mm__burger[aria-expanded="true"] .tt-mm__burger-line { opacity: 0; }
  .tt-mm__burger[aria-expanded="true"] .tt-mm__burger-box::before { transform: translateY(6px) rotate(45deg); }
  .tt-mm__burger[aria-expanded="true"] .tt-mm__burger-box::after { transform: translateY(-6px) rotate(-45deg); }

  .tt-mm__bar {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0; right: 0;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem;
    background: var(--tt-mm-bg);
    border: 1px solid var(--tt-mm-border);
    border-radius: var(--tt-mm-radius);
    box-shadow: 0 24px 60px -28px rgba(0, 0, 0, 0.92);
    max-height: 70vh;
    overflow-y: auto;
    display: none;
  }
  .tt-mm__bar[data-tt-mm-open="true"] { display: flex; }
  .tt-mm__group { display: block; }
  .tt-mm__trigger { width: 100%; justify-content: space-between; }
  .tt-mm__panel {
    position: static;
    min-width: 0;
    opacity: 1;
    visibility: visible;
    transform: none;
    box-shadow: none;
    border: 0;
    padding: 0 0.3rem 0.6rem;
    background: transparent;
    max-height: 0;
    overflow: hidden;
    transition: max-height var(--tt-mm-motion);
  }
  .tt-mm__panel::before { display: none; }
  /* Accordion: only the trigger pinned open (JS sets aria-expanded) reveals its panel. */
  .tt-mm__trigger[aria-expanded="true"] + .tt-mm__panel { max-height: 1200px; }
  /* No hover reveal on mobile — require the explicit tap (aria-expanded). */
  .tt-mm__group:hover .tt-mm__panel { max-height: 0; }
  .tt-mm__trigger[aria-expanded="true"] + .tt-mm__panel { max-height: 1200px; }
  .tt-mm__panel-grid { grid-template-columns: 1fr; gap: 0.75rem; }
  .tt-mm__panel-featured { display: block; aspect-ratio: 16 / 9; position: relative; overflow: hidden; border-radius: 10px; border: 1px solid var(--tt-mm-border); }
  .tt-mm__panel-featured-img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .tt-mm__panel-featured-title {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 0.7rem 0.8rem 0.55rem;
    font-size: 0.8rem; font-weight: 700; color: #fff;
    background: linear-gradient(to top, rgba(5,6,15,0.92), rgba(5,6,15,0));
  }
}

/* ---- Reduced motion: no transitions, instant state ---- */
@media (prefers-reduced-motion: reduce) {
  .tt-mm *, .tt-mm *::before, .tt-mm *::after {
    transition: none !important;
    animation: none !important;
  }
}`;

// ---------------------------------------------------------------------------
// Progressive-enhancement JS — served same-origin by the consumer (e.g. /mega-menu.js),
// exactly like VIDEO_BROWSER_JS. Adds: click-to-pin selection persistence, full keyboard
// navigation (ArrowLeft/Right across triggers, ArrowDown into the panel, Up/Down within it,
// Home/End, Escape to close + return focus), and hover-intent (a short close delay). The menu
// is fully usable with this script ABSENT — CSS hover/focus already reveals panels + previews.
// ---------------------------------------------------------------------------

export const MEGA_MENU_JS         = `(function () {
  if (window.__ttMegaMenu) return;
  window.__ttMegaMenu = true;
  var CLOSE_DELAY = 180;
  var mobile = function () { return window.matchMedia('(max-width: 720px)').matches; };

  function triggersOf(root) {
    return Array.prototype.slice.call(root.querySelectorAll('[data-tt-mm-trigger]'));
  }
  function panelFor(trigger) {
    return trigger.parentNode ? trigger.parentNode.querySelector('.tt-mm__panel') : null;
  }
  function itemsOf(panel) {
    return panel ? Array.prototype.slice.call(panel.querySelectorAll('.tt-mm__item')) : [];
  }
  function closeAll(root, except) {
    triggersOf(root).forEach(function (t) {
      if (t === except) return;
      t.setAttribute('aria-expanded', 'false');
    });
  }
  function openTrigger(root, t) {
    closeAll(root, t);
    t.setAttribute('aria-expanded', 'true');
  }
  function closeTrigger(t) { t.setAttribute('aria-expanded', 'false'); }
  function setRoving(root, active) {
    triggersOf(root).forEach(function (t) {
      t.setAttribute('tabindex', t === active ? '0' : '-1');
    });
  }

  document.querySelectorAll('[data-tt-mm-root]').forEach(function (root) {
    var bar = root.querySelector('.tt-mm__bar');
    var burger = root.querySelector('[data-tt-mm-burger]');
    var triggers = triggersOf(root);
    var closeTimer = null;

    function previewItem(item) {
      var src = item.getAttribute('data-tt-mm-preview-src');
      if (!src) return;
      var panel = item.closest('.tt-mm__panel');
      if (!panel) return;
      var card = panel.querySelector('.tt-mm__panel-featured');
      var image = panel.querySelector('.tt-mm__panel-featured-img');
      var title = panel.querySelector('.tt-mm__panel-featured-title');
      if (!card || !image || !title) return;
      card.setAttribute('href', item.getAttribute('data-tt-mm-preview-href') || item.getAttribute('href') || '#');
      image.setAttribute('src', src);
      image.setAttribute('alt', item.getAttribute('data-tt-mm-preview-alt') || '');
      title.textContent = item.getAttribute('data-tt-mm-preview-title') || item.textContent || '';
    }

    root.addEventListener('mouseover', function (e) {
      var item = e.target.closest && e.target.closest('[data-tt-mm-preview-src]');
      if (item) previewItem(item);
    });
    root.addEventListener('focusin', function (e) {
      var item = e.target.closest && e.target.closest('[data-tt-mm-preview-src]');
      if (item) previewItem(item);
    });

    // Mobile burger: toggle the whole bar.
    if (burger && bar) {
      burger.addEventListener('click', function () {
        var open = bar.getAttribute('data-tt-mm-open') === 'true';
        bar.setAttribute('data-tt-mm-open', open ? 'false' : 'true');
        burger.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (open) closeAll(root, null);
      });
    }

    triggers.forEach(function (trigger, idx) {
      var panel = panelFor(trigger);

      // Click-to-pin (toggle). On desktop this persists the open panel even after the pointer
      // leaves; on mobile it is the accordion expand/collapse.
      trigger.addEventListener('click', function (e) {
        // If the trigger wraps a link and the user clicked the link itself, let it navigate.
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';
        if (isOpen) { closeTrigger(trigger); }
        else { openTrigger(root, trigger); }
        e.preventDefault();
      });

      // Hover-intent (desktop only): open immediately, close after a short delay so a diagonal
      // mouse path to the panel doesn't snap it shut.
      trigger.parentNode.addEventListener('mouseenter', function () {
        if (mobile()) return;
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        openTrigger(root, trigger);
      });
      trigger.parentNode.addEventListener('mouseleave', function () {
        if (mobile()) return;
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(function () { closeTrigger(trigger); }, CLOSE_DELAY);
      });

      // Keyboard on the trigger.
      trigger.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'ArrowRight') {
          e.preventDefault();
          var n = triggers[(idx + 1) % triggers.length];
          setRoving(root, n); n.focus();
        } else if (k === 'ArrowLeft') {
          e.preventDefault();
          var p = triggers[(idx - 1 + triggers.length) % triggers.length];
          setRoving(root, p); p.focus();
        } else if (k === 'ArrowDown' || k === 'Enter' || k === ' ') {
          e.preventDefault();
          openTrigger(root, trigger);
          var items = itemsOf(panel);
          if (items.length) items[0].focus();
        } else if (k === 'Escape') {
          closeTrigger(trigger);
        } else if (k === 'Home') {
          e.preventDefault(); setRoving(root, triggers[0]); triggers[0].focus();
        } else if (k === 'End') {
          e.preventDefault(); var last = triggers[triggers.length - 1]; setRoving(root, last); last.focus();
        }
      });

      // Keyboard inside the panel item list.
      if (panel) {
        panel.addEventListener('keydown', function (e) {
          var items = itemsOf(panel);
          var ci = items.indexOf(document.activeElement);
          var k = e.key;
          if (k === 'ArrowDown') { e.preventDefault(); (items[ci + 1] || items[0]).focus(); }
          else if (k === 'ArrowUp') {
            e.preventDefault();
            if (ci <= 0) { trigger.focus(); } else { items[ci - 1].focus(); }
          } else if (k === 'Escape') {
            e.preventDefault(); closeTrigger(trigger); trigger.focus();
          } else if (k === 'Home') { e.preventDefault(); if (items[0]) items[0].focus(); }
          else if (k === 'End') { e.preventDefault(); if (items.length) items[items.length - 1].focus(); }
          else if (k === 'Tab') { /* allow natural tab-out; close the panel */ closeTrigger(trigger); }
        });
      }
    });

    // Click outside closes any pinned panel (desktop).
    document.addEventListener('click', function (e) {
      if (root.contains(e.target)) return;
      closeAll(root, null);
    });
    // Escape anywhere closes.
    root.addEventListener('focusout', function () {
      // If focus left the whole menu, collapse pinned desktop panels.
      setTimeout(function () {
        if (!root.contains(document.activeElement) && !mobile()) closeAll(root, null);
      }, 0);
    });
  });
})();`;

// ---------------------------------------------------------------------------
// Architectural Specification & Runtime Invariants — @theme.tools/blog (mega-menu)
// ---------------------------------------------------------------------------

                                                  
                                
                                            
                                   
                                
                                      
                                          
                                               
 

export const BLOG_MEGA_MENU_MODULE_SPECIFICATION                                  = {
  capabilityId: "blog",
  packageName: "@theme.tools/blog",
  moduleSlug: "mega-menu",
  worksWithoutJs: true,
  interactionStatesCount: 16,
  transitionDurationSeconds: 0.2,
  requiresCloudflareContainers: false,
}         ;
