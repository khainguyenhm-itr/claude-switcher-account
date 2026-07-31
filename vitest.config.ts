import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/bin.ts'],
      // Lines/statements/functions held at 90%. Branches at 75%: the remaining
      // uncovered branches are defensive catch blocks and real-system default
      // wiring (defaultConfirm, defaultExec, lock-steal) not worth contriving tests for.
      thresholds: { lines: 90, functions: 90, branches: 75, statements: 90 },
    },
  },
});
