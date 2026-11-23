# Shared telemetry adoption

## ADDED Requirements

### Requirement: Canonical reusable telemetry

Crawl.cheap SHALL consume reusable telemetry behavior from `@theme.tools/telemetry` and SHALL NOT maintain a local provider-delivery implementation.

#### Scenario: Existing engine callers

- **WHEN** an existing caller imports the engine telemetry API
- **THEN** compatible trace, redaction, routing, and fail-open operations are provided by the canonical package

### Requirement: Product configuration boundary

The crawl-specific catalog manifest SHALL remain product configuration and SHALL NOT be treated as reusable telemetry behavior.

#### Scenario: Catalog inspection

- **WHEN** the crawl catalog endpoint is inspected
- **THEN** its product metadata is served from crawl-owned configuration while telemetry operations remain canonical
