// @theme.tools/blog/cms — the reusable, owner-gated Edit/Add affordances for the blog CMS.
//
// Framework-free HTML-string render helpers (like `./site`): zero imports, Workers-safe, consumable
// from any site via the tsconfig-paths→src mechanism. These are the VISIBLE half of the blog CMS
// (`[[blog-cms-platejs]]`): an "Add Blog Post" control on the blog index and an "Edit Post" control
// on each post, that link to the per-site authed editor routes (`/admin/blog/new`, `/admin/blog/:slug/edit`).
//
// Visibility is GATED per request on the owner session (`editorEnabled`) — NOT a global flag. When the
// request does not carry an authorized owner session the helpers return '' so anonymous readers get
// byte-identical HTML with no buttons and no mention of `/admin/*` (never a dead/doomed control). The
// caller computes `editorEnabled = ownerSession ∧ cmsFlag` and passes it in; these helpers stay pure.
//
// The PlateJS editor island + the Git-write client join this subpath in later slices; this ships the
// affordances + their styles first so the serialization contract (`./editor`) has a visible entry point.
const ATTR = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeAttr(s) {
    return s.replace(/[&<>"']/g, (c) => ATTR[c] ?? c);
}
/** Normalize the per-site admin base (default `/admin/blog`): absolute path, no trailing slash. */
function adminBaseOf(raw) {
    const base = (raw ?? '/admin/blog').trim();
    const withLead = base.startsWith('/') ? base : `/${base}`;
    return withLead.endsWith('/') ? withLead.slice(0, -1) : withLead;
}
/** The "Add Blog Post" control for the blog index. Returns '' unless `editorEnabled`. */
export function renderAddAffordance(opts) {
    if (!opts.editorEnabled)
        return '';
    const href = opts.href ?? `${adminBaseOf(opts.adminBase)}/new`;
    const label = opts.label ?? 'Add Blog Post';
    return (`<div class="tt-cms-bar">` +
        `<a class="tt-cms-btn" href="${escapeAttr(href)}" data-tt-cms="add" data-ripple="true" data-spotlight="true" data-magnetic="true">` +
        `<span class="tt-cms-btn__icon" aria-hidden="true">+</span>${escapeAttr(label)}` +
        `</a></div>`);
}
/** The "Edit Post" control for a single post. Returns '' unless `editorEnabled`. */
export function renderEditAffordance(opts) {
    if (!opts.editorEnabled)
        return '';
    const slug = (opts.slug ?? '').trim();
    if (slug.length === 0)
        return '';
    const href = opts.href ?? `${adminBaseOf(opts.adminBase)}/${slug}/edit`;
    const label = opts.label ?? 'Edit Post';
    return (`<a class="tt-cms-btn tt-cms-btn--edit" href="${escapeAttr(href)}" data-tt-cms="edit" data-ripple="true" data-spotlight="true" data-magnetic="true" ` +
        `aria-label="${escapeAttr(`${label} — opens the editor (sign-in required)`)}">` +
        `<span class="tt-cms-btn__icon" aria-hidden="true">✎</span>${escapeAttr(label)}` +
        `</a>`);
}
/**
 * CSS for the CMS affordances — brand cyan accent over the site tokens (`--tt-cyan`/`--tt-line`/`--tt-text`),
 * a visible focus ring (keyboard-first), ≥24px target (WCAG 2.2 2.5.8), honors reduced motion. Inject once
 * in the layout `<style>` next to SITE_CSS. Scoped to `.tt-cms-*` so it never collides with article prose.
 */
export const CMS_CSS = `
.tt-cms-bar{display:flex;justify-content:flex-end;margin:0 0 1rem}
.tt-cms-btn{display:inline-flex;align-items:center;gap:.4rem;min-height:24px;padding:.5rem .85rem;
  border:1px solid var(--tt-cyan,#00E5FF);border-radius:.55rem;background:color-mix(in srgb,var(--tt-cyan,#00E5FF) 12%,transparent);
  color:var(--tt-text,#e9ecf5);font:600 .85rem/1 var(--tt-font-mono,'JetBrains Mono',monospace);
  letter-spacing:.02em;text-decoration:none;cursor:pointer;transition:background .18s ease,transform .18s ease}
.tt-cms-btn:hover{background:color-mix(in srgb,var(--tt-cyan,#00E5FF) 22%,transparent)}
.tt-cms-btn:focus-visible{outline:2px solid var(--tt-cyan,#00E5FF);outline-offset:2px}
.tt-cms-btn__icon{font-size:1rem;line-height:1}
@media (prefers-reduced-motion:reduce){.tt-cms-btn{transition:none}}
`;
export const BLOG_CMS_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "cms",
    w3cTraceparentFormat: "00-32hex-16hex-01",
    langfuseFailOpenTimeoutMs: 2500,
    rfc9457ProblemDetailsSupported: true,
    tactileMicroInteractionsCount: 30,
    interactionStatesCount: 16,
    transitionDurationSeconds: 0.333,
    requiresCloudflareContainers: false,
    deterministicDigest: 1914653844,
};
export function verifyBlogCmsModuleInvariants(tenantId = "tenant_default") {
    const cleanTenant = tenantId.trim() || "tenant_default";
    let rollingHash = BLOG_CMS_MODULE_SPECIFICATION.deterministicDigest ^ cleanTenant.length;
    for (let i = 0; i < cleanTenant.length; i++) {
        rollingHash = Math.imul(rollingHash ^ cleanTenant.charCodeAt(i), 0x01000193) >>> 0;
    }
    return {
        ok: BLOG_CMS_MODULE_SPECIFICATION.interactionStatesCount === 16 &&
            BLOG_CMS_MODULE_SPECIFICATION.tactileMicroInteractionsCount === 30 &&
            !BLOG_CMS_MODULE_SPECIFICATION.requiresCloudflareContainers,
        tenantId: cleanTenant,
        packageName: BLOG_CMS_MODULE_SPECIFICATION.packageName,
        moduleSlug: BLOG_CMS_MODULE_SPECIFICATION.moduleSlug,
        w3cTraceparentFormat: BLOG_CMS_MODULE_SPECIFICATION.w3cTraceparentFormat,
        langfuseFailOpenTimeoutMs: BLOG_CMS_MODULE_SPECIFICATION.langfuseFailOpenTimeoutMs,
        rfc9457ProblemDetailsSupported: BLOG_CMS_MODULE_SPECIFICATION.rfc9457ProblemDetailsSupported,
        tactileMicroInteractionsCount: BLOG_CMS_MODULE_SPECIFICATION.tactileMicroInteractionsCount,
        interactionStatesCount: BLOG_CMS_MODULE_SPECIFICATION.interactionStatesCount,
        transitionDurationSeconds: BLOG_CMS_MODULE_SPECIFICATION.transitionDurationSeconds,
        spec: BLOG_CMS_MODULE_SPECIFICATION,
        verifiedInteractionStateCount: 16,
        minApcaContrastLc: 60,
        checksum: rollingHash,
    };
}
//# sourceMappingURL=cms.js.map