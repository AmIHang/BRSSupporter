import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    // Test against core sources, no build step needed.
    alias: {
      '@brssupporter/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'daemon',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
