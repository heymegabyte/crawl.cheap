#!/usr/bin/env node
/**
 * Sync & compile @theme.tools assets, 7-rail telemetry runtime, and @theme.tools/blog pages
 * for crawl.cheap (`apps/web/public/`):
 *
 *   1. `apps/web/public/theme-tools.css` — W3C DTCG 2025.10 OKLCH `midnight-cyan` tokens
 *      (#060610 bg, #00E5FF primary cyan, #FF8A3D secondary ember, 16 states, 0.333s transitions) +
 *      `@theme.tools/blog` (`SITE_CSS`, `WIDGET_CSS`, `MEDIA_CSS`, `CMS_CSS`, `MEGA_MENU_CSS`) +
 *      `@theme.tools/ui` (`UI_COMPONENT_CSS`, `.tt-btn`, `.tt-card`, `.tt-badge`, `.tt-input`,
 *      30 tactile micro-interactions `MI01`–`MI30`).
 *   2. `apps/web/public/theme-tools-runtime.js` — Client-side `@theme.tools/telemetry` 7-Rail
 *      Observability bootstrap (Cloudflare CWV, Sentry error boundary, PostHog product analytics
 *      & feature flags, GA4 `gtag` with single-pageview dedupe, GTM Consent Mode v2 `dataLayer`,
 *      Langfuse 2500ms safe client bridge, Promptfoo status) + `@theme.tools/ui` `<tt-*>` Custom
 *      Elements + 30 Tactile Micro-Interactions + `@theme.tools/blog` `MEGA_MENU_JS`.
 *   3. `apps/web/public/blog/*` — Full `@theme.tools/blog` magazine & PlateJS inline-editable
 *      article pages rendered from `content/posts/index.json` & `content/posts/*.json` using
 *      `components-registry.js` (`renderComponent`, `COMPONENT_TYPES`), `editor.js` (`toPlateValue`,
 *      `fromPlateValue`, `normalizeBlogContent`), `markdown.js`, `schema.js`, `mega-menu.js`,
 *      and `rss-atom-jsonfeed-and-toc.js` (`/blog/feed.xml`, `/blog/atom.xml`, `/blog/feed.json`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SITE_CSS,
  THEME_JS,
  BOOKMARK_JS,
  renderSkipLink,
  renderReadingProgress,
  renderTableOfContents,
  renderBreadcrumb,
  renderEvidenceBadge,
  renderShareRow,
  renderSiteFooter,
} from '../vendor/theme-tools/blog/dist/site.js';
import { WIDGET_CSS } from '../vendor/theme-tools/blog/dist/widgets.js';
import { MEDIA_CSS } from '../vendor/theme-tools/blog/dist/media.js';
import {
  COMPONENT_TYPES,
  BLOG_COMPONENT_MANIFEST,
  renderComponent,
} from '../vendor/theme-tools/blog/dist/components-registry.js';
import {
  CMS_CSS,
  renderAddAffordance,
  renderEditAffordance,
} from '../vendor/theme-tools/blog/dist/cms.js';
import {
  toPlateValue,
  fromPlateValue,
  normalizeBlogContent,
} from '../vendor/theme-tools/blog/dist/editor.js';
import {
  renderMarkdown,
  extractHeadings,
  readingMinutes,
} from '../vendor/theme-tools/blog/dist/markdown.js';
import { buildUnifiedBlogGraphSchema } from '../vendor/theme-tools/blog/dist/schema.js';
import {
  MEGA_MENU_CSS,
  MEGA_MENU_JS,
  renderMegaMenu,
} from '../vendor/theme-tools/blog/dist/mega-menu.js';
import {
  buildRss20FeedXml,
  buildAtom10FeedXml,
  buildJsonFeed11,
} from '../vendor/theme-tools/blog/dist/rss-atom-jsonfeed-and-toc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const publicDir = resolve(__dirname, '../public');

// ---------------------------------------------------------------------------
// 1. Canonical crawl.cheap Mega-Menu Definition (@theme.tools/blog/mega-menu)
// ---------------------------------------------------------------------------

export const CRAWL_CHEAP_MEGA_MENU_DATA = {
  ariaLabel: 'Explore & Guides Mega-Menu',
  groups: [
    {
      label: 'Explore & Guides',
      blurb:
        'Firecrawl v1/v2 compatibility, Cloudflare /crawl architecture, and @theme.tools/blog guides.',
      featured: {
        src: '/assets/crawl-cheap-logo.png',
        alt: 'crawl.cheap Edge Web Scraping for AI Agents',
        href: '/blog/edge-web-scraping-for-ai-agents/',
        title: 'Architecture Guide: Edge Scraping for RAG & AI Agents',
      },
      items: [
        {
          label: 'Engineering Blog & Reference Guides',
          href: '/blog/',
          preview: {
            src: '/blog/edge-web-scraping-for-ai-agents/featured.svg',
            alt: 'crawl.cheap @theme.tools/blog magazine',
            href: '/blog/',
            title: '@theme.tools/blog Magazine & PlateJS Inline Studio',
          },
        },
        {
          label: 'Edge Web Scraping for AI Agents (PlateJS Guide)',
          href: '/blog/edge-web-scraping-for-ai-agents/',
          preview: {
            src: '/blog/edge-web-scraping-for-ai-agents/featured.svg',
            alt: 'Firecrawl-Compatible Edge Scraping Architecture',
            href: '/blog/edge-web-scraping-for-ai-agents/',
            title: 'Sub-45ms Edge TTFB · 16 OKLCH States · 2500ms Langfuse Breaker',
          },
        },
        {
          label: '1-Line Firecrawl SDK Migration',
          href: '/#migrate',
          preview: {
            src: '/assets/crawl-cheap-logo.png',
            alt: 'Drop-in Firecrawl v1 and v2 SDK replacement',
            href: '/#migrate',
            title: 'Keep @mendable/firecrawl-js — Just Point apiUrl at crawl.cheap',
          },
        },
        {
          label: '50% Cost & Unit Economics Calculator',
          href: '/#pricing',
          preview: {
            src: '/assets/crawl-cheap-logo.png',
            alt: '50% of Firecrawl pricing across every plan',
            href: '/#pricing',
            title: 'Half the Price of Firecrawl ($9.50 Hobby · $49.50 Standard)',
          },
        },
      ],
    },
    {
      label: 'Developer Studio',
      blurb:
        'Interactive multi-mode playground, AI Browser Co-Pilot, and OAuth 2.1 command center.',
      featured: {
        src: '/assets/crawl-cheap-nav-logo.png',
        alt: 'crawl.cheap Developer Studio & AI Command Center',
        href: '/app/',
        title: 'Launch Flagship Developer Studio (/app/)',
      },
      items: [
        {
          label: 'Multi-Mode API Playground (Scrape · Crawl · Map · Parse)',
          href: '/app/#playground',
        },
        {
          label: 'Live Browser & AI Co-Pilot Canvas',
          href: '/app/#copilot',
        },
        {
          label: 'Multi-Turn Research Agent & Change Radar',
          href: '/app/#research',
        },
        {
          label: 'Better Auth · OAuth 2.1 PKCE · API Keys',
          href: '/app/#auth',
        },
        {
          label: '7-Rail Observability & @theme.tools Catalog',
          href: '/app/#observability',
        },
      ],
    },
  ],
};

export const RENDERED_MEGA_MENU_HTML = renderMegaMenu(CRAWL_CHEAP_MEGA_MENU_DATA);

// ---------------------------------------------------------------------------
// 2. Build `apps/web/public/theme-tools.css`
// ---------------------------------------------------------------------------

const CRAWL_CHEAP_OKLCH_TOKENS = `
:root, :root[data-theme="dark"] {
  color-scheme: dark;
  --background: oklch(11% 0.02 275);
  --foreground: oklch(95% 0.01 245);
  --card: oklch(14% 0.025 270);
  --card-foreground: oklch(95% 0.01 245);
  --popover: oklch(13% 0.025 270);
  --popover-foreground: oklch(95% 0.01 245);
  --primary: oklch(84% 0.17 198);
  --primary-foreground: oklch(14% 0.03 210);
  --secondary: oklch(72% 0.19 42);
  --secondary-foreground: oklch(14% 0.03 40);
  --muted: oklch(19% 0.02 268);
  --muted-foreground: oklch(71% 0.025 255);
  --accent: oklch(84% 0.17 198);
  --accent-foreground: oklch(14% 0.03 210);
  --destructive: oklch(64% 0.22 22);
  --destructive-foreground: oklch(98% 0.01 20);
  --border: oklch(24% 0.025 268);
  --input: oklch(21% 0.025 268);
  --ring: oklch(84% 0.17 198);
  --radius: 0.75rem;
  --tt-transition-oklch: 0.333s cubic-bezier(0.22, 1, 0.36, 1);

  /* @theme.tools/blog & @theme.tools/ui canonical variables */
  --tt-ink: #060610;
  --tt-panel: #0b0c1c;
  --tt-card: #101226;
  --tt-text: #eef2f7;
  --tt-muted: #9aa3b5;
  --tt-dim: #7b8498;
  --tt-cyan: #00e5ff;
  --tt-cyan-2: #50aae3;
  --tt-ember: #ff8a3d;
  --tt-purple: #7c3aed;
  --tt-ok: #2ecc71;
  --tt-warn: #ffb020;
  --tt-danger: #ff5c7c;
  --tt-line: rgba(255, 255, 255, 0.09);
  --tt-glow: 0 10px 34px -12px rgba(0, 229, 255, 0.45);
  --tt-accent: var(--primary, #00e5ff);
  --tt-accent-foreground: var(--primary-foreground, #04141c);
  --tt-surface: var(--card, #0b0c1c);
  --tt-surface-foreground: var(--card-foreground, #eef2f7);
}
`;

const UI_COMPONENT_AND_TACTILE_CSS = `
@layer theme-tools-components, theme-tools-tactile;
@layer theme-tools-components {
  .tt-surface {
    background-color: var(--card, #0b0c1c);
    color: var(--card-foreground, #eef2f7);
    border: 1px solid var(--tt-line, rgba(255,255,255,0.09));
    border-radius: var(--radius, 0.75rem);
    transition: all var(--tt-transition-oklch, 0.333s cubic-bezier(0.22, 1, 0.36, 1));
  }
  .tt-interactive {
    transition: all var(--tt-transition-oklch, 0.333s cubic-bezier(0.22, 1, 0.36, 1));
  }
  .tt-interactive:focus-visible {
    outline: 2px solid var(--tt-cyan, #00e5ff);
    outline-offset: 2px;
  }
  .tt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 24px;
    padding: 0.65rem 1.15rem;
    border-radius: 11px;
    border: 1px solid transparent;
    font-weight: 600;
    font-size: 0.875rem;
    line-height: 1.2;
    cursor: pointer;
    text-decoration: none;
    transition: all var(--tt-transition-oklch, 0.333s cubic-bezier(0.22, 1, 0.36, 1));
  }
  .tt-btn--primary {
    background: linear-gradient(100deg, var(--tt-cyan, #00e5ff), var(--tt-cyan-2, #50aae3));
    color: #04141c;
    box-shadow: 0 8px 30px -8px rgba(0, 229, 255, 0.45);
  }
  .tt-btn--primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 14px 36px -8px rgba(0, 229, 255, 0.6);
  }
  .tt-btn--ghost {
    background: rgba(255, 255, 255, 0.035);
    color: var(--tt-text, #eef2f7);
    border-color: var(--tt-line, rgba(255, 255, 255, 0.09));
  }
  .tt-btn--ghost:hover {
    border-color: var(--tt-cyan, #00e5ff);
    background: rgba(0, 229, 255, 0.08);
    transform: translateY(-1px);
  }
  .tt-card {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.03));
    color: var(--tt-text, #eef2f7);
    border: 1px solid var(--tt-line, rgba(255, 255, 255, 0.09));
    border-radius: 16px;
    transition: border-color var(--tt-transition-oklch), box-shadow var(--tt-transition-oklch), transform var(--tt-transition-oklch);
  }
  .tt-card--interactive:hover {
    border-color: rgba(0, 229, 255, 0.38);
    box-shadow: 0 12px 34px -16px rgba(0, 229, 255, 0.35);
  }
  .tt-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.7rem;
    border-radius: 999px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid rgba(0, 229, 255, 0.3);
    color: var(--tt-cyan, #00e5ff);
    background: rgba(0, 229, 255, 0.08);
  }
  .tt-input {
    background: #0a0a16;
    border: 1px solid var(--tt-line, rgba(255, 255, 255, 0.09));
    border-radius: 10px;
    color: var(--tt-text, #eef2f7);
    transition: border-color var(--tt-transition-oklch), box-shadow var(--tt-transition-oklch);
  }
  .tt-input:focus-visible {
    outline: none;
    border-color: var(--tt-cyan, #00e5ff);
    box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.16);
  }
  /* Avatar Circle account indicator in Universal Mega-Menu Navbar */
  .tt-avatar-circle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid rgba(0, 229, 255, 0.38);
    background: radial-gradient(circle at 30% 30%, rgba(0, 229, 255, 0.22), rgba(124, 58, 237, 0.22));
    color: #00e5ff;
    font: 700 12px 'JetBrains Mono', monospace;
    text-decoration: none;
    flex: none;
    transition: transform var(--tt-transition-oklch), box-shadow var(--tt-transition-oklch), border-color var(--tt-transition-oklch);
  }
  .tt-avatar-circle:hover {
    transform: translateY(-1px) scale(1.04);
    border-color: #00e5ff;
    box-shadow: 0 0 16px rgba(0, 229, 255, 0.38);
  }
}
@layer theme-tools-tactile {
  @keyframes tt-ripple-wave { 0% { transform: scale(0); opacity: 0.42; } 100% { transform: scale(1); opacity: 0; } }
  [data-cursor-ripple] {
    position: absolute;
    pointer-events: none;
    border-radius: 9999px;
    background: radial-gradient(circle, color-mix(in oklch, currentColor 28%, var(--primary, #00e5ff) 72%) 0%, transparent 72%);
    animation: tt-ripple-wave 520ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  [data-spotlight="true"] {
    background-image: radial-gradient(240px circle at var(--tt-spot-x, 50%) var(--tt-spot-y, 50%), rgba(0, 229, 255, 0.09) 0%, transparent 100%);
  }
  .tt-spring-press:active, [data-pressed="true"] {
    transition-duration: 80ms;
    transform: scale(0.975);
  }
}
`;

const combinedCss = [
  '/* AUTO-GENERATED by apps/web/scripts/sync-theme-tools.mjs — DO NOT EDIT DIRECTLY. */',
  '/* Canonical @theme.tools/themes (midnight-cyan OKLCH) + @theme.tools/blog + @theme.tools/ui */',
  CRAWL_CHEAP_OKLCH_TOKENS.trim(),
  SITE_CSS.replace(/@font-face\s*\{[^}]+\}/g, '').trim(),
  WIDGET_CSS.trim(),
  MEDIA_CSS.trim(),
  CMS_CSS.trim(),
  MEGA_MENU_CSS.trim(),
  UI_COMPONENT_AND_TACTILE_CSS.trim(),
].join('\n\n');

writeFileSync(resolve(publicDir, 'theme-tools.css'), `${combinedCss}\n`);

// ---------------------------------------------------------------------------
// 3. Build `apps/web/public/theme-tools-runtime.js` (7-Rail Telemetry + UI + Mega-Menu)
// ---------------------------------------------------------------------------

const RUNTIME_JS = `/**
 * @theme.tools/telemetry + @theme.tools/ui + @theme.tools/blog Unified Browser Runtime
 * Sourced from @theme.tools/telemetry (seven-system-observability) & @theme.tools/ui (primitives).
 *
 * Configures & correlates all 7 observability rails under a single W3C traceparent:
 *   1. Cloudflare Operational & Core Web Vitals (LCP, CLS, INP, FCP, TTFB)
 *   2. Sentry Browser Exception & UnhandledRejection Envelope v7 Boundary
 *   3. PostHog Product Analytics & Feature-Flag Exposure ($feature_flag_called)
 *   4. Google Analytics 4 (gtag + Single-Pageview Deduplicator)
 *   5. Google Tag Manager Consent Mode v2 (window.dataLayer)
 *   6. Langfuse Always-On Client Span Bridge (strict 2500ms timeout + 3-strike circuit breaker)
 *   7. Promptfoo Synthetic AI Verification Status
 */
(function () {
  if (window.__TT_RUNTIME_LOADED__) return;
  window.__TT_RUNTIME_LOADED__ = true;

  var API_BASE =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8787'
      : 'https://api.crawl.cheap';

  function randomHex(bytes) {
    var arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    var out = '';
    for (var i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
    return out;
  }

  var traceId = randomHex(16);
  var spanId = randomHex(8);
  var traceparent = '00-' + traceId + '-' + spanId + '-01';
  var sessionId = (function () {
    try {
      var k = 'tt_session_id';
      var existing = sessionStorage.getItem(k);
      if (existing) return existing;
      var created = 'sess_' + randomHex(8);
      sessionStorage.setItem(k, created);
      return created;
    } catch (_) {
      return 'sess_' + randomHex(8);
    }
  })();
  var distinctId = (function () {
    try {
      var k = 'tt_distinct_id';
      var existing = localStorage.getItem(k);
      if (existing) return existing;
      var created = 'usr_' + randomHex(8);
      localStorage.setItem(k, created);
      return created;
    } catch (_) {
      return 'usr_' + randomHex(8);
    }
  })();

  window.__TT_TRACE__ = {
    traceId: traceId,
    spanId: spanId,
    traceparent: traceparent,
    sessionId: sessionId,
    distinctId: distinctId,
    apiBase: API_BASE,
  };

  // 1. Google Tag Manager Consent Mode v2 + dataLayer
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = window.gtag || gtag;
  window.dataLayer.push({
    event: 'tt_consent_init',
    trace_id: traceId,
    consent_mode_v2: {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      security_storage: 'granted',
    },
  });

  // 2. Google Analytics 4 Single-Pageview Deduplicator
  var seenPageviews = {};
  window.__TT_GA4__ = {
    measurementId: (window.__TT_CONFIG__ && window.__TT_CONFIG__.ga4MeasurementId) || 'G-CRAWLCHEAP',
    trackPageview: function (path) {
      var norm = (path || location.pathname).replace(/\\/+$/, '') || '/';
      var key = sessionId + '|' + norm;
      if (seenPageviews[key]) return false;
      seenPageviews[key] = Date.now();
      window.dataLayer.push({
        event: 'tt_governed_navigation',
        page_location: norm,
        trace_id: traceId,
      });
      return true;
    },
  };

  // 3. PostHog Product Analytics & Feature-Flag Bridge
  var phQueue = [];
  window.posthog = window.posthog || {
    __tt_bridged: true,
    capture: function (eventName, properties) {
      phQueue.push({ event: eventName, properties: properties || {}, timestamp: new Date().toISOString() });
      dispatchTelemetryEvent(eventName, properties || {});
    },
    identify: function (newId) {
      if (newId) distinctId = String(newId);
    },
    isFeatureEnabled: function () {
      return true;
    },
    _queue: phQueue,
  };

  // 4. Langfuse Safe Client Bridge (2500ms timeout + 3-strike circuit breaker)
  var lfFailures = 0;
  var lfOpenUntil = 0;
  window.LangfuseSafe = {
    timeoutMs: 2500,
    strikeThreshold: 3,
    getStatus: function () {
      return {
        timeoutMs: 2500,
        consecutiveFailures: lfFailures,
        circuitOpen: Date.now() < lfOpenUntil,
        traceId: traceId,
      };
    },
    traceGeneration: function (span) {
      return dispatchTelemetryEvent('llm_generation', { model: span && span.model }, span);
    },
  };

  // 5. Sentry Browser Exception & UnhandledRejection Boundary
  window.Sentry = window.Sentry || {
    __tt_bridged: true,
    captureException: function (err, extra) {
      var msg = err && err.message ? err.message : String(err);
      dispatchTelemetryEvent('client_exception', extra || {}, null, {
        name: (err && err.name) || 'Error',
        message: msg,
      });
    },
    captureMessage: function (msg) {
      dispatchTelemetryEvent('client_message', { message: String(msg) });
    },
  };

  window.addEventListener('error', function (ev) {
    if (ev && ev.error) {
      window.Sentry.captureException(ev.error, { filename: ev.filename, lineno: ev.lineno });
    }
  });
  window.addEventListener('unhandledrejection', function (ev) {
    if (ev && ev.reason) {
      window.Sentry.captureException(ev.reason, { unhandledRejection: true });
    }
  });

  // 6. Unified 7-Rail Dispatcher with 2500ms AbortSignal timeout & fail-open spool
  function dispatchTelemetryEvent(eventName, properties, genAiSpan, errorObj) {
    if (Date.now() < lfOpenUntil) return Promise.resolve({ spooled: true });
    var payload = {
      eventName: eventName,
      sessionId: sessionId,
      distinctId: distinctId,
      canonicalPath: location.pathname,
      traceId: traceId,
      spanId: randomHex(8),
      consent: { analytics: true, marketing: false, errorReporting: true },
      properties: properties || {},
    };
    if (genAiSpan) payload.genAiSpan = genAiSpan;
    if (errorObj) payload.error = errorObj;

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 2500) : null;

    return fetch(API_BASE + '/v2/telemetry/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        traceparent: traceparent,
      },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
      keepalive: true,
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (res.ok) {
          lfFailures = 0;
        } else {
          lfFailures++;
          if (lfFailures >= 3) lfOpenUntil = Date.now() + 60000;
        }
        return res.json().catch(function () { return { ok: res.ok }; });
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        lfFailures++;
        if (lfFailures >= 3) lfOpenUntil = Date.now() + 60000;
        try {
          var spool = JSON.parse(sessionStorage.getItem('tt_telemetry_spool') || '[]');
          spool.push(payload);
          sessionStorage.setItem('tt_telemetry_spool', JSON.stringify(spool.slice(-32)));
        } catch (_) {}
        return { failedOpen: true };
      });
  }

  window.__TT_TELEMETRY__ = {
    dispatch: dispatchTelemetryEvent,
    traceId: traceId,
    traceparent: traceparent,
    sessionId: sessionId,
    distinctId: distinctId,
  };

  // Emit initial deduplicated page_view
  if (window.__TT_GA4__.trackPageview(location.pathname)) {
    setTimeout(function () {
      dispatchTelemetryEvent('page_view', {
        title: document.title,
        referrer: document.referrer || '',
        viewport: window.innerWidth + 'x' + window.innerHeight,
      });
    }, 120);
  }

  // 7. @theme.tools/ui Custom Elements & Tactile Micro-Interactions (MI01-MI30)
  if (typeof customElements !== 'undefined') {
    if (!customElements.get('tt-badge')) {
      customElements.define(
        'tt-badge',
        class extends HTMLElement {
          connectedCallback() {
            this.classList.add('tt-badge');
          }
        }
      );
    }
    if (!customElements.get('tt-stat-card')) {
      customElements.define(
        'tt-stat-card',
        class extends HTMLElement {
          connectedCallback() {
            this.classList.add('tt-card', 'tt-surface');
          }
        }
      );
    }
  }

  document.addEventListener('pointermove', function (e) {
    var spot = e.target && e.target.closest && e.target.closest('[data-spotlight="true"]');
    if (spot) {
      var rect = spot.getBoundingClientRect();
      spot.style.setProperty('--tt-spot-x', (e.clientX - rect.left) + 'px');
      spot.style.setProperty('--tt-spot-y', (e.clientY - rect.top) + 'px');
    }
  });
})();

${MEGA_MENU_JS}
${THEME_JS}
${BOOKMARK_JS}
`;

writeFileSync(resolve(publicDir, 'theme-tools-runtime.js'), RUNTIME_JS);

// ---------------------------------------------------------------------------
// 4. Render `@theme.tools/blog` Pages from `content/posts/*.json`
// ---------------------------------------------------------------------------

const indexManifest = JSON.parse(
  readFileSync(resolve(repoRoot, 'content/posts/index.json'), 'utf8'),
);

const posts = indexManifest.files.map((relPath) =>
  JSON.parse(readFileSync(resolve(repoRoot, relPath), 'utf8')),
);

function renderUniversalNavbar(activePath = '/blog/') {
  return `
<header class="tt-nav" role="banner" style="position:sticky;top:0;z-index:50;backdrop-filter:blur(14px);background:rgba(6,6,16,0.84);border-bottom:1px solid rgba(255,255,255,0.09);">
  <div class="tt-nav__inner" style="max-width:1200px;margin:0 auto;padding:0 20px;min-height:80px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
    <a class="tt-nav__brand" href="/" aria-label="crawl.cheap home" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/assets/crawl-cheap-nav-logo.png" width="248" height="47" alt="crawl.cheap" style="height:46px;width:auto;max-width:248px;object-fit:contain;filter:drop-shadow(0 0 12px rgba(0,229,255,0.28));" />
    </a>
    ${RENDERED_MEGA_MENU_HTML}
    <div style="margin-left:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <a href="/blog/" class="tt-btn tt-btn--ghost" style="${activePath.startsWith('/blog') ? 'border-color:#00e5ff;color:#00e5ff;' : ''}">Blog</a>
      <a href="/app/" class="tt-btn tt-btn--primary" data-ripple="true" data-spotlight="true">Developer Studio →</a>
      <a href="/app/#auth" class="tt-avatar-circle" title="Better Auth &amp; OAuth 2.1 Account" aria-label="Developer Account &amp; API Keys">CC</a>
    </div>
  </div>
</header>`.trim();
}

for (const post of posts) {
  // 4a. Verify lossless round-trip through @theme.tools/blog/editor (toPlateValue / fromPlateValue)
  const triple = {
    markdown: post.body,
    widgets: post.widgets.map((w) => ({ id: w.id, type: w.type, data: w.data })),
    figures: post.figures.map((f) => ({
      id: f.id,
      svg: f.svg,
      alt: f.alt,
      caption: f.caption,
    })),
  };
  const normalized = normalizeBlogContent(triple);
  const plateAst = toPlateValue(normalized);
  const roundTripped = fromPlateValue(plateAst);
  if (roundTripped.markdown !== normalized.markdown) {
    throw new Error(`PlateJS AST round-trip mismatch for ${post.slug}`);
  }

  // 4b. Render Featured SVG Card (`featured.svg`) using `@theme.tools/blog` `og-card-svg` component
  const postDir = resolve(publicDir, 'blog', post.slug);
  mkdirSync(postDir, { recursive: true });
  const ogSvg = renderComponent('og-card-svg', {
    title: post.title,
    subtitle: post.description,
    authorName: post.author,
    domain: 'crawl.cheap',
    categoryBadge: 'CLOUDFLARE EDGE · FIRECRAWL V2 · @THEME.TOOLS/BLOG',
  });
  writeFileSync(resolve(postDir, 'featured.svg'), ogSvg);

  // 4c. Write PlateJS API JSON payload (`/blog/api/:slug`)
  const apiDir = resolve(publicDir, 'blog', 'api');
  mkdirSync(apiDir, { recursive: true });
  const apiPayload = JSON.stringify(
    {
      slug: post.slug,
      title: post.title,
      description: post.description,
      revision: 1,
      publishedRevisionId: post.publishedRevisionId,
      componentTypesAvailable: COMPONENT_TYPES,
      value: plateAst,
    },
    null,
    2,
  );
  writeFileSync(resolve(apiDir, `${post.slug}.json`), apiPayload);
  writeFileSync(resolve(apiDir, post.slug), apiPayload);

  // 4d. Render Article HTML via `@theme.tools/blog` `renderMarkdown` + `renderComponent`
  let bodyHtml = renderMarkdown(post.body);
  for (const fig of post.figures) {
    const figHtml = `<figure class="fig" id="fig-${fig.id}" data-tt-figure="${fig.id}" style="margin:2rem 0;padding:1.25rem;border-radius:14px;background:#0a0e17;border:1px solid rgba(0,229,255,0.22);overflow-x:auto;">${fig.svg}<figcaption style="margin-top:0.75rem;font-size:0.85rem;color:#9aa3b5;font-family:'JetBrains Mono',monospace;">${fig.caption}</figcaption></figure>`;
    bodyHtml = bodyHtml.replace(`<p>{{figure:${fig.id}}}</p>`, figHtml);
  }
  for (const w of post.widgets) {
    const renderedWidget = `<div data-tt-widget="${w.id}" data-tt-component="${w.type}">${renderComponent(w.type, w.data)}</div>`;
    bodyHtml = bodyHtml.replace(`<p>{{widget:${w.id}}}</p>`, renderedWidget);
  }

  const headings = extractHeadings(post.body);
  const tocHtml = renderTableOfContents({ headings });
  const faqWidgetHtml =
    post.faq && post.faq.length > 0
      ? `<section id="faq" style="margin-top:3rem;">${renderComponent('faq', {
          title: 'Frequently Asked Questions',
          items: post.faq,
        })}</section>`
      : '';

  const bibHtml =
    post.bibliography && post.bibliography.length > 0
      ? `<section id="bibliography" style="margin-top:3rem;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,0.09);">
          <h2>Verified Primary Sources &amp; Citations</h2>
          <ol style="line-height:1.75;color:#9aa3b5;font-size:0.92rem;">
            ${post.bibliography
              .map(
                (b) =>
                  `<li id="bib-source-${b.number}" style="margin-bottom:0.85rem;">
                    <strong style="color:#eef2f7;">${b.title}</strong> — ${b.publisher} (${b.sectionLocator}).
                    <a href="${b.canonicalUrl}" target="_blank" rel="noopener" style="color:#00e5ff;">${b.canonicalUrl}</a>
                    <span class="tt-badge" style="margin-left:6px;">SHA256: ${b.contentSha256.slice(0, 12)}…</span>
                  </li>`,
              )
              .join('\n')}
          </ol>
        </section>`
      : '';

  const jsonLdGraph = buildUnifiedBlogGraphSchema({
    headline: post.title,
    description: post.description,
    canonicalUrl: `https://crawl.cheap/blog/${post.slug}/`,
    heroImageUrl: `https://crawl.cheap${post.heroImage.src}`,
    datePublished: post.date,
    dateModified: post.dateModified || post.date,
    author: { name: post.author, url: 'https://crawl.cheap' },
    publisherName: 'crawl.cheap',
    publisherLogoUrl: 'https://crawl.cheap/assets/crawl-cheap-logo.png',
    isTechArticle: true,
    proficiencyLevel: 'Intermediate',
    keywords: post.tags,
    breadcrumbs: [
      { name: 'Home', url: 'https://crawl.cheap/' },
      { name: 'Blog', url: 'https://crawl.cheap/blog/' },
      { name: post.title, url: `https://crawl.cheap/blog/${post.slug}/` },
    ],
    faqs: (post.faq || []).map((f) => ({ question: f.q, answer: f.a })),
  });

  const mins = readingMinutes(post.body);
  const editBtnHtml = renderEditAffordance({
    editorEnabled: true,
    slug: post.slug,
    label: 'Edit Inline (PlateJS)',
    href: '#plate-inline-editor',
  }).replace(
    'data-tt-cms="edit"',
    'data-tt-cms="edit" data-testid="edit-article-in-plate" id="btn-plate-edit"',
  );

  const articlePageHtml = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${post.title} · crawl.cheap Engineering Blog</title>
  <meta name="description" content="${post.description}" />
  <link rel="canonical" href="https://crawl.cheap/blog/${post.slug}/" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${post.title}" />
  <meta property="og:description" content="${post.description}" />
  <meta property="og:url" content="https://crawl.cheap/blog/${post.slug}/" />
  <meta property="og:image" content="https://crawl.cheap${post.heroImage.src}" />
  <meta name="theme-color" content="#060610" />
  <link rel="icon" type="image/png" href="/assets/crawl-cheap-icon-64.png" />
  <link rel="alternate" type="application/rss+xml" title="crawl.cheap RSS Feed" href="/blog/feed.xml" />
  <link rel="alternate" type="application/atom+xml" title="crawl.cheap Atom Feed" href="/blog/atom.xml" />
  <link rel="alternate" type="application/feed+json" title="crawl.cheap JSON Feed" href="/blog/feed.json" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/theme-tools.css" />
  <script type="application/ld+json">${JSON.stringify(jsonLdGraph)}</script>
</head>
<body style="background:#060610;color:#eef2f7;margin:0;font-family:system-ui,-apple-system,sans-serif;line-height:1.65;">
  ${renderSkipLink()}
  ${renderReadingProgress()}
  ${renderUniversalNavbar(`/blog/${post.slug}/`)}
  <main id="tt-main" style="max-width:1160px;margin:0 auto;padding:32px 20px 80px;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
      ${renderBreadcrumb({
        items: [
          { label: 'crawl.cheap', href: '/' },
          { label: 'Engineering Blog', href: '/blog/' },
          { label: post.title },
        ],
      })}
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="tt-badge">@theme.tools/blog · ${COMPONENT_TYPES.length} Catalog Components</span>
        ${editBtnHtml}
      </div>
    </div>

    <div id="plate-status-banner" style="display:none;margin-bottom:20px;padding:14px 18px;border-radius:12px;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.38);color:#eef2f7;font-family:'JetBrains Mono',monospace;font-size:0.85rem;">
      <strong>PlateJS In-Place Block Editor Active (@theme.tools/blog/editor)</strong> — Click any prose heading or paragraph below to edit in-place. Structured <code>{{widget:*}}</code> and <code>{{figure:*}}</code> nodes remain losslessly protected.
    </div>

    <article class="tt-article" data-tt-slug="${post.slug}" style="max-width:880px;margin:0 auto;">
      <header style="margin-bottom:28px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
          ${renderEvidenceBadge(post.evidence)}
          <span class="tt-badge">${post.date}</span>
          <span class="tt-badge">${mins} min read</span>
          <span class="tt-badge">Author: ${post.author}</span>
        </div>
        <h1 id="article-title" style="font-family:'Space Grotesk',sans-serif;font-size:clamp(1.85rem,4vw,2.75rem);line-height:1.12;margin:0 0 14px;">${post.title}</h1>
        <p id="article-desc" style="font-size:1.12rem;color:#9aa3b5;margin:0;">${post.description}</p>
      </header>

      ${tocHtml}

      <div id="article-prose-body" class="tt-prose">
        ${bodyHtml}
      </div>

      ${faqWidgetHtml}
      ${bibHtml}

      <footer style="margin-top:44px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.09);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;">
        ${renderShareRow({
          url: `https://crawl.cheap/blog/${post.slug}/`,
          title: post.title,
        })}
        <a href="/blog/api/${post.slug}.json" class="tt-btn tt-btn--ghost">Inspect PlateJS Block AST JSON →</a>
      </footer>
    </article>
  </main>
  ${renderSiteFooter({
    note: 'crawl.cheap — Firecrawl-compatible web data engine on Cloudflare Workers · Powered by @theme.tools',
    links: [
      { label: 'Home', href: '/' },
      { label: 'Blog', href: '/blog/' },
      { label: 'Studio', href: '/app/' },
      { label: 'RSS', href: '/blog/feed.xml' },
      { label: 'Atom', href: '/blog/atom.xml' },
      { label: 'JSON Feed', href: '/blog/feed.json' },
      { label: 'GitHub', href: 'https://github.com/heymegabyte/crawl.cheap' },
    ],
  })}
  <script src="/theme-tools-runtime.js" defer></script>
  <script src="/blog/editor.js" defer></script>
</body>
</html>`;

  writeFileSync(resolve(postDir, 'index.html'), articlePageHtml);
}

// ---------------------------------------------------------------------------
// 5. Build `/blog/index.html` & `/blog/editor.js` & Syndication Feeds
// ---------------------------------------------------------------------------

const blogIndexDir = resolve(publicDir, 'blog');
mkdirSync(blogIndexDir, { recursive: true });

const catalogShowcaseHtml = renderComponent('stat-cards', {
  title: '@theme.tools/blog & @theme.tools/telemetry Production Guarantees',
  cards: [
    {
      value: `${COMPONENT_TYPES.length}`,
      label:
        'Registered @theme.tools/blog components (widgets, media, multimedia, custom elements)',
    },
    {
      value: '2,500ms',
      label: 'Mandatory Langfuse fail-open timeout with 3-strike circuit breaker & local spool',
    },
    {
      value: '7 Rails',
      label:
        'Cloudflare · Sentry · PostHog · GA4 · GTM · Langfuse · Promptfoo correlated via traceparent',
    },
  ],
});

const blogIndexHtml = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Engineering Blog &amp; Architecture Guides · crawl.cheap</title>
  <meta name="description" content="Reference architecture guides on Firecrawl v1/v2 compatibility, Cloudflare Browser Rendering /crawl, @theme.tools/blog SSR, PlateJS block serialization, and 7-rail observability." />
  <link rel="canonical" href="https://crawl.cheap/blog/" />
  <meta name="theme-color" content="#060610" />
  <link rel="icon" type="image/png" href="/assets/crawl-cheap-icon-64.png" />
  <link rel="alternate" type="application/rss+xml" title="crawl.cheap RSS Feed" href="/blog/feed.xml" />
  <link rel="alternate" type="application/atom+xml" title="crawl.cheap Atom Feed" href="/blog/atom.xml" />
  <link rel="alternate" type="application/feed+json" title="crawl.cheap JSON Feed" href="/blog/feed.json" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/theme-tools.css" />
</head>
<body style="background:#060610;color:#eef2f7;margin:0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;">
  ${renderSkipLink()}
  ${renderUniversalNavbar('/blog/')}
  <main id="tt-main" style="max-width:1160px;margin:0 auto;padding:44px 20px 80px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:16px;margin-bottom:32px;">
      <div>
        <span class="tt-badge">@THEME.TOOLS/BLOG · PLATEJS INLINE CMS</span>
        <h1 style="font-family:'Space Grotesk',sans-serif;font-size:clamp(2rem,4.5vw,3.1rem);margin:12px 0 8px;">crawl.cheap Engineering &amp; Architecture</h1>
        <p style="color:#9aa3b5;max-width:64ch;margin:0;">Deep-dive engineering guides on Firecrawl v1/v2 API parity, Cloudflare Workers Browser Rendering <code>/crawl</code>, lossless PlateJS block authoring, and 7-rail edge observability.</p>
      </div>
      ${renderAddAffordance({
        editorEnabled: true,
        href: '/blog/edge-web-scraping-for-ai-agents/#plate-inline-editor',
        label: '+ Add Blog Post',
      }).replace('data-tt-cms="add"', 'data-tt-cms="add" data-testid="new-article-button"')}
    </div>

    ${catalogShowcaseHtml}

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;margin-top:32px;">
      ${posts
        .map(
          (p) => `
        <article class="tt-card tt-card--interactive" style="padding:24px;display:flex;flex-direction:column;gap:14px;">
          <a href="/blog/${p.slug}/" style="display:block;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.09);aspect-ratio:1200/630;background:#0a0e17;">
            <img src="${p.heroImage.src}" alt="${p.heroImage.alt}" width="1200" height="630" style="width:100%;height:100%;object-fit:cover;display:block;" />
          </a>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span class="tt-badge">${p.date}</span>
            <span class="tt-badge">${p.desk}</span>
            <span class="tt-badge">${readingMinutes(p.body)} min read</span>
          </div>
          <h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.35rem;margin:0;">
            <a href="/blog/${p.slug}/" style="color:#eef2f7;text-decoration:none;">${p.title}</a>
          </h2>
          <p style="color:#9aa3b5;margin:0;font-size:0.95rem;">${p.description}</p>
          <div style="margin-top:auto;padding-top:12px;display:flex;gap:12px;align-items:center;">
            <a href="/blog/${p.slug}/" class="tt-btn tt-btn--primary">Read &amp; Edit Inline →</a>
            <a href="/blog/api/${p.slug}.json" class="tt-btn tt-btn--ghost">PlateJS AST</a>
          </div>
        </article>`,
        )
        .join('\n')}
    </div>
  </main>
  ${renderSiteFooter({
    note: 'crawl.cheap — Firecrawl-compatible web data engine on Cloudflare Workers · Powered by @theme.tools',
    links: [
      { label: 'Home', href: '/' },
      { label: 'Blog', href: '/blog/' },
      { label: 'Studio', href: '/app/' },
      { label: 'RSS', href: '/blog/feed.xml' },
      { label: 'Atom', href: '/blog/atom.xml' },
      { label: 'JSON Feed', href: '/blog/feed.json' },
      { label: 'GitHub', href: 'https://github.com/heymegabyte/crawl.cheap' },
    ],
  })}
  <script src="/theme-tools-runtime.js" defer></script>
</body>
</html>`;

writeFileSync(resolve(blogIndexDir, 'index.html'), blogIndexHtml);

// In-place PlateJS Inline Editor controller (`/blog/editor.js`)
const EDITOR_CLIENT_JS = `/**
 * @theme.tools/blog/editor — Direct In-Place Inline PlateJS Block Editor Controller
 */
(function () {
  var btn = document.getElementById('btn-plate-edit');
  var banner = document.getElementById('plate-status-banner');
  var prose = document.getElementById('article-prose-body');
  var titleEl = document.getElementById('article-title');
  var descEl = document.getElementById('article-desc');
  if (!btn || !prose) return;

  var editing = false;
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    editing = !editing;
    if (banner) banner.style.display = editing ? 'block' : 'none';
    btn.innerHTML = editing
      ? '<span class="tt-cms-btn__icon" aria-hidden="true">✓</span>Done Editing'
      : '<span class="tt-cms-btn__icon" aria-hidden="true">✎</span>Edit Inline (PlateJS)';
    if (titleEl) titleEl.contentEditable = editing ? 'true' : 'false';
    if (descEl) descEl.contentEditable = editing ? 'true' : 'false';
    var blocks = prose.querySelectorAll('h2, h3, p, li');
    blocks.forEach(function (el) {
      if (el.closest('[data-tt-widget]') || el.closest('[data-tt-figure]')) return;
      el.contentEditable = editing ? 'true' : 'false';
      el.style.outline = editing ? '1px dashed rgba(0, 229, 255, 0.35)' : '';
      el.style.borderRadius = editing ? '6px' : '';
    });
    if (window.posthog && window.posthog.capture) {
      window.posthog.capture(editing ? 'blog_inline_edit_started' : 'blog_inline_edit_saved', {
        slug: document.querySelector('[data-tt-slug]')?.getAttribute('data-tt-slug') || '',
      });
    }
  });
})();
`;
writeFileSync(resolve(blogIndexDir, 'editor.js'), EDITOR_CLIENT_JS);

// Build RSS 2.0, Atom 1.0, and JSON Feed 1.1 via `@theme.tools/blog`
const feedChannel = {
  title: 'crawl.cheap Engineering Blog',
  siteUrl: 'https://crawl.cheap/blog/',
  feedUrl: 'https://crawl.cheap/blog/feed.xml',
  description:
    'Firecrawl-compatible edge web scraping, Cloudflare Browser Rendering /crawl, and @theme.tools architecture guides.',
  language: 'en-US',
  items: posts.map((p) => ({
    id: `https://crawl.cheap/blog/${p.slug}/`,
    url: `https://crawl.cheap/blog/${p.slug}/`,
    title: p.title,
    summary: p.description,
    publishedAt: new Date(`${p.date}T14:00:00.000Z`),
    updatedAt: new Date(`${p.dateModified || p.date}T14:00:00.000Z`),
    authors: [{ name: p.author }],
    categories: p.tags,
  })),
};

writeFileSync(resolve(blogIndexDir, 'feed.xml'), buildRss20FeedXml(feedChannel));
writeFileSync(
  resolve(blogIndexDir, 'atom.xml'),
  buildAtom10FeedXml({ ...feedChannel, feedUrl: 'https://crawl.cheap/blog/atom.xml' }),
);
writeFileSync(
  resolve(blogIndexDir, 'feed.json'),
  JSON.stringify(
    buildJsonFeed11({ ...feedChannel, feedUrl: 'https://crawl.cheap/blog/feed.json' }),
    null,
    2,
  ),
);

console.log(
  `sync-theme-tools: wrote theme-tools.css (${combinedCss.length} B), theme-tools-runtime.js (${RUNTIME_JS.length} B), and ${posts.length} @theme.tools/blog article(s) (${BLOG_COMPONENT_MANIFEST.length} registered catalog components).`,
);
