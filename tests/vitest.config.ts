import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.spec.ts',
      'tests/integration/**/*.spec.ts',
      'tests/snapshot/**/*.spec.ts',
      'tests/failure-injection/**/*.spec.ts',
    ],
  },
});
