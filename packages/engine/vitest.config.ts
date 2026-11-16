import { defineConfig } from 'vitest/config';

/**
 * Transport-boundary tests stub the global `fetch` (packages/engine/test/tls-options.test.ts).
 * In vitest's default `threads` pool that stub also replaces the worker's module-fetch RPC, so
 * collection times out ("Timeout calling fetch") instead of running the suite. The `forks`
 * pool isolates the stub in a child process and keeps the suite deterministic; no timeouts or
 * retries are relaxed.
 */
export default defineConfig({
  test: {
    pool: 'forks',
  },
});
