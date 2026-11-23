/**
 * @file related-posts.ts
 * @brief Shared "More from this desk / series" related-reading block for @theme.tools/blog.
 *
 * Zero-dependency HTML-string SSR (matches `widgets.ts` / `media.ts`). The consumer passes its OWN
 * already-filtered sibling posts (e.g. the result of its `postsByDesk(desk)` / `postsBySeries()`
 * helper); this renderer derives up to `limit` cards — excluding the current slug — with a cover
 * image, title, and reading time. Self-contained inline styling (like the multimedia renderers), so
 * no extra stylesheet injection is required.
 */
function esc(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
/**
 * Render a "More from this desk/series" block. Returns `""` when, after excluding the current
 * slug, there are no siblings to show (so a consumer can inject it unconditionally).
 *
 * @param data See {@link RelatedPostsData}.
 */
export function renderRelatedPosts(data) {
    const limit = typeof data.limit === "number" && data.limit > 0 ? Math.floor(data.limit) : 3;
    const siblings = (data.posts ?? [])
        .filter((p) => p && typeof p.slug === "string" && p.slug !== data.currentSlug)
        .slice(0, limit);
    if (siblings.length === 0)
        return "";
    const scope = (data.series && data.series.trim()) || (data.desk && data.desk.trim()) || "";
    const heading = scope ? `More from ${esc(scope)}` : "More reading";
    const cards = siblings
        .map((p) => {
        const href = p.href && p.href.trim() ? p.href : `/blog/${p.slug}`;
        const coverSrc = p.cover?.src || p.coverSrc || "";
        const coverAlt = p.cover?.alt || p.title;
        const cover = coverSrc
            ? `<div style="aspect-ratio:16/9;overflow:hidden;background:#05060f;">
        <img src="${esc(coverSrc)}" alt="${esc(coverAlt)}" loading="lazy" decoding="async" width="400" height="225" style="width:100%;height:100%;object-fit:cover;" />
      </div>`
            : "";
        const rt = typeof p.readingTimeMinutes === "number" && p.readingTimeMinutes > 0
            ? `<span style="font-size:0.75rem;color:oklch(0.6 0.02 240);margin-top:auto;">${Math.round(p.readingTimeMinutes)} min read</span>`
            : "";
        return `
    <a href="${esc(href)}" style="display:flex;flex-direction:column;background:oklch(0.13 0.02 240);border:1px solid oklch(0.25 0.02 240);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;">
      ${cover}
      <div style="padding:0.9rem 1rem;display:flex;flex-direction:column;gap:0.4rem;flex:1;">
        <h3 style="margin:0;font-size:0.975rem;font-weight:600;line-height:1.35;color:#ffffff;">${esc(p.title)}</h3>
        ${rt}
      </div>
    </a>`;
    })
        .join("");
    return `
<section class="tt-related-posts" aria-label="${esc(heading)}" style="margin-top:3.5rem;padding-top:2rem;border-top:1px solid oklch(0.25 0.02 240);">
  <h2 style="font-size:1.25rem;font-weight:700;color:#ffffff;margin:0 0 1.25rem 0;">${heading}</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1.1rem;">
    ${cards}
  </div>
</section>`.trim();
}
//# sourceMappingURL=related-posts.js.map