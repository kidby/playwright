import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:0',
  },
});
