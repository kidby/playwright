---
id: test-cli
title: "Command line"
---

Playwright provides a powerful command line interface for running tests, generating code, debugging, and more. The most up to date list of commands and arguments available on the CLI can always be retrieved via `npx playwright --help`.

## Essential Commands

### Run Tests

Run your Playwright tests. [Read more about running tests](./running-tests.md).

#### Syntax

```bash
npx playwright test [options] [test-filter...]
```

#### Examples

```bash
# Run all tests
npx playwright test

# Run a single test file
npx playwright test tests/todo-page.spec.ts

# Run a set of test files
npx playwright test tests/todo-page/ tests/landing-page/

# Run tests at a specific line
npx playwright test my-spec.ts:42

# Run tests by title
npx playwright test -g "add a todo item"

# Run tests in headed browsers
npx playwright test --headed

# Run tests for a specific project
npx playwright test --project=chromium

# Get help
npx playwright test --help
```

**Disable [parallelization](./test-parallel.md)**

```bash
npx playwright test --workers=1
```

**Run in debug mode with [Playwright Inspector](./debug.md)**

```bash
npx playwright test --debug
```

**Run tests in interactive [UI mode](./test-ui-mode.md)**

```bash
npx playwright test --ui
```

#### Common Options

| Option | Description |
| :--- | :--- |
| `--debug` | Run tests with Playwright Inspector. Shortcut for `PWDEBUG=1` environment variable and `--timeout=0 --max-failures=1 --headed --workers=1` options. |
| `--headed` | Run tests in headed browsers (default: headless). |
| `-g <grep>` or `--grep <grep>` | Only run tests matching this regular expression (default: ".*"). |
| `--project <project-name...>` | Only run tests from the specified list of projects, supports '*' wildcard (default: run all projects). |
| `--ui` | Run tests in interactive UI mode. |
| `-j <workers>` or `--workers <workers>` | Number of concurrent workers or percentage of logical CPU cores, use 1 to run in a single worker (default: 50%). |

#### All Options

| Option | Description |
| :--- | :--- |
| Non-option arguments | Each argument is treated as a regular expression matched against the full test file path. Only tests from files matching the pattern will be executed. Special symbols like `$` or `*` should be escaped with `\`. In many shells/terminals you may need to quote the arguments. |
| `-c <file>` or `--config <file>` | Configuration file, or a test directory with optional "playwright.config.&#123;m,c&#125;?&#123;js,ts&#125;". Defaults to `playwright.config.ts` or `playwright.config.js` in the current directory. |
| `--debug` | Run tests with Playwright Inspector. Shortcut for `PWDEBUG=1` environment variable and `--timeout=0 --max-failures=1 --headed --workers=1` options. |
| `--fail-on-flaky-tests` | Fail if any test is flagged as flaky (default: false). |
| `--forbid-only` | Fail if `test.only` is called (default: false). Useful on CI. |
| `--fully-parallel` | Run all tests in parallel (default: false). |
| `--global-timeout <timeout>` | Maximum time this test suite can run in milliseconds (default: unlimited). |
| `-g <grep>` or `--grep <grep>` | Only run tests matching this regular expression (default: ".*"). |
| `-G <grep>` or `--grep-invert <grep>` | Only run tests that do not match this regular expression. |
| `--headed` | Run tests in headed browsers (default: headless). |
| `--ignore-snapshots` | Ignore screenshot and snapshot expectations. |
| `-j <workers>` or `--workers <workers>` | Number of concurrent workers or percentage of logical CPU cores, use 1 to run in a single worker (default: 50%). |
| `--last-failed` | Only re-run the failures. |
| `--last-failed-file <file>` | Override the default last-run JSON path for `--last-failed` (default: `<outputDir>/.last-run.json`). Same as `PLAYWRIGHT_LAST_RUN_OUTPUT_FILE` environment variable. |
| `--list` | Collect all the tests and report them, but do not run. |
| `--max-failures <N>` or `-x` | Stop after the first `N` failures. Passing `-x` stops after the first failure. |
| `--no-deps` | Do not run project dependencies. |
| `--output <dir>` | Folder for output artifacts (default: "test-results"). |
| `--only-changed [ref]` | Only run test files that have been changed between 'HEAD' and 'ref'. Defaults to running all uncommitted changes. Only supports Git. |
| `--pass-with-no-tests` | Makes test run succeed even if no tests were found. |
| `--project <project-name...>` | Only run tests from the specified list of projects, supports '*' wildcard (default: run all projects). |
| `--quiet` | Suppress stdio. |
| `--repeat-each <N>` | Run each test `N` times (default: 1). |
| `--reporter <reporter>` | Reporter to use, comma-separated, can be "dot", "line", "list", or others (default: "list"). You can also pass a path to a custom reporter file. |
| `--retries <retries>` | Maximum retry count for flaky tests, zero for no retries (default: no retries). |
| `--shard <shard>` | Shard tests and execute only the selected shard, specified in the form "current/all", 1-based, e.g., "3/5". |
| `--test-list <file>` | Path to a file containing a list of tests to run. See [test list](#test-list) for details. |
| `--test-list-invert <file>` | Path to a file containing a list of tests to skip. See [test list](#test-list) for details.  |
| `--timeout <timeout>` | Specify test timeout threshold in milliseconds, zero for unlimited (default: 30 seconds). |
| `--trace <mode>` | Force tracing mode, can be `on`, `off`, `on-first-retry`, `on-all-retries`, `retain-on-failure`, `retain-on-first-failure`, `retain-on-failure-and-retries`, `retain-all-failures`. |
| `--tsconfig <path>` | Path to a single tsconfig applicable to all imported files (default: look up tsconfig for each imported file separately). |
| `--ui` | Run tests in interactive UI mode. |
| `--ui-host <host>` | Host to serve UI on; specifying this option opens UI in a browser tab. |
| `--ui-port <port>` | Port to serve UI on, 0 for any free port; specifying this option opens UI in a browser tab. |
| `-u` or `--update-snapshots [mode]` | Update snapshots with actual results. Possible values are "all", "changed", "missing", and "none". Running tests without the flag defaults to "missing"; running tests with the flag but without a value defaults to "changed". |
| `--update-source-method [mode]` | Update snapshots with actual results. Possible values are "patch" (default), "3way" and "overwrite". "Patch" creates a unified diff file that can be used to update the source code later. "3way" generates merge conflict markers in source code. "Overwrite" overwrites the source code with the new snapshot values.|
| `-x` | Stop after the first failure. |

#### Test list

Options `--test-list` and `--test-list-invert` accept a path to a test list file. This file should list tests in the format similar to the output produced in `--list` mode.

```txt
# This is a test list file.
# It can include comments and empty lines.

# Run ALL tests in a file:
path/to/example.spec.ts

# Run all tests in a file for a specific project:
[chromium] › path/to/example.spec.ts

# Run all tests in a specific group/suite:
path/to/example.spec.ts › suite name

# Run all tests in a nested group:
path/to/example.spec.ts › outer suite › inner suite

# Fully qualified test with a project:
[chromium] › path/to/example.spec.ts:3:9 › suite › nested suite › example test

# This test is included for all projects:
path/to/example.spec.ts:3:9 › example test

# Use "›" or ">" as a separator:
[firefox] > example.spec.ts > suite > nested suite > example test

# Line/column numbers are completely ignored, you can omit them.
# Three entries below refer to the same test:
example.spec.ts › example test
example.spec.ts:15 › example test
example.spec.ts:42:42 › example test
```

### Show Report

Display HTML report from previous test run. [Read more about the HTML reporter](./test-reporters#html-reporter).

#### Syntax

```bash
npx playwright show-report [report] [options]
```

#### Examples

```bash
# Show latest test report
npx playwright show-report

# Show a specific report
npx playwright show-report playwright-report/

# Show report on custom port
npx playwright show-report --port 8080
```

#### Options

| Option | Description |
| :--- | :--- |
| `--host <host>` | Host to serve report on (default: localhost) |
| `--port <port>` | Port to serve report on (default: 9323) |

### Install Browsers

Install browsers required by Playwright. [Read more about Playwright's browser support](./browsers.md).

#### Syntax

```bash
npx playwright install [options] [browser...]
npx playwright install-deps [options] [browser...]
npx playwright uninstall
```

#### Examples

```bash
# Install all browsers
npx playwright install

# Install only Chromium
npx playwright install chromium

# Install specific browsers
npx playwright install chromium webkit

# Install browsers with dependencies
npx playwright install --with-deps
```

#### Install Options

| Option | Description |
| :--- | :--- |
| `--force` | Force reinstall of stable browser channels |
| `--with-deps` | Install browser system dependencies |
| `--dry-run` | Don't perform installation, just print information |
| `--only-shell` | Only install chromium-headless-shell instead of full Chromium |
| `--no-shell` | Don't install chromium-headless-shell |

#### Install Deps Options

| Option | Description |
| :--- | :--- |
| `--dry-run` | Don't modify the system. On Linux, simulates the install via apt-get and exits with a non-zero code if any required packages are missing — useful for non-interactive verification scripts. On Windows, prints the install command. |

## Generation & Debugging Tools

### Code Generation

Record actions and generate tests for multiple languages. [Read more about Codegen](./codegen-intro.md).

#### Syntax

```bash
npx playwright codegen [options] [url]
```

#### Examples

```bash
# Start recording with interactive UI
npx playwright codegen

# Record on specific site
npx playwright codegen https://playwright.dev

# Generate Python code
npx playwright codegen --target=python
```

#### Options

| Option | Description |
| :--- | :--- |
| `-b, --browser <name>` | Browser to use: chromium, firefox, or webkit (default: chromium) |
| `-o, --output <file>` | Output file for the generated script |
| `--target <language>` | Language to use: javascript, playwright-test, python, etc. |
| `--test-id-attribute <attr>` | Attribute to use for test IDs |

### Trace Viewer

Analyze and view test traces for debugging. [Read more about Trace Viewer](./trace-viewer.md).

#### Syntax

```bash
npx playwright show-trace [options] [trace]
```

#### Examples

```bash
# Open trace viewer without a specific trace (can load traces via UI)
npx playwright show-trace

# View a trace file
npx playwright show-trace trace.zip

# View trace from directory
npx playwright show-trace trace/
```

#### Options

| Option | Description |
| :--- | :--- |
| `-b, --browser <name>` | Browser to use: chromium, firefox, or webkit (default: chromium) |
| `-h, --host <host>` | Host to serve trace on |
| `-p, --port <port>` | Port to serve trace on |

## Running under Bun

Playwright's CLI auto-detects Bun. The single `playwright` bin works under either runtime — `node ./node_modules/playwright/cli.js test` and `bun ./node_modules/playwright/cli.js test` both run the suite. There is no separate Bun-only bin to install.

### Consumer setup

In a Bun-based project:

```bash
# Install Playwright via bun link, not bun add. Bun caches file: installs by
# path-spelling, which can produce two independent Playwright instances in
# node_modules (causing "Error: two different versions of @playwright/test").
# `bun link` registers a single canonical symlink and side-steps the cache.
bun link playwright @playwright/test playwright-core
```

```json title="package.json"
{
  "scripts": {
    "test": "bun ./node_modules/playwright/cli.js test"
  }
}
```

No `bunfig.toml` preload, no `--preload` flag, no separate bin.

### How the Bun shim works

`packages/playwright/lib/transform/bunRuntime.js` is required at the top of `cli.js`. Under Node it's a no-op (gated by `typeof Bun === 'undefined'`). Under Bun it registers a single `Bun.plugin` with two hooks:

1. **`onResolve`** intercepts `playwright/lib/*` and `playwright-core/lib/*` specifiers and forces them to the actual `lib/*.js` files in `node_modules`. Bun honors `tsconfig.json` `compilerOptions.paths` at runtime, and the workspace's tsconfig deliberately maps these paths to `src/*.ts` for TypeScript authoring convenience — without this onResolve override, Bun would load `src/bootstrap.ts` (a TS file the plugin marks as an async module via the onLoad hook) instead of `lib/bootstrap.js`, and `require()` of an async module fails. The hook routes Playwright's lib paths around tsconfig paths so the workspace stays Bun-runnable.
2. **`onLoad`** reads each `.ts` / `.tsx` source via `fs.readFileSync` (**synchronous** — making this async causes Bun to mark every plugin-processed file as an async module, which breaks all the CJS `require()` calls in the runner). Strips dangling `import type { … }` statements that Bun's CJS-require path occasionally leaks as runtime imports — producing confusing `SyntaxError: export 'X' not found` for type-only names like `Page`. Returns the source with the correct loader: `loader: 'tsx'` for `.tsx` files (handles JSX), `loader: 'ts'` otherwise.

`importUnderBun` in the same module uses `Bun.pathToFileURL` to construct the URL passed to dynamic `import()` — faster than `url.pathToFileURL` and removes the `url` module dep from the Bun-only path.

### Scope of Bun support

- ✅ TypeScript spec files including `import type` forms.
- ✅ JSX in `.tsx` files (loader picks `tsx`).
- ✅ Mixed CJS / ESM consumer setups.
- ✅ **The fork's own in-monorepo test suite** runs under Bun. The `onResolve` hook routes tsconfig path mappings around the source-vs-lib trap (54/54 upstream `loader.spec.ts` tests pass under Bun).
- ❌ Playwright's custom Babel plugins (fixture-lift preprocessing, CSS-to-identity-obj-proxy, component-test JSX). Bun's native TS transpiler handles typical TS+JSX, but component-testing users who depend on Playwright's Babel plugins should keep running under Node.

### Bun-flavored npm scripts

The repo ships dual-runtime variants for the two most-used test scripts:

| Node script | Bun script | Purpose |
|---|---|---|
| `npm run ttest <grep>` | `npm run ttest:bun <grep>` | Playwright-test runner tests under the Bun runtime. Outer process is Bun; child processes spawned by `runInlineTest` inherit Bun via `process.execPath`. |
| `npm run ctest <grep>` | `npm run ctest:bun <grep>` | Chromium-only library/page tests under Bun. Browser launch dominates wall-clock, so the runtime delta is small here — use the Bun variant mainly for compatibility verification, not speed. |

Under both `:bun` scripts, all spawned children (workers, inline-test sub-runners, fixtures) inherit the Bun runtime automatically via `child_process.fork`'s `process.execPath` inheritance — no separate flag needed.

### Known Bun-only test gaps

- **`expect-to-have-response-property.spec.ts`** is `test.skip`-gated under Bun. The shared `server` fixture (Node `http.createServer`) is not reachable from inline-test child processes when the parent runs under Bun — child gets `ECONNREFUSED` whether targeting `localhost` or `127.0.0.1`. Likely a binding-or-readiness mismatch between Bun's `http` polyfill and the fixture's lifecycle. Spec passes 1/1 under Node.

### Performance

Micro-benchmark of the specific Node→Bun swaps the fork makes, 1000 iterations on a ~4 KB TypeScript file:

| Operation | Node (ms total) | Bun (ms total) | Speedup |
|---|---|---|---|
| `fs.readFileSync` ↔ `Bun.file().text()` | 53.9 | 43.1 | 1.25× |
| `fs.writeFileSync` ↔ `Bun.write()` | 98.1 | 70.6 | 1.39× |
| `url.pathToFileURL` ↔ `Bun.pathToFileURL` | 3.1 | 0.9 | 3.60× |

Run via `node utils/bench-bun.mjs` (requires Bun on PATH). Set `BENCH_ITERATIONS=5000 BENCH_FILE_KB=64` for larger samples.

Real-world: against one-automation's `@unit` suite (4 tests in `tests/platform/config/`):

| Runtime | Wall-clock | Pass count |
|---|---|---|
| Node | 6.80s | 4/4 |
| Bun | 3.38s | 4/4 |

Bun is ~2× faster for the runner cold-start + transpile path. Identical pass/fail outcomes.

The fork's own in-tree suites under both runtimes:

| Suite | Tests | Node | Bun |
|---|---|---|---|
| `bun-runtime` | 13 (12 active under Bun; 1 inverted by design) | 13/13 — 0.8s | 12/13 — 0.8s |
| `reporter-ai` | 5 | 5/5 — 6.7s | 5/5 — 4.6s |
| 9 fork reporters (ai/catalog/csv/jira/new-relic/slack/xray/intellum-social/ci-adapter) | 25 | 25/25 — ~13s | 25/25 — 5.5s |
| Upstream `loader.spec.ts` | 54 | 54/54 — 41.9s | 54/54 — 42.7s |

The runner under Bun runs Playwright's most loader-heavy upstream spec (54 tests of the runner's own ESM/CJS loader plumbing) at parity wall-clock with Node, and fork-added reporters at ~2× faster.

### Bun API audit

For each Bun-native API evaluated against the fork's code, here's why it was either used or skipped:

| Bun feature | Verdict | Reason |
|---|---|---|
| `Bun.pathToFileURL` | ✅ Used | Drop-in for `url.pathToFileURL` in `bunRuntime.ts`'s Bun-only `importUnderBun()`. 3.6× faster. |
| `Bun.write` | ✅ Used | Conditional helper in `runtimeIO.ts` used by `ai.ts` + `csv.ts` reporter file writes. 1.4× faster. |
| `Bun.file().text()` | ❌ Reverted | Making the plugin onLoad async causes Bun to mark every plugin-processed file as an async module, which breaks `require()` on the runner. Sync `fs.readFileSync` is correct. |
| `Bun.fetch` | ✅ Free | All reporter outbound HTTP and the mobile package's Appium client already use the Web-standard `fetch()`. Bun replaces it natively at runtime — zero code change. |
| `Bun.serve` | ⏭ Skip | Test fixtures use `http.createServer` which runs in <2ms; no measurable win. Would force dual-implementation since unit tests run under Node. |
| `bun:sqlite` | ⏭ Skip | No current hot path. Could power a future failure-history index in the AI reporter — that's a feature add, not a Bun improvement. |
| `Bun.WebView` | ⏭ Skip | Bun.WebView is itself a Playwright-style browser automator. Heavy overlap with Playwright. Replacing Playwright's CDP transport with Bun.WebView is core-scale upstream work with massive rebase risk. |
| Bun `Worker` | ⏭ Skip | Playwright's runner already uses `child_process.fork`. Replacing it = upstream core rewrite. Fork-added code has no parallelism-bound hot paths large enough to justify worker overhead. |
| `Bun.semver` | ⏭ Skip | No version-comparison code in fork-added paths. |
| `Bun.Glob` | ⏭ Skip | No file-scan code in fork-added paths. |
| `Bun.hash` / `Bun.CryptoHasher` | ⏭ Skip | Only crypto usage in fork-touched code is `crypto.randomBytes` in upstream `mcp/test/browserBackend.ts` (not fork-added). |
| `Bun.Image` | ⏭ Skip | The mobile package's `device.screenshot()` passes PNG bytes through unmodified. No transformations in the pipeline. |
| `HTMLRewriter` | ⏭ Skip | No HTML transformation in fork-added paths. |
| `Bun.YAML.parse` | ⏭ Skip | The fork *emits* YAML (mobile snapshot, AI briefing) but never parses it. |
| `Bun.JSONL` | ⏭ Skip | `ai.ts` writes `failures.jsonl` line by line as strings (`JSON.stringify` per failure). Nothing reads it in fork code; a downstream consumer of the jsonl could use `Bun.JSONL.parse` but that's not our scope. |
| `Bun.escapeHTML` | ⏭ Skip | No HTML generation in fork-added paths (the markdown briefings are markdown, not HTML). |
| `Bun.sleep` | ⏭ Skip | Two `setTimeout(resolve, ms)` helpers in `device.ts` and `webview.ts`. Both are dual-runtime; conditional swap would cost more than the speedup. |
| `Bun.spawn` | ⏭ Skip | Tests deliberately spawn Bun *from Node* to test the Node→Bun boundary; using `Bun.spawn` would defeat the purpose. |
| `crypto.randomUUID` (Web standard, both runtimes) | ✅ Used | `createGuid` in `packages/utils/crypto.ts` swapped from `crypto.randomBytes(16).toString('hex')` to `crypto.randomUUID().replaceAll('-', '')`. ~30% faster under both Node and Bun; output shape preserved (32 lowercase hex chars). |
| `Bun.fetch.preconnect` | ✅ Used | Warms TCP+TLS at reporter constructor time (`webhookBase`/`jira`/`xray`/`newRelic`) and at `APIRequestContext` constructor time for `request` fixtures with a `baseURL`. Bun-only; no-ops under Node. Shared helper in `packages/utils/bunPreconnect.ts`. |
| `undici` direct migration in `playwright-core` | ⏭ Skip | `packages/playwright-core/src/server/fetch.ts` uses Node's legacy `http.request`/`https.request` with custom proxy agents, HappyEyeballs DNS, HAR timing, client certs. Migrating to undici's Dispatcher API is a ~500-LOC refactor of an upstream-hot file with significant rebase risk. Node 18+ already routes global `fetch()` through undici, which is what the reporters use — so the win is already realized where it's cheap. |
| `Bun.gzipSync` / `Bun.gunzipSync` | ⏭ Skip | No gzip in fork-touched code. The only zlib touchpoints are `wsServer.ts` per-message-deflate config (passed to the `ws` library, not direct zlib) and the vendored `yauzl` raw-inflate (different format from gzip). The applicable site would be HTTP response decompression in `playwright-core/src/server/fetch.ts`, which is part of the same upstream-rebase-risk zone as the undici migration above. |

## Specialized Commands

### Merge Reports

Read [blob](./test-reporters#blob-reporter) reports and combine them. [Read more about merge-reports](./test-sharding.md).

#### Syntax

```bash
npx playwright merge-reports [options] <blob dir>
```

#### Examples

```bash
# Combine test reports
npx playwright merge-reports ./reports
```

#### Options

| Option | Description |
| :--- | :--- |
| `-c, --config <file>` | Configuration file. Can be used to specify additional configuration for the output report |
| `--reporter <reporter>` | Reporter to use, comma-separated, can be "list", "line", "dot", "json", "junit", "null", "github", "html", "blob" (default: "list") |

### Clear Cache

Clear all Playwright caches.

#### Syntax

```bash
npx playwright clear-cache
```

## Mobile testing (Appium)

`@playwright/experimental-mobile` adds an Appium-driven mobile test runner alongside the browser-test stack. It speaks W3C WebDriver classic to an Appium 2 server and exposes a Playwright-shaped `mobileTest` fixture that works for both iOS (XCUITest) and Android (UiAutomator2).

```ts title="playwright.config.ts"
import { defineConfig } from '@playwright/test';
import { androidCapabilities } from '@playwright/experimental-mobile';

export default defineConfig({
  projects: [
    {
      name: 'android-smoke',
      testMatch: '**/*.mobile.spec.ts',
      use: {
        appiumServerUrl: 'http://127.0.0.1:4723',
        capabilities: androidCapabilities({ app: 'apks/dev.apk', appPackage: 'com.example.dev' }),
      },
    },
  ],
});
```

```ts title="login.mobile.spec.ts"
import { mobileTest as test, expect } from '@playwright/experimental-mobile';

test('login then dashboard', async ({ device }) => {
  await device.app.byAccessibilityId('email').fill('user@example.com');
  await device.app.byAccessibilityId('signin').click();
  await device.waitForVisible(device.app.byAccessibilityId('dashboard'));
});
```

This package is independent of Playwright's native `_android` API, which drives Chrome-on-Android via ADB + CDP. Use `_android` for Chrome content automation, `@playwright/experimental-mobile` for native app testing across either platform. See `packages/playwright-mobile/README.md` for the full API.

