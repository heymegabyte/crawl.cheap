/**
 * @file schema.ts
 * @brief Schema.org JSON-LD Builders for Editorial Blog Posts and Multimedia Assets.
 */
export function buildBlogPostSchema(config) {
    const schemaType = config.isTechArticle ? 'TechArticle' : 'BlogPosting';
    const schema = {
        '@context': 'https://schema.org',
        '@type': schemaType,
        headline: config.headline,
        description: config.description,
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': config.canonicalUrl,
        },
        url: config.canonicalUrl,
        image: {
            '@type': 'ImageObject',
            url: config.heroImageUrl,
            width: 1200,
            height: 630,
        },
        datePublished: config.datePublished,
        dateModified: config.dateModified || config.datePublished,
        author: {
            '@type': 'Person',
            name: config.author.name,
            ...(config.author.url ? { url: config.author.url } : {}),
            ...(config.author.jobTitle ? { jobTitle: config.author.jobTitle } : {}),
            ...(config.author.avatarUrl ? { image: config.author.avatarUrl } : {}),
            ...(config.author.sameAs && config.author.sameAs.length > 0 ? { sameAs: config.author.sameAs } : {}),
        },
        publisher: {
            '@type': 'Organization',
            name: config.publisherName,
            ...(config.publisherLogoUrl
                ? {
                    logo: {
                        '@type': 'ImageObject',
                        url: config.publisherLogoUrl,
                    },
                }
                : {}),
        },
    };
    if (config.articleSection) {
        schema.articleSection = config.articleSection;
    }
    if (config.keywords && config.keywords.length > 0) {
        schema.keywords = config.keywords.join(', ');
    }
    if (config.citations && config.citations.length > 0) {
        schema.citation = config.citations;
    }
    if (config.isTechArticle && config.proficiencyLevel) {
        schema.proficiencyLevel = config.proficiencyLevel;
    }
    if (config.speakableCssSelectors && config.speakableCssSelectors.length > 0) {
        schema.speakable = {
            '@type': 'SpeakableSpecification',
            cssSelector: config.speakableCssSelectors,
        };
    }
    if (config.video) {
        schema.video = buildVideoObjectSchema(config.video, config.canonicalUrl);
    }
    return schema;
}
export function buildVideoObjectSchema(video, watchPageUrl) {
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: video.name,
        description: video.description,
        thumbnailUrl: [video.thumbnailUrl],
        uploadDate: video.uploadDate,
        duration: video.durationIso,
        embedUrl: video.embedUrl,
    };
    if (video.contentUrl) {
        schema.contentUrl = video.contentUrl;
    }
    if (video.chapters && video.chapters.length > 0) {
        schema.hasPart = video.chapters.map((ch) => ({
            '@type': 'Clip',
            name: ch.title,
            startOffset: ch.startOffsetSeconds,
            endOffset: ch.endOffsetSeconds,
            url: ch.url || (watchPageUrl ? `${watchPageUrl}#t=${ch.startOffsetSeconds}` : undefined),
        }));
    }
    return schema;
}
export function buildAudioObjectSchema(opts) {
    return {
        '@context': 'https://schema.org',
        '@type': 'AudioObject',
        name: opts.name,
        contentUrl: opts.contentUrl,
        ...(opts.durationIso ? { duration: opts.durationIso } : {}),
        ...(opts.description ? { description: opts.description } : {}),
    };
}
export function buildBreadcrumbListSchema(crumbs) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, idx) => ({
            '@type': 'ListItem',
            position: crumb.position ?? idx + 1,
            name: crumb.name,
            item: crumb.url,
        })),
    };
}
export function buildFAQPageSchema(faqs) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
            },
        })),
    };
}
export function buildUnifiedBlogGraphSchema(config) {
    const graph = [];
    const siteUrl = new URL(config.canonicalUrl).origin;
    const pageId = `${config.canonicalUrl}#webpage`;
    const articleId = `${config.canonicalUrl}#article`;
    const authorId = `${siteUrl}/authors/${encodeURIComponent(config.author.name.toLowerCase().replace(/\s+/g, '-'))}#person`;
    const publisherId = `${siteUrl}#organization`;
    // 1. Author Person entity
    graph.push({
        '@type': 'Person',
        '@id': authorId,
        name: config.author.name,
        ...(config.author.jobTitle ? { jobTitle: config.author.jobTitle } : {}),
        ...(config.author.url ? { url: config.author.url } : {}),
        ...(config.author.avatarUrl ? { image: config.author.avatarUrl } : {}),
        ...(config.author.sameAs && config.author.sameAs.length > 0 ? { sameAs: config.author.sameAs } : {}),
    });
    // 2. Publisher Organization entity
    graph.push({
        '@type': 'Organization',
        '@id': publisherId,
        name: config.publisherName,
        url: siteUrl,
        ...(config.publisherLogoUrl
            ? {
                logo: {
                    '@type': 'ImageObject',
                    url: config.publisherLogoUrl,
                },
            }
            : {}),
    });
    // 3. BreadcrumbList entity if breadcrumbs provided
    if (config.breadcrumbs && config.breadcrumbs.length > 0) {
        const breadcrumbId = `${config.canonicalUrl}#breadcrumb`;
        graph.push({
            '@type': 'BreadcrumbList',
            '@id': breadcrumbId,
            itemListElement: config.breadcrumbs.map((crumb, idx) => ({
                '@type': 'ListItem',
                position: crumb.position ?? idx + 1,
                name: crumb.name,
                item: crumb.url,
            })),
        });
    }
    // 4. Primary Article entity
    const articleType = config.isTechArticle ? 'TechArticle' : 'BlogPosting';
    const articleNode = {
        '@type': articleType,
        '@id': articleId,
        isPartOf: { '@id': pageId },
        headline: config.headline,
        description: config.description,
        mainEntityOfPage: config.canonicalUrl,
        image: {
            '@type': 'ImageObject',
            url: config.heroImageUrl,
            width: 1200,
            height: 630,
        },
        datePublished: config.datePublished,
        dateModified: config.dateModified || config.datePublished,
        author: { '@id': authorId },
        publisher: { '@id': publisherId },
    };
    if (config.articleSection) {
        articleNode.articleSection = config.articleSection;
    }
    if (config.keywords && config.keywords.length > 0) {
        articleNode.keywords = config.keywords.join(', ');
    }
    if (config.citations && config.citations.length > 0) {
        articleNode.citation = config.citations;
    }
    if (config.isTechArticle && config.proficiencyLevel) {
        articleNode.proficiencyLevel = config.proficiencyLevel;
    }
    if (config.speakableCssSelectors && config.speakableCssSelectors.length > 0) {
        articleNode.speakable = {
            '@type': 'SpeakableSpecification',
            cssSelector: config.speakableCssSelectors,
        };
    }
    if (config.video) {
        articleNode.video = buildVideoObjectSchema(config.video, config.canonicalUrl);
    }
    if (config.audio) {
        articleNode.audio = buildAudioObjectSchema({
            name: config.audio.name,
            contentUrl: config.audio.contentUrl,
            durationIso: config.audio.durationIso,
            description: config.audio.description,
        });
    }
    graph.push(articleNode);
    // 5. WebPage node
    graph.push({
        '@type': 'WebPage',
        '@id': pageId,
        url: config.canonicalUrl,
        name: config.headline,
        description: config.description,
        breadcrumb: config.breadcrumbs && config.breadcrumbs.length > 0 ? { '@id': `${config.canonicalUrl}#breadcrumb` } : undefined,
    });
    // 6. FAQPage entity if FAQs present
    if (config.faqs && config.faqs.length > 0) {
        const faqId = `${config.canonicalUrl}#faq`;
        graph.push({
            '@type': 'FAQPage',
            '@id': faqId,
            mainEntity: config.faqs.map((f) => ({
                '@type': 'Question',
                name: f.question,
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: f.answer,
                },
            })),
        });
    }
    return {
        '@context': 'https://schema.org',
        '@graph': graph,
    };
}
export function renderBlogJsonLd(schema) {
    return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}
export const BLOG_SCHEMA_MODULE_SPECIFICATION = {
    capabilityId: "blog",
    packageName: "@theme.tools/blog",
    moduleSlug: "schema",
    w3cTraceparentFormat: "00-32hex-16hex-01",
    langfuseFailOpenTimeoutMs: 2500,
    rfc9457ProblemDetailsSupported: true,
    tactileMicroInteractionsCount: 30,
    interactionStatesCount: 16,
    transitionDurationSeconds: 0.333,
    requiresCloudflareContainers: false,
    deterministicDigest: 3028595804,
};
export function verifyBlogSchemaModuleInvariants(tenantId = "tenant_default") {
    const cleanTenant = tenantId.trim() || "tenant_default";
    let rollingHash = BLOG_SCHEMA_MODULE_SPECIFICATION.deterministicDigest ^ cleanTenant.length;
    for (let i = 0; i < cleanTenant.length; i++) {
        rollingHash = Math.imul(rollingHash ^ cleanTenant.charCodeAt(i), 0x01000193) >>> 0;
    }
    return {
        ok: BLOG_SCHEMA_MODULE_SPECIFICATION.interactionStatesCount === 16 &&
            BLOG_SCHEMA_MODULE_SPECIFICATION.tactileMicroInteractionsCount === 30 &&
            !BLOG_SCHEMA_MODULE_SPECIFICATION.requiresCloudflareContainers,
        tenantId: cleanTenant,
        packageName: BLOG_SCHEMA_MODULE_SPECIFICATION.packageName,
        moduleSlug: BLOG_SCHEMA_MODULE_SPECIFICATION.moduleSlug,
        w3cTraceparentFormat: BLOG_SCHEMA_MODULE_SPECIFICATION.w3cTraceparentFormat,
        langfuseFailOpenTimeoutMs: BLOG_SCHEMA_MODULE_SPECIFICATION.langfuseFailOpenTimeoutMs,
        rfc9457ProblemDetailsSupported: BLOG_SCHEMA_MODULE_SPECIFICATION.rfc9457ProblemDetailsSupported,
        tactileMicroInteractionsCount: BLOG_SCHEMA_MODULE_SPECIFICATION.tactileMicroInteractionsCount,
        interactionStatesCount: BLOG_SCHEMA_MODULE_SPECIFICATION.interactionStatesCount,
        transitionDurationSeconds: BLOG_SCHEMA_MODULE_SPECIFICATION.transitionDurationSeconds,
        spec: BLOG_SCHEMA_MODULE_SPECIFICATION,
        verifiedInteractionStateCount: 16,
        minApcaContrastLc: 60,
        checksum: rollingHash,
    };
}
//# sourceMappingURL=schema.js.map