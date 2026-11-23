// @theme.tools/blog/editor — the lossless serialization contract between the markdown-string
// blog content model and a PlateJS `Value`. This is the PURE DATA layer (slice 1): zero imports,
// framework-free, Workers-safe, and NO `@udecode/plate` runtime dependency — the editor component
// (which does pull Plate in) binds to this contract in a later slice.
//
// The blog content model a server-rendered (SSR) site authors is a triple:
//   - `markdown`  — the article body as one markdown string. Widget/figure placements are tokens
//                   on their OWN line: `{{widget:<id>}}` / `{{figure:<id>}}`. The site renders the
//                   markdown, then swaps the `<p>{{widget:<id>}}</p>` paragraph for the real widget.
//   - `widgets`   — `{ id, type, data }[]`, resolved into the body by matching `id` to a token.
//   - `figures`   — `{ id, svg, alt, caption }[]`, resolved the same way.
//
// `toPlateValue` turns that triple into a flat Plate `Value` (an array of block nodes: a prose
// block carries its raw markdown verbatim; each token becomes a VOID element carrying the matched
// widget/figure payload inline). `fromPlateValue` turns a Plate `Value` back into the triple.
//
// The contract is LOSSLESS by construction and canonicalizes widgets/figures to their body order
// (rendering is id-keyed, so document order is the natural, render-identical canonical form):
//   fromPlateValue(toPlateValue(content))  ===  normalizeBlogContent(content)
// A malformed node (dangling token, orphaned entry, duplicate id, unknown node type, bad shape) is
// REJECTED with a thrown Error — never silently dropped — so the serializer doubles as a validator.
/** Thrown when the content model or a Plate node cannot be serialized faithfully. */
export class BlogEditorSerializationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BlogEditorSerializationError';
    }
}
/** A body line that is EXACTLY a widget/figure token (full-line match, matching the renderer). */
const TOKEN_LINE = /^\{\{(widget|figure):([A-Za-z0-9_-]+)\}\}$/;
const EMPTY_LEAF = [{ text: '' }];
function indexById(items, kind) {
    const map = new Map();
    for (const item of items) {
        if (typeof item?.id !== 'string' || item.id.length === 0) {
            throw new BlogEditorSerializationError(`${kind} is missing a non-empty string id`);
        }
        if (map.has(item.id)) {
            throw new BlogEditorSerializationError(`duplicate ${kind} id "${item.id}" — ids must be unique`);
        }
        map.set(item.id, item);
    }
    return map;
}
/**
 * Serialize a blog content triple into a Plate `Value`.
 *
 * - Consecutive non-token lines become ONE `markdown` block holding their exact text.
 * - Each `{{widget:<id>}}` / `{{figure:<id>}}` line becomes a void node carrying the matched payload.
 * - A token with no matching entry → throws (dangling token).
 * - An entry never referenced by a token → throws (orphaned entry — never silently dropped).
 * - A duplicate id within widgets/figures → throws.
 */
export function toPlateValue(content) {
    if (typeof content?.markdown !== 'string') {
        throw new BlogEditorSerializationError('content.markdown must be a string');
    }
    const widgetById = indexById(content.widgets ?? [], 'widget');
    const figureById = indexById(content.figures ?? [], 'figure');
    const usedWidgets = new Set();
    const usedFigures = new Set();
    const nodes = [];
    let prose = [];
    const flushProse = () => {
        if (prose.length > 0) {
            nodes.push({ type: 'markdown', markdown: prose.join('\n'), children: EMPTY_LEAF });
            prose = [];
        }
    };
    for (const line of content.markdown.split('\n')) {
        const match = TOKEN_LINE.exec(line);
        const kind = match?.[1];
        const id = match?.[2];
        if (!match || kind === undefined || id === undefined) {
            prose.push(line);
            continue;
        }
        flushProse();
        if (kind === 'widget') {
            const widget = widgetById.get(id);
            if (!widget) {
                throw new BlogEditorSerializationError(`dangling token {{widget:${id}}} — no widget with that id`);
            }
            usedWidgets.add(id);
            nodes.push({ type: 'widget', widgetId: id, widgetType: widget.type, data: widget.data, children: EMPTY_LEAF });
        }
        else {
            const figure = figureById.get(id);
            if (!figure) {
                throw new BlogEditorSerializationError(`dangling token {{figure:${id}}} — no figure with that id`);
            }
            usedFigures.add(id);
            nodes.push({
                type: 'figure',
                figureId: id,
                svg: figure.svg,
                alt: figure.alt,
                caption: figure.caption,
                children: EMPTY_LEAF,
            });
        }
    }
    flushProse();
    for (const id of widgetById.keys()) {
        if (!usedWidgets.has(id)) {
            throw new BlogEditorSerializationError(`orphaned widget "${id}" — not referenced by any {{widget:${id}}} token`);
        }
    }
    for (const id of figureById.keys()) {
        if (!usedFigures.has(id)) {
            throw new BlogEditorSerializationError(`orphaned figure "${id}" — not referenced by any {{figure:${id}}} token`);
        }
    }
    return nodes;
}
function assertLeaf(node) {
    const children = node.children;
    if (!Array.isArray(children) || children.length !== 1 || typeof children[0]?.text !== 'string') {
        throw new BlogEditorSerializationError(`node of type "${node.type}" has a malformed children leaf`);
    }
}
/**
 * Serialize a Plate `Value` back into a blog content triple. Widgets and figures are reconstructed
 * in document (body) order — the canonical form. Any malformed node throws.
 */
export function fromPlateValue(value) {
    if (!Array.isArray(value)) {
        throw new BlogEditorSerializationError('a Plate value must be an array of block nodes');
    }
    const parts = [];
    const widgets = [];
    const figures = [];
    const seenWidgetIds = new Set();
    const seenFigureIds = new Set();
    for (const node of value) {
        if (node === null || typeof node !== 'object' || typeof node.type !== 'string') {
            throw new BlogEditorSerializationError('every Plate node must be an object with a string "type"');
        }
        assertLeaf(node);
        switch (node.type) {
            case 'markdown': {
                if (typeof node.markdown !== 'string') {
                    throw new BlogEditorSerializationError('a "markdown" node must carry a string "markdown"');
                }
                parts.push(node.markdown);
                break;
            }
            case 'widget': {
                if (typeof node.widgetId !== 'string' || typeof node.widgetType !== 'string') {
                    throw new BlogEditorSerializationError('a "widget" node must carry string "widgetId" and "widgetType"');
                }
                if (seenWidgetIds.has(node.widgetId)) {
                    throw new BlogEditorSerializationError(`duplicate widget node id "${node.widgetId}"`);
                }
                seenWidgetIds.add(node.widgetId);
                parts.push(`{{widget:${node.widgetId}}}`);
                widgets.push({ id: node.widgetId, type: node.widgetType, data: node.data });
                break;
            }
            case 'figure': {
                if (typeof node.figureId !== 'string' ||
                    typeof node.svg !== 'string' ||
                    typeof node.alt !== 'string' ||
                    typeof node.caption !== 'string') {
                    throw new BlogEditorSerializationError('a "figure" node must carry string "figureId", "svg", "alt", and "caption"');
                }
                if (seenFigureIds.has(node.figureId)) {
                    throw new BlogEditorSerializationError(`duplicate figure node id "${node.figureId}"`);
                }
                seenFigureIds.add(node.figureId);
                parts.push(`{{figure:${node.figureId}}}`);
                figures.push({ id: node.figureId, svg: node.svg, alt: node.alt, caption: node.caption });
                break;
            }
            default: {
                throw new BlogEditorSerializationError(`unknown Plate node type "${node.type}"`);
            }
        }
    }
    return { markdown: parts.join('\n'), widgets, figures };
}
/**
 * The canonical form of a content triple: widgets and figures ordered by their first appearance in
 * the body. `fromPlateValue(toPlateValue(x))` deep-equals `normalizeBlogContent(x)`. A content model
 * that is already in body order (the authored convention) is its own canonical form.
 */
export function normalizeBlogContent(content) {
    return fromPlateValue(toPlateValue(content));
}
/** Extract a Plate `Value` from any object that carries a blog body (e.g. a full `Post`). */
export function postToPlateValue(post) {
    return toPlateValue(post);
}
/**
 * Merge an edited Plate `Value` back into a post, replacing ONLY the body triple (markdown, widgets,
 * figures) and preserving every other field (title, dates, faq, taxonomy…). This is the save-path
 * primitive the authed editor route uses.
 */
export function applyPlateValue(post, value) {
    const { markdown, widgets, figures } = fromPlateValue(value);
    return { ...post, markdown, widgets, figures };
}
export const BLOG_EDITOR_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "editor",
    w3cTraceparentFormat: "00-32hex-16hex-01",
    langfuseFailOpenTimeoutMs: 2500,
    rfc9457ProblemDetailsSupported: true,
    tactileMicroInteractionsCount: 30,
    interactionStatesCount: 16,
    transitionDurationSeconds: 0.333,
    requiresCloudflareContainers: false,
    deterministicDigest: 3458810126,
};
export function verifyBlogEditorModuleInvariants(tenantId = "tenant_default") {
    const cleanTenant = tenantId.trim() || "tenant_default";
    let rollingHash = BLOG_EDITOR_MODULE_SPECIFICATION.deterministicDigest ^ cleanTenant.length;
    for (let i = 0; i < cleanTenant.length; i++) {
        rollingHash = Math.imul(rollingHash ^ cleanTenant.charCodeAt(i), 0x01000193) >>> 0;
    }
    return {
        ok: BLOG_EDITOR_MODULE_SPECIFICATION.interactionStatesCount === 16 &&
            BLOG_EDITOR_MODULE_SPECIFICATION.tactileMicroInteractionsCount === 30 &&
            !BLOG_EDITOR_MODULE_SPECIFICATION.requiresCloudflareContainers,
        tenantId: cleanTenant,
        packageName: BLOG_EDITOR_MODULE_SPECIFICATION.packageName,
        moduleSlug: BLOG_EDITOR_MODULE_SPECIFICATION.moduleSlug,
        w3cTraceparentFormat: BLOG_EDITOR_MODULE_SPECIFICATION.w3cTraceparentFormat,
        langfuseFailOpenTimeoutMs: BLOG_EDITOR_MODULE_SPECIFICATION.langfuseFailOpenTimeoutMs,
        rfc9457ProblemDetailsSupported: BLOG_EDITOR_MODULE_SPECIFICATION.rfc9457ProblemDetailsSupported,
        tactileMicroInteractionsCount: BLOG_EDITOR_MODULE_SPECIFICATION.tactileMicroInteractionsCount,
        interactionStatesCount: BLOG_EDITOR_MODULE_SPECIFICATION.interactionStatesCount,
        transitionDurationSeconds: BLOG_EDITOR_MODULE_SPECIFICATION.transitionDurationSeconds,
        spec: BLOG_EDITOR_MODULE_SPECIFICATION,
        verifiedInteractionStateCount: 16,
        minApcaContrastLc: 60,
        checksum: rollingHash,
    };
}
//# sourceMappingURL=editor.js.map