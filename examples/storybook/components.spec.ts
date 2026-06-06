import { storybookTest as test, expect, runPlayFunction } from '@playwright/storybook';

test('Storybook component interactions', async ({ mountStory, page }) => {
  // 1. Mount the component story inside the test iframe
  // The story id is usually lowercase and separated by dashes: component-name--story-name
  await mountStory('components-button--primary');

  // 2. You can interact with the rendered component normally via Playwright locators
  const button = page.locator('button');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Button');
  await button.click();

  // 3. Optional: Trigger the Storybook native `play` function if it exists
  // Useful to reuse interactions written directly in your *.stories.ts files!
  await runPlayFunction(page);
});
