#!/usr/bin/env node
/**
 * sync-theme-tools.mjs — vendor the canonical @theme.tools/blog component CSS into
 * apps/web/public/theme-tools.css, rebranded to fuegol.ink's REAL fire-orange brand.
 *
 * Validated pattern (ref: ghost.claims): the token-driven component layer
 * (`.tt-btn` / `.tt-feature` (card) / `.tt-tag` (badge) / inputs + the tactile ripple
 * micro-interaction `@layer`) is produced by `SITE_CSS` + `ALL_BLOG_CSS` exported from
 * `@theme.tools/blog`. Zero-JS, no Tailwind build — a static <link>-able stylesheet.
 *
 * fuegol's brand is FIRE-ORANGE (`--flame2 #ff8a3d`, hue ~50°), with cyan `#00e5ff` as a
 * genuine secondary accent and green `#7ee787` as success. Upstream SITE_CSS ships a CYAN
 * accent (`--tt-cyan #00e5ff`, hue ~200°). We faithfully remap the single brand ACCENT
 * from cyan → fuegol fire via the OKLCH token roles (`--primary`/`--ring`) + the `--tt-*`
 * token layer, and recolor the pervasive `rgba(0,229,255,…)` accent glows to fire. No
 * class bodies are hand-edited — only the design tokens flip, so the whole component set
 * rebrands from one source of truth.
 *
 * Run: `node apps/web/scripts/sync-theme-tools.mjs` (also wired into `predeploy`).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Import the CSS string constants from the leaf dist modules directly. These three files are
// self-contained (zero imports), so we avoid `components-registry.js`'s transitive pull of
// `@theme-tools/shared-utils`. `ALL_BLOG_CSS` is canonically `WIDGET_CSS + "\n" + MEDIA_CSS`.
import { MEDIA_CSS } from '../vendor/theme-tools/blog/dist/media.js';
import { SITE_CSS } from '../vendor/theme-tools/blog/dist/site.js';
import { WIDGET_CSS } from '../vendor/theme-tools/blog/dist/widgets.js';

const ALL_BLOG_CSS = `${WIDGET_CSS}\n${MEDIA_CSS}`;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/theme-tools.css');
const PKG = resolve(here, '../vendor/theme-tools/blog/package.json');

// fuegol fire palette (sRGB → OKLCH, computed once; hue ~50° orange).
//   #ff8a3d flame2  → oklch(75.0% .167 50.5)   — the primary accent (mark fill + wordmark)
//   #ff5722 flame1  → oklch(67.9% .213 36.5)   — deep flame (gradient start)
//   #ffc24b flame3  → oklch(84.9% .148 80.7)   — soft flame (gradient end / highlight)
//   #060610 ink     → the dark canvas (unchanged — matches upstream)
const FIRE = {
  accent: '#ff8a3d', // --tt-cyan role (brand accent)
  accentSoft: '#ffc24b', // --tt-cyan-soft
  accentDeep: '#ff5722', // --tt-cyan-deep
  onAccent: '#1a0b02', // dark ink that sits ON the fire gradient (matches existing .btn-primary)
  // Light-mode accent that passes AA contrast on white (deepened fire):
  accentLight: '#b4480c',
  accentSoftLight: '#9c3d0a',
  accentDeepLight: '#8a3508',
  // RGB triplet of the accent, for the many `rgba(…, a)` glow literals:
  rgb: '255,138,61',
};

/**
 * Neutralize the upstream GLOBAL PAGE rules (`body`, `html,body`, bare `a`, `main`, and the
 * light-mode `body` background) so the vendored sheet is a pure TOKEN + `.tt-*` COMPONENT layer
 * that composes over fuegol's existing page shell instead of fighting it (one-canonical-seam:
 * fuegol's `index.html` owns the page background/typography; theme.tools owns the tokens + the
 * `.tt-*` primitives). The `*{box-sizing}` reset is kept — it matches fuegol's own.
 */
function stripGlobalPageRules(css) {
  return (
    css
      // `body{ … }` (multi-line declaration incl. the fire background-image gradients)
      .replace(/\nbody\{[\s\S]*?\n\}\n/, '\n')
      // `html,body{margin:0}`
      .replace(/\nhtml,body\{margin:0\}/, '')
      // bare element `a{color:inherit;text-decoration:none}` (scoped links keep their own rules)
      .replace(/\na\{color:inherit;text-decoration:none\}/, '')
      // `main{min-height:58vh}`
      .replace(/\nmain\{min-height:58vh\}/, '')
      // light-mode page background block
      .replace(/:root\[data-theme="light"\] body\{background-image:[\s\S]*?60%\)\}/, '')
  );
}

/** Rebrand the upstream cyan token layer + accent glows to fuegol fire. */
function rebrand(css) {
  let out = css;

  // 1) Dark-mode :root accent tokens (cyan → fire).
  out = out.replace('--tt-cyan:#00e5ff;', `--tt-cyan:${FIRE.accent};`);
  out = out.replace('--tt-cyan-soft:#8ff6ff;', `--tt-cyan-soft:${FIRE.accentSoft};`);
  out = out.replace('--tt-cyan-deep:#2aa7c7;', `--tt-cyan-deep:${FIRE.accentDeep};`);
  // Border/line tint tokens (cyan-rgba → fire-rgba).
  out = out.replaceAll('rgba(0,229,255,.14)', `rgba(${FIRE.rgb},.14)`);
  out = out.replaceAll('rgba(0,229,255,.3)', `rgba(${FIRE.rgb},.3)`);
  // Text that sits on the accent gradient stays dark, but match fuegol's warm ink.
  out = out.replaceAll('color:#02121a', `color:${FIRE.onAccent}`);
  out = out.replaceAll('#02121a!important', `${FIRE.onAccent}!important`);
  out = out.replace('--tt-on-accent:#02121a;', `--tt-on-accent:${FIRE.onAccent};`);

  // 2) Light-mode :root accent tokens (AA-contrast deep fire on white).
  out = out.replace('--tt-cyan:#0a6f8a;', `--tt-cyan:${FIRE.accentLight};`);
  out = out.replace('--tt-cyan-soft:#0a6680;', `--tt-cyan-soft:${FIRE.accentSoftLight};`);
  out = out.replace('--tt-cyan-deep:#075b72;', `--tt-cyan-deep:${FIRE.accentDeepLight};`);
  out = out.replaceAll('rgba(10,54,78,.15)', `rgba(140,56,10,.15)`);
  out = out.replaceAll('rgba(10,54,78,.28)', `rgba(140,56,10,.28)`);
  out = out.replaceAll('rgba(10,111,138', 'rgba(180,72,12'); // light decorative glows
  out = out.replace(
    '.tt-term{--tt-faint:#8299ab;--tt-cyan:#5fe0f5}',
    '.tt-term{--tt-faint:#8299ab;--tt-cyan:#ffb27a}',
  );
  out = out.replaceAll('#0c1922 26%,var(--tt-cyan)', `#1a0b02 26%,var(--tt-cyan)`); // light masthead gradient start

  // 3) Every remaining cyan accent glow literal → fire (shadows, inset borders, hovers).
  out = out.replaceAll(/rgba\(0,\s*229,\s*255,/g, `rgba(${FIRE.rgb},`);
  // Any bare #00e5ff / #8ff6ff / #2aa7c7 left in class bodies → fire equivalents.
  out = out.replaceAll('#00e5ff', FIRE.accent);
  out = out.replaceAll('#8ff6ff', FIRE.accentSoft);
  out = out.replaceAll('#2aa7c7', FIRE.accentDeep);

  return out;
}

/**
 * OKLCH design-token role layer (`@theme-tools/themes` names) carrying fuegol's fire brand.
 * Prepended so the canonical role vocabulary (`--primary`/`--ring`/`--card`/`--border`/
 * `--radius`) is present and drives the `--tt-*` layer that follows.
 */
const OKLCH_ROLES = `/* fuegol.ink — @theme.tools OKLCH design-token roles (brand: fire-orange #ff8a3d, hue ~50°).
   Faithful remap of the @theme-tools/themes role vocabulary; cyan stays a real secondary accent. */
:root{
  color-scheme:dark;
  --background:oklch(12.9% .023 282.6);        /* #060610 ink */
  --foreground:oklch(96% .01 240);
  --card:oklch(16% .02 275);                   /* raised panel */
  --card-foreground:oklch(96% .01 240);
  --primary:oklch(75% .167 50.5);              /* #ff8a3d fire — the brand accent */
  --primary-foreground:oklch(16.9% .034 57.5); /* #1a0b02 warm ink ON fire */
  --secondary:oklch(84% .17 198);              /* #00e5ff cyan — genuine secondary accent */
  --accent:oklch(67.9% .213 36.5);             /* #ff5722 deep flame */
  --muted:oklch(22% .025 275);
  --muted-foreground:oklch(70% .02 250);
  --destructive:oklch(62% .21 25);
  --border:oklch(27% .03 275);
  --input:oklch(27% .03 275);
  --ring:oklch(75% .167 50.5);                 /* focus ring = fire */
  --radius:.75rem;
  --font-sans:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
}
`;

const version = JSON.parse(await readFile(PKG, 'utf8')).version;

// Drop the optional @font-face preamble (fuegol loads Google Fonts in-head already);
// start at the :root token block, exactly as the ghost.claims chain does.
const siteFromRoot = SITE_CSS.slice(SITE_CSS.indexOf(':root{'));
const raw = `${siteFromRoot}\n${ALL_BLOG_CSS}`;
const branded = rebrand(stripGlobalPageRules(raw));

const banner = `/* fuegol.ink theme-tools component layer — generated from @theme.tools/blog v${version}.
   Source of truth: apps/web/scripts/sync-theme-tools.mjs. Do not edit by hand — re-run the script.
   Brand: fuegol FIRE-ORANGE (#ff8a3d, hue ~50°) remapped from the upstream cyan accent. */
`;

await writeFile(OUT, `${banner}${OKLCH_ROLES}\n${branded.trim()}\n`, 'utf8');

// Guardrails: the canonical component set must survive, and no stray cyan accent may leak.
const final = await readFile(OUT, 'utf8');
const required = [
  '.tt-btn',
  '.tt-btn--primary',
  '.tt-btn--ghost',
  '.tt-feature',
  '.tt-tag',
  '--primary:oklch',
  '--ring:oklch',
];
const missing = required.filter((t) => !final.includes(t));
if (missing.length)
  throw new Error(`theme-tools.css missing required tokens/classes: ${missing.join(', ')}`);
// Leak check runs on the BRANDED UPSTREAM css only (not our annotated role layer, whose
// comments legitimately name #00e5ff as the secondary accent). Strip CSS comments first.
const brandedNoComments = branded.replace(/\/\*[\s\S]*?\*\//g, '');
const cyanLeak =
  (brandedNoComments.match(/#00e5ff/gi) || []).length +
  (brandedNoComments.match(/rgba\(0,\s*229,\s*255/g) || []).length;
if (cyanLeak > 0)
  throw new Error(
    `theme-tools.css still has ${cyanLeak} upstream cyan accent literal(s) — rebrand incomplete`,
  );

console.log(
  `wrote ${OUT} (${(final.length / 1024).toFixed(1)}KB, @theme.tools/blog v${version}, fire-branded, 0 cyan leak)`,
);
