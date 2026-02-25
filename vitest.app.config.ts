import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.app.test.ts'],
    testTimeout: 300_000,  // 5 minutes — behaviors need time to run
    hookTimeout: 60_000,
    reporters: ['verbose'],
    pool: 'forks',         // single-process execution required for debugger attach
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
