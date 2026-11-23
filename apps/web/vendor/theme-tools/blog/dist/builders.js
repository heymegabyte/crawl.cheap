/**
 * @module @theme.tools/blog/builders
 * @description
 * STANDALONE-SAFE barrel for the blog/changelog RENDER + feed builders — importable by a plain
 * npm / Vite / Hono site WITHOUT any workspace (`@theme-tools/shared-utils`) resolution.
 *
 * The package root (`.`) barrel (`src/index.ts`) re-exports from
 * `@theme-tools/shared-utils/tier1-3-upstream-repo-compat` (a `workspace:*` dependency), and its
 * `core.ts`/`contracts.ts` additionally import `@theme-tools/shared-utils/interaction-state-tokens`,
 * so a standalone consumer that imports from the root fails
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@theme-tools/shared-utils'` when that package is absent.
 * This subpath re-exports ONLY the FULLY SELF-CONTAINED (zero-external-import) source files that hold
 * the logic a site needs to serve a `/blog` index + a post page + a `/changelog`, so the emitted
 * `dist/builders.js` references no workspace package by construction (plain file-for-file build).
 *
 * The render/feed logic a standalone blog/changelog surface actually wants:
 * - **Post body render** — `renderMarkdown` (safe, framework-free markdown → HTML), `extractHeadings`
 *   (TOC anchors), `autolinkTerms`, `countWords` / `readingMinutes` (`markdown.ts`).
 * - **Feeds + TOC + canonicals** — `buildRss20FeedXml`, `buildAtom10FeedXml`, `buildJsonFeed11`
 *   (RSS/Atom/JSONFeed for `/blog` + `/changelog`), `buildSyndicatedHeadingOutline`,
 *   `estimateWeightedArticleReadingTime`, `buildCanonicalAndHreflangLinks`
 *   (`rss-atom-jsonfeed-and-toc.ts`).
 * - **Post JSON-LD** — `buildBlogPostSchema`, `buildUnifiedBlogGraphSchema`, `buildBreadcrumbListSchema`,
 *   `buildFAQPageSchema`, `renderBlogJsonLd` (`schema.ts`).
 * - **Related-posts module** — `renderRelatedPosts` (`related-posts.ts`).
 * - **In-page CMS affordances** — `renderAddAffordance`, `renderEditAffordance`, `CMS_CSS` (`cms.ts`).
 * - **Editorial scheduling / topic selection** — `evaluateDataForSeo15CandidateTopicBrief`,
 *   `evaluateDailyEditorialSchedulePolicy`, `evaluatePreviewVsProductionEditorialBoundary`
 *   (`topic-strategy.ts`).
 *
 * All six re-exported files are self-contained with ZERO name collisions between them. The richer
 * Plate/ArticleDocument path (`core.ts`/`react.ts`) + the upstream-compat helpers stay behind the
 * root barrel (they need `@theme-tools/shared-utils`). Importing from the root barrel / the existing
 * `./markdown`, `./related-posts`, `./topic-strategy`, `./cms` subpaths stays supported and unchanged
 * — this is purely additive.
 */
export * from "./markdown.js";
export * from "./rss-atom-jsonfeed-and-toc.js";
export * from "./schema.js";
export * from "./related-posts.js";
export * from "./cms.js";
export * from "./topic-strategy.js";
//# sourceMappingURL=builders.js.map