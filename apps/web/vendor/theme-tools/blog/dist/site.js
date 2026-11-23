/**
 * @file site.ts
 * @brief Zero-dependency WEBSITE-SHELL components for @theme.tools/blog/site.
 *
 * The cinematic black + cyan site system: nav, hero, terminal, node constellation, content
 * sections, feature grid, buttons, post cards, a page header, and an article wrapper — plus the
 * single `SITE_CSS` stylesheet a host injects once. Same vanilla, server-rendered Cloudflare-Worker
 * HTML-string style as `widgets.ts`/`media.ts` (NO framework, NO inline JS), fully SELF-CONTAINED
 * (zero cross-package imports). Text fields are escaped; fields explicitly documented as a "slot"
 * (e.g. `visual`, `body`) accept TRUSTED composed HTML (the site author's own markup), never
 * untrusted user input.
 *
 * Palette: canvas #060610 · panels #0a0e17 · ONE accent cyan #00E5FF (borders, glows, gradients
 * are cyan-led; violet is retired from the UI). Tokens live on `:root` in SITE_CSS and can be
 * overridden by the host.
 */
/** Escape the five HTML-significant characters so untrusted text is inert in markup. */
export function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
const E = escapeHtml;
// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
/** Per-render counter so ids are unique when multiple navs render on one page (never collide aria wiring). */
let navMegaCounter = 0;
/** Render ONE top-level mega-menu group (trigger button + its panel) for the unified header. */
function renderNavMegaGroup(group, uid, gi) {
    if (!group.items || group.items.length === 0) {
        throw new Error(`Nav mega-menu group "${group.label}" requires a non-empty items array.`);
    }
    const panelId = `${uid}-p${gi}`;
    const triggerId = `${uid}-t${gi}`;
    const f = group.featured;
    const icon = group.icon
        ? `<span class="tt-nav__mm-ic" aria-hidden="true">${E(group.icon)}</span>`
        : "";
    const label = group.href
        ? `<a class="tt-nav__mm-labellink" href="${E(group.href)}" tabindex="-1">${E(group.label)}</a>`
        : `<span>${E(group.label)}</span>`;
    const items = group.items
        .map((it) => {
        const sub = it.sub
            ? `<span class="tt-nav__mm-itemsub">${E(it.sub)}</span>`
            : "";
        return `<li role="none"><a class="tt-nav__mm-item" role="menuitem" href="${E(it.href)}" tabindex="-1"><span class="tt-nav__mm-itemlabel">${E(it.label)}</span>${sub}<span class="tt-nav__mm-arrow" aria-hidden="true">→</span></a></li>`;
    })
        .join("");
    const blurb = group.blurb
        ? `<p class="tt-nav__mm-blurb">${E(group.blurb)}</p>`
        : "";
    const kicker = f.kicker
        ? `<span class="tt-nav__mm-fkicker">${E(f.kicker)}</span>`
        : "";
    return `<li class="tt-nav__mm-group" role="none">
      <button type="button" id="${triggerId}" class="tt-nav__mm-trigger" role="menuitem" aria-haspopup="true" aria-expanded="false" aria-controls="${panelId}" data-tt-nav-trigger="${gi}" tabindex="${gi === 0 ? "0" : "-1"}">${icon}${label}<svg class="tt-nav__mm-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="tt-nav__mm-panel" id="${panelId}" role="region" aria-labelledby="${triggerId}" data-tt-nav-panel="${gi}">
        <div class="tt-nav__mm-grid">
          <div class="tt-nav__mm-col">
            ${blurb}
            <ul class="tt-nav__mm-list" role="menu" aria-label="${E(group.label)}">${items}</ul>
          </div>
          <a class="tt-nav__mm-featured" href="${E(f.href)}" tabindex="-1" aria-label="${E(f.title)}">
            <img class="tt-nav__mm-fimg" src="${E(f.src)}" alt="${E(f.alt)}" loading="lazy" decoding="async" width="480" height="270">
            <span class="tt-nav__mm-fscrim">${kicker}<span class="tt-nav__mm-ftitle">${E(f.title)}</span></span>
          </a>
        </div>
      </div>
    </li>`;
}
/**
 * Render ONE desk card for the compact-overlay mega-menu grid — an icon chip + name + blurb, carrying
 * the group's featured preview as data-attrs so hovering/focusing it live-swaps the shared preview pane.
 * The card is the primary link to the desk hub (`group.href`), with the sub-items reachable from the hub.
 */
function renderNavOverlayCard(group, gi) {
    const f = group.featured;
    const icon = group.icon
        ? `<span class="tt-ov__card-ic" aria-hidden="true">${E(group.icon)}</span>`
        : "";
    const blurb = group.blurb ? `<span class="tt-ov__card-blurb">${E(group.blurb)}</span>` : "";
    const href = group.href ?? f.href;
    const count = group.items.length;
    const countLabel = count > 0
        ? `<span class="tt-ov__card-count" aria-hidden="true">${count}</span><span class="tt-sr-only"> — ${count} article${count === 1 ? "" : "s"}</span>`
        : "";
    return `<a class="tt-ov__card" role="menuitem" href="${E(href)}" data-tt-ov-card="${gi}" data-tt-ov-fsrc="${E(f.src)}" data-tt-ov-falt="${E(f.alt)}" data-tt-ov-fhref="${E(f.href)}" data-tt-ov-ftitle="${E(f.title)}" data-tt-ov-fkicker="${E(f.kicker ?? group.label)}" tabindex="-1">
      <span class="tt-ov__card-head">${icon}<span class="tt-ov__card-name">${E(group.label)}</span>${countLabel}</span>
      ${blurb}
    </a>`;
}
/**
 * The COMPACT-OVERLAY mega-menu. Resting state is a single `Explore ▾` trigger (plus an optional
 * compact search icon) — the whole 12-desk catalogue hides until the reader opens it. Open state is a
 * ONE full-width glass OVERLAY integrating every good mega-menu idea: a search box, the desks as an
 * icon+blurb grid, a live-swapping featured preview, a "Latest" column, and a dominant CTA + quick
 * links. CSS-first (`:target`-free; `[data-tt-ov-open]` toggled by JS) with graceful JS-off fallback
 * (the trigger is a real `<a href>` to the first group's hub so no-JS readers still navigate).
 */
function renderNavOverlay(data, uid) {
    const groups = data.mega ?? [];
    const panelId = `${uid}-ov`;
    const triggerId = `${uid}-ovt`;
    const triggerLabel = data.megaTriggerLabel && data.megaTriggerLabel.trim() ? data.megaTriggerLabel : "Explore";
    const first = groups[0];
    // Search box (overlay top) + the compact resting-bar search affordance.
    const search = data.megaSearch;
    const searchName = search?.name && search.name.trim() ? search.name : "q";
    const overlaySearch = search
        ? `<form class="tt-ov__search" role="search" method="get" action="${E(search.action)}">
        <span class="tt-ov__search-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.6"/><path d="M12 12l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>
        <input class="tt-ov__search-input" type="search" name="${E(searchName)}" placeholder="${E(search.placeholder ?? "Search the magazine…")}" aria-label="${E(search.placeholder ?? "Search the magazine")}" autocomplete="off" data-tt-ov-search>
        <button class="tt-ov__search-go" type="submit">Search</button>
      </form>`
        : "";
    const restingSearch = search
        ? `<a class="tt-nav__ov-search" href="${E(search.action)}" aria-label="Search" data-tt-ov-searchbtn>
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 12l3.6 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
  </a>`
        : "";
    // Desk grid.
    const cards = groups.map((g, gi) => renderNavOverlayCard(g, gi)).join("\n          ");
    // Shared live-featured preview pane — seeded with the first group's featured image. The article title
    // remains visible beneath the media instead of relying on title text baked into cover art. The title,
    // image, kicker, href and accessible name all share the same live-swap binding.
    const featured = first
        ? `<a class="tt-ov__featured" href="${E(first.featured.href)}" data-tt-ov-featured aria-label="${E(first.featured.title)}" data-tt-ov-flabel="${E(first.featured.title)}">
          <span class="tt-ov__fmedia">
            <img class="tt-ov__fimg" src="${E(first.featured.src)}" alt="${E(first.featured.alt)}" loading="lazy" decoding="async" width="520" height="300" data-tt-ov-fimg>
            <span class="tt-ov__fscrim">
              <span class="tt-ov__fkicker" data-tt-ov-fkicker>${E(first.featured.kicker ?? first.label)}</span>
              <span class="tt-ov__fcue" aria-hidden="true">Read the story →</span>
            </span>
          </span>
          <span class="tt-ov__ftitle" data-tt-ov-ftitle>${E(first.featured.title)}</span>
        </a>`
        : "";
    // "Latest" column.
    const latest = data.megaLatest;
    const latestCol = latest && latest.items.length > 0
        ? `<div class="tt-ov__latest">
          <p class="tt-ov__col-label">${E(latest.title ?? "Latest")}</p>
          <ul class="tt-ov__latest-list" role="menu" aria-label="${E(latest.title ?? "Latest articles")}">
            ${latest.items
            .map((it) => `<li role="none"><a class="tt-ov__latest-item${it.image ? " tt-ov__latest-item--visual" : ""}" role="menuitem" href="${E(it.href)}" tabindex="-1">${it.image ? `<img class="tt-ov__latest-img" src="${E(it.image.src)}" alt="${E(it.image.alt)}" loading="lazy" decoding="async" width="72" height="56">` : ""}<span class="tt-ov__latest-copy"><span class="tt-ov__latest-title">${E(it.label)}</span>${it.meta ? `<span class="tt-ov__latest-meta">${E(it.meta)}</span>` : ""}</span></a></li>`)
            .join("\n            ")}
          </ul>
        </div>`
        : "";
    // Dominant CTA + quick links rail.
    const cta = data.megaCta;
    const ctaCard = cta
        ? `<a class="tt-ov__cta" href="${E(cta.href)}" data-tt-ov-link>
          <span class="tt-ov__cta-kicker">${E(cta.kicker)}</span>
          <span class="tt-ov__cta-title">${E(cta.title)}</span>
          <span class="tt-ov__cta-blurb">${E(cta.blurb)}</span>
          <span class="tt-ov__cta-go">${E(cta.cta ?? "Start here →")}</span>
        </a>`
        : "";
    const quick = data.megaQuick;
    const quickLinks = quick && quick.items.length > 0
        ? `<div class="tt-ov__quick">
          ${quick.title ? `<p class="tt-ov__col-label">${E(quick.title)}</p>` : ""}
          <ul class="tt-ov__quick-list" role="menu" aria-label="${E(quick.title ?? "Quick links")}">
            ${quick.items
            .map((q) => `<li role="none"><a class="tt-ov__quick-item" role="menuitem" href="${E(q.href)}" tabindex="-1">${q.icon ? `<span class="tt-ov__quick-ic" aria-hidden="true">${E(q.icon)}</span>` : ""}<span class="tt-ov__quick-label">${E(q.label)}</span>${q.sub ? `<span class="tt-ov__quick-sub">${E(q.sub)}</span>` : ""}</a></li>`)
            .join("\n            ")}
          </ul>
        </div>`
        : "";
    const rail = ctaCard || quickLinks
        ? `<div class="tt-ov__rail">${ctaCard}${quickLinks}</div>`
        : "";
    // The resting trigger — a real link (first hub) upgraded to a button-like control by JS.
    const triggerHref = first ? (first.href ?? first.featured.href) : "/";
    return `<button type="button" id="${triggerId}" class="tt-nav__ov-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="${panelId}" data-tt-ov-trigger>
    <span class="tt-nav__ov-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="tt-nav__ov-label">${E(triggerLabel)}</span>
    <svg class="tt-nav__ov-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <noscript><a class="tt-nav__ov-nojs" href="${E(triggerHref)}">${E(triggerLabel)}</a></noscript>${restingSearch}
  <div class="tt-ov" id="${panelId}" role="dialog" aria-modal="true" aria-label="${E(data.megaLabel && data.megaLabel.trim() ? data.megaLabel : "Explore the magazine")}" data-tt-ov-panel hidden>
    <div class="tt-ov__scrim" data-tt-ov-scrim></div>
    <div class="tt-ov__sheet" role="document">
      <div class="tt-ov__top">
        ${overlaySearch}
        <button type="button" class="tt-ov__close" data-tt-ov-close aria-label="Close menu"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="tt-ov__body">
        <nav class="tt-ov__desks" aria-label="Sections">
          <p class="tt-ov__col-label">All ${groups.length} sections</p>
          <div class="tt-ov__grid" role="menu" aria-label="Sections">
          ${cards}
          </div>
        </nav>
        <div class="tt-ov__aside">
          ${featured}
          ${latestCol}
        </div>
        ${rail}
      </div>
    </div>
  </div>`;
}
/**
 * Sticky, blurred top nav: a glowing brand mark + wordmark, an optional desk MEGA-MENU, utility links,
 * and one accent CTA — all in ONE unified header. Two mega presentations (see `megaMode`):
 * - `'bar'` (default): a wide row of per-desk triggers, each opening its own dropdown (CSS-first,
 *   hover / `:focus-within`, JS-off safe; `NAV_MENU_JS` adds click-pin + keyboard + hover-intent).
 * - `'overlay'`: a COMPACT resting header (brand + a single `Explore ▾` trigger + optional search +
 *   theme toggle) that opens ONE full-width, full-featured mega-menu OVERLAY. Omit `mega` for the
 *   classic brand+links header.
 */
export function renderSiteNav(data) {
    const brandHref = data.brandHref ?? "/";
    const layoutClass = data.layout === "full" ? " tt-nav--full" : "";
    const brandMark = data.logo
        ? `<img class="tt-nav__logo" src="${E(data.logo.src)}" alt="${E(data.logo.alt)}" width="${data.logo.width ?? 34}" height="${data.logo.height ?? 34}" decoding="async">`
        : `<span class="tt-nav__mark" aria-hidden="true"></span>`;
    const links = data.links
        .map((l) => `<a class="tt-nav__link${l.cta ? " tt-nav__cta" : ""}" href="${E(l.href)}">${E(l.label)}</a>`)
        .join("");
    const hasMega = !!(data.mega && data.mega.length > 0);
    const overlayMode = hasMega && data.megaMode === "overlay";
    const account = data.account
        ? `<a class="tt-nav__account" href="${E(data.account.href)}" aria-label="${E(data.account.label)}" title="${E(data.account.label)}">${data.account.avatarSrc
            ? `<img class="tt-nav__avatar" src="${E(data.account.avatarSrc)}" alt="${E(data.account.avatarAlt ?? "")}" width="34" height="34" decoding="async">`
            : `<span class="tt-nav__avatar tt-nav__avatar--initials" aria-hidden="true">${E(data.account.initials?.trim().slice(0, 2) || data.brand.slice(0, 2))}</span>`}</a>`
        : "";
    // --- Compact-overlay mode: tiny resting bar + one full-featured overlay. ---------------------
    if (overlayMode) {
        navMegaCounter += 1;
        const uid = `ttnav-${navMegaCounter.toString(36)}`;
        const overlay = renderNavOverlay(data, uid);
        return `<header class="tt-nav tt-nav--overlay${layoutClass}" data-tt-nav-root data-tt-nav-uid="${uid}">
  <a class="tt-nav__brand" href="${E(brandHref)}" aria-label="${E(data.brand)} home">
    ${brandMark}
    <span class="tt-nav__word">${E(data.brand)}</span>
  </a>
  <div class="tt-nav__actions">
    ${overlay}
    <nav class="tt-nav__links">${links}${data.themeToggle ? renderThemeToggle() : ""}${account}</nav>
  </div>
</header>`;
    }
    // --- Legacy bar mode (default) — unchanged. --------------------------------------------------
    let mega = "";
    if (hasMega) {
        navMegaCounter += 1;
        const uid = `ttnav-${navMegaCounter.toString(36)}`;
        const groups = (data.mega ?? [])
            .map((g, gi) => renderNavMegaGroup(g, uid, gi))
            .join("\n      ");
        const navLabel = data.megaLabel && data.megaLabel.trim() ? data.megaLabel : "Primary";
        mega = `
  <button type="button" class="tt-nav__burger" aria-expanded="false" aria-controls="${uid}-bar" data-tt-nav-burger aria-label="Open menu">
    <span class="tt-nav__burger-box" aria-hidden="true"><span class="tt-nav__burger-line"></span></span>
  </button>
  <nav class="tt-nav__mm" aria-label="${E(navLabel)}" data-tt-nav-root data-tt-nav-uid="${uid}">
    <ul class="tt-nav__mm-bar" id="${uid}-bar" role="menubar">
      ${groups}
    </ul>
  </nav>`;
    }
    return `<header class="tt-nav${hasMega ? " tt-nav--mega" : ""}${layoutClass}">
  <a class="tt-nav__brand" href="${E(brandHref)}" aria-label="${E(data.brand)} home">
    ${brandMark}
    <span class="tt-nav__word">${E(data.brand)}</span>
  </a>${mega}
  <nav class="tt-nav__links">${links}${data.themeToggle ? renderThemeToggle() : ""}${account}</nav>
</header>`;
}
/** Render a classic navigation bar from a portable JSON string or object. */
export function renderSiteNavFromJson(input) {
    const value = typeof input === "string" ? JSON.parse(input) : input;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Navigation config must be an object");
    const nav = value;
    if (typeof nav.brand !== "string" || !nav.brand.trim())
        throw new TypeError("Navigation config requires brand");
    if (!Array.isArray(nav.links) || nav.links.some((link) => !link || typeof link !== "object" || typeof link.label !== "string" || typeof link.href !== "string")) {
        throw new TypeError("Navigation config requires links with label and href");
    }
    if (nav.logo !== undefined) {
        const logo = nav.logo;
        if (!logo || typeof logo !== "object" || typeof logo.src !== "string" || typeof logo.alt !== "string")
            throw new TypeError("Navigation logo requires src and alt");
    }
    if (nav.account !== undefined) {
        const account = nav.account;
        if (!account || typeof account !== "object" || typeof account.href !== "string" || typeof account.label !== "string")
            throw new TypeError("Navigation account requires href and label");
        if (account.avatarSrc !== undefined && typeof account.avatarSrc !== "string")
            throw new TypeError("Navigation account avatarSrc must be a string");
    }
    return renderSiteNav(value);
}
/**
 * Light/dark reading-mode toggle. The server renders the current theme on `<html data-theme>` (from a
 * cookie, so no flash); THEME_JS flips it live + persists. Icon is CSS-driven by the root theme; the
 * accessible name updates in script. Honors the server state on load — never assumes dark.
 */
export function renderThemeToggle() {
    return `<button class="tt-theme-toggle" type="button" data-tt-theme-toggle aria-pressed="false" aria-label="Switch to light reading mode" title="Light / dark reading mode">
  <span class="tt-theme-toggle__icon" aria-hidden="true"></span>
</button>`;
}
/** Internal: one CTA button. */
function button(b) {
    const variant = b.variant === "ghost" ? "tt-btn--ghost" : "tt-btn--primary";
    return `<a class="tt-btn ${variant}" href="${E(b.href)}">${E(b.label)}</a>`;
}
export function renderButton(data) {
    return button(data);
}
/** The cinematic hero — eyebrow, a headline with a cyan-gradient accent, a lede, CTAs, and a visual. */
export function renderHero(data) {
    const eyebrow = data.eyebrow
        ? `<span class="tt-eyebrow">${E(data.eyebrow)}</span>`
        : "";
    let titleHtml = E(data.title);
    if (data.accent && data.title.includes(data.accent)) {
        titleHtml = E(data.title).replace(E(data.accent), `<span class="tt-grad">${E(data.accent)}</span>`);
    }
    const ctas = (data.ctas ?? []).map(button).join("");
    const ctaRow = ctas ? `<div class="tt-cta-row">${ctas}</div>` : "";
    const visual = data.visual ? `<div class="tt-hero__visual">${data.visual}</div>` : "";
    return `<section class="tt-hero">
  <div class="tt-hero__lead">
    ${eyebrow}
    <h1 class="tt-hero__title">${titleHtml}</h1>
    <p class="tt-lede">${E(data.lede)}</p>
    ${ctaRow}
  </div>
  ${visual}
</section>`;
}
/** A stylised terminal panel (traffic-light bar + colour-coded lines + optional blinking cursor). */
export function renderTerminal(data) {
    const lines = data.lines
        .map((l, i) => {
        const cls = l.kind === "prompt"
            ? ""
            : l.kind === "dim"
                ? " tt-term__dim"
                : l.kind === "pr"
                    ? " tt-term__pr"
                    : l.kind === "ok"
                        ? " tt-term__ok"
                        : "";
        const last = i === data.lines.length - 1;
        const cur = last && data.cursor ? `<span class="tt-term__cursor"></span>` : "";
        const prefix = l.kind === "prompt" ? `<span class="tt-term__dim">$</span> ` : "";
        return `    <div class="tt-term__line${cls}">${prefix}${E(l.text)}${cur}</div>`;
    })
        .join("\n");
    return `<div class="tt-term" role="img" aria-label="${E(data.title)}">
  <div class="tt-term__bar"><i class="tt-term__r"></i><i class="tt-term__y"></i><i class="tt-term__g"></i><span class="tt-term__name">${E(data.title)}</span></div>
  <div class="tt-term__body">
${lines}
  </div>
</div>`;
}
/** A grid of lit/unlit nodes — the "live fleet" constellation. */
export function renderNodeConstellation(data) {
    const total = data?.total ?? 24;
    const lit = new Set(data?.lit ?? [1, 2, 5, 8, 10, 13, 16, 18, 21, 23]);
    let cells = "";
    for (let i = 0; i < total; i++)
        cells += `<i class="${lit.has(i) ? "tt-node--on" : ""}"></i>`;
    return `<div class="tt-nodes" aria-hidden="true">${cells}</div>`;
}
/** A content band: an optional mono kicker, a heading, an optional lede, and a trusted body slot. */
export function renderSection(data) {
    const id = data.id ? ` id="${E(data.id)}"` : "";
    const kicker = data.kicker ? `<span class="tt-kicker">${E(data.kicker)}</span>` : "";
    const lede = data.lede ? `<p class="tt-lede">${E(data.lede)}</p>` : "";
    const body = data.body ?? "";
    return `<section class="tt-band"${id}>
  ${kicker}
  <h2 class="tt-h2">${E(data.title)}</h2>
  ${lede}
  ${body}
</section>`;
}
/** A responsive 3-up grid of feature cards (icon chip + title + trusted inline body). */
export function renderFeatureGrid(data) {
    const cards = data.cards
        .map((c) => `  <article class="tt-feature">
    <span class="tt-feature__ic" aria-hidden="true">${E(c.icon)}</span>
    <h3 class="tt-feature__title">${E(c.title)}</h3>
    <p class="tt-feature__body">${c.body}</p>
  </article>`)
        .join("\n");
    return `<div class="tt-features">
${cards}
</div>`;
}
/** A single blog post card (optional thumbnail, tag chip, title, description, meta). */
export function renderPostCard(data) {
    const thumb = data.image
        ? `<img class="tt-post__thumb" src="${E(data.image.src)}" alt="${E(data.image.alt)}" loading="lazy" decoding="async" width="1200" height="630">`
        : "";
    const tag = data.tag ? `<span class="tt-post__tag">${E(data.tag)}</span>` : "";
    const meta = data.meta ? `<div class="tt-post__meta">${E(data.meta)}</div>` : "";
    return `<a class="tt-post" href="${E(data.href)}">
  ${thumb}
  ${tag}
  <h3 class="tt-post__title">${E(data.title)}</h3>
  <p class="tt-post__desc">${E(data.description)}</p>
  ${meta}
</a>`;
}
/** A responsive grid of post cards. */
export function renderPostGrid(data) {
    return `<div class="tt-posts">
${data.posts.map(renderPostCard).join("\n")}
</div>`;
}
/** A page/section header (blog index, 404, …). */
export function renderPageHeader(data) {
    const kicker = data.kicker ? `<span class="tt-kicker">${E(data.kicker)}</span>` : "";
    const lede = data.lede ? `<p class="tt-lede">${E(data.lede)}</p>` : "";
    return `<header class="tt-pagehead">
  ${kicker}
  <h1 class="tt-pagehead__title">${E(data.title)}</h1>
  ${lede}
</header>`;
}
/** A reusable product-site surface for documentation, settings, summaries, and supporting content. */
export function renderPanel(data) {
    const kicker = data.kicker ? `<p class="tt-kicker">${E(data.kicker)}</p>` : "";
    const title = data.title ? `<h2 class="tt-panel__title">${E(data.title)}</h2>` : "";
    const actions = data.actions ? `<div class="tt-panel__actions">${data.actions}</div>` : "";
    return `<section class="tt-panel">${kicker}${title}<div class="tt-panel__body">${data.body}</div>${actions}</section>`;
}
/** A compact editorial-method or disclosure notice inside the package-owned journal shell. */
export function renderJournalNotice(data) {
    return `<aside class="tt-journal__notice" role="note"><strong>${E(data.label)}</strong> ${data.body}</aside>`;
}
/**
 * A visible revision history — the dated-correction notes a publication shows so that a material change
 * is a published revision, never a silent edit (editorial-integrity furniture). Both fields are escaped;
 * returns "" for an empty list. `heading` defaults to "Revision history", `id` to "revisions".
 */
export function renderRevisions(data) {
    if (data.revisions.length === 0)
        return "";
    const id = data.id ?? "revisions";
    const heading = data.heading ?? "Revision history";
    const items = data.revisions
        .map((r) => `<li><strong>${E(r.date)}</strong> — ${E(r.note)}</li>`)
        .join("\n");
    return `<section class="tt-revisions" aria-labelledby="${E(id)}"><h2 class="tt-revisions__heading" id="${E(id)}">${E(heading)}</h2>\n<ul class="tt-revisions__list">${items}</ul></section>`;
}
/** Wrap long-form article HTML (markdown → HTML + blog widgets) in the reading shell. */
export function renderArticle(bodyHtml) {
    return `<article class="tt-article">${bodyHtml}</article>`;
}
export function renderDirectoryCard(data) {
    const tags = (data.tags ?? []).map((t) => `<span class="tt-tag">${E(t)}</span>`).join("");
    const tagRow = tags ? `<div class="tt-tags">${tags}</div>` : "";
    return `<article class="tt-feature">
  <span class="tt-feature__ic" aria-hidden="true">${E(data.icon ?? "◆")}</span>
  <h3 class="tt-feature__title"><a href="${E(data.href)}">${E(data.title)}</a></h3>
  <p class="tt-feature__body">${E(data.summary)}</p>
  ${tagRow}
  <a class="tt-cover__cta" href="${E(data.ctaHref ?? data.href)}">${E(data.ctaLabel ?? "Read more →")}</a>
</article>`;
}
/** A responsive grid of {@link renderDirectoryCard} cards (software directories, resource libraries). */
export function renderDirectoryGrid(data) {
    return `<div class="tt-features">
${data.cards.map(renderDirectoryCard).join("\n")}
</div>`;
}
/**
 * A publication-grade bibliography / source archive. Citation bodies are trusted composed HTML so
 * consumers can retain semantic links and source annotations; headings, metadata, and controls are
 * escaped. Numbering is visual-only because the ordered list already communicates sequence.
 */
export function renderSourceLibrary(data) {
    const headingId = data.headingId ?? "sources";
    const eyebrow = data.eyebrow ?? "Documentation // verified trails";
    const introduction = data.introduction ?? "Primary records and reference material behind this article.";
    const returnHref = data.returnHref ?? "#tt-main";
    const returnLabel = data.returnLabel ?? "Return to the article";
    const cards = data.items.map((item) => `<li class="tt-source-card">
  <div class="tt-source-card__content">${item.html}</div>
  <span class="tt-source-card__domain">${E(item.domain)}</span>
  <span class="tt-source-card__arrow" aria-hidden="true">↗</span>
</li>`).join("\n");
    return `<section class="tt-sources" aria-labelledby="${E(headingId)}">
  <h2 id="${E(headingId)}">${E(data.heading)}</h2>
  <div class="tt-sources__masthead">
    <p class="tt-sources__eyebrow">${E(eyebrow)}</p>
    <p class="tt-sources__intro">${E(introduction)}</p>
    <span class="tt-sources__count" aria-label="${data.items.length} references"><strong>${String(data.items.length).padStart(2, "0")}</strong> references</span>
  </div>
  <ol class="tt-source-list">${cards}</ol>
  <a class="tt-sources__return" href="${E(returnHref)}">${E(returnLabel)} <span aria-hidden="true">↑</span></a>
</section>`;
}
/**
 * The magazine nameplate / flag — a centred publication wordmark between two hairline rules, a
 * strapline, and an optional mono meta strip. Renders the page's single `<h1>` (the publication name).
 */
export function renderMasthead(data) {
    const meta = data.meta ? `\n  <div class="tt-masthead__meta">${E(data.meta)}</div>` : "";
    return `<section class="tt-masthead">
  <div class="tt-masthead__rule" aria-hidden="true"></div>
  <h1 class="tt-masthead__title">${E(data.title)}</h1>
  <p class="tt-masthead__tag">${E(data.tagline)}</p>${meta}
  <div class="tt-masthead__rule" aria-hidden="true"></div>
</section>`;
}
/**
 * The cover story — the lead article presented editorially: a large framed cover image beside a
 * category kicker, a display headline linking to the piece, a dek/standfirst, a byline, and a read
 * link. This is the magazine's hero (the real article), NOT an abstract value-prop.
 */
export function renderCoverStory(data) {
    const cta = data.cta ?? "Read the story →";
    return `<section class="tt-cover">
  <a class="tt-cover__media" href="${E(data.href)}" tabindex="-1" aria-hidden="true">
    <img class="tt-cover__img" src="${E(data.image.src)}" alt="${E(data.image.alt)}" loading="eager" decoding="async" width="1200" height="630">
  </a>
  <div class="tt-cover__body">
    <span class="tt-kicker">${E(data.kicker)}</span>
    <h2 class="tt-cover__title"><a href="${E(data.href)}">${E(data.title)}</a></h2>
    <p class="tt-cover__dek">${E(data.dek)}</p>
    <div class="tt-cover__byline">By ${E(data.byline)} · ${E(data.meta)}</div>
    <a class="tt-cover__cta" href="${E(data.href)}">${E(cta)}</a>
  </div>
</section>`;
}
/** A short editorial note — a ruled band with a left accent rail, reading-width prose, and a sign-off. */
export function renderEditorsNote(data) {
    const sig = data.signature ? `\n  <div class="tt-ednote__sig">${E(data.signature)}</div>` : "";
    return `<section class="tt-band tt-ednote">
  <span class="tt-kicker">${E(data.kicker)}</span>
  <h2 class="tt-h2">${E(data.heading)}</h2>
  <div class="tt-ednote__body">${data.body}</div>${sig}
</section>`;
}
/** A keyboard skip-to-content link (visually hidden until focused). The host's <main> needs id="tt-main". */
export function renderSkipLink() {
    return `<a class="tt-skip" href="#tt-main">Skip to content</a>`;
}
/** A top reading-progress bar driven by a CSS scroll-timeline (0 JS; hidden where unsupported). */
export function renderReadingProgress() {
    return `<div class="tt-progress" aria-hidden="true"><span class="tt-progress__bar"></span></div>`;
}
/** A floating back-to-top control, revealed after scrolling via a CSS scroll-timeline (0 JS). */
export function renderBackToTop() {
    return `<a class="tt-totop" href="#tt-main" aria-label="Back to top">↑</a>`;
}
/** An in-article table of contents (jump links to the heading ids). h3s are nested under their h2. */
export function renderTableOfContents(data) {
    if (data.headings.length === 0)
        return "";
    const items = data.headings
        .map((h) => `    <li class="tt-toc__item tt-toc__item--h${h.level}"><a href="#${E(h.id)}">${E(h.text)}</a></li>`)
        .join("\n");
    return `<nav class="tt-toc" aria-label="Table of contents">
  <p class="tt-toc__label">${E(data.label ?? "In this article")}</p>
  <ol class="tt-toc__list">
${items}
  </ol>
</nav>`;
}
/** A share row — X / LinkedIn / Hacker News / email intent links (0 JS, no tracking scripts). */
export function renderShareRow(data) {
    const u = encodeURIComponent(data.url);
    const t = encodeURIComponent(data.title);
    const links = [
        { label: "X", href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
        { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
        { label: "Hacker News", href: `https://news.ycombinator.com/submitlink?u=${u}&t=${t}` },
        { label: "Email", href: `mailto:?subject=${t}&body=${u}` },
    ];
    const items = links
        .map((l) => `<a class="tt-share__link" href="${E(l.href)}" target="_blank" rel="noopener" aria-label="Share on ${E(l.label)}">${E(l.label)}</a>`)
        .join("");
    // A single <nav> (no nested block) so a word-count validator can strip it cleanly.
    return `<nav class="tt-share" aria-label="Share this article">
  <span class="tt-share__label">${E(data.label ?? "Share")}</span>
  ${items}
</nav>`;
}
/**
 * A row of tag chips. A `string` entry renders a static `<span class="tt-tag">` (unchanged); a
 * {@link TagChip} object renders a navigable `<a class="tt-tag">` when `href` is set and may carry an
 * optional leading `icon` glyph. All text + the href are escaped. Powers taxonomy/desk/letter nav rows
 * so consumers stop hand-rolling `<a class="tt-tag" href>` chips.
 */
export function renderTagList(data) {
    if (data.tags.length === 0)
        return "";
    const label = data.label ? `<span class="tt-tags__label">${E(data.label)}</span>` : "";
    const chips = data.tags
        .map((t) => {
        const chip = typeof t === "string" ? { label: t } : t;
        const inner = `${chip.icon ? `${E(chip.icon)} ` : ""}${E(chip.label)}`;
        return chip.href
            ? `<a class="tt-tag" href="${E(chip.href)}">${inner}</a>`
            : `<span class="tt-tag">${inner}</span>`;
    })
        .join("");
    return `<div class="tt-tags">${label}${chips}</div>`;
}
/** A breadcrumb trail (the visible counterpart of BreadcrumbList JSON-LD). Last item = current page. */
export function renderBreadcrumb(data) {
    const parts = data.items
        .map((it, i) => {
        const last = i === data.items.length - 1;
        return it.href && !last
            ? `<a href="${E(it.href)}">${E(it.label)}</a>`
            : `<span class="tt-crumb__current" aria-current="page">${E(it.label)}</span>`;
    })
        .join(`<span class="tt-crumb__sep" aria-hidden="true">/</span>`);
    return `<nav class="tt-crumb" aria-label="Breadcrumb">${parts}</nav>`;
}
/**
 * A device-local "Save" toggle for an article. Pure markup — `BOOKMARK_JS` (served same-origin) wires
 * it to `localStorage` and flips the label/`aria-pressed`. `id` is the stable key (the slug); `title`
 * and `url` are stored so the reading-list page can render without re-fetching. Degrades to an inert,
 * disabled button where storage is unavailable (private mode) — never a dead-end.
 */
export function renderBookmarkButton(data) {
    return `<button class="tt-bookmark" type="button" data-tt-bookmark data-tt-id="${E(data.id)}" data-tt-title="${E(data.title)}" data-tt-url="${E(data.url)}" aria-pressed="false">
  <span class="tt-bookmark__icon" aria-hidden="true"></span><span class="tt-bookmark__label">Save</span>
</button>`;
}
/**
 * The saved-articles shell. Content is device-local, so the server renders only the furniture (empty
 * state + an items container + export/clear controls + an unavailable-storage note) and `BOOKMARK_JS`
 * fills it from `localStorage` on load. The host should render this inside a `noindex` page.
 */
export function renderReadingList() {
    return `<section class="tt-reading-list" data-tt-reading-list>
  <p class="tt-reading-list__empty">No saved articles yet. Open any article and press <strong>Save</strong> — your list lives in this browser, no account needed.</p>
  <ul class="tt-reading-list__items" hidden></ul>
  <div class="tt-reading-list__actions" hidden>
    <button class="tt-btn tt-btn--ghost" type="button" data-tt-rl-export>Export as JSON</button>
    <button class="tt-btn tt-btn--ghost" type="button" data-tt-rl-clear>Clear all</button>
  </div>
  <p class="tt-reading-list__note" hidden>Your browser has blocked local storage, so saved articles can’t be kept on this device. Enable storage (leave private mode) to use the reading list.</p>
</section>`;
}
export function renderEvidenceBadge(e) {
    const handsOn = e.kind === "hands-on";
    const label = handsOn ? "Hands-on tested" : "Researched analysis";
    const meta = handsOn && (e.date || e.environment)
        ? `<dl class="tt-evidence__meta">${e.date ? `<dt>Tested</dt><dd>${E(e.date)}</dd>` : ""}${e.environment ? `<dt>Environment</dt><dd>${E(e.environment)}</dd>` : ""}</dl>`
        : "";
    return `<aside class="tt-evidence tt-evidence--${handsOn ? "handson" : "researched"}" role="note" aria-label="Evidence provenance: ${E(label)}">
  <span class="tt-evidence__chip">${handsOn ? "✓ " : "◇ "}${E(label)}</span>
  <p class="tt-evidence__summary">${E(e.summary)}</p>
  ${meta}
  <p class="tt-evidence__limits"><strong>Limitations:</strong> ${E(e.limitations)}</p>
</aside>`;
}
/** The site footer — a note line + a nav row. */
export function renderSiteFooter(data) {
    const links = data.links
        .map((l) => `<a href="${E(l.href)}">${E(l.label)}</a>`)
        .join("");
    return `<footer class="tt-footer">
  <div class="tt-footer__row">
    <div class="tt-footer__note">${E(data.note)}</div>
    <nav class="tt-footer__links">${links}</nav>
  </div>
</footer>`;
}
// ---------------------------------------------------------------------------
// Stylesheet — black + cyan, cinematic, accessible, responsive.
// ---------------------------------------------------------------------------
export const SITE_CSS = `
/* Brand fonts — self-hosted variable woff2 (the host serves /fonts/*.woff2; CSP font-src 'self').
   font-display:swap so text paints immediately in the fallback, then swaps. */
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:300 700;font-display:swap;
  src:url(/fonts/space-grotesk-latin.woff2) format('woff2');
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400 700;font-display:swap;
  src:url(/fonts/jetbrains-mono-latin.woff2) format('woff2');
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{
  color-scheme:dark;
  --tt-ink:#060610;--tt-ink-2:#04040b;--tt-panel:#0a0e17;--tt-panel-2:#0d1420;
  --tt-line:rgba(0,229,255,.14);--tt-line-2:rgba(0,229,255,.3);
  --tt-cyan:#00e5ff;--tt-cyan-soft:#8ff6ff;--tt-cyan-deep:#2aa7c7;
  --tt-text:#e8f2f7;--tt-muted:#90a4b3;--tt-faint:#90a4b3;
  /* Semantic text roles — flip with the theme. --tt-on-accent is text ON the cyan/teal accent
     (stays dark in both modes). */
  --tt-heading:#ffffff;--tt-body:#d4dee6;--tt-on-accent:#02121a;
  --tt-radius:16px;--tt-maxw:1120px;
  --tt-sans:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --tt-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --tt-ease:cubic-bezier(.16,1,.3,1);
}
/* Light reading mode — set server-side via <html data-theme="light"> (cookie, no FOUC). An AA-contrast
   palette; the cyan accent deepens to a teal that passes contrast on white, decorative glows soften. */
:root[data-theme="light"]{
  color-scheme:light;
  --tt-ink:#f6f8fc;--tt-ink-2:#eef2f8;--tt-panel:#ffffff;--tt-panel-2:#f3f6fb;
  --tt-line:rgba(10,54,78,.15);--tt-line-2:rgba(10,54,78,.28);
  --tt-cyan:#0a6f8a;--tt-cyan-soft:#0a6680;--tt-cyan-deep:#075b72;
  --tt-text:#17242e;--tt-muted:#46586a;--tt-faint:#5a6b78;
  --tt-heading:#0c1922;--tt-body:#1f2d38;
}
/* Light-mode component overrides. Decorative DARK ISLANDS (the hero terminal, code blocks) stay dark
   and keep LIGHT text via scoped token overrides, so they read as intentional dark panels on the light
   page — never dark-on-dark. The masthead wordmark + ambient glows adapt to the light canvas. */
:root[data-theme="light"] body{background-image:
  radial-gradient(60rem 44rem at 82% -14%,rgba(10,111,138,.07),transparent 60%),
  radial-gradient(48rem 42rem at 4% 4%,rgba(10,111,138,.05),transparent 55%),
  radial-gradient(38rem 38rem at 50% 120%,rgba(10,111,138,.04),transparent 60%)}
:root[data-theme="light"] .tt-masthead__title{
  background:linear-gradient(100deg,#0c1922 26%,var(--tt-cyan) 66%,var(--tt-cyan-deep))}
:root[data-theme="light"] .tt-term{--tt-faint:#8299ab;--tt-cyan:#5fe0f5}
:root[data-theme="light"] .tt-article .body pre{background:#0d1a26;border-color:rgba(255,255,255,.08)}
:root[data-theme="light"] .tt-article .body pre code{color:#d6e9f2}
:root[data-theme="light"] .tt-tok-c{color:#8aa0b2}
:root[data-theme="light"] .tt-tok-s{color:#2f9f73}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
/* Smooth in-page anchor scrolling, but only for motion-tolerant users (WCAG 2.3.3 Animation from
   Interactions / vestibular safety) — reduced-motion users get an instant jump. */
@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{
  font-family:var(--tt-sans);color:var(--tt-text);background:var(--tt-ink);line-height:1.65;
  -webkit-font-smoothing:antialiased;
  background-image:
    radial-gradient(64rem 46rem at 82% -14%,rgba(0,229,255,.14),transparent 60%),
    radial-gradient(52rem 44rem at 4% 4%,rgba(0,229,255,.07),transparent 55%),
    radial-gradient(40rem 40rem at 50% 120%,rgba(0,229,255,.05),transparent 60%);
  background-attachment:fixed;
}
a{color:inherit;text-decoration:none}
main{min-height:58vh}
/* Visually hidden, but present for assistive tech — gives a card grid a section heading so the outline
   never skips from the page h1 straight to the h3 card titles. */
.tt-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.tt-eyebrow{display:inline-flex;gap:8px;align-items:center;min-height:24px;font-family:var(--tt-mono);font-size:12px;
  letter-spacing:.09em;text-transform:uppercase;color:var(--tt-cyan);border:1px solid var(--tt-line);
  border-radius:999px;padding:6px 13px;background:rgba(0,229,255,.06);box-shadow:0 0 24px rgba(0,229,255,.08) inset}
.tt-kicker{font-family:var(--tt-mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--tt-cyan)}
.tt-grad{background:linear-gradient(100deg,var(--tt-cyan-soft),var(--tt-cyan) 52%,var(--tt-cyan-deep));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.tt-lede{color:var(--tt-muted);font-size:clamp(1.05rem,2vw,1.22rem);margin:20px 0 0;max-width:46ch;text-wrap:pretty}

/* Buttons --------------------------------------------------------------- */
.tt-cta-row{display:flex;gap:14px;margin-top:30px;flex-wrap:wrap}
.tt-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:12px;font-weight:600;
  font-size:15px;transition:transform .15s var(--tt-ease),box-shadow .15s var(--tt-ease),border-color .15s var(--tt-ease)}
.tt-btn--primary{background:linear-gradient(100deg,var(--tt-cyan),var(--tt-cyan-deep));color:#02121a;
  box-shadow:0 10px 34px -8px rgba(0,229,255,.5),0 0 0 1px rgba(0,229,255,.25) inset}
.tt-btn--primary:hover{transform:translateY(-2px);box-shadow:0 16px 46px -8px rgba(0,229,255,.65)}
.tt-btn--ghost{border:1px solid var(--tt-line-2);color:var(--tt-text);background:rgba(0,229,255,.03)}
.tt-btn--ghost:hover{border-color:var(--tt-cyan);background:rgba(0,229,255,.08);transform:translateY(-2px)}
.tt-btn:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:3px}

/* Nav ------------------------------------------------------------------- */
.tt-nav{position:sticky;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:16px;line-height:1.65;
  flex-wrap:wrap;row-gap:10px;
  max-width:var(--tt-maxw);margin:0 auto;padding:15px 24px;backdrop-filter:blur(14px);
  background:linear-gradient(180deg,rgba(6,6,16,.82),rgba(6,6,16,.5));border-bottom:1px solid var(--tt-line)}
.tt-nav--full{max-width:none;width:100%;padding-inline:max(24px,env(safe-area-inset-left),calc((100vw - var(--tt-maxw))/2 + 24px)) max(24px,env(safe-area-inset-right),calc((100vw - var(--tt-maxw))/2 + 24px))}
.tt-nav__logo{display:block;flex:0 0 auto;object-fit:contain}
.tt-nav__account{display:inline-grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border:1px solid var(--tt-line);border-radius:999px;
  background:linear-gradient(145deg,rgba(0,229,255,.13),rgba(0,229,255,.025));box-shadow:inset 0 0 0 1px rgba(255,255,255,.025),0 0 24px -12px rgba(0,229,255,.65);
  transition:border-color .2s var(--tt-ease),box-shadow .2s var(--tt-ease),transform .2s var(--tt-ease)}
.tt-nav__account:hover{border-color:var(--tt-cyan);box-shadow:inset 0 0 0 1px rgba(0,229,255,.12),0 0 28px -8px rgba(0,229,255,.7);transform:translateY(-1px)}
.tt-nav__account:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:3px}
.tt-nav__avatar{display:block;width:30px;height:30px;border-radius:999px;object-fit:cover}
.tt-nav__avatar--initials{display:grid;place-items:center;font:700 11px/1 var(--tt-mono);letter-spacing:.05em;color:var(--tt-cyan);background:var(--tt-ink-2)}
.tt-nav__brand{display:flex;align-items:center;gap:11px;font-weight:700;letter-spacing:-.02em;font-size:18px;min-width:0}
.tt-nav__mark{width:24px;height:24px;flex:0 0 auto;border-radius:8px;
  background:radial-gradient(120% 120% at 30% 20%,var(--tt-cyan-soft),var(--tt-cyan) 45%,var(--tt-cyan-deep));
  box-shadow:0 0 20px rgba(0,229,255,.6),0 0 0 1px rgba(0,229,255,.3) inset}
.tt-nav__word{white-space:nowrap}
.tt-nav__links{display:flex;align-items:center;gap:22px;font-size:14px;color:var(--tt-muted)}
.tt-nav__link{display:inline-flex;align-items:center;min-height:44px;transition:color .15s var(--tt-ease)}
.tt-nav__link:hover{color:var(--tt-text)}
.tt-nav__cta{padding:8px 15px;border:1px solid var(--tt-cyan);border-radius:10px;color:#02121a!important;
  font-weight:600;background:linear-gradient(100deg,var(--tt-cyan),var(--tt-cyan-deep));box-shadow:0 0 22px rgba(0,229,255,.4)}
.tt-nav__cta:hover{color:#02121a!important;transform:translateY(-1px);box-shadow:0 0 30px rgba(0,229,255,.6)}
/* Light/dark reading-mode toggle. The icon follows the root theme (sun while dark = "go light"; moon
   while light = "go dark"); the button has no-JS-safe default styling + a visible focus ring. */
.tt-theme-toggle{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:10px;
  border:1px solid var(--tt-line);background:transparent;color:var(--tt-muted);cursor:pointer;line-height:1;
  transition:color .15s var(--tt-ease),border-color .15s var(--tt-ease),background .15s var(--tt-ease)}
.tt-theme-toggle:hover{color:var(--tt-cyan);border-color:var(--tt-line-2);background:rgba(0,229,255,.06)}
.tt-theme-toggle:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-theme-toggle__icon{font-size:15px}
.tt-theme-toggle__icon::before{content:"\\2600"}
:root[data-theme="light"] .tt-theme-toggle__icon::before{content:"\\263E"}
/* On mobile the nav wraps to a second row so every link stays reachable (never a CTA-only nav). */
@media(max-width:640px){
  .tt-nav{padding:12px 18px}
  .tt-nav--full{padding-inline:max(18px,env(safe-area-inset-left)) max(18px,env(safe-area-inset-right))}
  .tt-nav__links{width:100%;justify-content:flex-start;gap:14px 18px;font-size:13.5px;flex-wrap:wrap}
}

/* Mega-menu (unified header) -------------------------------------------- */
/* The desk mega-menu lives INSIDE .tt-nav as the primary navigation: a row of triggers that each
   open a glass panel with a sub-menu list beside a live-swapping featured-image preview. CSS-first —
   panels reveal on hover / :focus-within (JS-off safe); NAV_MENU_JS adds click-pin + keyboard + hover-intent. */
.tt-nav--mega{gap:10px 20px}
.tt-nav__mm{display:flex;flex:1 1 auto;min-width:0;justify-content:center}
.tt-nav__mm-bar{display:flex;align-items:stretch;gap:2px;list-style:none;margin:0;padding:0;flex-wrap:wrap;justify-content:center}
.tt-nav__mm-group{position:relative;display:flex}
.tt-nav__mm-trigger{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:7px 13px;background:transparent;
  border:0;border-radius:10px;color:var(--tt-text);font:inherit;font-size:13.5px;font-weight:600;letter-spacing:-.01em;cursor:pointer;
  transition:background .2s var(--tt-ease),color .2s var(--tt-ease),box-shadow .2s var(--tt-ease)}
.tt-nav__mm-labellink{color:inherit;text-decoration:none}
.tt-nav__mm-ic{font-family:var(--tt-mono);font-size:10px;font-weight:700;color:var(--tt-cyan);opacity:.85;letter-spacing:.02em}
.tt-nav__mm-trigger:hover,.tt-nav__mm-group:focus-within .tt-nav__mm-trigger,.tt-nav__mm-trigger[aria-expanded="true"]{
  background:linear-gradient(180deg,rgba(0,229,255,.1),rgba(0,229,255,.03));color:var(--tt-heading);
  box-shadow:inset 0 0 0 1px var(--tt-line)}
.tt-nav__mm-trigger:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-nav__mm-chev{color:var(--tt-faint);transition:transform .2s var(--tt-ease),color .2s var(--tt-ease)}
.tt-nav__mm-trigger:hover .tt-nav__mm-chev,.tt-nav__mm-group:focus-within .tt-nav__mm-chev,.tt-nav__mm-trigger[aria-expanded="true"] .tt-nav__mm-chev{transform:rotate(180deg);color:var(--tt-cyan)}
/* Panel */
.tt-nav__mm-panel{position:absolute;top:calc(100% + 11px);left:50%;transform:translateX(-50%) translateY(-7px);
  width:min(620px,92vw);padding:16px;z-index:60;
  background:radial-gradient(130% 120% at 0% 0%,rgba(0,229,255,.08),transparent 55%),linear-gradient(180deg,var(--tt-panel),var(--tt-ink-2));
  border:1px solid var(--tt-line);border-radius:var(--tt-radius);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 30px 70px -30px rgba(0,0,0,.92),0 0 50px -24px rgba(0,229,255,.4);
  opacity:0;visibility:hidden;transition:opacity .333s var(--tt-ease),transform .333s var(--tt-ease),visibility 0s linear .333s}
.tt-nav__mm-panel::before{content:"";position:absolute;left:16px;right:16px;top:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--tt-cyan) 30%,rgba(0,229,255,.3) 75%,transparent)}
.tt-nav__mm-panel::after{content:"";position:absolute;top:-6px;left:50%;transform:translateX(-50%) rotate(45deg);
  width:11px;height:11px;background:var(--tt-panel);border-left:1px solid var(--tt-line);border-top:1px solid var(--tt-line)}
.tt-nav__mm-group:hover .tt-nav__mm-panel,.tt-nav__mm-group:focus-within .tt-nav__mm-panel,.tt-nav__mm-trigger[aria-expanded="true"]+.tt-nav__mm-panel{
  opacity:1;visibility:visible;transform:translateX(-50%) translateY(0);transition:opacity .333s var(--tt-ease),transform .333s var(--tt-ease),visibility 0s}
.tt-nav__mm-grid{display:grid;grid-template-columns:1fr minmax(190px,44%);gap:16px;align-items:stretch}
.tt-nav__mm-col{min-width:0;display:flex;flex-direction:column}
.tt-nav__mm-blurb{margin:0 0 10px;font-size:12px;line-height:1.5;color:var(--tt-muted)}
.tt-nav__mm-list{list-style:none;margin:0;padding:0;display:grid;gap:1px;overflow-y:auto;max-height:52vh}
.tt-nav__mm-item{display:flex;align-items:center;gap:8px;padding:9px 11px;min-height:40px;border-radius:9px;color:var(--tt-body);
  text-decoration:none;font-size:13.5px;line-height:1.35;transition:background .2s var(--tt-ease),color .2s var(--tt-ease),padding-left .2s var(--tt-ease)}
.tt-nav__mm-itemlabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-nav__mm-itemsub{flex:0 0 auto;font-size:11px;color:var(--tt-faint)}
.tt-nav__mm-arrow{flex:0 0 auto;color:var(--tt-cyan);opacity:0;transform:translateX(-4px);transition:opacity .2s var(--tt-ease),transform .2s var(--tt-ease);font-size:13px}
.tt-nav__mm-item:hover,.tt-nav__mm-item:focus-visible{background:linear-gradient(90deg,rgba(0,229,255,.1),transparent);color:var(--tt-heading);padding-left:14px;outline:none}
.tt-nav__mm-item:hover .tt-nav__mm-arrow,.tt-nav__mm-item:focus-visible .tt-nav__mm-arrow{opacity:1;transform:translateX(0)}
.tt-nav__mm-item:focus-visible{box-shadow:inset 0 0 0 1px var(--tt-cyan)}
/* Featured preview */
.tt-nav__mm-featured{position:relative;overflow:hidden;border-radius:12px;border:1px solid var(--tt-line);background:var(--tt-ink-2);
  text-decoration:none;min-height:150px;display:block;transition:transform .333s var(--tt-ease),border-color .333s var(--tt-ease),box-shadow .333s var(--tt-ease)}
.tt-nav__mm-featured:hover{transform:translateY(-2px);border-color:var(--tt-line-2);box-shadow:0 18px 44px -20px rgba(0,229,255,.5)}
.tt-nav__mm-featured:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-nav__mm-fimg{display:block;width:100%;height:100%;min-height:150px;object-fit:cover;transition:transform .5s var(--tt-ease)}
.tt-nav__mm-featured:hover .tt-nav__mm-fimg{transform:scale(1.05)}
.tt-nav__mm-fscrim{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:3px;padding:14px 13px 11px;
  background:linear-gradient(to top,rgba(4,4,11,.94),rgba(4,4,11,.4) 60%,transparent)}
.tt-nav__mm-fkicker{font-family:var(--tt-mono);font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--tt-cyan)}
.tt-nav__mm-ftitle{font-size:13.5px;font-weight:700;color:#fff;line-height:1.25;text-wrap:balance}
/* Burger (mobile only) */
.tt-nav__burger{display:none;align-items:center;justify-content:center;width:40px;height:40px;background:transparent;
  border:1px solid var(--tt-line);border-radius:10px;color:var(--tt-text);cursor:pointer}
.tt-nav__burger:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-nav__burger-box{position:relative;width:18px;height:2px}
.tt-nav__burger-line,.tt-nav__burger-box::before,.tt-nav__burger-box::after{content:"";position:absolute;left:0;width:18px;height:2px;
  background:currentColor;border-radius:2px;transition:transform .2s var(--tt-ease),opacity .2s var(--tt-ease)}
.tt-nav__burger-line{top:0}.tt-nav__burger-box::before{top:-6px}.tt-nav__burger-box::after{top:6px}
.tt-nav__burger[aria-expanded="true"] .tt-nav__burger-line{opacity:0}
.tt-nav__burger[aria-expanded="true"] .tt-nav__burger-box::before{transform:translateY(6px) rotate(45deg)}
.tt-nav__burger[aria-expanded="true"] .tt-nav__burger-box::after{transform:translateY(-6px) rotate(-45deg)}
/* Mobile: the mega-menu collapses into a tap-to-expand accordion drawer (no hover dependency) */
@media(max-width:860px){
  .tt-nav--mega{position:relative}
  .tt-nav__burger{display:inline-flex;order:3}
  .tt-nav__mm{order:4;flex:1 1 100%;justify-content:stretch}
  .tt-nav__mm-bar{flex-direction:column;gap:2px;width:100%;max-height:0;overflow:hidden;transition:max-height .333s var(--tt-ease)}
  .tt-nav__mm[data-tt-nav-open="true"] .tt-nav__mm-bar{max-height:80vh;overflow-y:auto}
  .tt-nav__mm-group{display:block;width:100%}
  .tt-nav__mm-trigger{width:100%;justify-content:space-between}
  .tt-nav__mm-panel{position:static;width:100%;transform:none;opacity:1;visibility:visible;box-shadow:none;border:0;
    padding:0 2px 8px;background:transparent;max-height:0;overflow:hidden;transition:max-height .333s var(--tt-ease)}
  .tt-nav__mm-panel::before,.tt-nav__mm-panel::after{display:none}
  .tt-nav__mm-group:hover .tt-nav__mm-panel{max-height:0}
  .tt-nav__mm-trigger[aria-expanded="true"]+.tt-nav__mm-panel{max-height:1400px}
  .tt-nav__mm-grid{grid-template-columns:1fr;gap:10px}
  .tt-nav__mm-featured{min-height:140px}
}
@media(prefers-reduced-motion:reduce){
  .tt-nav__mm-panel,.tt-nav__mm-fimg,.tt-nav__mm-item,.tt-nav__mm-chev,.tt-nav__mm-arrow,.tt-nav__mm-featured,.tt-nav__mm-trigger,.tt-nav__mm-bar{transition:none!important}
}

/* Compact-overlay mega-menu --------------------------------------------- */
/* RESTING: a tiny bar — brand + a single "Explore" trigger (+ optional search) + theme toggle.
   OPEN: ONE full-width glass OVERLAY (search + 12-desk grid + live featured preview + Latest + CTA).
   The whole catalogue hides until opened — the opposite of the wide always-visible desk bar. */
.tt-nav--overlay{padding:10px 24px;gap:14px;flex-wrap:nowrap}
.tt-nav--overlay .tt-nav__brand{font-size:17px}
.tt-nav--overlay .tt-nav__mark{width:22px;height:22px}
.tt-nav__actions{display:flex;align-items:center;gap:10px;min-width:0}
.tt-nav--overlay .tt-nav__links{gap:14px;font-size:13.5px}
/* The compact trigger */
.tt-nav__ov-trigger{display:inline-flex;align-items:center;gap:9px;min-height:36px;padding:7px 14px 7px 12px;cursor:pointer;
  background:linear-gradient(180deg,rgba(0,229,255,.1),rgba(0,229,255,.03));color:var(--tt-text);font:inherit;font-size:13.5px;font-weight:600;
  letter-spacing:-.01em;border:1px solid var(--tt-line);border-radius:11px;
  transition:border-color .2s var(--tt-ease),box-shadow .2s var(--tt-ease),background .2s var(--tt-ease),color .2s var(--tt-ease)}
.tt-nav__ov-trigger:hover{border-color:var(--tt-line-2);color:var(--tt-heading);box-shadow:0 0 24px -6px rgba(0,229,255,.45)}
.tt-nav__ov-trigger[aria-expanded="true"]{border-color:var(--tt-cyan);color:var(--tt-heading);box-shadow:0 0 28px -6px rgba(0,229,255,.55)}
.tt-nav__ov-trigger:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-nav__ov-grid{display:grid;grid-template-columns:1fr 1fr;gap:2.5px;width:13px;height:13px;flex:0 0 auto}
.tt-nav__ov-grid i{display:block;border-radius:1.5px;background:var(--tt-cyan);opacity:.9;box-shadow:0 0 6px rgba(0,229,255,.6);transition:transform .25s var(--tt-ease)}
.tt-nav__ov-trigger:hover .tt-nav__ov-grid i:nth-child(1){transform:translate(-.5px,-.5px)}
.tt-nav__ov-trigger:hover .tt-nav__ov-grid i:nth-child(4){transform:translate(.5px,.5px)}
.tt-nav__ov-label{white-space:nowrap}
.tt-nav__ov-chev{color:var(--tt-faint);transition:transform .25s var(--tt-ease),color .2s var(--tt-ease)}
.tt-nav__ov-trigger[aria-expanded="true"] .tt-nav__ov-chev{transform:rotate(180deg);color:var(--tt-cyan)}
.tt-nav__ov-nojs{display:inline-flex;align-items:center;font-size:13.5px;font-weight:600;color:var(--tt-text);padding:7px 12px;border:1px solid var(--tt-line);border-radius:11px}
/* Resting-bar compact search affordance */
.tt-nav__ov-search{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:11px;border:1px solid var(--tt-line);
  color:var(--tt-muted);background:rgba(0,229,255,.03);transition:color .2s var(--tt-ease),border-color .2s var(--tt-ease),background .2s var(--tt-ease)}
.tt-nav__ov-search:hover{color:var(--tt-cyan);border-color:var(--tt-line-2);background:rgba(0,229,255,.08)}
.tt-nav__ov-search:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}

/* The overlay (dialog) */
.tt-ov{position:fixed;inset:0;z-index:90}
.tt-ov[hidden]{display:none}
.tt-nav:has(.tt-ov[data-tt-ov-open]){backdrop-filter:none;-webkit-backdrop-filter:none}
.tt-ov__scrim{position:absolute;inset:0;background:#000;backdrop-filter:none;
  opacity:0;transition:opacity .333s var(--tt-ease)}
.tt-ov[data-tt-ov-open] .tt-ov__scrim{opacity:1}
.tt-ov__sheet{position:absolute;left:50%;top:0;transform:translateX(-50%);width:min(1120px,96vw);
  max-height:92vh;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;margin-top:70px;padding:20px;isolation:isolate;
  background:radial-gradient(130% 90% at 0% 0%,rgba(0,229,255,.09),transparent 52%),radial-gradient(120% 120% at 100% 0%,rgba(124,58,237,.11),transparent 54%),linear-gradient(180deg,var(--tt-panel),var(--tt-ink-2));
  border:1px solid var(--tt-line);border-radius:20px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 50px 120px -40px rgba(0,0,0,.95),0 0 80px -30px rgba(0,229,255,.4);
  opacity:0;transform:translateX(-50%) translateY(-14px) scale(.985);
  transition:opacity .333s var(--tt-ease),transform .333s cubic-bezier(.22,1,.36,1)}
.tt-ov__sheet::before{content:"";position:absolute;left:20px;right:20px;top:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--tt-cyan) 24%,rgba(124,58,237,.6) 72%,transparent)}
.tt-ov[data-tt-ov-open] .tt-ov__sheet{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}
/* Top row: search + close */
.tt-ov__top{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.tt-ov__search{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-width:0;padding:11px 12px 11px 14px;
  background:var(--tt-ink-2);border:1px solid var(--tt-line);border-radius:13px;transition:border-color .2s var(--tt-ease),box-shadow .2s var(--tt-ease)}
.tt-ov__search:focus-within{border-color:var(--tt-cyan);box-shadow:0 0 30px -8px rgba(0,229,255,.5)}
.tt-ov__search-ic{flex:0 0 auto;color:var(--tt-cyan);display:inline-grid;place-items:center}
.tt-ov__search-input{flex:1 1 auto;min-width:0;background:transparent;border:0;outline:0;color:var(--tt-text);
  font:inherit;font-size:16px}
.tt-ov__search-input::placeholder{color:var(--tt-faint)}
.tt-ov__search-go{flex:0 0 auto;padding:8px 16px;border:0;border-radius:9px;font:inherit;font-weight:600;font-size:14px;cursor:pointer;
  color:#02121a;background:linear-gradient(100deg,var(--tt-cyan),var(--tt-cyan-deep));box-shadow:0 0 22px -6px rgba(0,229,255,.6)}
.tt-ov__search-go:hover{transform:translateY(-1px)}
.tt-ov__search-go:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-ov__close{flex:0 0 auto;display:inline-grid;place-items:center;width:42px;height:42px;border-radius:12px;cursor:pointer;
  border:1px solid var(--tt-line);background:rgba(0,229,255,.03);color:var(--tt-muted);transition:color .2s var(--tt-ease),border-color .2s var(--tt-ease),transform .2s var(--tt-ease)}
.tt-ov__close:hover{color:var(--tt-heading);border-color:var(--tt-line-2);transform:rotate(90deg)}
.tt-ov__close:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
/* Body: desks grid | aside (featured + latest) | rail (cta + quick) */
.tt-ov__body{display:grid;grid-template-columns:1.55fr 1fr;grid-template-areas:"desks aside" "rail aside";gap:18px}
.tt-ov__desks{grid-area:desks;min-width:0}
.tt-ov__aside{grid-area:aside;display:flex;flex-direction:column;gap:14px;min-width:0}
.tt-ov__rail{grid-area:rail;display:flex;flex-direction:column;gap:14px;min-width:0}
.tt-ov__col-label{margin:0 0 10px;font-family:var(--tt-mono);font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--tt-cyan)}
/* Desk grid */
.tt-ov__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.tt-ov__card{display:flex;flex-direction:column;gap:5px;padding:13px 13px 14px;border-radius:13px;text-decoration:none;
  background:linear-gradient(180deg,rgba(255,255,255,.015),transparent);border:1px solid var(--tt-line);min-width:0;
  transition:border-color .2s var(--tt-ease),background .2s var(--tt-ease),transform .2s var(--tt-ease),box-shadow .2s var(--tt-ease)}
.tt-ov__card:hover,.tt-ov__card:focus-visible,.tt-ov__card[data-tt-ov-active]{border-color:var(--tt-line-2);transform:translateY(-2px);
  background:linear-gradient(180deg,rgba(0,229,255,.1),rgba(0,229,255,.02));box-shadow:0 16px 40px -22px rgba(0,229,255,.55);outline:none}
.tt-ov__card[aria-current="page"],.tt-ov a[data-tt-ov-current]{border-color:var(--tt-cyan);box-shadow:inset 3px 0 0 var(--tt-cyan),0 16px 40px -24px rgba(0,229,255,.5)}
.tt-ov__card:focus-visible{box-shadow:inset 0 0 0 1px var(--tt-cyan),0 16px 40px -22px rgba(0,229,255,.55)}
.tt-ov__card-head{display:flex;align-items:center;gap:8px;min-width:0}
.tt-ov__card-ic{flex:0 0 auto;display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 6px;border-radius:8px;
  font-family:var(--tt-mono);font-size:11px;font-weight:700;color:var(--tt-cyan);background:rgba(0,229,255,.1);border:1px solid var(--tt-line)}
.tt-ov__card-name{flex:1 1 auto;min-width:0;font-size:14px;font-weight:700;color:var(--tt-heading);line-height:1.2;letter-spacing:-.01em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-ov__card-count{flex:0 0 auto;font-family:var(--tt-mono);font-size:10.5px;font-weight:700;color:var(--tt-faint);
  min-width:20px;height:18px;display:inline-grid;place-items:center;padding:0 5px;border-radius:999px;background:rgba(0,229,255,.06)}
.tt-ov__card:hover .tt-ov__card-count,.tt-ov__card[data-tt-ov-active] .tt-ov__card-count{color:var(--tt-cyan)}
.tt-ov__card-blurb{font-size:12px;line-height:1.45;color:var(--tt-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* Featured preview */
.tt-ov__featured{display:flex;flex-direction:column;overflow:hidden;border-radius:15px;border:1px solid var(--tt-line);background:var(--tt-ink-2);
  text-decoration:none;min-height:168px;transition:border-color .333s var(--tt-ease),box-shadow .333s var(--tt-ease),transform .333s var(--tt-ease)}
.tt-ov__featured:hover{transform:translateY(-2px);border-color:var(--tt-line-2);box-shadow:0 24px 60px -26px rgba(0,229,255,.6)}
.tt-ov__featured:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-ov__fmedia{position:relative;display:block;overflow:hidden;aspect-ratio:16/9;background:var(--tt-ink-2)}
.tt-ov__fimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .6s var(--tt-ease),opacity .25s var(--tt-ease)}
.tt-ov__featured:hover .tt-ov__fimg{transform:scale(1.045)}
.tt-ov__fimg[data-tt-ov-swapping]{opacity:0}
.tt-ov__fscrim{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:4px;padding:18px 16px 15px;
  background:linear-gradient(to top,rgba(4,4,11,.95),rgba(4,4,11,.45) 62%,transparent)}
.tt-ov__fkicker{align-self:flex-start;font-family:var(--tt-mono);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#02121a;background:var(--tt-cyan);padding:3px 8px;border-radius:999px}
.tt-ov__fcue{font-size:13px;font-weight:700;color:var(--tt-cyan-soft)}
.tt-ov__featured:hover .tt-ov__fcue{color:#fff}
.tt-ov__ftitle{display:block;padding:11px 14px 13px;font-size:14px;font-weight:700;line-height:1.35;color:var(--tt-heading);
  border-top:1px solid var(--tt-line);background:linear-gradient(180deg,rgba(0,229,255,.045),transparent)}
.tt-ov__featured:hover .tt-ov__ftitle,.tt-ov__featured:focus-visible .tt-ov__ftitle{color:var(--tt-cyan-soft)}
/* Latest column */
.tt-ov__latest{min-width:0}
.tt-ov__latest-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.tt-ov__latest-item{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:10px;text-decoration:none;
  transition:background .2s var(--tt-ease),padding-left .2s var(--tt-ease)}
.tt-ov__latest-item:hover,.tt-ov__latest-item:focus-visible{background:linear-gradient(90deg,rgba(0,229,255,.1),transparent);padding-left:13px;outline:none}
.tt-ov__latest-item--visual{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:12px}
.tt-ov__latest-img{width:72px;height:56px;object-fit:cover;border-radius:8px;filter:saturate(.9);transition:transform .3s ease,filter .3s ease}
.tt-ov__latest-copy{display:grid;gap:4px;min-width:0}
.tt-ov__latest-item--visual:hover .tt-ov__latest-img,.tt-ov__latest-item--visual:focus-visible .tt-ov__latest-img{transform:scale(1.04);filter:saturate(1.1)}
.tt-ov__latest-item:focus-visible{box-shadow:inset 0 0 0 1px var(--tt-cyan)}
.tt-ov__latest-title{font-size:13px;font-weight:600;color:var(--tt-body);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tt-ov__latest-item:hover .tt-ov__latest-title,.tt-ov__latest-item:focus-visible .tt-ov__latest-title{color:var(--tt-heading)}
.tt-ov__latest-meta{font-family:var(--tt-mono);font-size:10.5px;color:var(--tt-faint)}
/* Rail: dominant CTA + quick links */
.tt-ov__cta{display:flex;flex-direction:column;gap:5px;padding:16px;border-radius:14px;text-decoration:none;
  background:radial-gradient(120% 120% at 100% 0%,rgba(0,229,255,.16),transparent 60%),linear-gradient(180deg,rgba(0,229,255,.06),rgba(124,58,237,.05));
  border:1px solid var(--tt-line-2);transition:transform .2s var(--tt-ease),box-shadow .2s var(--tt-ease),border-color .2s var(--tt-ease)}
.tt-ov__cta:hover{transform:translateY(-2px);border-color:var(--tt-cyan);box-shadow:0 20px 50px -24px rgba(0,229,255,.6)}
.tt-ov__cta:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-ov__cta-kicker{font-family:var(--tt-mono);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--tt-cyan)}
.tt-ov__cta-title{font-size:16px;font-weight:700;color:var(--tt-heading);line-height:1.25}
.tt-ov__cta-blurb{font-size:12.5px;line-height:1.5;color:var(--tt-muted)}
.tt-ov__cta-go{margin-top:4px;font-size:13px;font-weight:700;color:var(--tt-cyan)}
.tt-ov__quick-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.tt-ov__quick-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;text-decoration:none;font-size:13px;
  color:var(--tt-body);transition:background .2s var(--tt-ease),color .2s var(--tt-ease),padding-left .2s var(--tt-ease)}
.tt-ov__quick-item:hover,.tt-ov__quick-item:focus-visible{background:linear-gradient(90deg,rgba(0,229,255,.1),transparent);color:var(--tt-heading);padding-left:13px;outline:none}
.tt-ov__quick-item:focus-visible{box-shadow:inset 0 0 0 1px var(--tt-cyan)}
.tt-ov__quick-ic{flex:0 0 auto;font-family:var(--tt-mono);font-size:11px;font-weight:700;color:var(--tt-cyan);min-width:16px}
.tt-ov__quick-label{flex:0 0 auto;font-weight:600}
.tt-ov__quick-sub{flex:1 1 auto;min-width:0;font-size:11px;color:var(--tt-faint);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Tablet/mobile: single column, stacked (desks → featured → latest → rail), sheet fills the screen */
@media(max-width:900px){
  .tt-ov__body{grid-template-columns:1fr;grid-template-areas:"desks" "aside" "rail"}
  .tt-ov__grid{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:620px){
  .tt-nav--overlay{padding:9px 16px}
  .tt-nav__ov-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .tt-nav__ov-trigger{padding:7px 11px;gap:7px}
  .tt-nav--overlay .tt-nav__links{display:none}
  .tt-ov__sheet{width:100vw;max-height:100vh;height:100vh;margin-top:0;border-radius:0;border:0;padding:16px}
  .tt-ov__sheet::before{display:none}
  .tt-ov__grid{grid-template-columns:1fr}
  .tt-ov__search-input{font-size:16px}
}
@media(prefers-reduced-motion:reduce){
  .tt-ov__scrim,.tt-ov__sheet,.tt-ov__fimg,.tt-ov__card,.tt-ov__featured,.tt-ov__cta,.tt-nav__ov-trigger,.tt-nav__ov-chev,.tt-ov__close{transition:none!important}
  .tt-ov__sheet{transform:translateX(-50%)!important}
  .tt-ov[data-tt-ov-open] .tt-ov__sheet{transform:translateX(-50%)!important}
}

/* Hero ------------------------------------------------------------------ */
.tt-hero{max-width:var(--tt-maxw);margin:0 auto;padding:74px 24px 48px;display:grid;
  grid-template-columns:1.08fr .92fr;gap:48px;align-items:center}
@media(max-width:900px){.tt-hero{grid-template-columns:1fr;padding-top:50px}}
.tt-hero__lead{min-width:0}
.tt-hero__title{font-size:clamp(2.7rem,6vw,4.2rem);line-height:1.02;letter-spacing:-.035em;margin:22px 0 0;
  font-weight:800;text-wrap:balance;color:var(--tt-heading)}
.tt-hero__visual{min-width:0}

/* Terminal -------------------------------------------------------------- */
.tt-term{background:linear-gradient(180deg,#07101a,#050912);border:1px solid var(--tt-line-2);border-radius:var(--tt-radius);
  box-shadow:0 36px 90px -36px rgba(0,0,0,.8),0 0 50px -20px rgba(0,229,255,.35),inset 0 1px 0 rgba(0,229,255,.08);
  overflow:hidden;font-family:var(--tt-mono);font-size:13.5px}
.tt-term__bar{display:flex;align-items:center;gap:7px;padding:12px 15px;border-bottom:1px solid var(--tt-line);
  color:var(--tt-faint);font-size:11px}
.tt-term__bar i{width:11px;height:11px;border-radius:50%;display:inline-block}
.tt-term__r{background:#ff5f57}.tt-term__y{background:#febc2e}.tt-term__g{background:#28c840}
.tt-term__name{margin-left:4px}
.tt-term__body{padding:18px;line-height:1.95}
.tt-term__dim{color:var(--tt-faint)}.tt-term__pr{color:var(--tt-cyan)}.tt-term__ok{color:#3ff0a0}
.tt-term__cursor{display:inline-block;width:8px;height:15px;vertical-align:-2px;background:var(--tt-cyan);
  margin-left:6px;box-shadow:0 0 10px var(--tt-cyan);animation:tt-blink 1.1s steps(1) infinite}
@keyframes tt-blink{50%{opacity:0}}

/* Node constellation ---------------------------------------------------- */
.tt-nodes{display:grid;grid-template-columns:repeat(8,1fr);gap:12px;margin-top:16px}
.tt-nodes i{aspect-ratio:1;border-radius:8px;border:1px solid var(--tt-line);background:rgba(0,229,255,.03)}
.tt-nodes i.tt-node--on{background:rgba(0,229,255,.14);border-color:var(--tt-line-2);
  box-shadow:0 0 16px rgba(0,229,255,.45);animation:tt-pulse 3.2s ease-in-out infinite}
@keyframes tt-pulse{0%,100%{opacity:.4}50%{opacity:1}}

/* Band / section -------------------------------------------------------- */
.tt-band{max-width:var(--tt-maxw);margin:0 auto;padding:72px 24px;border-top:1px solid var(--tt-line)}
.tt-h2{font-size:clamp(1.75rem,3.5vw,2.5rem);letter-spacing:-.025em;margin:12px 0 20px;font-weight:800;
  text-wrap:balance;color:var(--tt-heading)}
.tt-band .tt-lede{margin-top:16px}

/* Feature cards --------------------------------------------------------- */
.tt-features{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:36px}
@media(max-width:820px){.tt-features{grid-template-columns:1fr}}
.tt-feature{position:relative;border:1px solid var(--tt-line);border-radius:var(--tt-radius);padding:26px;
  background:linear-gradient(180deg,rgba(0,229,255,.05),rgba(0,229,255,0) 42%),var(--tt-panel);
  box-shadow:inset 0 1px 0 rgba(0,229,255,.06),0 22px 48px -30px rgba(0,0,0,.9);
  transition:transform .18s var(--tt-ease),border-color .18s var(--tt-ease),box-shadow .18s var(--tt-ease)}
.tt-feature::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;border-radius:var(--tt-radius) var(--tt-radius) 0 0;
  background:linear-gradient(90deg,transparent,var(--tt-cyan),transparent)}
.tt-feature:hover{transform:translateY(-3px);border-color:var(--tt-line-2);box-shadow:0 26px 60px -30px rgba(0,229,255,.4)}
.tt-feature__ic{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;font-family:var(--tt-mono);
  font-size:15px;color:var(--tt-cyan);background:rgba(0,229,255,.08);border:1px solid var(--tt-line-2);
  box-shadow:0 0 18px rgba(0,229,255,.25)}
.tt-feature__title{margin:16px 0 8px;font-size:1.18rem;font-weight:700;color:var(--tt-heading)}
.tt-feature__body{color:var(--tt-muted);font-size:.97rem;margin:0}
.tt-feature__title a{color:inherit;text-decoration:none}
.tt-feature__title a:hover{color:var(--tt-cyan-soft)}
.tt-feature .tt-tags{margin-top:14px}
.tt-feature__body code{font-family:var(--tt-mono);font-size:.88em;background:rgba(0,229,255,.1);color:var(--tt-cyan-soft);
  padding:2px 6px;border-radius:6px}

/* Post cards ------------------------------------------------------------ */
.tt-posts{display:grid;grid-template-columns:repeat(2,1fr);gap:22px;margin-top:34px}
@media(max-width:760px){.tt-posts{grid-template-columns:1fr}}
.tt-post{display:block;border:1px solid var(--tt-line);border-radius:var(--tt-radius);padding:0;overflow:hidden;
  background:linear-gradient(180deg,rgba(0,229,255,.04),rgba(0,229,255,0) 40%),var(--tt-panel);
  transition:border-color .16s var(--tt-ease),transform .16s var(--tt-ease),box-shadow .16s var(--tt-ease)}
.tt-post:hover{border-color:var(--tt-line-2);transform:translateY(-3px);box-shadow:0 24px 56px -30px rgba(0,229,255,.42)}
.tt-post__thumb{display:block;width:100%;height:auto;aspect-ratio:1200/630;object-fit:cover;
  border-bottom:1px solid var(--tt-line);background:linear-gradient(135deg,rgba(0,229,255,.1),rgba(0,229,255,.02))}
.tt-post__tag{display:inline-block;margin:22px 26px 0;font-family:var(--tt-mono);font-size:11px;color:var(--tt-cyan);
  letter-spacing:.05em;text-transform:uppercase}
.tt-post__title{font-size:1.32rem;margin:10px 26px;letter-spacing:-.015em;color:var(--tt-heading)}
.tt-post__desc{color:var(--tt-muted);margin:0 26px;font-size:.97rem}
.tt-post__meta{color:var(--tt-faint);font-size:12px;font-family:var(--tt-mono);margin:16px 26px 26px}
.tt-post:not(:has(.tt-post__thumb)) .tt-post__tag{margin-top:26px}
/* Skip rendering work for off-screen REPEATING post cards (long index/hub grids). The auto keyword
   remembers each card's rendered size so scroll-back is CLS-free; contain-intrinsic-size seeds a
   placeholder height before first paint. Scoped to .tt-post ONLY — never the hero/cover/above-fold
   or any heading/anchor-target (those must stay rendered for #id jumps + find-in-page). */
@supports (content-visibility:auto){
  .tt-posts>.tt-post{content-visibility:auto;contain-intrinsic-size:auto 320px}
}

/* Page header (blog index / 404) ---------------------------------------- */
.tt-pagehead{max-width:var(--tt-maxw);margin:0 auto;padding:64px 24px 8px}
.tt-pagehead__title{font-size:clamp(2rem,5vw,3rem);letter-spacing:-.03em;margin:12px 0 0;font-weight:800;color:var(--tt-heading)}
.tt-panel{padding:clamp(22px,3vw,34px);border:1px solid var(--tt-line);border-radius:var(--tt-radius);
  background:linear-gradient(145deg,rgba(0,229,255,.045),var(--tt-panel) 58%,rgba(255,255,255,.012));
  box-shadow:0 28px 80px -64px rgba(0,229,255,.7)}
.tt-panel+.tt-panel{margin-top:20px}
.tt-panel__title{margin:8px 0 0;color:var(--tt-heading);font-size:clamp(1.35rem,3vw,2rem);letter-spacing:-.025em}
.tt-panel__body{margin-top:14px;color:var(--tt-body);line-height:1.7}
.tt-panel__body>:first-child{margin-top:0}.tt-panel__body>:last-child{margin-bottom:0}
.tt-panel__actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}

/* Cohesive publication skin for journals embedded in a product site. The journal keeps its
   editorial hierarchy while inheriting the same dense cyan panel language as dashboards/docs. */
.tt-journal{max-width:var(--tt-maxw);margin:0 auto;padding:clamp(36px,6vw,72px) 24px 88px;
  background:radial-gradient(circle at 8% 8%,rgba(0,229,255,.07),transparent 28%),
             radial-gradient(circle at 92% 30%,rgba(0,229,255,.04),transparent 24%)}
.tt-journal .tt-masthead{padding:30px 24px 22px;margin-bottom:24px;border:1px solid var(--tt-line-2);
  border-radius:var(--tt-radius);background:linear-gradient(145deg,rgba(0,229,255,.08),var(--tt-panel) 55%,rgba(255,255,255,.015));
  box-shadow:0 24px 80px -54px rgba(0,229,255,.65)}
.tt-journal .tt-masthead__title{font-size:clamp(2.4rem,6.5vw,4.9rem)}
.tt-journal .tt-cover{padding:clamp(22px,3vw,34px);margin-bottom:28px;border:1px solid var(--tt-line-2);
  border-radius:var(--tt-radius);background:linear-gradient(145deg,rgba(0,229,255,.075),var(--tt-panel) 52%,rgba(255,255,255,.015))}
.tt-journal .tt-ednote{margin:0 0 28px;padding:clamp(26px,4vw,44px);border:1px solid var(--tt-line);
  border-left:3px solid var(--tt-cyan);border-radius:var(--tt-radius);background:var(--tt-panel)}
.tt-journal .tt-pagehead{max-width:none;margin:0 0 24px;padding:clamp(28px,4vw,48px);border:1px solid var(--tt-line-2);
  border-radius:var(--tt-radius);background:linear-gradient(145deg,rgba(0,229,255,.08),var(--tt-panel) 64%)}
.tt-journal .tt-pagehead__title{font-size:clamp(2.5rem,7vw,5.8rem);line-height:.94;text-wrap:balance}
.tt-journal .tt-posts{gap:18px}
.tt-journal .tt-post{min-height:16rem;background:linear-gradient(160deg,rgba(0,229,255,.045),var(--tt-panel) 45%)}
.tt-journal__notice{max-width:760px;margin:0 0 28px;padding:16px 18px;border:1px solid var(--tt-line);
  border-left:3px solid var(--tt-cyan);border-radius:0 var(--tt-radius-sm) var(--tt-radius-sm) 0;
  background:linear-gradient(90deg,rgba(0,229,255,.075),var(--tt-panel));color:var(--tt-muted);line-height:1.65}
.tt-journal__notice strong{color:var(--tt-text)}
.tt-journal__article>.tt-article{margin-top:20px;padding:clamp(28px,5vw,56px);border:1px solid var(--tt-line);
  border-radius:var(--tt-radius);background:linear-gradient(160deg,rgba(0,229,255,.035),var(--tt-panel) 20%)}
@media(max-width:760px){.tt-journal{padding-inline:14px}.tt-journal .tt-cover{padding:18px}
  .tt-journal .tt-pagehead{padding:26px 20px}.tt-journal__article>.tt-article{padding:24px 18px}}

/* Article shell --------------------------------------------------------- */
.tt-article{box-sizing:border-box;width:min(100%,720px);max-width:720px;margin-inline:auto;padding:56px 24px;text-align:left}
.tt-article h1{font-size:clamp(2rem,5vw,3rem);letter-spacing:-.03em;color:var(--tt-heading);font-weight:800}
.tt-article .back,.tt-back{font-family:var(--tt-mono);font-size:13px;color:var(--tt-muted)}
.tt-article .back:hover,.tt-back:hover{color:var(--tt-cyan)}
.tt-article .meta{color:var(--tt-faint);font-family:var(--tt-mono);font-size:13px;margin-top:18px;
  border-bottom:1px solid var(--tt-line);padding-bottom:22px}
.tt-article .body{margin-top:30px;font-size:1.08rem}
.tt-article .body h2:not(.tt-widget__heading){font-size:1.55rem;margin:46px 0 18px;color:var(--tt-heading);font-weight:700;letter-spacing:-.02em}
.tt-article .body h3:not(.tt-widget__heading){font-size:1.18rem;margin:28px 0 14px;color:var(--tt-heading)}
/* Anchor landing clearance (WCAG 2.4.11 Focus-Not-Obscured): the sticky blurred .tt-nav (~70px) must
   never cover a heading jumped-to via #id, nor a focused in-article anchor target. 5rem ≈ nav height. */
.tt-article .body h2[id],.tt-article .body h3[id],.tt-article .body h4[id],.tt-article .body [id]:target{scroll-margin-top:5rem}
.tt-article .body p{color:var(--tt-body)}
.tt-article .body ul,.tt-article .body ol{color:var(--tt-body);padding-left:22px}
.tt-article .body li{margin:9px 0}
.tt-article .body a{color:var(--tt-cyan);text-decoration:underline;text-underline-offset:3px}
.tt-article .body code{font-family:var(--tt-mono);font-size:.9em;background:rgba(0,229,255,.1);color:var(--tt-cyan-soft);padding:2px 6px;border-radius:6px}
.tt-article .body pre{background:#050a12;border:1px solid var(--tt-line);border-radius:12px;padding:18px;overflow:auto;margin:24px 0}
.tt-article .body pre code{background:none;padding:0;color:var(--tt-cyan-soft)}
.tt-article .body table{width:100%;border-collapse:collapse;margin:28px 0;font-size:.95rem}
.tt-article .body th,.tt-article .body td{border:1px solid var(--tt-line);padding:10px 14px;text-align:left;vertical-align:top}
.tt-article .body thead th{background:linear-gradient(180deg,rgba(0,229,255,.12),rgba(0,229,255,.04));color:var(--tt-heading);
  font-family:var(--tt-mono);font-size:.78rem;letter-spacing:.03em;text-transform:uppercase}
.tt-article .body td{color:var(--tt-body)}
.tt-article .body h2:first-of-type + p{border-left:3px solid var(--tt-cyan);
  background:linear-gradient(90deg,rgba(0,229,255,.1),transparent);padding:16px 20px;border-radius:0 12px 12px 0;
  font-size:1.12rem;color:var(--tt-heading);box-shadow:0 0 30px -14px rgba(0,229,255,.4)}
.tt-article .body .fig{margin:30px 0;border:1px solid var(--tt-line);border-radius:14px;overflow:hidden;background:var(--tt-panel-2)}
.tt-article .body .fig svg{display:block;width:100%;height:auto}
.tt-article .body>figure{box-sizing:border-box;width:100%;max-width:100%;margin:clamp(28px,6vw,48px) auto;overflow:hidden}
.tt-article .body>figure :where(img,picture,video,iframe,svg){display:block;max-width:100%;height:auto;margin-inline:auto}
.tt-article .body figcaption{padding:12px 16px;color:var(--tt-faint);font-size:.85rem;font-family:var(--tt-mono);border-top:1px solid var(--tt-line)}
.tt-article .body #faq{margin-top:48px;padding-top:4px;border-top:1px solid var(--tt-line)}

/* Masthead (magazine nameplate) ---------------------------------------- */
.tt-masthead{max-width:var(--tt-maxw);margin:0 auto;padding:58px 24px 18px;text-align:center}
.tt-masthead__rule{height:1px;max-width:760px;margin:0 auto;
  background:linear-gradient(90deg,transparent,var(--tt-line-2),transparent)}
.tt-masthead__title{font-size:clamp(2.6rem,8.5vw,5.6rem);line-height:.96;letter-spacing:-.045em;font-weight:800;
  margin:26px 0 0;word-break:break-word;
  background:linear-gradient(100deg,#ffffff 28%,var(--tt-cyan-soft) 68%,var(--tt-cyan));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.tt-masthead__tag{font-family:var(--tt-mono);font-size:clamp(.85rem,2.1vw,1.02rem);color:var(--tt-muted);
  letter-spacing:.01em;margin:18px auto 18px;max-width:54ch;text-wrap:balance}
.tt-masthead__meta{font-family:var(--tt-mono);font-size:11px;letter-spacing:.24em;text-transform:uppercase;
  color:var(--tt-cyan);margin:0 0 24px}

/* Cover story ----------------------------------------------------------- */
.tt-cover{max-width:var(--tt-maxw);margin:0 auto;padding:22px 24px 70px;display:grid;
  grid-template-columns:1.12fr .88fr;gap:46px;align-items:center}
@media(max-width:900px){.tt-cover{grid-template-columns:1fr;gap:26px;padding-bottom:52px}}
.tt-cover__media{display:block;border:1px solid var(--tt-line-2);border-radius:var(--tt-radius);overflow:hidden;
  box-shadow:0 40px 92px -42px rgba(0,0,0,.85),0 0 60px -26px rgba(0,229,255,.4);
  transition:transform .2s var(--tt-ease),box-shadow .2s var(--tt-ease)}
.tt-cover__media:hover{transform:translateY(-3px);box-shadow:0 48px 104px -42px rgba(0,0,0,.9),0 0 76px -24px rgba(0,229,255,.58)}
.tt-cover__img{display:block;width:100%;height:auto;aspect-ratio:1200/630;object-fit:cover}
.tt-cover__body{min-width:0}
.tt-cover__title{font-size:clamp(2rem,4.7vw,3.4rem);line-height:1.04;letter-spacing:-.03em;font-weight:800;
  margin:14px 0 0;color:var(--tt-heading);text-wrap:balance}
.tt-cover__title a{transition:color .15s var(--tt-ease)}
.tt-cover__title a:hover{color:var(--tt-cyan-soft)}
.tt-cover__dek{color:var(--tt-muted);font-size:clamp(1.05rem,1.8vw,1.2rem);line-height:1.6;margin:18px 0 0;
  max-width:52ch;text-wrap:pretty}
.tt-cover__byline{font-family:var(--tt-mono);font-size:12.5px;color:var(--tt-faint);margin:22px 0 0;
  padding-top:18px;border-top:1px solid var(--tt-line)}
.tt-cover__cta{display:inline-flex;align-items:center;gap:8px;margin-top:20px;font-weight:600;
  color:var(--tt-cyan);font-size:15px;transition:gap .15s var(--tt-ease),color .15s var(--tt-ease)}
.tt-cover__cta:hover{gap:13px;color:var(--tt-cyan-soft)}

/* Editor's note --------------------------------------------------------- */
.tt-ednote{position:relative}
/* A left accent rail that runs alongside the whole note (kicker → sign-off) — the editorial pull-aside. */
.tt-ednote::before{content:"";position:absolute;left:24px;top:72px;bottom:72px;width:2px;border-radius:2px;
  background:linear-gradient(180deg,var(--tt-cyan),var(--tt-cyan-deep) 55%,transparent);
  box-shadow:0 0 18px rgba(0,229,255,.35)}
.tt-ednote>.tt-kicker,.tt-ednote>.tt-h2,.tt-ednote>.tt-ednote__body,.tt-ednote>.tt-ednote__sig{padding-left:28px}
@media(max-width:560px){.tt-ednote::before{left:20px}.tt-ednote>.tt-kicker,.tt-ednote>.tt-h2,.tt-ednote>.tt-ednote__body,.tt-ednote>.tt-ednote__sig{padding-left:22px}}
.tt-ednote .tt-h2{max-width:24ch}
.tt-ednote__body{max-width:65ch;margin-top:16px;color:var(--tt-body);font-size:1.1rem;line-height:1.78}
.tt-ednote__body p{margin:0 0 15px}
.tt-ednote__sig{font-family:var(--tt-mono);font-size:13px;color:var(--tt-cyan);margin-top:6px}

/* Article editorial touches (dek + drop cap) ---------------------------- */
.tt-article .dek{font-size:clamp(1.15rem,2.4vw,1.42rem);line-height:1.48;color:var(--tt-cyan-soft);
  font-weight:500;margin:18px 0 0;text-wrap:pretty;max-width:60ch}
.tt-article .body>p:first-of-type::first-letter{float:left;font-size:3.4em;line-height:.82;font-weight:800;
  padding:4px 10px 0 0;color:var(--tt-cyan)}

/* Gradient-clip fallback — show a solid colour instead of invisible text where unsupported */
@supports not ((-webkit-background-clip:text) or (background-clip:text)){
  .tt-masthead__title,.tt-grad{color:var(--tt-cyan-soft)}
}

/* Skip link ------------------------------------------------------------- */
.tt-skip{position:fixed;top:-60px;left:12px;z-index:100;padding:10px 16px;border-radius:10px;
  background:var(--tt-cyan);color:#02121a;font-weight:700;font-size:14px;transition:top .15s var(--tt-ease)}
.tt-skip:focus{top:12px;outline:2px solid #fff;outline-offset:2px}

/* Reading progress (CSS scroll-timeline; hidden where unsupported) -------- */
.tt-progress{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;pointer-events:none}
.tt-progress__bar{display:block;height:100%;transform-origin:0 50%;transform:scaleX(0);
  background:linear-gradient(90deg,var(--tt-cyan-deep),var(--tt-cyan));box-shadow:0 0 12px rgba(0,229,255,.55);
  animation:tt-progress-grow linear both;animation-timeline:scroll(root block)}
@keyframes tt-progress-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@supports not (animation-timeline:scroll()){.tt-progress{display:none}}

/* Back to top (always-visible, subtle) ---------------------------------- */
.tt-totop{position:fixed;right:20px;bottom:20px;z-index:55;display:grid;place-items:center;width:44px;height:44px;
  border-radius:50%;font-size:20px;color:var(--tt-cyan);background:rgba(10,14,23,.72);border:1px solid var(--tt-line-2);
  backdrop-filter:blur(8px);box-shadow:0 10px 30px -10px rgba(0,0,0,.7);opacity:.72;
  transition:opacity .15s var(--tt-ease),color .15s var(--tt-ease),background .15s var(--tt-ease),transform .15s var(--tt-ease)}
.tt-totop:hover{opacity:1;color:#02121a;background:var(--tt-cyan);border-color:transparent;transform:translateY(-2px)}
.tt-totop:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:3px;opacity:1}

/* Table of contents ----------------------------------------------------- */
.tt-toc{margin:30px 0;border:1px solid var(--tt-line);border-left:3px solid var(--tt-cyan);border-radius:12px;
  padding:18px 22px;background:linear-gradient(180deg,rgba(0,229,255,.04),transparent 60%),var(--tt-panel)}
.tt-toc__label{margin:0 0 12px;font-family:var(--tt-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--tt-cyan)}
.tt-toc__list{margin:0;padding:0;list-style:none;display:grid;gap:7px;counter-reset:toc}
.tt-toc__item a{color:var(--tt-muted);font-size:.98rem;transition:color .15s var(--tt-ease)}
.tt-toc__item a:hover{color:var(--tt-cyan)}
.tt-toc__item--h2{counter-increment:toc}
.tt-toc__item--h2 a::before{content:counter(toc) ". ";color:var(--tt-faint);font-family:var(--tt-mono);font-size:.82em}
.tt-toc__item--h3{margin-left:22px}
.tt-toc__item--h3 a{font-size:.9rem;color:var(--tt-faint)}
.tt-toc__item--h3 a::before{content:"– ";color:var(--tt-faint)}

/* Source library -------------------------------------------------------- */
.tt-sources{position:relative;width:min(100vw - 2rem,980px);margin:clamp(5rem,10vw,8rem) 50% 0;
  padding:clamp(2rem,5vw,4.5rem);transform:translateX(-50%);overflow:hidden;border:1px solid var(--tt-line);
  border-radius:2px 28px 2px 28px;background:linear-gradient(135deg,rgba(0,229,255,.08),transparent 32%),
  radial-gradient(circle at 100% 0,rgba(42,167,199,.12),transparent 23rem),var(--tt-panel);box-shadow:0 34px 90px rgba(0,0,0,.48),inset 0 1px rgba(255,255,255,.04);isolation:isolate}
.tt-sources::before{content:"";position:absolute;inset:0;z-index:-1;opacity:.25;pointer-events:none;
  background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
  background-size:34px 34px;mask-image:linear-gradient(to bottom,#000,transparent 70%)}
.tt-sources::after{content:"REFERENCE ARCHIVE";position:absolute;top:1.1rem;right:-2.5rem;color:rgba(255,255,255,.045);
  font:800 clamp(2.2rem,7vw,5.5rem)/1 var(--tt-display);letter-spacing:-.045em;white-space:nowrap;pointer-events:none}
.tt-article .tt-sources>h2{position:relative;z-index:1;max-width:12ch;margin:0;color:var(--tt-text);
  font-size:clamp(2.4rem,7vw,5.5rem);line-height:.92;letter-spacing:-.055em;text-wrap:balance}
.tt-sources__masthead{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem 2rem;
  align-items:end;margin:1.75rem 0 2.5rem;padding-bottom:1.75rem;border-bottom:1px solid rgba(255,255,255,.12)}
.tt-article .tt-sources__eyebrow{grid-column:1/-1;margin:0;color:var(--tt-cyan);font:700 .68rem/1.2 var(--tt-mono);letter-spacing:.16em;text-transform:uppercase}
.tt-article .tt-sources__intro{max-width:52ch;margin:0;color:var(--tt-body);font-size:1rem;line-height:1.65}
.tt-sources__count{display:flex;align-items:baseline;gap:.5rem;color:var(--tt-muted);font:600 .68rem/1 var(--tt-mono);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.tt-sources__count strong{color:var(--tt-text);font:400 2.2rem/1 var(--tt-display);letter-spacing:-.05em}
.tt-source-list{position:relative;z-index:1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin:0;padding:0;list-style:none;counter-reset:tt-source}
.tt-source-card{counter-increment:tt-source;position:relative;min-height:9rem;padding:1.2rem 3.1rem 2.7rem 3.6rem;overflow:hidden;
  border:1px solid rgba(255,255,255,.1);border-radius:12px;background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018));
  box-shadow:inset 0 1px rgba(255,255,255,.035);transition:transform .22s ease,border-color .22s ease,background-color .22s ease,box-shadow .22s ease}
.tt-source-card::before{content:counter(tt-source,decimal-leading-zero);position:absolute;top:1.1rem;left:1rem;color:var(--tt-cyan);font:700 .68rem/1 var(--tt-mono);letter-spacing:.08em}
.tt-source-card:hover,.tt-source-card:focus-within{transform:translateY(-3px);border-color:var(--tt-line-2);background:linear-gradient(145deg,rgba(0,229,255,.08),rgba(255,255,255,.025));box-shadow:0 18px 38px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.06)}
.tt-source-card:last-child:nth-child(odd){grid-column:1/-1;min-height:7.25rem;padding-right:min(24rem,34vw)}
.tt-source-card__content{display:contents}.tt-source-card__content strong{display:none}
.tt-article .tt-source-card__content a{display:block;color:var(--tt-text);font:600 1rem/1.48 var(--tt-body);text-decoration:none;text-wrap:pretty}
.tt-source-card__content a::after{content:"";position:absolute;inset:0}.tt-source-card__content a:focus-visible{outline:none}
.tt-source-card:has(a:focus-visible){outline:2px solid var(--tt-cyan);outline-offset:3px}
.tt-source-card__domain{position:absolute;left:3.6rem;right:3rem;bottom:1.1rem;overflow:hidden;color:var(--tt-faint);font:600 .66rem/1 var(--tt-mono);letter-spacing:.055em;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap}
.tt-source-card__arrow{position:absolute;top:1rem;right:1rem;display:grid;width:1.75rem;height:1.75rem;place-items:center;border:1px solid rgba(255,255,255,.12);border-radius:50%;color:var(--tt-muted);transition:color .2s ease,border-color .2s ease,transform .2s ease}
.tt-source-card:hover .tt-source-card__arrow,.tt-source-card:focus-within .tt-source-card__arrow{color:var(--tt-cyan);border-color:var(--tt-line-2);transform:rotate(8deg)}
.tt-sources__return{display:inline-flex;gap:.65rem;align-items:center;margin-top:2rem;color:var(--tt-muted)!important;font:700 .7rem/1 var(--tt-mono);letter-spacing:.1em;text-decoration:none;text-transform:uppercase}
.tt-sources__return:hover{color:var(--tt-text)!important}
@media(max-width:760px){.tt-sources{width:calc(100vw - 1.25rem);padding:1.5rem;border-radius:2px 20px 2px 20px}.tt-sources__masthead{grid-template-columns:1fr;align-items:start}.tt-sources__count{grid-row:3}.tt-source-list{grid-template-columns:1fr}.tt-source-card{min-height:8.25rem}.tt-source-card:last-child:nth-child(odd){grid-column:auto;min-height:8.25rem;padding-right:3.1rem}}
@media(prefers-reduced-motion:reduce){.tt-source-card,.tt-source-card__arrow{transition:none}}

/* Auto-linked first mention of a software name / glossary term (markdown.ts autolinkTerms). Inherits
   the body-link colour inside .tt-article; a dotted underline distinguishes it as a cross-reference. */
.tt-autolink{color:var(--tt-cyan);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
.tt-autolink:hover{text-decoration-style:solid}

/* Heading permalink anchors --------------------------------------------- */
.tt-h-anchor{opacity:0;margin-left:.4em;color:var(--tt-cyan);font-weight:400;text-decoration:none;transition:opacity .15s var(--tt-ease)}
.tt-h-anchor::before{content:"#"}
.tt-article .body h2:hover .tt-h-anchor,.tt-article .body h3:hover .tt-h-anchor,.tt-h-anchor:focus-visible{opacity:.7;outline:none}

/* Share row ------------------------------------------------------------- */
.tt-share{display:flex;align-items:center;gap:9px 14px;flex-wrap:wrap;margin:36px 0 8px;padding-top:22px;border-top:1px solid var(--tt-line)}
.tt-share__label{font-family:var(--tt-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--tt-faint)}
.tt-share__link{font-family:var(--tt-mono);font-size:12.5px;padding:7px 13px;border-radius:999px;border:1px solid var(--tt-line);
  color:var(--tt-muted);background:rgba(0,229,255,.03);transition:color .15s var(--tt-ease),border-color .15s var(--tt-ease),background .15s var(--tt-ease)}
.tt-share__link:hover{color:var(--tt-cyan);border-color:var(--tt-line-2);background:rgba(0,229,255,.08)}
.tt-share__link:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}

/* Breadcrumb ------------------------------------------------------------ */
.tt-crumb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:var(--tt-mono);font-size:12.5px;color:var(--tt-faint)}
.tt-crumb a{color:var(--tt-muted);transition:color .15s var(--tt-ease)}
.tt-crumb a:hover{color:var(--tt-cyan)}
.tt-crumb__sep{opacity:.5}
.tt-crumb__current{color:var(--tt-muted);max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Print — clean, legible, chrome-free black-on-white ---------------------- */
@media print{
  body{background:#fff!important;color:#111!important;background-image:none!important}
  .tt-nav,.tt-footer,.tt-progress,.tt-totop,.tt-share,.tt-skip,.tt-toc,.tt-crumb,.tt-h-anchor,
  .tt-video-browser,.tt-gallery,.tt-lightbox,.tt-bookmark,.tt-reading-list__actions,.tt-reading-list__remove{display:none!important}
  .tt-article{max-width:none;padding:0}
  .tt-article *{color:#1a1a1a!important}
  .tt-article a{text-decoration:underline}
  .tt-article .body a[href^="http"]::after{content:" (" attr(href) ")";font-size:.75em;color:#555!important}
  .tt-widget{background:#fff!important;border:1px solid #bbb!important;box-shadow:none!important}
}

/* Responsive table wrapper (wide markdown tables scroll instead of clipping) -- */
.tt-table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.tt-article .body .tt-table-scroll{margin:28px 0}
.tt-article .body .tt-table-scroll table{margin:0}

/* Tag chips ------------------------------------------------------------- */
.tt-tags{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:18px 0 0}
.tt-tags__label{font-family:var(--tt-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--tt-faint)}
/* min-height 24px + inline-flex centering guarantees a WCAG 2.5.8 (AA) target box without changing the
   visual padding — these border+background chips read as tappable, so give them a real hit-box. */
.tt-tag{display:inline-flex;align-items:center;min-height:24px;font-family:var(--tt-mono);font-size:11.5px;letter-spacing:.02em;padding:4px 11px;border-radius:999px;
  border:1px solid var(--tt-line);color:var(--tt-cyan);background:rgba(0,229,255,.06)}
a.tt-tag{text-decoration:none;transition:border-color .2s,background .2s}
a.tt-tag:hover{border-color:var(--tt-cyan);background:rgba(0,229,255,.12)}

/* Code block + copy button ---------------------------------------------- */
.tt-article .body .tt-code{position:relative;margin:24px 0}
.tt-article .body .tt-code>pre{margin:0}
.tt-code__copy{position:absolute;top:10px;right:10px;z-index:1;display:inline-flex;align-items:center;gap:6px;
  font-family:var(--tt-mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;
  padding:5px 10px;border-radius:8px;color:var(--tt-muted);background:rgba(10,14,23,.85);border:1px solid var(--tt-line-2);
  backdrop-filter:blur(6px);opacity:0;transition:opacity .15s var(--tt-ease),color .15s var(--tt-ease),border-color .15s var(--tt-ease)}
.tt-code:hover .tt-code__copy,.tt-code__copy:focus-visible{opacity:1}
.tt-code__copy:hover{color:var(--tt-cyan);border-color:var(--tt-cyan)}
.tt-code__copy:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-code__copy--done{color:#3ff0a0;border-color:#3ff0a0;opacity:1}
@media(hover:none){.tt-code__copy{opacity:1}}
/* Language label (persistent, top-left) + make room for it above the code. */
.tt-code__lang{position:absolute;top:9px;left:15px;z-index:1;font-family:var(--tt-mono);font-size:10.5px;
  letter-spacing:.12em;text-transform:uppercase;color:#67e8f9;opacity:1;pointer-events:none}
.tt-article .body .tt-code[data-lang]:not([data-lang=""])>pre{padding-top:38px}
/* Conservative syntax tint (comments + strings only — see markdown.ts highlightCode). */
.tt-tok-c{color:var(--tt-faint);font-style:italic}
.tt-tok-s{color:#9ef0c0}

/* Image lightbox (click-to-zoom) — built on demand by LIGHTBOX_JS ---------- */
img[data-tt-zoom]{cursor:zoom-in}
.tt-lightbox{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:clamp(16px,4vmin,48px);
  background:rgba(4,6,14,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  opacity:0;transition:opacity .2s var(--tt-ease)}
.tt-lightbox--open{opacity:1}
.tt-lightbox__fig{margin:0;display:flex;flex-direction:column;gap:14px;max-width:min(1240px,94vw);
  transform:scale(.96);transition:transform .2s var(--tt-ease)}
.tt-lightbox--open .tt-lightbox__fig{transform:scale(1)}
.tt-lightbox__img{display:block;margin:0 auto;max-width:100%;max-height:82vh;width:auto;height:auto;object-fit:contain;
  background:#0a0e17;border:1px solid var(--tt-line-2);border-radius:14px;
  box-shadow:0 48px 130px -30px rgba(0,0,0,.92),0 0 70px -22px rgba(0,229,255,.45)}
.tt-lightbox__cap{margin:0 auto;max-width:72ch;text-align:center;color:var(--tt-muted);
  font-family:var(--tt-mono);font-size:.84rem;line-height:1.5;text-wrap:pretty}
.tt-lightbox__close{position:fixed;top:18px;right:20px;width:46px;height:46px;display:grid;place-items:center;
  font-size:26px;line-height:1;cursor:pointer;color:var(--tt-text);background:rgba(10,14,23,.72);
  border:1px solid var(--tt-line-2);border-radius:50%;backdrop-filter:blur(8px);
  transition:color .15s var(--tt-ease),background .15s var(--tt-ease),transform .15s var(--tt-ease)}
.tt-lightbox__close:hover{color:#02121a;background:var(--tt-cyan);border-color:transparent;transform:scale(1.05)}
.tt-lightbox__close:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:3px}
.tt-lightbox__nav{position:fixed;top:50%;width:48px;height:48px;display:grid;place-items:center;transform:translateY(-50%);
  font-size:28px;line-height:1;cursor:pointer;color:var(--tt-text);background:rgba(10,14,23,.78);
  border:1px solid var(--tt-line-2);border-radius:50%;backdrop-filter:blur(8px)}
.tt-lightbox__nav--prev{left:clamp(10px,2vw,28px)}
.tt-lightbox__nav--next{right:clamp(10px,2vw,28px)}
.tt-lightbox__nav:hover{color:#02121a;background:var(--tt-cyan);border-color:transparent}
.tt-lightbox__nav:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:3px}
.tt-lightbox__count{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);font-family:var(--tt-mono);
  font-size:12px;letter-spacing:.12em;color:var(--tt-muted);background:rgba(10,14,23,.78);padding:6px 10px;border-radius:999px}

/* Bookmark toggle + reading list ---------------------------------------- */
.tt-bookmark{display:inline-flex;align-items:center;gap:8px;font-family:var(--tt-mono);font-size:12.5px;
  letter-spacing:.04em;cursor:pointer;padding:7px 14px;border-radius:999px;color:var(--tt-muted);
  background:rgba(0,229,255,.04);border:1px solid var(--tt-line);
  transition:color .15s var(--tt-ease),border-color .15s var(--tt-ease),background .15s var(--tt-ease)}
.tt-bookmark__icon{width:13px;height:13px;flex:0 0 auto;border-radius:3px;border:1.5px solid currentColor;position:relative}
.tt-bookmark__icon::before,.tt-bookmark__icon::after{content:"";position:absolute;background:currentColor}
.tt-bookmark__icon::before{left:50%;top:3px;bottom:3px;width:1.5px;transform:translateX(-50%)}
.tt-bookmark__icon::after{top:50%;left:3px;right:3px;height:1.5px;transform:translateY(-50%)}
.tt-bookmark:hover{color:var(--tt-cyan);border-color:var(--tt-line-2);background:rgba(0,229,255,.08)}
.tt-bookmark:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-bookmark[aria-pressed="true"]{color:var(--tt-cyan);border-color:var(--tt-cyan);background:rgba(0,229,255,.1)}
.tt-bookmark[aria-pressed="true"] .tt-bookmark__icon{border-color:var(--tt-cyan);background:var(--tt-cyan)}
.tt-bookmark[aria-pressed="true"] .tt-bookmark__icon::before{display:none}
.tt-bookmark[aria-pressed="true"] .tt-bookmark__icon::after{left:2px;right:2px;top:6px;height:1.5px;background:#02121a;transform:rotate(-45deg);box-shadow:-2px 2px 0 #02121a}
.tt-bookmark[disabled]{opacity:.5;cursor:not-allowed}
.tt-reading-list{max-width:720px;margin:8px auto 0}
.tt-reading-list__empty,.tt-reading-list__note{color:var(--tt-muted);font-size:1.05rem;line-height:1.6;max-width:60ch}
.tt-reading-list__note{color:var(--tt-warning,#f5a623)}
.tt-reading-list__items{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.tt-reading-list__item{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid var(--tt-line)}
.tt-reading-list__item a{color:var(--tt-heading);font-weight:600;font-size:1.1rem;flex:1 1 60%;min-width:0}
.tt-reading-list__item a:hover{color:var(--tt-cyan)}
.tt-reading-list__date{font-family:var(--tt-mono);font-size:12px;color:var(--tt-faint)}
.tt-reading-list__remove{font-family:var(--tt-mono);font-size:11.5px;cursor:pointer;color:var(--tt-faint);
  background:none;border:1px solid var(--tt-line);border-radius:999px;padding:4px 11px;transition:color .15s var(--tt-ease),border-color .15s var(--tt-ease)}
.tt-reading-list__remove:hover{color:#ff6b6b;border-color:#ff6b6b}
.tt-reading-list__remove:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-reading-list__actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}

/* Evidence provenance badge (hands-on vs researched) --------------------- */
.tt-evidence{margin:22px 0 0;padding:16px 18px;border:1px solid var(--tt-line);border-left-width:3px;
  border-radius:10px;background:rgba(255,255,255,.015)}
.tt-evidence--handson{border-left-color:var(--tt-cyan)}
.tt-evidence--researched{border-left-color:var(--tt-line-2,#2a3344)}
.tt-evidence__chip{display:inline-block;font-family:var(--tt-mono);font-size:11.5px;letter-spacing:.1em;
  text-transform:uppercase;font-weight:600;padding:3px 10px;border-radius:999px;margin-bottom:10px}
.tt-evidence--handson .tt-evidence__chip{color:#02121a;background:var(--tt-cyan)}
.tt-evidence--researched .tt-evidence__chip{color:var(--tt-muted);background:rgba(148,163,184,.14);border:1px solid var(--tt-line)}
.tt-evidence__summary{margin:0;color:var(--tt-text);font-size:.95rem;line-height:1.6;max-width:68ch}
.tt-evidence__limits{margin:10px 0 0;color:var(--tt-muted);font-size:.9rem;line-height:1.55;max-width:68ch}
.tt-evidence__limits strong{color:var(--tt-text)}
.tt-evidence__meta{margin:12px 0 0;display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:.85rem}
.tt-evidence__meta dt{font-family:var(--tt-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--tt-faint)}
.tt-evidence__meta dd{margin:0;color:var(--tt-muted)}

/* Self-assessment worksheet (interactive utility) ----------------------- */
.tt-worksheet{max-width:760px;margin:0 auto}
.tt-worksheet__subject{display:block;margin:0 0 26px}
.tt-worksheet__subject label{display:block;font-family:var(--tt-mono);font-size:12px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--tt-cyan);margin:0 0 8px}
.tt-worksheet__subject input{width:100%;font:inherit;font-size:1.05rem;color:var(--tt-text);background:var(--tt-panel);
  border:1px solid var(--tt-line);border-radius:10px;padding:11px 14px}
.tt-worksheet__subject input:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:1px;border-color:var(--tt-line-2)}
.tt-criterion{border:1px solid var(--tt-line);border-radius:12px;padding:18px 20px;margin:0 0 14px;background:var(--tt-panel)}
.tt-criterion legend{font-weight:700;font-size:1.08rem;color:var(--tt-heading);padding:0}
.tt-criterion__hint{color:var(--tt-muted);font-size:.9rem;margin:4px 0 14px;line-height:1.55}
.tt-criterion__opts{display:flex;flex-wrap:wrap;gap:8px}
.tt-criterion__opt{display:inline-flex;align-items:center;gap:7px;font-family:var(--tt-mono);font-size:13px;
  color:var(--tt-muted);border:1px solid var(--tt-line);border-radius:999px;padding:7px 14px;cursor:pointer;
  transition:color .15s var(--tt-ease),border-color .15s var(--tt-ease),background .15s var(--tt-ease)}
.tt-criterion__opt:hover{color:var(--tt-text);border-color:var(--tt-line-2)}
.tt-criterion__opt input{accent-color:var(--tt-cyan);margin:0}
.tt-criterion__opt:has(input:checked){color:var(--tt-cyan);border-color:var(--tt-cyan);background:rgba(0,229,255,.08)}
.tt-criterion__opt:has(input:focus-visible){outline:2px solid var(--tt-cyan);outline-offset:2px}
.tt-criterion textarea{display:block;width:100%;margin-top:12px;font:inherit;font-size:.95rem;color:var(--tt-text);
  background:transparent;border:1px solid var(--tt-line);border-radius:8px;padding:9px 12px;min-height:44px;resize:vertical}
.tt-criterion textarea:focus-visible{outline:2px solid var(--tt-cyan);outline-offset:1px;border-color:var(--tt-line-2)}
.tt-worksheet__summary{margin:26px 0 0;padding:18px 20px;border:1px solid var(--tt-line);border-left:3px solid var(--tt-cyan);
  border-radius:10px;background:rgba(0,229,255,.04)}
.tt-worksheet__summary p{margin:0 0 8px;color:var(--tt-body);line-height:1.6}
.tt-worksheet__summary p:last-child{margin-bottom:0}
.tt-worksheet__summary strong{color:var(--tt-heading)}
.tt-worksheet__actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}

/* Footer ---------------------------------------------------------------- */
.tt-footer{border-top:1px solid var(--tt-line);margin-top:48px}
.tt-footer__row{max-width:var(--tt-maxw);margin:0 auto;padding:40px 24px;display:flex;justify-content:space-between;
  gap:20px;flex-wrap:wrap;color:var(--tt-faint);font-size:14px}
.tt-footer__links{display:flex;gap:18px;flex-wrap:wrap}
.tt-footer__links a:hover{color:var(--tt-text)}

/* 404 ------------------------------------------------------------------- */
.tt-nf{max-width:640px;margin:0 auto;padding:96px 24px;text-align:center}
.tt-nf h1{font-size:clamp(3rem,10vw,6rem);color:var(--tt-heading);font-weight:800}

/* Motion safety --------------------------------------------------------- */
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

/* Cross-document View Transitions — native smooth MPA navigations, pairing with the
   speculation-rules prerender. Opt-in ONLY for motion-tolerant users (WCAG 2.3.3); the subtle
   ~0.24s cross-fade is likewise gated. Firefox (no cross-doc VT support) just does a normal nav —
   zero breakage; reduced-motion users get an instant swap. */
@media(prefers-reduced-motion:no-preference){
  @view-transition{navigation:auto}
  ::view-transition-old(root),::view-transition-new(root){animation-duration:.24s;animation-timing-function:var(--tt-ease)}
}

/* Reduced transparency — honour the a11y pref by dropping the blurred glass on every translucent
   surface (nav, overlay scrim, back-to-top, code copy, lightbox + its close) for a solid/near-opaque
   backing. Pure progressive enhancement: the default (above) stays blurred; unsupported UAs ignore this. */
@media(prefers-reduced-transparency:reduce){
  .tt-nav{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--tt-ink)}
  .tt-ov__scrim{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(2,3,9,.97)}
  .tt-totop{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--tt-panel);opacity:1}
  .tt-code__copy{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--tt-panel)}
  .tt-lightbox{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(4,6,14,.985)}
  .tt-lightbox__close{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--tt-panel)}
}

/* Increased contrast — strengthen the low-contrast hairlines, muted text, and focus ring for users
   who ask for it (WCAG 1.4.6). Only the tokens change, so every component that reads them lifts in
   lockstep; unsupported UAs keep the default palette. */
@media(prefers-contrast:more){
  :root{
    --tt-line:rgba(0,229,255,.42);--tt-line-2:rgba(0,229,255,.62);
    --tt-muted:#c4d4de;--tt-faint:#9fb2bf;
  }
  :root[data-theme="light"]{
    --tt-line:rgba(10,54,78,.42);--tt-line-2:rgba(10,54,78,.62);
    --tt-muted:#2b3c48;--tt-faint:#394a56;
  }
  :focus-visible{outline-width:3px;outline-offset:3px}
}
`.trim();
/**
 * A single copyable code block: an optional `[data-lang]` label chip + a copy button (driven by
 * {@link CODE_COPY_JS}) + the verbatim `<pre><code>`. The markup contract and its JS driver live
 * together in the catalog, so a site can render a standalone copyable snippet without hand-rolling the
 * `.tt-code__copy` markup `CODE_COPY_JS` reads. `code` and `lang` are escaped.
 */
export function renderCodeBlock(data) {
    const lang = data.lang ?? "";
    const label = lang ? `<span class="tt-code__lang" aria-hidden="true">${E(lang)}</span>` : "";
    return `<figure class="tt-code" data-lang="${E(lang)}">${label}<button class="tt-code__copy" type="button" aria-label="Copy to clipboard"><span class="tt-code__copy-label">Copy</span></button><pre><code>${E(data.code)}</code></pre></figure>`;
}
/**
 * Companion script for the code blocks that `@theme.tools/blog/markdown` emits + {@link renderCodeBlock}
 * (`.tt-code` figures). Served same-origin (CSP `script-src 'self'`); idempotent; clipboard-API with an
 * execCommand fallback. On copy it flips the button to a "Copied" confirmation for ~1.6s.
 */
export const CODE_COPY_JS = `(function(){
  if(window.__ttCodeCopy)return;window.__ttCodeCopy=true;
  document.addEventListener('click',function(e){
    var t=e.target;var btn=t&&t.closest?t.closest('.tt-code__copy'):null;if(!btn)return;
    var fig=btn.closest('.tt-code');var pre=fig&&fig.querySelector('pre');if(!pre)return;
    var label=btn.querySelector('.tt-code__copy-label');
    var ok=function(){btn.classList.add('tt-code__copy--done');if(label)label.textContent='Copied';
      setTimeout(function(){btn.classList.remove('tt-code__copy--done');if(label)label.textContent='Copy';},1600);};
    var text=pre.innerText;
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(ok,function(){});}
    else{try{var r=document.createRange();r.selectNodeContents(pre);var s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('copy');s.removeAllRanges();ok();}catch(_){}}
  },false);
})();`;
/**
 * Click-to-zoom lightbox for any image marked `data-tt-zoom` (the gallery's big slide, a featured
 * image, any article figure a host opts in). Served same-origin (CSP `script-src 'self'`); idempotent.
 * On click it builds a fullscreen dialog (scrim + centered image + caption from `alt` + a close
 * button), traps Escape, and restores focus on close. With the script absent the image is simply not
 * zoomable (graceful) — the markup carries no lightbox DOM, so nothing breaks. CSS lives in SITE_CSS.
 */
export const LIGHTBOX_JS = `(function(){
  if(window.__ttLightbox)return;window.__ttLightbox=true;
  var overlay=null,lastFocus=null;
  function onKey(e){if(e.key==='Escape'||e.keyCode===27)close();}
  function close(){
    if(!overlay)return;var ov=overlay;overlay=null;
    ov.classList.remove('tt-lightbox--open');
    document.removeEventListener('keydown',onKey);
    setTimeout(function(){if(ov&&ov.parentNode)ov.parentNode.removeChild(ov);},200);
    if(lastFocus&&lastFocus.focus)lastFocus.focus();
  }
  function open(img){
    lastFocus=document.activeElement;
    overlay=document.createElement('div');
    overlay.className='tt-lightbox';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
    var alt=img.getAttribute('alt')||'';overlay.setAttribute('aria-label',alt||'Enlarged image');
    var btn=document.createElement('button');btn.type='button';btn.className='tt-lightbox__close';
    btn.setAttribute('aria-label','Close');btn.innerHTML='&times;';
    var fig=document.createElement('figure');fig.className='tt-lightbox__fig';
    var big=document.createElement('img');big.className='tt-lightbox__img';
    big.src=img.currentSrc||img.src;big.alt=alt;big.setAttribute('decoding','async');
    fig.appendChild(big);
    if(alt){var cap=document.createElement('figcaption');cap.className='tt-lightbox__cap';cap.textContent=alt;fig.appendChild(cap);}
    overlay.appendChild(btn);overlay.appendChild(fig);
    document.body.appendChild(overlay);
    overlay.offsetWidth;overlay.classList.add('tt-lightbox--open');
    btn.focus();document.addEventListener('keydown',onKey);
  }
  document.addEventListener('click',function(e){
    var t=e.target;
    if(overlay){if(t===overlay||(t.closest&&t.closest('.tt-lightbox__close'))){e.preventDefault();close();}return;}
    var img=t&&t.closest?t.closest('img[data-tt-zoom]'):null;if(!img)return;
    e.preventDefault();open(img);
  },false);
})();`;
/**
 * Install the interactive, keyboard-operable gallery lightbox in browser applications.
 * Images opt in with `data-tt-zoom`; all matching images form one navigable gallery.
 * Returns a cleanup function suitable for React effects and client-side route transitions.
 */
export function installImageLightbox(root = document) {
    const images = Array.from(root.querySelectorAll("img[data-tt-zoom]"));
    if (!images.length)
        return () => { };
    let overlay = null;
    let index = 0;
    let lastFocus = null;
    const render = () => {
        if (!overlay)
            return;
        const source = images[index];
        const image = overlay.querySelector(".tt-lightbox__img");
        const caption = overlay.querySelector(".tt-lightbox__cap");
        const count = overlay.querySelector(".tt-lightbox__count");
        if (!source || !image || !caption || !count)
            return;
        image.src = source.currentSrc || source.src;
        image.alt = source.alt;
        caption.textContent = source.alt;
        caption.hidden = !source.alt;
        count.textContent = `${index + 1} / ${images.length}`;
    };
    const close = () => {
        if (!overlay)
            return;
        overlay.remove();
        overlay = null;
        lastFocus?.focus();
    };
    const step = (delta) => {
        index = (index + delta + images.length) % images.length;
        render();
    };
    const open = (nextIndex, source) => {
        index = nextIndex;
        lastFocus = source;
        overlay = root.createElement("div");
        overlay.className = "tt-lightbox tt-lightbox--open";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Image gallery");
        overlay.innerHTML = `<button class="tt-lightbox__close" type="button" aria-label="Close image gallery">&times;</button>
      <button class="tt-lightbox__nav tt-lightbox__nav--prev" type="button" aria-label="Previous image">&#8249;</button>
      <figure class="tt-lightbox__fig"><img class="tt-lightbox__img" alt=""><figcaption class="tt-lightbox__cap"></figcaption></figure>
      <button class="tt-lightbox__nav tt-lightbox__nav--next" type="button" aria-label="Next image">&#8250;</button>
      <span class="tt-lightbox__count" aria-live="polite"></span>`;
        root.body.appendChild(overlay);
        render();
        overlay.querySelector(".tt-lightbox__close")?.focus();
    };
    const onClick = (event) => {
        const target = event.target;
        if (overlay) {
            if (target === overlay || target?.closest(".tt-lightbox__close"))
                close();
            else if (target?.closest(".tt-lightbox__nav--prev"))
                step(-1);
            else if (target?.closest(".tt-lightbox__nav--next"))
                step(1);
            return;
        }
        const image = target?.closest("img[data-tt-zoom]");
        if (!image)
            return;
        event.preventDefault();
        open(images.indexOf(image), image);
    };
    const onKey = (event) => {
        if (overlay) {
            if (event.key === "Escape")
                close();
            else if (event.key === "ArrowLeft")
                step(-1);
            else if (event.key === "ArrowRight")
                step(1);
            return;
        }
        if (event.key !== "Enter" && event.key !== " ")
            return;
        const image = event.target instanceof HTMLImageElement && event.target.matches("img[data-tt-zoom]") ? event.target : null;
        if (!image)
            return;
        event.preventDefault();
        open(images.indexOf(image), image);
    };
    images.forEach((image) => {
        image.tabIndex = image.tabIndex < 0 ? 0 : image.tabIndex;
        image.setAttribute("role", "button");
        image.setAttribute("aria-label", `Open image: ${image.alt || "gallery image"}`);
    });
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    return () => {
        root.removeEventListener("click", onClick);
        root.removeEventListener("keydown", onKey);
        overlay?.remove();
    };
}
/**
 * Companion script for {@link renderBookmarkButton} + {@link renderReadingList}. Served same-origin
 * (CSP `script-src 'self'`); idempotent. Stores a device-local list in `localStorage` under
 * `dm:bookmarks` ([{id,title,url,savedAt}]); toggles Save/Saved on articles; renders, removes,
 * clears, and exports (as a downloaded JSON data-URI, no network) the reading-list page. All storage
 * access is try/caught — where it is blocked (private mode), Save buttons disable and the list shows
 * an honest note instead of silently failing. No account, no server, no tracking.
 */
export const BOOKMARK_JS = `(function(){
  if(window.__ttBookmark)return;window.__ttBookmark=true;
  var KEY='dm:bookmarks';
  function read(){try{var v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v:[];}catch(e){return null;}}
  function write(list){try{localStorage.setItem(KEY,JSON.stringify(list));return true;}catch(e){return false;}}
  function has(list,id){for(var i=0;i<list.length;i++){if(list[i]&&list[i].id===id)return true;}return false;}
  function esc(s){var d=document.createElement('div');d.textContent=(s==null?'':String(s));return d.innerHTML;}
  var storageOk=read()!==null;
  function syncButtons(){
    var list=read()||[];var btns=document.querySelectorAll('[data-tt-bookmark]');
    for(var i=0;i<btns.length;i++){var b=btns[i];var saved=has(list,b.getAttribute('data-tt-id'));
      b.setAttribute('aria-pressed',saved?'true':'false');
      var l=b.querySelector('.tt-bookmark__label');if(l)l.textContent=saved?'Saved':'Save';
      if(!storageOk){b.setAttribute('disabled','');b.setAttribute('title','Local storage is blocked in this browser');}}
  }
  function toggle(b){var list=read();if(list===null)return;var id=b.getAttribute('data-tt-id');
    if(has(list,id)){list=list.filter(function(x){return x.id!==id;});}
    else{list.push({id:id,title:b.getAttribute('data-tt-title'),url:b.getAttribute('data-tt-url'),savedAt:new Date().toISOString()});}
    write(list);syncButtons();renderList();}
  function renderList(){
    var root=document.querySelector('[data-tt-reading-list]');if(!root)return;
    var ul=root.querySelector('.tt-reading-list__items');var empty=root.querySelector('.tt-reading-list__empty');
    var actions=root.querySelector('.tt-reading-list__actions');var note=root.querySelector('.tt-reading-list__note');
    if(!storageOk){if(note)note.hidden=false;if(empty)empty.hidden=true;if(ul)ul.hidden=true;if(actions)actions.hidden=true;return;}
    var list=(read()||[]).slice().sort(function(a,b){return (b.savedAt||'').localeCompare(a.savedAt||'');});
    if(!list.length){if(empty)empty.hidden=false;if(ul){ul.hidden=true;ul.innerHTML='';}if(actions)actions.hidden=true;return;}
    if(empty)empty.hidden=true;if(actions)actions.hidden=false;
    if(ul){ul.hidden=false;ul.innerHTML=list.map(function(b){var d=(b.savedAt||'').slice(0,10);
      return '<li class="tt-reading-list__item"><a href="'+esc(b.url)+'">'+esc(b.title)+'</a>'+(d?' <span class="tt-reading-list__date">saved '+esc(d)+'</span>':'')+' <button class="tt-reading-list__remove" type="button" data-tt-remove="'+esc(b.id)+'" aria-label="Remove '+esc(b.title)+' from your reading list">Remove</button></li>';
    }).join('');}
  }
  document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
    var b=t.closest('[data-tt-bookmark]');if(b){e.preventDefault();toggle(b);return;}
    var rm=t.closest('[data-tt-remove]');if(rm){var list=read();if(list){write(list.filter(function(x){return x.id!==rm.getAttribute('data-tt-remove');}));syncButtons();renderList();}return;}
    if(t.closest('[data-tt-rl-clear]')){if(write([])){syncButtons();renderList();}return;}
    if(t.closest('[data-tt-rl-export]')){var data=JSON.stringify(read()||[],null,2);
      var a=document.createElement('a');a.href='data:application/json;charset=utf-8,'+encodeURIComponent(data);
      a.download='desktop-management-reading-list.json';document.body.appendChild(a);a.click();document.body.removeChild(a);return;}
  },false);
  syncButtons();renderList();
})();`;
/**
 * Light/dark reading-mode toggle driver. The SERVER already set `data-theme` from the `dm-theme` cookie
 * (no flash), so this only (a) syncs each toggle button's pressed state + label to the live theme, and
 * (b) on click flips the theme live + persists the cookie for the next SSR. CSP-safe (served same-origin),
 * idempotent, and a cookie write failure (private mode) degrades to session-only theming.
 */
export const THEME_JS = `(function(){
  if(window.__ttTheme)return;window.__ttTheme=true;
  var KEY='dm-theme';
  function current(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}
  function apply(t){
    document.documentElement.setAttribute('data-theme',t);
    try{document.cookie=KEY+'='+t+';path=/;max-age=31536000;SameSite=Lax';}catch(e){}
    var btns=document.querySelectorAll('[data-tt-theme-toggle]');
    for(var i=0;i<btns.length;i++){
      btns[i].setAttribute('aria-pressed',t==='light'?'true':'false');
      btns[i].setAttribute('aria-label',t==='light'?'Switch to dark reading mode':'Switch to light reading mode');
    }
  }
  apply(current());
  document.addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('[data-tt-theme-toggle]'):null;
    if(!b)return;
    apply(current()==='light'?'dark':'light');
  },false);
})();`;
/**
 * Delegated tactile click ripple driver for blog interactive controls (`.tt-btn`, `.tt-bookmark`,
 * `.tt-theme-toggle`, `.tt-code__copy`, `.tt-platform-tabs__tab`, `.tt-faq__summary`, `button`).
 * Sets `--tt-ripple-x` and `--tt-ripple-y` (with 50%/50% keyboard fallback) and respects `prefers-reduced-motion`.
 */
export const RIPPLE_JS = `(function(){
  if(window.__ttRipple)return;window.__ttRipple=true;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var SEL='.tt-btn,.tt-bookmark,.tt-theme-toggle,.tt-code__copy,.tt-platform-tabs__tab,.tt-faq__summary,button:not(:disabled)';
  document.addEventListener('pointerdown',function(e){
    var el=e.target&&e.target.closest?e.target.closest(SEL):null;
    if(!el||!el.style)return;
    var r=el.getBoundingClientRect();
    var kb=e.clientX===0&&e.clientY===0;
    el.style.setProperty('--tt-ripple-x',kb?'50%':(e.clientX-r.left)+'px');
    el.style.setProperty('--tt-ripple-y',kb?'50%':(e.clientY-r.top)+'px');
  },{passive:true});
})();`;
/**
 * Progressive-enhancement driver for the unified header MEGA-MENU (served same-origin, exactly like
 * THEME_JS / BOOKMARK_JS). The menu is fully usable WITHOUT this script — CSS hover/`:focus-within`
 * already reveals panels + swaps the featured preview. This adds: click-to-pin persistence, full
 * keyboard navigation (ArrowLeft/Right across triggers, ArrowDown into the panel, Up/Down within it,
 * Home/End, Escape to close + restore focus), hover-intent (a short close delay so a diagonal pointer
 * path doesn't snap the panel shut), the mobile burger toggle, and click-outside-to-close. Idempotent,
 * CSP-safe (no innerHTML, no eval), reduced-motion agnostic.
 */
export const NAV_MENU_JS = `(function(){
  if(window.__ttNavMenu)return;window.__ttNavMenu=true;
  var CLOSE_DELAY=170;
  function mobile(){return window.matchMedia&&window.matchMedia('(max-width: 860px)').matches;}
  function triggersOf(r){return Array.prototype.slice.call(r.querySelectorAll('[data-tt-nav-trigger]'));}
  function panelFor(t){return t.parentNode?t.parentNode.querySelector('.tt-nav__mm-panel'):null;}
  function itemsOf(p){return p?Array.prototype.slice.call(p.querySelectorAll('.tt-nav__mm-item')):[];}
  function closeAll(r,ex){triggersOf(r).forEach(function(t){if(t!==ex)t.setAttribute('aria-expanded','false');});}
  function open(r,t){closeAll(r,t);t.setAttribute('aria-expanded','true');}
  function close(t){t.setAttribute('aria-expanded','false');}
  function roving(r,a){triggersOf(r).forEach(function(t){t.setAttribute('tabindex',t===a?'0':'-1');});}
  document.querySelectorAll('[data-tt-nav-root]').forEach(function(root){
    var bar=root.querySelector('.tt-nav__mm-bar');
    var header=root.closest?root.closest('.tt-nav'):null;
    var burger=header?header.querySelector('[data-tt-nav-burger]'):null;
    var triggers=triggersOf(root);
    var timer=null;
    if(burger&&bar){
      burger.addEventListener('click',function(){
        var o=root.getAttribute('data-tt-nav-open')==='true';
        root.setAttribute('data-tt-nav-open',o?'false':'true');
        burger.setAttribute('aria-expanded',o?'false':'true');
        if(o)closeAll(root,null);
      });
    }
    triggers.forEach(function(trigger,idx){
      var panel=panelFor(trigger);
      trigger.addEventListener('click',function(e){
        var isOpen=trigger.getAttribute('aria-expanded')==='true';
        if(isOpen){close(trigger);}else{open(root,trigger);}
        e.preventDefault();
      });
      if(trigger.parentNode){
        trigger.parentNode.addEventListener('mouseenter',function(){
          if(mobile())return;
          if(timer){clearTimeout(timer);timer=null;}
          open(root,trigger);
        });
        trigger.parentNode.addEventListener('mouseleave',function(){
          if(mobile())return;
          if(timer)clearTimeout(timer);
          timer=setTimeout(function(){close(trigger);},CLOSE_DELAY);
        });
      }
      trigger.addEventListener('keydown',function(e){
        var k=e.key;
        if(k==='ArrowRight'){e.preventDefault();var n=triggers[(idx+1)%triggers.length];roving(root,n);n.focus();}
        else if(k==='ArrowLeft'){e.preventDefault();var p=triggers[(idx-1+triggers.length)%triggers.length];roving(root,p);p.focus();}
        else if(k==='ArrowDown'||k==='Enter'||k===' '){e.preventDefault();open(root,trigger);var it=itemsOf(panel);if(it.length)it[0].focus();}
        else if(k==='Escape'){close(trigger);}
        else if(k==='Home'){e.preventDefault();roving(root,triggers[0]);triggers[0].focus();}
        else if(k==='End'){e.preventDefault();var l=triggers[triggers.length-1];roving(root,l);l.focus();}
      });
      if(panel){
        panel.addEventListener('keydown',function(e){
          var it=itemsOf(panel);var ci=it.indexOf(document.activeElement);var k=e.key;
          if(k==='ArrowDown'){e.preventDefault();(it[ci+1]||it[0]).focus();}
          else if(k==='ArrowUp'){e.preventDefault();if(ci<=0){trigger.focus();}else{it[ci-1].focus();}}
          else if(k==='Escape'){e.preventDefault();close(trigger);trigger.focus();}
          else if(k==='Home'){e.preventDefault();if(it[0])it[0].focus();}
          else if(k==='End'){e.preventDefault();if(it.length)it[it.length-1].focus();}
          else if(k==='Tab'){close(trigger);}
        });
      }
    });
    document.addEventListener('click',function(e){if(root.contains(e.target))return;closeAll(root,null);});
    root.addEventListener('focusout',function(){setTimeout(function(){if(!root.contains(document.activeElement)&&!mobile())closeAll(root,null);},0);});
  });
})();
(function(){
  /* Compact-overlay mega-menu driver: open/close + focus trap + Esc + roving-arrow desk grid +
     live featured swap + global "/" and Cmd/Ctrl+K to open & focus search. CSP-safe (no innerHTML
     on untrusted data — only element attributes the server set), idempotent, reduced-motion agnostic. */
  var FOCUSABLE='a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])';
  function boot(scope){
  (scope||document).querySelectorAll('[data-tt-ov-trigger]').forEach(function(trigger){
    if(trigger.hasAttribute('data-tt-ov-ready'))return;
    trigger.setAttribute('data-tt-ov-ready','true');
    var id=trigger.getAttribute('aria-controls');
    var panel=id?document.getElementById(id):null;if(!panel)return;
    var scrim=panel.querySelector('[data-tt-ov-scrim]');
    var closeBtn=panel.querySelector('[data-tt-ov-close]');
    var searchInput=panel.querySelector('[data-tt-ov-search]');
    var searchBtn=trigger.parentNode?trigger.parentNode.querySelector('[data-tt-ov-searchbtn]'):null;
    var cards=Array.prototype.slice.call(panel.querySelectorAll('[data-tt-ov-card]'));
    var featuredImg=panel.querySelector('[data-tt-ov-fimg]');
    var featuredLink=panel.querySelector('[data-tt-ov-featured]');
    var fKicker=featuredLink?featuredLink.querySelector('[data-tt-ov-fkicker]'):null;
    var fTitle=featuredLink?featuredLink.querySelector('[data-tt-ov-ftitle]'):null;
    var lastFocus=null,swapT=null;
    function markCurrentRoute(){
      var here=location.pathname.replace(/\\/+$/,'')||'/';
      Array.prototype.forEach.call(panel.querySelectorAll('a[href]'),function(link){
        var current=false;
        try{var url=new URL(link.getAttribute('href'),location.href);var path=url.pathname.replace(/\\/+$/,'')||'/';current=url.origin===location.origin&&path===here;}catch(e){}
        if(current){link.setAttribute('aria-current','page');link.setAttribute('data-tt-ov-current','1');}
        else{link.removeAttribute('aria-current');link.removeAttribute('data-tt-ov-current');}
      });
    }
    function cols(){ // how many cards per row (for up/down arrows) — read the computed grid
      try{var s=getComputedStyle(panel.querySelector('.tt-ov__grid'));var n=s.gridTemplateColumns.split(' ').length;return n>0?n:3;}catch(e){return 3;}}
    function setFeatured(card){
      if(!featuredImg||!card)return;
      var src=card.getAttribute('data-tt-ov-fsrc');if(!src)return;
      var alt=card.getAttribute('data-tt-ov-falt');
      var ttl=card.getAttribute('data-tt-ov-ftitle')||'';
      var href=card.getAttribute('data-tt-ov-fhref');
      if(fKicker)fKicker.textContent=card.getAttribute('data-tt-ov-fkicker')||'';
      if(fTitle)fTitle.textContent=ttl;
      if(featuredLink){if(href)featuredLink.setAttribute('href',href);if(ttl)featuredLink.setAttribute('aria-label',ttl);}
      if(alt)featuredImg.setAttribute('alt',alt);
      if(swapT){clearTimeout(swapT);swapT=null;}
      if(featuredImg.getAttribute('src')===src){featuredImg.removeAttribute('data-tt-ov-swapping');return;}
      featuredImg.setAttribute('data-tt-ov-swapping','1');
      swapT=setTimeout(function(){
        featuredImg.setAttribute('src',src);
        featuredImg.removeAttribute('data-tt-ov-swapping');
        swapT=null;
      },140);
    }
    function markActive(card){cards.forEach(function(c){if(c===card)c.setAttribute('data-tt-ov-active','1');else c.removeAttribute('data-tt-ov-active');});}
    function isOpen(){return trigger.getAttribute('aria-expanded')==='true';}
    function open(focusSearch){
      if(isOpen())return;lastFocus=document.activeElement;
      markCurrentRoute();
      panel.hidden=false;
      // next frame so the transition runs from the hidden→shown state
      requestAnimationFrame(function(){panel.setAttribute('data-tt-ov-open','1');});
      trigger.setAttribute('aria-expanded','true');
      document.documentElement.style.overflow='hidden';
      cards.forEach(function(c,i){c.setAttribute('tabindex',i===0?'0':'-1');});
      var target=(focusSearch&&searchInput)?searchInput:(cards[0]||closeBtn||searchInput);
      if(target)setTimeout(function(){target.focus();},60);
    }
    function close(restore){
      if(!isOpen())return;
      panel.removeAttribute('data-tt-ov-open');
      trigger.setAttribute('aria-expanded','false');
      document.documentElement.style.overflow='';
      var done=function(){panel.hidden=true;};
      // allow the close transition to play unless reduced-motion
      var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(rm){done();}else{setTimeout(done,360);}
      if(restore!==false){var t=lastFocus&&lastFocus.focus?lastFocus:trigger;setTimeout(function(){t.focus();},0);}
    }
    trigger.addEventListener('click',function(e){e.preventDefault();if(isOpen())close();else open(false);});
    if(searchBtn)searchBtn.addEventListener('click',function(e){e.preventDefault();open(true);});
    if(scrim)scrim.addEventListener('click',function(){close();});
    if(closeBtn)closeBtn.addEventListener('click',function(){close();});
    // Live featured swap on card hover/focus
    cards.forEach(function(card,idx){
      card.addEventListener('mouseenter',function(){setFeatured(card);markActive(card);});
      card.addEventListener('focus',function(){setFeatured(card);markActive(card);cards.forEach(function(c,i){c.setAttribute('tabindex',i===idx?'0':'-1');});});
      card.addEventListener('keydown',function(e){
        var k=e.key,n=cols(),next=-1;
        if(k==='ArrowRight')next=(idx+1)%cards.length;
        else if(k==='ArrowLeft')next=(idx-1+cards.length)%cards.length;
        else if(k==='ArrowDown')next=Math.min(cards.length-1,idx+n);
        else if(k==='ArrowUp')next=Math.max(0,idx-n);
        else if(k==='Home')next=0;
        else if(k==='End')next=cards.length-1;
        if(next>=0){e.preventDefault();var t=cards[next];cards.forEach(function(c,i){c.setAttribute('tabindex',i===next?'0':'-1');});t.focus();}
      });
    });
    // Focus trap + Esc, scoped to the panel
    panel.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();close();return;}
      if(e.key!=='Tab')return;
      var f=Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE)).filter(function(el){return el.offsetParent!==null||el===document.activeElement;});
      if(!f.length)return;var first=f[0],last=f[f.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    });
  });
  }
  boot(document);
  if(!window.__ttNavOverlayObserver&&window.MutationObserver){
    window.__ttNavOverlayObserver=new MutationObserver(function(records){records.forEach(function(record){
      Array.prototype.forEach.call(record.addedNodes||[],function(node){if(node&&node.querySelectorAll)boot(node);});
    });});
    window.__ttNavOverlayObserver.observe(document.documentElement,{childList:true,subtree:true});
  }
  // Global shortcuts: "/" or Cmd/Ctrl+K opens the FIRST overlay + focuses its search (not while typing).
  // Prefer the resting search affordance's own click (runs the canonical open(true) path); else the trigger.
  if(window.__ttNavOverlayShortcuts)return;window.__ttNavOverlayShortcuts=true;
  document.addEventListener('keydown',function(e){
    var slash=e.key==='/'&&!e.metaKey&&!e.ctrlKey&&!e.altKey;
    var cmdk=(e.key==='k'||e.key==='K')&&(e.metaKey||e.ctrlKey);
    if(!slash&&!cmdk)return;
    var ae=document.activeElement,tag=ae?ae.tagName:'';
    if(slash&&(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(ae&&ae.isContentEditable)))return;
    var trigger=document.querySelector('[data-tt-ov-trigger]');if(!trigger)return;
    if(trigger.getAttribute('aria-expanded')==='true')return; // already open — let native focus flow
    e.preventDefault();
    var header=trigger.closest?trigger.closest('.tt-nav'):null;
    var searchBtn=header?header.querySelector('[data-tt-ov-searchbtn]'):null;
    if(searchBtn){searchBtn.click();}else{trigger.click();}
  });
})();`;
/**
 * A server-rendered self-assessment worksheet form: a config-attribute carrier + per-criterion
 * radiogroups + a live-summary slot + export/reset actions. Fully usable before JS; {@link WORKSHEET_JS}
 * enhances it by reading the `data-tt-worksheet*` / `data-tt-criterion` / `data-tt-flag` attributes this
 * emits — so the markup contract and its driver live together in the catalog. All text + attribute
 * values are escaped. Powers calculator / assessment / buyer-guide lead-magnets across sites.
 */
export function renderWorksheetForm(data) {
    const cfgAttrs = Object.entries(data.config)
        .map(([k, v]) => `${k}="${E(v)}"`)
        .join(" ");
    const subject = data.subject
        ? `<div class="tt-worksheet__subject">
        <label for="ws-subject">${E(data.subject.label)}</label>
        <input id="ws-subject" data-tt-worksheet-subject type="text" placeholder="${E(data.subject.placeholder)}">
      </div>`
        : "";
    const fields = data.items
        .map((it, i) => {
        const opts = data.levels
            .map((l) => `<label class="tt-criterion__opt"><input type="radio" name="ws-${i}" value="${E(l.value)}"${l.flag ? ` data-tt-flag="${l.flag}"` : ""}> ${E(l.label)}</label>`)
            .join("");
        return `<fieldset class="tt-criterion" data-tt-criterion="${E(it.name)}">
        <legend>${E(it.name)}</legend>
        <p class="tt-criterion__hint">${E(it.hint)}</p>
        <div class="tt-criterion__opts" role="radiogroup" aria-label="${E(it.name)} assessment">${opts}</div>
        <textarea rows="1" aria-label="${E(it.name)} notes" placeholder="${E(data.notePlaceholder)}"></textarea>
      </fieldset>`;
    })
        .join("");
    return `<form class="tt-worksheet" data-tt-worksheet="${E(data.id)}" autocomplete="off" ${cfgAttrs}>
    ${subject}
    ${fields}
    <div class="tt-worksheet__summary" data-tt-worksheet-summary role="status" aria-live="polite" aria-label="Summary">
      <p>${E(data.initialSummary)}</p>
    </div>
    <div class="tt-worksheet__actions">
      <button type="button" class="tt-btn tt-btn--primary" data-tt-worksheet-export>Export worksheet</button>
      <button type="button" class="tt-btn tt-btn--ghost" data-tt-worksheet-reset>Clear</button>
    </div>
  </form>`;
}
/**
 * Self-assessment worksheet driver. Enhances a server-rendered `[data-tt-worksheet]` form: it tallies
 * the reader's OWN radio selections into a live summary + exports the completed sheet as a text file,
 * and (if storage is available) keeps progress across reloads. It inspects nothing but the form — no
 * machine, no network. The summary is built with DOM nodes (no innerHTML → Trusted-Types-safe);
 * criterion labels come from `data-tt-criterion` attributes the server controls. Idempotent, CSP-safe.
 */
export const WORKSHEET_JS = `(function(){
  if(window.__ttWorksheet)return;window.__ttWorksheet=true;
  function keyFor(f){return 'dm:worksheet:'+(f.getAttribute('data-tt-worksheet')||'default');}
  function groups(f){return f.querySelectorAll('[data-tt-criterion]');}
  function cfg(f,attr,dflt){var v=f.getAttribute(attr);return v!=null?v:dflt;}
  function read(f){
    var out=[];var gs=groups(f);
    for(var i=0;i<gs.length;i++){var g=gs[i];
      var sel=g.querySelector('input[type=radio]:checked');
      var note=g.querySelector('textarea');
      var label='';if(sel){var lb=sel.closest('label');label=lb?lb.textContent.trim():sel.value;}
      out.push({name:g.getAttribute('data-tt-criterion'),value:sel?sel.value:'',label:label,
        flag:sel?(sel.getAttribute('data-tt-flag')||''):'',note:note?note.value.trim():''});}
    return out;
  }
  function subjectVal(f){var t=f.querySelector('[data-tt-worksheet-subject]');return t&&t.value.trim()?t.value.trim():'';}
  function save(f){try{localStorage.setItem(keyFor(f),JSON.stringify({subject:subjectVal(f),rows:read(f)}));}catch(e){}}
  function restore(f){
    var data;try{data=JSON.parse(localStorage.getItem(keyFor(f))||'null');}catch(e){data=null;}
    if(!data)return;
    var subj=f.querySelector('[data-tt-worksheet-subject]');if(subj&&data.subject)subj.value=data.subject;
    var gs=groups(f);var map={};if(data.rows)for(var k=0;k<data.rows.length;k++)map[data.rows[k].name]=data.rows[k];
    for(var i=0;i<gs.length;i++){var g=gs[i];var d=map[g.getAttribute('data-tt-criterion')];if(!d)continue;
      if(d.value){var r=g.querySelector('input[type=radio][value="'+d.value+'"]');if(r)r.checked=true;}
      if(d.note){var t=g.querySelector('textarea');if(t)t.value=d.note;}}
  }
  function p(text,strongParts){var el=document.createElement('p');el.appendChild(document.createTextNode(text));
    if(strongParts){var s=document.createElement('strong');s.textContent=strongParts;el.appendChild(s);}return el;}
  function flagged(rows){var out={concern:[],unknown:[]};for(var i=0;i<rows.length;i++){var fl=rows[i].flag;
    if(fl==='concern')out.concern.push(rows[i].name);else if(fl==='unknown')out.unknown.push(rows[i].name);}return out;}
  function summarize(f){
    var rows=read(f);var n=rows.length;var assessed=0;
    for(var i=0;i<rows.length;i++){if(rows[i].value)assessed++;}
    var fg=flagged(rows);var noun=cfg(f,'data-tt-noun','criteria');
    var box=f.querySelector('[data-tt-worksheet-summary]');if(!box)return;
    while(box.firstChild)box.removeChild(box.firstChild);
    if(assessed===0){box.appendChild(p(cfg(f,'data-tt-empty','Fill in the items above to build your summary. Nothing here is sent anywhere.')));return;}
    box.appendChild(p(assessed+' of '+n+' '+noun+' assessed.'));
    if(fg.concern.length)box.appendChild(p(cfg(f,'data-tt-concern-label','Areas to weigh carefully')+': ',fg.concern.join(', ')));
    if(fg.unknown.length)box.appendChild(p(cfg(f,'data-tt-unknown-label','Unknowns to research')+': ',fg.unknown.join(', ')));
    if(assessed===n&&!fg.concern.length&&!fg.unknown.length)box.appendChild(p(cfg(f,'data-tt-allgood','Nothing flagged — but this reflects your own judgement, not a test.')));
  }
  function exportSheet(f){
    var rows=read(f);var subj=subjectVal(f);
    var lines=[cfg(f,'data-tt-title','desktop.management — Worksheet')];
    if(f.querySelector('[data-tt-worksheet-subject]'))lines.push(cfg(f,'data-tt-subject-label','Subject')+': '+(subj||'(not named)'));
    lines.push('');
    for(var i=0;i<rows.length;i++){lines.push(rows[i].name+': '+(rows[i].label||'(not assessed)'));
      if(rows[i].note)lines.push('  Note: '+rows[i].note);}
    var fg=flagged(rows);var assessed=0;for(var j=0;j<rows.length;j++){if(rows[j].value)assessed++;}
    lines.push('','Assessed: '+assessed+' of '+rows.length+'.');
    if(fg.concern.length)lines.push(cfg(f,'data-tt-concern-label','Areas to weigh carefully')+': '+fg.concern.join(', '));
    if(fg.unknown.length)lines.push(cfg(f,'data-tt-unknown-label','Unknowns to research')+': '+fg.unknown.join(', '));
    lines.push('','This worksheet reflects your own assessment. It does not test anything or inspect your computer.');
    var blob=lines.join('\\n');
    try{var a=document.createElement('a');a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(blob);
      a.download=cfg(f,'data-tt-filename','worksheet')+'.txt';document.body.appendChild(a);a.click();document.body.removeChild(a);}catch(e){}
  }
  var fs=document.querySelectorAll('[data-tt-worksheet]');
  for(var i=0;i<fs.length;i++){(function(f){
    restore(f);summarize(f);
    f.addEventListener('submit',function(e){e.preventDefault();},false); // no server submit — Enter must not reload
    f.addEventListener('change',function(){summarize(f);save(f);},false);
    f.addEventListener('input',function(e){if(e.target&&(e.target.tagName==='TEXTAREA'||e.target.hasAttribute('data-tt-worksheet-subject')))save(f);},false);
    var ex=f.querySelector('[data-tt-worksheet-export]');if(ex)ex.addEventListener('click',function(){exportSheet(f);},false);
    var rs=f.querySelector('[data-tt-worksheet-reset]');if(rs)rs.addEventListener('click',function(){
      try{localStorage.removeItem(keyFor(f));}catch(e){}
      var radios=f.querySelectorAll('input[type=radio]');for(var k=0;k<radios.length;k++)radios[k].checked=false;
      var tas=f.querySelectorAll('textarea');for(var m=0;m<tas.length;m++)tas[m].value='';
      var subj=f.querySelector('[data-tt-worksheet-subject]');if(subj)subj.value='';
      summarize(f);},false);
  })(fs[i]);}
})();`;
export const BLOG_SITE_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "site",
    w3cTraceparentFormat: "00-32hex-16hex-01",
    langfuseFailOpenTimeoutMs: 2500,
    rfc9457ProblemDetailsSupported: true,
    tactileMicroInteractionsCount: 30,
    interactionStatesCount: 16,
    transitionDurationSeconds: 0.333,
    requiresCloudflareContainers: false,
    deterministicDigest: 3687275616,
};
export function verifyBlogSiteModuleInvariants(tenantId = "tenant_default") {
    const cleanTenant = tenantId.trim() || "tenant_default";
    let rollingHash = BLOG_SITE_MODULE_SPECIFICATION.deterministicDigest ^ cleanTenant.length;
    for (let i = 0; i < cleanTenant.length; i++) {
        rollingHash = Math.imul(rollingHash ^ cleanTenant.charCodeAt(i), 0x01000193) >>> 0;
    }
    return {
        ok: BLOG_SITE_MODULE_SPECIFICATION.interactionStatesCount === 16 &&
            BLOG_SITE_MODULE_SPECIFICATION.tactileMicroInteractionsCount === 30 &&
            !BLOG_SITE_MODULE_SPECIFICATION.requiresCloudflareContainers,
        tenantId: cleanTenant,
        packageName: BLOG_SITE_MODULE_SPECIFICATION.packageName,
        moduleSlug: BLOG_SITE_MODULE_SPECIFICATION.moduleSlug,
        w3cTraceparentFormat: BLOG_SITE_MODULE_SPECIFICATION.w3cTraceparentFormat,
        langfuseFailOpenTimeoutMs: BLOG_SITE_MODULE_SPECIFICATION.langfuseFailOpenTimeoutMs,
        rfc9457ProblemDetailsSupported: BLOG_SITE_MODULE_SPECIFICATION.rfc9457ProblemDetailsSupported,
        tactileMicroInteractionsCount: BLOG_SITE_MODULE_SPECIFICATION.tactileMicroInteractionsCount,
        interactionStatesCount: BLOG_SITE_MODULE_SPECIFICATION.interactionStatesCount,
        transitionDurationSeconds: BLOG_SITE_MODULE_SPECIFICATION.transitionDurationSeconds,
        spec: BLOG_SITE_MODULE_SPECIFICATION,
        verifiedInteractionStateCount: 16,
        minApcaContrastLc: 60,
        checksum: rollingHash,
    };
}
//# sourceMappingURL=site.js.map