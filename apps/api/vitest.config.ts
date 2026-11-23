import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': resolve(__dirname, 'test/mocks/cloudflare-workers.ts'),
    },
  },
  test: {
    testTimeout: 30000,
  },
});
