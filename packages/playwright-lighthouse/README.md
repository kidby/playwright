# @playwright/lighthouse

Run [Lighthouse](https://github.com/GoogleChrome/lighthouse) audits directly from Playwright tests. The fixture launches Chromium with a CDP port and hands Lighthouse the same page your test was driving — your `page.goto(...)`, cookies, and storage are visible to the audit.

## Install

```bash
npm i -D @playwright/lighthouse lighthouse
```

`lighthouse` is a peer dependency so you can pin the version that matches your test infrastructure.

## Fixture style (recommended)

```ts
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

The `lighthouse` fixture launches a persistent Chromium context with `--remote-debugging-port=<free port>` per worker, and attaches that port to the `page` fixture transparently.

## Free-function style

If you need to manage your own context:

```ts
import { audit } from '@playwright/lighthouse';

const result = await audit(page, {
  port: cdpPort,
  thresholds: { performance: 90 },
});
```

You're responsible for launching the page's Chromium with `--remote-debugging-port=<cdpPort>` and passing the same port.

## API

### `lighthouse(options)` / `audit(page, options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `url` | `string` | `page.url()` | URL to audit. |
| `port` | `number` | from fixture | CDP port. Required for free-function style; auto-wired by the fixture. |
| `thresholds` | `{ performance?, accessibility?, 'best-practices'?, seo?, pwa? }` | `100` per category | Minimum scores (0–100). |
| `saveReport` | `'html' \| 'json' \| 'csv' \| Array` | — | Write report(s) to disk. |
| `outputDir` | `string` | `<cwd>/lighthouse` | Where to write saved reports. |
| `reportName` | `string` | `lighthouse-<timestamp>` | Base name for saved reports. |
| `throwOnFail` | `boolean` | `false` | Throw instead of returning `passed: false`. |
| `flags` | `LH.Flags` | — | Lighthouse runner flags. `port` is always overridden. |
| `config` | `LH.Config` | — | Custom Lighthouse config. |

Returns:

```ts
{
  passed: boolean;                 // every threshold met
  scores: { performance: 92, ... }; // 0–100 per category
  failures: string[];               // per-category misses
  successes: string[];              // per-category passes
  reportPaths: string[];            // absolute paths of saved reports
  lhr: LH.Result;                   // full Lighthouse result
}
```

## Notes

- The fixture overrides Playwright's default `context` and `page` fixtures to launch with a CDP port. If you compose with other test bases, use `mergeTests(lighthouseTest, otherBase)` and remember the lighthouse `context`/`page` wins.
- The default thresholds are 100 for every category — pass explicit values for anything looser.
- `saveReport: 'html'` is enough for most workflows; pair with `expect(result.passed).toBe(true)` and the HTML report becomes a CI artifact you can open on failure.
