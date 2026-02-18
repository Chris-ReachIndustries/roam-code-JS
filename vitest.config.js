import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    pool: 'forks', // Required for native addons (better-sqlite3, tree-sitter)
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/cli.js', 'src/index.js'],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
  },
});
