import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only — transform fixtures live under tests/ and run via `jssg test`.
    include: ['scripts/**/*.test.ts']
  }
});
