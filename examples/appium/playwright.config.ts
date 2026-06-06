import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './',
  use: {
    // Appium mobile configuration expects baseURL or other specific configs
    // depending on your test setup.
  },
  projects: [
    {
      name: 'Android',
      use: {
        // Here you would define your capabilities for Playwright mobile
        // but the actual connection happens via `appium` capabilities
      },
    },
  ],
});
