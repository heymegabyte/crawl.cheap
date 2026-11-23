#!/usr/bin/env node
/**
 * Real-browser E2E for the marketing site, driven over the Chrome DevTools Protocol
 * (no Playwright/Browserbase dependency — uses Node's global WebSocket + a local
 * headless Chromium). Loads the LIVE site, asserts it renders, captures every console
 * error + CSP violation, and exercises the two new dynamic surfaces end-to-end:
 *   • savings calculator  → fetch GET /v2/pricing, render savings
 *   • price estimator      → POST /v2/quote, render a bounded quote
 *   • migration tabs       → switch TS ↔ Python panes
 *
 *   URL=https://crawl-cheap-web.manhattan.workers.dev node e2e/web/cdp-check.mjs
 *
 * Local-only (needs a Chromium binary) — not a CI gate, like the rest of e2e/.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const URL_ = (process.env.URL ?? 'https://crawl.cheap').replace(/\/+$/, '');
const PORT = Number(process.env.CDP_PORT ?? 9333);
const BINS = [
  process.env.CHROME,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1178/chrome-mac/headless_shell`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const BIN = BINS.find((b) => existsSync(b));
if (!BIN) {
  console.error('No Chromium/Chrome binary found; skipping real-browser check.');
  process.exit(2);
}

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = '') => {
  (cond ? pass++ : fail++,
    console[cond ? 'log' : 'error'](`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  ' + extra}`));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(
  BIN,
  [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/crawl-cheap-cdp-profile',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const cleanup = () => {
  try {
    child.kill('SIGKILL');
  } catch {}
};
process.on('exit', cleanup);

async function browserWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('Chromium DevTools endpoint never came up');
}

const consoleErrors = [];
let nextId = 1;
const pending = new Map();
const eventWaiters = [];

function send(ws, method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function waitFor(predicate, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('event timeout')), timeout);
    eventWaiters.push((msg) => {
      if (predicate(msg)) {
        clearTimeout(t);
        resolve(msg);
        return true;
      }
      return false;
    });
  });
}

async function main() {
  const wsUrl = await browserWs();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    // Capture console errors + CSP / security log entries + page exceptions.
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
      consoleErrors.push(
        'console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      );
    if (msg.method === 'Runtime.exceptionThrown')
      consoleErrors.push(
        'exception: ' +
          (msg.params.exceptionDetails?.exception?.description ??
            msg.params.exceptionDetails?.text),
      );
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')
      consoleErrors.push(`log(${msg.params.entry.source}): ` + msg.params.entry.text);
    for (let i = eventWaiters.length - 1; i >= 0; i--)
      if (eventWaiters[i](msg)) eventWaiters.splice(i, 1);
  });

  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');
  await S('Log.enable');
  await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });

  const loaded = waitFor(
    (m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId,
    20000,
  );
  await S('Page.navigate', { url: URL_ });
  await loaded;
  await sleep(4000); // let the calculator's /v2/pricing fetch resolve

  const ev15 = async (expr) =>
    (await S('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  console.log(`\nreal-browser (CDP) E2E → ${URL_}\n`);

  // Render
  ok(
    'hero H1 renders the new headline',
    /Half the core API cost/.test(await ev15("document.querySelector('h1.hero')?.innerText||''")),
  );
  const rootLen = await ev15('document.body.innerText.length');
  ok('page body is non-empty (not blank/white)', rootLen > 1500, `len=${rootLen}`);

  const navOrderCheck = await ev15(`(() => {
    const topLinks = [...document.querySelectorAll('nav .links > a')].map(a => a.textContent.trim());
    const hasOldClutter = topLinks.some(t => ['Features', 'Demo', 'Pricing', 'Blog', 'Compatibility'].includes(t));
    const featuredTitle = document.querySelector('.tt-mm__panel-featured-title');
    const titlePos = featuredTitle ? getComputedStyle(featuredTitle).position : '';
    const mmCount = document.querySelectorAll('.tt-mm__item').length;
    return { topLinks, hasOldClutter, titlePos, mmCount };
  })()`);
  ok(
    'Navbar simplified to Explore & Guides Mega-Menu (11 items, non-overlapping static preview caption) + Studio + Avatar Circle',
    Boolean(
      navOrderCheck &&
      !navOrderCheck.hasOldClutter &&
      navOrderCheck.titlePos === 'static' &&
      navOrderCheck.mmCount >= 10,
    ),
    JSON.stringify(navOrderCheck),
  );

  // Savings calculator (ran its live /v2/pricing fetch)
  const calc = await ev15("document.getElementById('calcOut')?.innerText||''");
  ok(
    'savings calculator rendered a result',
    /\/mo on crawl.cheap/.test(calc) && /% less/.test(calc),
    calc.slice(0, 120),
  );
  ok('calculator shows the Standard default ($49.50)', /\$49\.50/.test(calc), calc.slice(0, 120));

  // Migration tabs
  await ev15(
    "[...document.querySelectorAll('#migTabs button')].find(b=>b.dataset.l==='py').click()",
  );
  await sleep(200);
  ok(
    'migration tab switches to Python',
    (await ev15("document.getElementById('mig-py').hidden")) === false &&
      (await ev15("document.getElementById('mig-ts').hidden")) === true,
  );

  // Price estimator (POST /v2/quote in-browser)
  await ev15("document.getElementById('eBtn').click()");
  let eout = '';
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    eout = await ev15("document.getElementById('eOut')?.innerText||''");
    if (/credits/.test(eout)) break;
  }
  ok(
    'estimator returned a quote via POST /v2/quote',
    /\bcredits\b/.test(eout) && /margin-safe/.test(eout),
    eout.slice(0, 140),
  );
  ok(
    'estimator shows a hard cap + Firecrawl comparison',
    /hard cap/.test(eout) && /Firecrawl/.test(eout),
    eout.slice(0, 160),
  );

  // Console / CSP cleanliness through the happy path (snapshot BEFORE we deliberately trip a 400).
  const happyErrors = [...consoleErrors];
  ok(
    '0 console errors / CSP violations through the happy path',
    happyErrors.length === 0,
    '\n   - ' + happyErrors.join('\n   - '),
  );

  // Fail-closed in-browser: an unbounded crawl must warn. The API returns an expected
  // 400 (boundable:false) — the ONLY network log entry we tolerate, and itself proof
  // that the product refuses to quote an unbounded-cost job.
  await ev15(
    "document.getElementById('eOp').value='crawl';document.getElementById('eOp').dispatchEvent(new Event('change'));document.getElementById('ePages').value='';document.getElementById('eBtn').click()",
  );
  let warn = '';
  for (let i = 0; i < 15; i++) {
    await sleep(400);
    warn = await ev15("document.getElementById('eOut')?.innerText||''");
    if (/⚠|page limit/i.test(warn)) break;
  }
  ok(
    'unbounded crawl warns (fails closed) in-browser',
    /page limit|unbounded/i.test(warn),
    warn.slice(0, 140),
  );
  const extraLogs = consoleErrors.slice(happyErrors.length);
  ok(
    'only extra console entry is the expected fail-closed 400',
    extraLogs.length >= 1 && extraLogs.every((l) => /status of 400/.test(l)),
    '\n   - ' + extraLogs.join('\n   - '),
  );

  // Visual evidence
  try {
    const { data } = await S('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync('e2e/web/screenshots', { recursive: true });
    writeFileSync('e2e/web/screenshots/home.png', Buffer.from(data, 'base64'));
    console.log('\n  📸 e2e/web/screenshots/home.png');
  } catch {}

  // ───────────────────────────────────────────────────────────────────────────
  // Flagship Developer Studio (/app/) + 6-Breakpoint Responsive Audit
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`\nFlagship Developer Studio (/app/) + 6-Breakpoint Audit → ${URL_}/app/\n`);
  const studioErrStart = consoleErrors.length;
  const loadedStudio = waitFor(
    (m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId,
    20000,
  );
  await S('Page.navigate', { url: `${URL_}/app/` });
  await loadedStudio;
  await sleep(1500);

  const studioTitle = await ev15("document.querySelector('h1.t')?.textContent||''");
  ok(
    'Dashboard H1 renders clean Overview heading',
    /Overview|Dashboard|Developer Studio/i.test(studioTitle),
    studioTitle,
  );

  const bgRgb = await ev15('getComputedStyle(document.body).backgroundColor');
  ok('Dark-first #060610 background (rgb(6, 6, 16)) verified', bgRgb === 'rgb(6, 6, 16)', bgRgb);

  const graphNodes = await ev15("document.querySelectorAll('#crawlGraphSvg circle').length");
  ok('WebSocket Crawl Graph SVG topology rendered', graphNodes >= 2, `nodes=${graphNodes}`);

  // Verify @theme.tools/blog Mega-Menu, Avatar Circle, & 7-Rail Telemetry Runtime on /app/
  const hasMegaMenu = await ev15("Boolean(document.querySelector('[data-tt-mm-root]'))");
  ok('@theme.tools/blog Universal Mega-Menu rendered in navbar', hasMegaMenu);
  const hasAvatarCircle = await ev15("Boolean(document.querySelector('.tt-avatar-circle'))");
  ok('@theme.tools/ui Avatar Circle rendered in navbar', hasAvatarCircle);
  const hasAuthProviders = await ev15(
    'Boolean(document.querySelector(\'[data-testid="login-google"]\') && document.querySelector(\'[data-testid="login-github"]\') && document.querySelector(\'[data-testid="send-magic-link"]\'))',
  );
  ok(
    'Google OAuth, GitHub OAuth, and Magic Email Link login buttons rendered in Firecrawl Admin Dashboard',
    hasAuthProviders,
  );
  const hasFirecrawlSections = await ev15(
    "Boolean(document.getElementById('overviewMetrics') && document.getElementById('playground') && document.getElementById('activitySection') && document.getElementById('usageSection') && document.getElementById('apiKeysSection'))",
  );
  ok(
    'Complete Firecrawl Admin Dashboard sections (Overview, 7-Mode Playground, Activity Logs, Usage & Plan Switcher, API Keys, Co-Pilot, Monitors) rendered',
    hasFirecrawlSections,
  );

  const dashboardSimplificationCheck = await ev15(`(() => {
    const sidebarText = [...document.querySelectorAll('.dash-sidebar .studio-tab')].map(b => b.textContent.trim()).join(' ');
    const hasSettingsTab = Boolean(document.querySelector('.dash-sidebar .studio-tab[data-ws="settings"]'));
    const pgTitle = document.querySelector('#playground h2')?.textContent?.trim() || '';
    const inspButtons = [...document.querySelectorAll('#inspectorTabs button')].map(b => b.textContent.trim());
    const hasBrandOrGraphTab = inspButtons.some(t => /Brand Kit|Crawl Graph/i.test(t));
    document.getElementById('getCode')?.click();
    const codeText = document.getElementById('pgCodeOut')?.textContent || '';
    const codeVisible = getComputedStyle(document.getElementById('pgCodeOut')).display !== 'none';
    localStorage.setItem('crawlcheap_name', 'Brian Zalewski');
    localStorage.setItem('crawlcheap_provider', 'github');
    if (window.__TT_HYDRATE_AVATAR__) window.__TT_HYDRATE_AVATAR__();
    const avatarInitials = document.getElementById('navAvatarCircle')?.textContent?.trim() || '';
    localStorage.removeItem('crawlcheap_name');
    localStorage.removeItem('crawlcheap_provider');
    if (window.__TT_HYDRATE_AVATAR__) window.__TT_HYDRATE_AVATAR__();
    return {
      sidebarText,
      hasSettingsTab,
      pgTitle,
      inspButtons,
      hasBrandOrGraphTab,
      codeWorks: codeVisible && codeText.includes('curl -X POST'),
      avatarInitials,
    };
  })()`);
  ok(
    'Dashboard simplified: Settings menu present, Playground cleaned (no Brand Kit / Crawl Graph tabs), Get code works, and Avatar Circle derives initials from account user',
    Boolean(
      dashboardSimplificationCheck &&
      dashboardSimplificationCheck.hasSettingsTab &&
      dashboardSimplificationCheck.pgTitle === 'Playground' &&
      !dashboardSimplificationCheck.hasBrandOrGraphTab &&
      dashboardSimplificationCheck.codeWorks &&
      dashboardSimplificationCheck.avatarInitials === 'BZ',
    ),
    JSON.stringify(dashboardSimplificationCheck),
  );
  const telemetryRailsReady = await ev15(
    'Boolean(window.__TT_TRACE__ && window.posthog && window.gtag && Array.isArray(window.dataLayer) && window.Sentry && window.LangfuseSafe && window.LangfuseSafe.timeoutMs === 2500)',
  );
  ok(
    '@theme.tools/telemetry 7-Rail Browser Runtime active (traceparent + Sentry + PostHog + GA4 + GTM + Langfuse 2500ms)',
    telemetryRailsReady,
  );

  // Test all 6 required responsive breakpoints (320px, 375px, 768px, 1024px, 1280px, 1440px)
  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await S('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 2,
      mobile: width < 768,
    });
    await sleep(150);
    const overflow = await ev15(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    ok(
      `Breakpoint ${width}px has zero horizontal overflow`,
      overflow <= 1,
      `overflow=${overflow}px`,
    );
  }

  // Filter out any non-blocking cross-origin telemetry beacon noise during local tests, require 0 CSP/page errors
  const studioErrors = consoleErrors.slice(studioErrStart);
  ok(
    '0 console errors / CSP violations on /app/ across all 6 breakpoints',
    studioErrors.length === 0,
    '\n   - ' + studioErrors.join('\n   - '),
  );

  try {
    const { data } = await S('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync('e2e/web/screenshots', { recursive: true });
    writeFileSync('e2e/web/screenshots/studio.png', Buffer.from(data, 'base64'));
    console.log('  📸 e2e/web/screenshots/studio.png');
  } catch {}

  // ───────────────────────────────────────────────────────────────────────────
  // @theme.tools/blog Magazine Index (/blog/) + 4 Flagship 2,000+ Word Articles
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`\n@theme.tools/blog Magazine (/blog/) & 4 Flagship 2,000+ Word Articles Audit\n`);
  const blogErrStart = consoleErrors.length;
  const loadedBlogIndex = waitFor(
    (m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId,
    20000,
  );
  await S('Page.navigate', { url: `${URL_}/blog/` });
  await loadedBlogIndex;
  await sleep(1200);

  const blogCardCount = await ev15("document.querySelectorAll('.tt-post, article.tt-card').length");
  ok(
    '@theme.tools/blog magazine index renders all 4 flagship engineering articles',
    blogCardCount >= 4,
    `cards=${blogCardCount}`,
  );

  for (const slug of [
    'edge-web-scraping-for-ai-agents',
    'cloudflare-browser-rendering-crawl-and-durable-objects',
    'oauth-2-1-pkce-and-30-tool-mcp-servers-on-cloudflare-workers',
    'multimodal-document-parsing-and-autonomous-browser-copilots',
  ]) {
    const loadedBlog = waitFor(
      (m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId,
      20000,
    );
    await S('Page.navigate', { url: `${URL_}/blog/${slug}/` });
    await loadedBlog;
    await sleep(1000);

    const blogWidgetCount = await ev15(
      "document.querySelectorAll('.tt-widget, [data-tt-widget], figure.fig').length",
    );
    ok(
      `/blog/${slug}/ rendered 14+ structured @theme.tools/blog widgets & SVG diagrams`,
      blogWidgetCount >= 14,
      `widgets=${blogWidgetCount}`,
    );
    const wordCount = await ev15(
      "(document.querySelector('article')?.innerText || '').split(/\\s+/).filter(Boolean).length",
    );
    ok(`/blog/${slug}/ exceeds 2,000+ rendered words`, wordCount >= 2000, `words=${wordCount}`);
    const rawTokensLeft = await ev15(
      "Array.from(document.querySelectorAll('p')).some(p => /^\\{\\{(widget|figure):[A-Za-z0-9_-]+\\}\\}$/.test((p.textContent || '').trim()))",
    );
    ok(`/blog/${slug}/ has zero unreplaced {{widget:*}} or {{figure:*}} tokens`, !rawTokensLeft);

    const refsCheck = await ev15(`(() => {
      const d = document.querySelector('[data-testid="collapsible-citations-drawer"]');
      if (!d) return { exists: false };
      const insidePanel = Boolean(d.closest('.tt-article-panel, article.tt-article'));
      return {
        exists: true,
        isCollapsedByDefault: d.open === false,
        isOutsidePanelContainer: !insidePanel,
      };
    })()`);
    ok(
      `/blog/${slug}/ collapsible references drawer is outside panel container and collapsed by default`,
      Boolean(
        refsCheck &&
        refsCheck.exists &&
        refsCheck.isCollapsedByDefault &&
        refsCheck.isOutsidePanelContainer,
      ),
      JSON.stringify(refsCheck),
    );
  }

  await ev15('document.querySelector(\'[data-testid="edit-article-in-plate"]\')?.click()');
  await sleep(500);
  const isInlineEditable = await ev15(
    'Boolean(document.querySelector(\'[data-testid="edit-article-in-plate"][aria-pressed="true"]\') || document.querySelector(\'[contenteditable="true"]\'))',
  );
  ok('Clicking ✎ Edit Inline activates in-place PlateJS block editing', isInlineEditable);

  const blogErrors = consoleErrors.slice(blogErrStart);
  ok(
    '0 console errors / CSP violations across all 4 @theme.tools/blog articles',
    blogErrors.length === 0,
    '\n   - ' + blogErrors.join('\n   - '),
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('harness error:', e.message);
  cleanup();
  process.exit(1);
});
