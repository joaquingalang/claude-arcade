import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

const here = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      // Test against source, so tests don't depend on build order.
      '@claude-arcade/shared': path.resolve(here, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
