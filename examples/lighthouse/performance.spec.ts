import { test, expect } from '@playwright/test';
import { playAudit } from '@playwright/lighthouse';
import { playReport } from '@playwright/lighthouse/html-report';

test('Lighthouse performance audit', async ({ page }) => {
  // 1. Navigate to the page you want to test
  await page.goto('https://playwright.dev');

  // 2. Run the audit against the page with expected thresholds
  const report = await playAudit({
    page,
    thresholds: {
      performance: 90,
      accessibility: 90,
      'best-practices': 90,
      seo: 90,
    },
    port: 9222, // This must match the remote-debugging-port in launchOptions
  });

  // 3. (Optional) Save a detailed HTML report locally
  await playReport(report, 'lighthouse-report.html');
});
