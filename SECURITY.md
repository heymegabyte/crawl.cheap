# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately — **do not** open a public issue.

- Preferred: open a [GitHub security advisory](https://github.com/heymegabyte/crawl.cheap/security/advisories/new).
- Or email **blzalewski@gmail.com** with details and reproduction steps.

We aim to acknowledge reports within 72 hours and to ship a fix or mitigation for
confirmed, in-scope issues promptly. Please allow reasonable time for remediation before
any public disclosure.

## Scope

In scope: the crawl.cheap API, MCP server, and engine (this repository), and the managed
edition at `*.crawl.cheap` / `*.manhattan.workers.dev`.

Out of scope: findings that require a compromised Cloudflare account or physical access;
denial-of-service via volumetric traffic; issues in third-party upstreams (Cloudflare,
search providers) rather than crawl.cheap itself.

## Good to know

- The engine is **SSRF-hardened** (private/reserved IPv4+IPv6, cloud-metadata endpoints, and
  non-`http(s)` schemes are blocked, and every redirect hop is re-validated).
- It respects `robots.txt` and Cloudflare Content Signals, and performs no CAPTCHA bypass,
  credential theft, private-network scanning, or paywall circumvention.
- Outbound webhooks are signed (HMAC-SHA256) and their targets are SSRF-guarded.
