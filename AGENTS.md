# AGENTS.md — crawl.cheap

This repository (`crawl.cheap` · `https://crawl.cheap`) is part of the Sovereign 55-Repository Emdash & Paperclip (`swarml.ink`) Engineering Fleet.

## 1. Stack & `@theme.tools/*` Thin-Shell Architecture

- **Runtime & Edge**: Cloudflare Workers + Hono + D1/Neon + Drizzle ORM + Better Auth + Stripe + VoiceKit (`$17,000` Startup Credits Grant).
- **Frontend**: React 19 + Vite + shadcn/ui (sites) / Angular 22 + Spartan UI (apps), Dark-First `#060610` background & `#00E5FF` accent, `0.333s` OKLCH transitions across all 16 interaction states, APCA `Lc >= 60`.
- **Canonical Shared Libraries (`@theme.tools/*` 28 Default Packages)**: Extract all reusable UI components, calculators, workflows, auth, billing, CRM, media/video, SEO/GEO, and telemetry logic into `heymegabyte/theme.tools`. Keep this repository a clean thin-shell composition layer.

## 2. 4-Harness + Local Fallback Routing (`cr`) & OpenSpec Governance

- **Frontier Architect Only for OpenSpec (`claude-1/2/3` / `codex` / `gemini` — NEVER `opencode`)**: Author and update `openspec/project.md` and `openspec/changes/<change-id>/` before material behavior, UI, or schema changes.
- **DeepSeek Off-Peak (`16:30–00:30 UTC`) & Local GPU Ollama Offload**: Offload mechanical, batch, and throughput-safe tasks onto `deepseek-v4-pro`, `deepseek-flash`, and local `ollama` (`hybrid-coder`) via Claw Router (`cr`) and LiteLLM Gateway (`https://llm.megabyte.space`).

## 3. VoiceKit (`$17,000` Credits Tier — Replaces ElevenLabs Everywhere)

- Use **VoiceKit** (`voicekit-mcp`, `@theme.tools/media-video` `buildVoiceKitTtsRequest` / `buildVoiceKitPodcastStudioRequest`, `VOICEKIT_API_KEY`, `VOICEKIT_AGENT_ID`) for all real-time voice agents, two-host podcast conversations (`voicekit-sage` + `voicekit-river`), and TTS narration, backed by `@cf/myshell-ai/melotts` on Cloudflare Workers AI and local Piper ONNX fallback. Never introduce new ElevenLabs dependencies.

## 4. Cloudflare 13-Dimension Free-Tier Edge Security & Sovereign 8-Pillar Telemetry

- **Edge Security**: Protected by 5 Free WAF Custom Rules, 1 Auth Rate Limit Rule, 4 Edge Security Headers, 2 Edge Cache Rules, Zstd+Brotli+Gzip Compression Rule, API-Safe Email-Obfuscation-Bypass Config Rule, Smart Tiered Cache, Bot Fight Mode + AI Scraper Block, Leaked Credential Checks, Page Shield, DNSSEC, RFC-3986 URL Normalization (`scope: "both"`), and 25 Zone Settings (including 1-year HSTS Preload, Post-Quantum ML-KEM `pq_keyex`, ECH, and Speed Brain).
- **8-Pillar Telemetry**: PostHog 4-Event AI Tree, Sentry Envelope v7, GA4 Measurement Protocol, GTM Consent Mode v2 default-deny (`gcs=G100`), Langfuse Cloud v4 OTLP (`2500ms` `AbortSignal.timeout(2500)` fail-open + 3-strike circuit breaker), Cloudflare First-Party RUM Proxy, W3C `traceparent`, and Promptfoo 25/25 Synthetic Evals.
