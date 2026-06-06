import { test } from '@playwright/test';
import { Actor } from '../../core/Actor';
import { BrowseWeb } from '../abilities/BrowseWeb';
import { MeasurePerformance } from '../tasks/MeasurePerformance';

test('Web Screenplay: Performance Audit', async ({ page }) => {
  const bob = Actor.named('Bob').whoCan('BrowseWeb', BrowseWeb.using(page));

  await test.step('Bob audits performance of Playwright website', async () => {
    await bob.attemptsTo(
      MeasurePerformance.ofUrl('https://playwright.dev', 90)
    );
  });
});
