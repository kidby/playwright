---
id: test-lighthouse
title: "Lighthouse audits (experimental)"
---

## Introduction

[`@playwright/lighthouse`](https://github.com/microsoft/playwright/tree/main/packages/playwright-lighthouse) runs [Lighthouse](https://github.com/GoogleChrome/lighthouse) audits against the same Chromium tab your test is driving. The fixture handles the `--remote-debugging-port` plumbing — your existing `page.goto(...)`, cookies, and storage state carry over into the audit.

## Install

```bash
npm i -D @playwright/lighthouse lighthouse
```

`lighthouse` is a peer dependency so you can pin the version that matches your test infrastructure.

## Example

```js
import { lighthouseTest as test, expect } from '@playwright/lighthouse';

test('homepage meets perf budget', async ({ page, lighthouse }) => {
  await page.goto('https://example.com');

  const result = await lighthouse({
    thresholds: { performance: 90, accessibility: 95 },
    saveReport: 'html',
  });

  expect(result.passed, result.failures.join('\n')).toBe(true);
});
```

The `lighthouse` fixture launches a persistent Chromium context with `--remote-debugging-port=<free port>` per worker, attaches that port to the `page` fixture, and exposes a `lighthouse(options)` runner.

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `url` | `string` | `page.url()` | URL to audit. |
| `thresholds` | `{ performance?, accessibility?, 'best-practices'?, seo?, pwa? }` | `100` per category | Minimum scores (0–100). |
| `saveReport` | `'html' \| 'json' \| 'csv' \| Array` | — | Write report(s) to disk. |
| `outputDir` | `string` | `<cwd>/lighthouse` | Where saved reports go. |
| `reportName` | `string` | `lighthouse-<timestamp>` | Base name for saved reports. |
| `throwOnFail` | `boolean` | `false` | Throw instead of returning `passed: false`. |
| `flags` | `LH.Flags` | — | Passthrough to the Lighthouse runner. `port` is always overridden. |
| `config` | `LH.Config` | — | Custom Lighthouse config. |

## Result

```ts
{
  passed: boolean;                  // every threshold met
  scores: { performance: 92, ... }; // 0–100 per category
  failures: string[];               // per-category misses, e.g. 'performance: scored 84, expected >= 90'
  successes: string[];              // per-category passes
  reportPaths: string[];            // absolute paths of saved reports
  lhr: LH.Result;                   // full Lighthouse runner result
}
```

## Free-function style

If you need to manage your own Chromium context (e.g., to compose with another base test), use `audit(page, options)` and pass the CDP port yourself:

```js
import { audit, attachPort } from '@playwright/lighthouse';
import { chromium } from '@playwright/test';

const port = 50061;
const context = await chromium.launchPersistentContext('/tmp/pw', {
  args: [`--remote-debugging-port=${port}`],
});
const page = await context.newPage();
attachPort(page, port);

await page.goto('https://example.com');
const result = await audit(page, { thresholds: { performance: 90 } });
```

## Notes

* The default thresholds are 100 for every category — pass explicit numbers for anything looser.
* `saveReport: 'html'` is enough for most workflows; pair with `expect(result.passed).toBe(true)` and the HTML report becomes a CI artifact you can open on failure.
* The fixture overrides Playwright's default `context` and `page` fixtures to launch with a CDP port. If you compose with other test bases, use `mergeTests(lighthouseTest, otherBase)` and remember the lighthouse fixtures win.

See the [package README](https://github.com/microsoft/playwright/tree/main/packages/playwright-lighthouse#readme) for the full API reference.
