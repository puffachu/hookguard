import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts', 'examples/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/core/src/benchmark.ts',
        'packages/core/src/historical-replay.ts',
        'packages/api/src/main.ts',
        'packages/cli/src/index.ts',
      ],
    },
    hookTimeout: 60000,
  },
  plugins: [tsconfigPaths()],
});
