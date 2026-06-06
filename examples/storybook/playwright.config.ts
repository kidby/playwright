import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  use: {
    // The baseURL MUST point to your running Storybook dev server
    baseURL: 'http://localhost:6006',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
