# `@playwright/storybook`

Playwright-runner-native Storybook integration. Discovers stories from a running Storybook's `index.json`, renders each via the live preview iframe, and exposes a `storybookTest` fixture that composes with [`@playwright/lighthouse`](../playwright-lighthouse) for per-story perf budgets, axe-core for a11y, and Playwright's `toHaveScreenshot()` for visual baselines.

Framework-agnostic from day 1 — works with React, Vue, Svelte, Web Components, anything Storybook supports.

## Install

```bash
npm i -D @playwright/storybook
```

Peer deps: `@playwright/test`, `storybook >= 8.1`. Optional: `axe-core` (only if you use the a11y helper).

## Quick start

```ts
// stories.spec.ts
import { storybookTest as test, expect, fetchStoryIndex, filterStories } from '@playwright/storybook';

const index = await fetchStoryIndex('http://localhost:6006');
const stories = filterStories(index, { include: ['Button/*'] });

for (const story of stories) {
  test(`renders ${story.title} / ${story.name}`, async ({ mountStory, page }) => {
    await mountStory(story.id);
    await expect(page.locator('#storybook-root, #root')).toBeVisible();
  });
}
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: { baseURL: 'http://localhost:6006' },
  webServer: {
    command: 'npm run storybook -- --ci',
    url: 'http://localhost:6006',
    reuseExistingServer: true,
  },
});
```

## Compose with Lighthouse

```ts
import { storybookTest } from '@playwright/storybook';
import { lighthouseTest } from '@playwright/lighthouse';

const test = storybookTest.extend(lighthouseTest.fixtures);

test('Button/Primary perf budget', async ({ page, mountStory, lighthouse }) => {
  await mountStory('button--primary');
  const audit = await lighthouse({ thresholds: { performance: 0.9 } });
  expect(audit.lhr.categories.performance.score).toBeGreaterThanOrEqual(0.9);
});
```

## Replay Storybook `play` functions

```ts
import { runPlayFunction } from '@playwright/storybook';

test('Form/Login play function fills + submits', async ({ page, mountStory }) => {
  await mountStory('form-login--default');
  await runPlayFunction(page, 'form-login--default');
  await expect(page.getByText('Welcome')).toBeVisible();
});
```

`runPlayFunction` invokes Storybook's runtime API (`__STORYBOOK_PREVIEW__.storyStoreValue`) so the play function runs in the same browser context as your Playwright `page` — clicks, screenshots, network mocks all available.

## Notes

- **`.mdx` stories are skipped** by `filterStories` (entry type `'docs'`, not `'story'`).
- **Iframe rendering, not portable-stories**: deliberately uses Storybook's live preview iframe rather than `composeStories()`. This gives a real browser process per story (so Lighthouse and CDP work) and stays framework-agnostic.
- **`webServer` config owns the dev server**: this package doesn't spawn Storybook for you. Use Playwright's standard `webServer` config (same pattern as any other dev-server-backed test setup).
