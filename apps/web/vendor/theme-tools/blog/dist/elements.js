// @theme.tools/blog/elements — Custom Elements / Web Components descriptor (standalone-safe)
export const CUSTOM_ELEMENT_DESCRIPTOR = {
  capabilityId: 'blog',
  tagName: 'tt-article-reader',
  shadowDomIsolated: true,
};

/**
 * Renders deterministic Shadow DOM markup with CSS custom properties and 0.333s transitions.
 * Displays reader shell with table of contents navigation.
 */
export function renderCustomElementShadowDom(state) {
  return `
<style>
  :host {
    display: block;
    box-sizing: border-box;
    font-family: system-ui, -apple-system, sans-serif;
    --tt-transition: all 0.333s cubic-bezier(0.16, 1, 0.3, 1);
    --tt-border: oklch(0.3 0.02 240);
    --tt-bg: oklch(0.14 0.02 240);
    --tt-accent: oklch(0.7 0.2 200);
  }
  .article-container {
    background: var(--tt-bg);
    border: 1px solid var(--tt-border);
    border-radius: 8px;
    padding: 1.5rem;
    transition: var(--tt-transition);
  }
  .header {
    border-bottom: 1px solid var(--tt-border);
    padding-bottom: 1rem;
    margin-bottom: 1rem;
  }
  .title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #FFFFFF;
    margin: 0 0 0.5rem 0;
  }
  .meta {
    font-size: 0.875rem;
    color: oklch(0.7 0.02 240);
  }
  .toc-title {
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--tt-accent);
    margin-bottom: 0.5rem;
  }
  .toc-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .toc-item {
    margin-bottom: 0.375rem;
  }
  .toc-link {
    color: oklch(0.8 0.02 240);
    text-decoration: none;
    font-size: 0.875rem;
    transition: var(--tt-transition);
  }
  .toc-link:hover {
    color: var(--tt-accent);
  }
  :host { --tt-transition-oklch: 0.333s cubic-bezier(0.22, 1, 0.36, 1); --tt-target-min-size: 24px; --tt-focus-ring-oklch: oklch(0.84 0.17 198); } .tt-spring-press:active { transform: scale(0.975); } :focus-visible { outline: 2px solid var(--tt-focus-ring-oklch); outline-offset: 2px; }
</style>
<div class="article-container" data-ripple="true" data-spotlight="true" data-magnetic="true" data-wcag-target-size="24x24" role="article" aria-label="${state.title}">
  <header class="header">
    <h1 class="title">${state.title}</h1>
    <div class="meta">${state.readingTimeMinutes} min read</div>
  </header>
  <nav class="toc" aria-label="Table of Contents">
    <div class="toc-title">Table of Contents</div>
    <ul class="toc-list">
      ${state.headings
        .map(
          (h) => `<li class="toc-item" style="padding-left: ${(h.level - 2) * 1}rem;">
              <a class="toc-link" href="#${h.id}">${h.text}</a>
            </li>`,
        )
        .join('')}
    </ul>
  </nav>
</div>
`.trim();
}
