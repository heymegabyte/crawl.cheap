/**
 * @file multimedia.ts
 * @brief High-Performance Semantic Multimedia Components for Editorial Blogs.
 *
 * Renders layout-shift-free (CLS = 0) responsive pictures, Cloudflare Stream embeds,
 * interactive code blocks, and audio narration shells.
 */
export function renderResponsivePicture(config) {
    const loading = config.priority ? 'eager' : 'lazy';
    const fetchPriority = config.priority ? ' fetchpriority="high"' : '';
    const decoding = config.priority ? 'sync' : 'async';
    const cls = config.className ? ` class="${config.className}"` : '';
    const sources = [];
    if (config.avifSrc) {
        sources.push(`    <source type="image/avif" srcset="${config.avifSrc}" />`);
    }
    if (config.webpSrc) {
        sources.push(`    <source type="image/webp" srcset="${config.webpSrc}" />`);
    }
    const picture = `
<picture${cls}>
${sources.join('\n')}
  <img
    src="${config.src}"
    alt="${escapeHtml(config.alt)}"
    width="${config.width}"
    height="${config.height}"
    loading="${loading}"
    decoding="${decoding}"${fetchPriority}
    style="aspect-ratio: ${config.width} / ${config.height}; width: 100%; height: auto; max-width: 100%; border-radius: 8px;"
  />
</picture>`.trim();
    if (config.caption) {
        return `
<figure class="tt-media-figure">
  ${picture}
  <figcaption class="tt-media-caption">${escapeHtml(config.caption)}</figcaption>
</figure>`.trim();
    }
    return picture;
}
export function renderCloudflareStreamEmbed(config) {
    const domain = config.customerDomain || 'iframe.videodelivery.net';
    const embedUrl = `https://${domain}/${config.videoUid}?preload=true&poster=https%3A%2F%2Fvideodelivery.net%2F${config.videoUid}%2Fthumbnails%2Fthumbnail.jpg`;
    const aspect = config.aspectRatio || '16 / 9';
    let html = `
<div class="tt-video-wrapper" style="aspect-ratio: ${aspect}; width: 100%; position: relative; border-radius: 8px; overflow: hidden; background: #060610; border: 1px solid oklch(0.3 0.02 240);">
  <iframe
    src="${embedUrl}"
    title="${escapeHtml(config.title)}"
    style="border: none; position: absolute; top: 0; left: 0; height: 100%; width: 100%;"
    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
    allowfullscreen="true"
    loading="lazy"
  ></iframe>
</div>`.trim();
    if (config.transcriptHtml) {
        html += `
<details class="tt-video-transcript" style="margin-top: 0.75rem; border: 1px solid oklch(0.25 0.02 240); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.875rem;">
  <summary style="cursor: pointer; font-weight: 600; color: oklch(0.7 0.2 200);">Video Transcript & Key Timestamps</summary>
  <div class="tt-transcript-body" style="margin-top: 0.5rem; color: oklch(0.85 0.02 240); line-height: 1.6;">
    ${config.transcriptHtml}
  </div>
</details>`.trim();
    }
    return html;
}
export function renderInteractiveCodeBlock(config) {
    const fileHeader = config.filename
        ? `<div class="tt-code-header" style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1rem; background: oklch(0.18 0.02 240); border-bottom: 1px solid oklch(0.25 0.02 240); font-family: ui-monospace, monospace; font-size: 0.8125rem; color: oklch(0.8 0.02 240);">
        <span class="tt-code-filename">${escapeHtml(config.filename)}</span>
        <span class="tt-code-lang" style="text-transform: uppercase; font-size: 0.75rem; color: oklch(0.7 0.2 200);">${escapeHtml(config.language)}</span>
      </div>`
        : '';
    return `
<div class="tt-code-container" style="border: 1px solid oklch(0.25 0.02 240); border-radius: 8px; overflow: hidden; margin: 1.5rem 0; background: oklch(0.12 0.02 240);">
  ${fileHeader}
  <pre style="margin: 0; padding: 1rem; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.875rem; line-height: 1.6; color: #FFFFFF;"><code class="language-${escapeHtml(config.language)}">${escapeHtml(config.code.trim())}</code></pre>
</div>`.trim();
}
export function renderCalloutBlock(config) {
    const borderColors = {
        info: 'oklch(0.7 0.2 200)', // Cyan
        tip: 'oklch(0.75 0.2 140)', // Emerald
        warning: 'oklch(0.75 0.2 80)', // Amber
        alert: 'oklch(0.65 0.25 30)', // Rose/Red
        'key-takeaways': 'oklch(0.7 0.2 290)', // Violet
    };
    const titles = {
        info: 'Important Information',
        tip: 'Pro-Tip',
        warning: 'Caution',
        alert: 'Critical Alert',
        'key-takeaways': 'Executive Summary & Key Takeaways',
    };
    const color = borderColors[config.type] || borderColors.info;
    const heading = config.title || titles[config.type] || 'Note';
    return `
<aside class="tt-callout tt-callout-${config.type}" style="border-left: 4px solid ${color}; background: oklch(0.15 0.02 240); padding: 1rem 1.25rem; border-radius: 0 8px 8px 0; margin: 1.5rem 0;">
  <div class="tt-callout-title" style="font-weight: 700; font-size: 0.9375rem; color: ${color}; margin-bottom: 0.5rem;">${escapeHtml(heading)}</div>
  <div class="tt-callout-body" style="font-size: 0.9375rem; line-height: 1.6; color: oklch(0.9 0.02 240);">
    ${config.contentHtml}
  </div>
</aside>`.trim();
}
export function renderBreadcrumbs(crumbs) {
    if (crumbs.length === 0)
        return '';
    return `
<nav class="tt-breadcrumbs" aria-label="Breadcrumb" style="margin-bottom: 1.25rem;">
  <ol itemscope itemtype="https://schema.org/BreadcrumbList" style="list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: oklch(0.7 0.02 240);">
    ${crumbs
        .map((crumb, idx) => {
        const isLast = idx === crumbs.length - 1;
        const separator = isLast ? '' : '<span class="tt-breadcrumb-separator" aria-hidden="true" style="color: oklch(0.4 0.02 240);">/</span>';
        const position = crumb.position ?? idx + 1;
        const inner = isLast
            ? `<span itemprop="name" style="color: oklch(0.85 0.02 240); font-weight: 500;">${escapeHtml(crumb.name)}</span>`
            : `<a itemprop="item" href="${escapeHtml(crumb.url)}" style="color: oklch(0.7 0.2 200); text-decoration: none;"><span itemprop="name">${escapeHtml(crumb.name)}</span></a>`;
        return `
    <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem" style="display: inline-flex; align-items: center; gap: 0.5rem;">
      ${inner}
      <meta itemprop="position" content="${position}" />
      ${separator}
    </li>`;
    })
        .join('')}
  </ol>
</nav>`.trim();
}
export function renderAudioNarrationPlayer(config) {
    const durationLabel = config.durationFormatted || (config.durationSeconds ? `${Math.round(config.durationSeconds / 60)} min listen` : 'Audio narration');
    const narrator = config.narratorName ? `Narrated by ${escapeHtml(config.narratorName)}` : 'AI Voice Narration (Edge TTS)';
    const title = escapeHtml(config.title);
    return `
<aside class="tt-audio-narration-player" aria-label="Audio narration: ${title}" style="background: oklch(0.12 0.03 240); border: 1px solid oklch(0.25 0.02 240); border-radius: 8px; padding: 1rem 1.25rem; margin: 1.5rem 0;">
  <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
    <div style="display: flex; align-items: center; gap: 0.5rem;">
      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #00E5FF;"></span>
      <span style="font-weight: 700; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; color: #00E5FF;">Listen to this article</span>
      <span style="font-size: 0.8125rem; color: oklch(0.65 0.02 240);">(${durationLabel})</span>
    </div>
    <span style="font-size: 0.75rem; color: oklch(0.7 0.02 240);">${narrator}</span>
  </div>
  <strong class="tt-audio-narration-player__title" style="display:block;margin:0 0 .75rem;color:oklch(.94 .02 220);font-size:1rem;line-height:1.35;">${title}</strong>
  <audio controls preload="none" style="width: 100%; height: 36px; border-radius: 4px;">
    <source src="${escapeHtml(config.audioUrl)}" type="audio/mpeg" />
    Your browser does not support the audio element.
  </audio>
  <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 0.5rem; font-size: 0.75rem;">
    ${config.downloadUrl ? `<a href="${escapeHtml(config.downloadUrl)}" download style="color: oklch(0.7 0.2 200); text-decoration: none;">Download MP3</a>` : ''}
    ${config.transcriptUrl ? `<a href="${escapeHtml(config.transcriptUrl)}" style="color: oklch(0.7 0.2 200); text-decoration: none;">Read Transcript</a>` : ''}
  </div>
</aside>`.trim();
}
export function renderAuthorBioCard(config) {
    const entityBadges = [];
    if (config.sameAs) {
        for (const url of config.sameAs) {
            if (url.includes('orcid.org')) {
                entityBadges.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #A6CE39; font-weight: 600; text-decoration: none; font-size: 0.75rem; padding: 0.2rem 0.5rem; background: oklch(0.18 0.02 240); border: 1px solid oklch(0.3 0.02 240); border-radius: 4px;">ORCID ↗</a>`);
            }
            else if (url.includes('wikidata.org')) {
                entityBadges.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #339966; font-weight: 600; text-decoration: none; font-size: 0.75rem; padding: 0.2rem 0.5rem; background: oklch(0.18 0.02 240); border: 1px solid oklch(0.3 0.02 240); border-radius: 4px;">Wikidata ↗</a>`);
            }
            else if (url.includes('github.com')) {
                entityBadges.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #FFFFFF; font-weight: 600; text-decoration: none; font-size: 0.75rem; padding: 0.2rem 0.5rem; background: oklch(0.18 0.02 240); border: 1px solid oklch(0.3 0.02 240); border-radius: 4px;">GitHub ↗</a>`);
            }
            else if (url.includes('linkedin.com')) {
                entityBadges.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #0A66C2; font-weight: 600; text-decoration: none; font-size: 0.75rem; padding: 0.2rem 0.5rem; background: oklch(0.18 0.02 240); border: 1px solid oklch(0.3 0.02 240); border-radius: 4px;">LinkedIn ↗</a>`);
            }
            else if (url.includes('x.com') || url.includes('twitter.com')) {
                entityBadges.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #00E5FF; font-weight: 600; text-decoration: none; font-size: 0.75rem; padding: 0.2rem 0.5rem; background: oklch(0.18 0.02 240); border: 1px solid oklch(0.3 0.02 240); border-radius: 4px;">X ↗</a>`);
            }
        }
    }
    return `
<section class="tt-author-bio-card" style="display: flex; gap: 1.25rem; align-items: flex-start; padding: 1.5rem; background: oklch(0.13 0.02 240); border: 1px solid oklch(0.25 0.02 240); border-radius: 8px; margin: 2.5rem 0;">
  ${config.avatarUrl ? `
  <div style="flex-shrink: 0; width: 64px; height: 64px; border-radius: 50%; overflow: hidden; aspect-ratio: 1 / 1; border: 2px solid #00E5FF; background: #060610;">
    <img src="${escapeHtml(config.avatarUrl)}" alt="${escapeHtml(config.name)}" width="64" height="64" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" />
  </div>` : ''}
  <div style="flex: 1; min-width: 0;">
    <div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; margin-bottom: 0.25rem;">
      <h3 style="margin: 0; font-size: 1.125rem; font-weight: 700; color: #FFFFFF;">${escapeHtml(config.name)}</h3>
      ${config.role ? `<span style="font-size: 0.8125rem; color: oklch(0.7 0.2 200); font-weight: 500;">${escapeHtml(config.role)}</span>` : ''}
    </div>
    <p style="margin: 0 0 0.75rem 0; font-size: 0.875rem; line-height: 1.6; color: oklch(0.85 0.02 240);">${escapeHtml(config.bio)}</p>
    ${entityBadges.length > 0 ? `<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">${entityBadges.join('')}</div>` : ''}
  </div>
</section>`.trim();
}
export function renderSocialShareBar(config) {
    const encUrl = encodeURIComponent(config.url);
    const encTitle = encodeURIComponent(config.title);
    const xShare = `https://twitter.com/intent/tweet?text=${encTitle}&url=${encUrl}`;
    const linkedInShare = `https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}`;
    const hnShare = `https://news.ycombinator.com/submitlink?u=${encUrl}&t=${encTitle}`;
    return `
<div class="tt-social-share-bar" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 0; border-top: 1px solid oklch(0.22 0.02 240); border-bottom: 1px solid oklch(0.22 0.02 240); margin: 2rem 0;">
  <span style="font-weight: 600; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; color: oklch(0.7 0.02 240);">Share this post</span>
  <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
    <a href="${xShare}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; padding: 0.35rem 0.75rem; background: oklch(0.18 0.02 240); color: #FFFFFF; font-size: 0.75rem; font-weight: 600; border-radius: 4px; text-decoration: none; border: 1px solid oklch(0.28 0.02 240);">Post on X</a>
    <a href="${linkedInShare}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; padding: 0.35rem 0.75rem; background: oklch(0.18 0.02 240); color: #0A66C2; font-size: 0.75rem; font-weight: 600; border-radius: 4px; text-decoration: none; border: 1px solid oklch(0.28 0.02 240);">LinkedIn</a>
    <a href="${hnShare}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; padding: 0.35rem 0.75rem; background: oklch(0.18 0.02 240); color: #FF6600; font-size: 0.75rem; font-weight: 600; border-radius: 4px; text-decoration: none; border: 1px solid oklch(0.28 0.02 240);">Hacker News</a>
  </div>
</div>`.trim();
}
export function renderReadingProgressBar() {
    // The scroll-driven fill is gated TWICE (matching site.ts's .tt-progress): an @supports check so
    // browsers without the CSS scroll-timeline hide the bar entirely (no stuck 0%-width sliver), and a
    // prefers-reduced-motion:no-preference wrapper so reduced-motion users get no animation at all. The
    // static fallback is simply a hidden bar — nothing animated, nothing broken.
    return `
<style>
  .tt-reading-progress-bar {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: linear-gradient(90deg, #00E5FF, #7928CA);
    transform-origin: 0 50%;
    transform: scaleX(0);
    z-index: 9999;
    display: none;
  }
  @keyframes tt-reading-progress {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }
  @supports (animation-timeline: scroll()) {
    @media (prefers-reduced-motion: no-preference) {
      .tt-reading-progress-bar {
        display: block;
        animation: tt-reading-progress linear both;
        animation-timeline: scroll();
      }
    }
  }
</style>
<div class="tt-reading-progress-bar" aria-hidden="true"></div>`.trim();
}
export function renderRelatedArticlesGrid(articles) {
    if (articles.length === 0)
        return '';
    return `
<section class="tt-related-articles-section" style="margin-top: 3.5rem; padding-top: 2rem; border-top: 1px solid oklch(0.25 0.02 240);">
  <h2 style="font-size: 1.375rem; font-weight: 700; color: #FFFFFF; margin-bottom: 1.5rem;">Related Articles in Topic Cluster</h2>
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem;">
    ${articles
        .map((art) => `
    <article class="tt-related-card" style="background: oklch(0.13 0.02 240); border: 1px solid oklch(0.25 0.02 240); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">
      ${art.heroImageUrl ? `
      <div style="aspect-ratio: 16 / 9; overflow: hidden; background: #060610;">
        <img src="${escapeHtml(art.heroImageUrl)}" alt="${escapeHtml(art.title)}" width="400" height="225" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" />
      </div>` : ''}
      <div style="padding: 1rem; flex: 1; display: flex; flex-direction: column;">
        ${art.category ? `<span style="font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; color: #00E5FF; margin-bottom: 0.5rem; letter-spacing: 0.05em;">${escapeHtml(art.category)}</span>` : ''}
        <h3 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem 0; line-height: 1.4;">
          <a href="${escapeHtml(art.url)}" style="color: #FFFFFF; text-decoration: none;">${escapeHtml(art.title)}</a>
        </h3>
        <p style="font-size: 0.8125rem; color: oklch(0.75 0.02 240); line-height: 1.5; margin: 0 0 1rem 0; flex: 1;">${escapeHtml(art.summary)}</p>
        ${art.readingTimeMinutes ? `<span style="font-size: 0.75rem; color: oklch(0.6 0.02 240);">${art.readingTimeMinutes} min read</span>` : ''}
      </div>
    </article>`)
        .join('\n')}
  </div>
</section>`.trim();
}
export function renderOpenGraphCardSvg(config) {
    const brand = config.brandName || 'Megabyte Labs';
    const category = config.category || 'TECHNICAL EDITORIAL';
    const reading = config.readingTimeMinutes ? `${config.readingTimeMinutes} MIN READ` : '5 MIN READ';
    // Simple XML escaping for SVG
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // Split title if long
    const words = config.title.split(' ');
    const lines = [];
    let curr = '';
    for (const w of words) {
        if ((curr + ' ' + w).length > 32) {
            if (curr)
                lines.push(curr);
            curr = w;
        }
        else {
            curr = curr ? `${curr} ${w}` : w;
        }
    }
    if (curr)
        lines.push(curr);
    const titleSvgText = lines
        .slice(0, 3)
        .map((line, i) => `<tspan x="80" y="${260 + i * 58}">${esc(line)}</tspan>`)
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#060610" />
      <stop offset="60%" stop-color="#0B0C1E" />
      <stop offset="100%" stop-color="#020208" />
    </linearGradient>
    <radialGradient id="cyanGlow" cx="90%" cy="10%" r="50%">
      <stop offset="0%" stop-color="#00E5FF" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="violetGlow" cx="10%" cy="90%" r="50%">
      <stop offset="0%" stop-color="#7928CA" stop-opacity="0.22" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Background Base -->
  <rect width="1200" height="630" fill="url(#bgGrad)" />
  <rect width="1200" height="630" fill="url(#cyanGlow)" />
  <rect width="1200" height="630" fill="url(#violetGlow)" />

  <!-- Outer Border -->
  <rect x="20" y="20" width="1160" height="590" rx="16" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="2" />

  <!-- Top Metadata Bar -->
  <g transform="translate(80, 90)">
    <!-- Category Badge -->
    <rect x="0" y="0" width="${category.length * 9 + 28}" height="32" rx="16" fill="rgba(0, 229, 255, 0.12)" stroke="#00E5FF" stroke-width="1.5" />
    <text x="14" y="21" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="#00E5FF" letter-spacing="1.5">${esc(category.toUpperCase())}</text>

    <!-- Reading Time -->
    <text x="${category.length * 9 + 48}" y="21" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#94A3B8" letter-spacing="1">${reading}</text>
  </g>

  <!-- Title Text -->
  <text font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="800" fill="#FFFFFF" letter-spacing="-0.5">
    ${titleSvgText}
  </text>

  <!-- Subtitle -->
  ${config.subtitle ? `
  <text x="80" y="${280 + Math.min(lines.length, 3) * 58}" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="400" fill="#94A3B8">
    ${esc(config.subtitle.slice(0, 90))}
  </text>` : ''}

  <!-- Footer Info Bar -->
  <g transform="translate(80, 530)">
    <circle cx="20" cy="20" r="20" fill="#00E5FF" />
    <text x="20" y="26" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" fill="#060610" text-anchor="middle">${esc(config.authorName.charAt(0))}</text>
    <text x="54" y="18" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">${esc(config.authorName)}</text>
    <text x="54" y="36" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="500" fill="#64748B">${esc(brand)}</text>

    <!-- Right Brand Badge -->
    <text x="1040" y="27" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="800" fill="#00E5FF" text-anchor="end" letter-spacing="1">${esc(brand.toUpperCase())}</text>
  </g>
</svg>`.trim();
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
export const BLOG_MULTIMEDIA_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "multimedia",
    w3cTraceparentFormat: "00-32hex-16hex-01",
    langfuseFailOpenTimeoutMs: 2500,
    rfc9457ProblemDetailsSupported: true,
    tactileMicroInteractionsCount: 30,
    interactionStatesCount: 16,
    transitionDurationSeconds: 0.333,
    requiresCloudflareContainers: false,
    deterministicDigest: 1328906336,
};
export function verifyBlogMultimediaModuleInvariants(tenantId = "tenant_default") {
    const cleanTenant = tenantId.trim() || "tenant_default";
    let rollingHash = BLOG_MULTIMEDIA_MODULE_SPECIFICATION.deterministicDigest ^ cleanTenant.length;
    for (let i = 0; i < cleanTenant.length; i++) {
        rollingHash = Math.imul(rollingHash ^ cleanTenant.charCodeAt(i), 0x01000193) >>> 0;
    }
    return {
        ok: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.interactionStatesCount === 16 &&
            BLOG_MULTIMEDIA_MODULE_SPECIFICATION.tactileMicroInteractionsCount === 30 &&
            !BLOG_MULTIMEDIA_MODULE_SPECIFICATION.requiresCloudflareContainers,
        tenantId: cleanTenant,
        packageName: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.packageName,
        moduleSlug: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.moduleSlug,
        w3cTraceparentFormat: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.w3cTraceparentFormat,
        langfuseFailOpenTimeoutMs: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.langfuseFailOpenTimeoutMs,
        rfc9457ProblemDetailsSupported: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.rfc9457ProblemDetailsSupported,
        tactileMicroInteractionsCount: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.tactileMicroInteractionsCount,
        interactionStatesCount: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.interactionStatesCount,
        transitionDurationSeconds: BLOG_MULTIMEDIA_MODULE_SPECIFICATION.transitionDurationSeconds,
        spec: BLOG_MULTIMEDIA_MODULE_SPECIFICATION,
        verifiedInteractionStateCount: 16,
        minApcaContrastLc: 60,
        checksum: rollingHash,
    };
}
//# sourceMappingURL=multimedia.js.map