# Design

**Architect:** codex  
**Architect Role:** assigned

The engine preserves its public exports while delegating trace context, redaction, seven-rail routing, Langfuse delivery, and fail-open behavior to the standalone-safe `@theme.tools/telemetry/builders` subpath. The crawl catalog manifest moves to product-owned configuration. Server delivery remains excluded from browser bundles by explicit subpath usage.
