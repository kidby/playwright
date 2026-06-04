# Fork Divergences

Living ledger of every meaningful difference between this fork (`kidby/playwright`) and upstream `microsoft/playwright`. Update on every merge or fork-only change. Not a git-log replacement — captures *why* the divergence exists and what its consequences are.

Source-of-truth rule:
- **Before** `git pull --rebase origin main`: skim this doc to predict conflict surface.
- **After** landing a new fork-only change: append a row in the relevant section.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the design and process rules that govern these divergences.

---

## 1. Fork-added packages

| Package | Purpose | Entry point | Last touched |
|---|---|---|---|
| `@playwright/mobile` | Native iOS/Android driver via Appium 2 (W3C WebDriver). Adds `mobileTest` fixture + `NativeDevice` + `AppLocator` mirroring the web `Page`+`Locator` shape. | `packages/playwright-mobile/src/index.ts` | 2026-06 (added `AppLocator.screenshot()`, dropped `Locator` alias) |
| `@playwright/storybook` | Storybook story discovery + test fixture; lets Playwright drive Storybook stories. | `packages/playwright-storybook/src/index.ts` | 2026-05 |
| `@playwright/lighthouse` | Lighthouse audits inside Playwright tests. Peer dep on `lighthouse >=12.0`. | `packages/playwright-lighthouse/src/index.ts` | 2026-05 |
| `@playwright/dashboard` | React UI for annotation/recording (served by `packages/playwright-core/src/tools/dashboard/dashboardApp.ts`). | `packages/dashboard/src/index.tsx` | 2026-06 (added README) |

All four track upstream's version string in lockstep (`1.61.0-next` as of this writing). Never bump a fork-added package's version independently — see [fork-follows-upstream-versions](https://github.com/anthropics/claude-code/issues) rule.

---

## 2. Fork-added reporters

All registered as built-in shorthands via `packages/playwright/src/reporters/registry.ts` (single source of truth).

| Shorthand | Class | Purpose | Config surface |
|---|---|---|---|
| `ai` | `AIReporter` (`reporters/ai.ts`) | Per-failure markdown briefings + JSONL summary tuned for LLM consumption. Inlines mobile snapshots, captures console + network errors, profiles memory/duration. | `outputDir`, `prompt`, `markdown`, `jsonl`, `summaryFile`, `briefingFormatter`, `summaryBuilder`, `filenameBuilder`, `productAreaMapper`, `extraFields`, `trackMemory`, `slowTestThreshold`, `highMemoryThreshold`, `ticketPattern`, `sourceBaseUrl`, `sourceBranch`, plus branch-filter options |
| `catalog` | `CatalogReporter` (`reporters/catalog.ts`) | Enriched terminal reporter — area buckets, pass/fail/flaky percentiles, insights box. Upstream `list` retains its native behavior unchanged. | Product-area mapping, source-link generation, link resolver |
| `csv` | `CSVReporter` (`reporters/csv.ts`) | Generic CSV export of per-test results. | `outputFile`, `noHeader`, `ticketPattern` (+ branch filter) |
| `jira` | `JiraReporter` (`reporters/jira.ts`) | Creates Jira issues for failures. Opt-in via `enabled: true`. | Jira host/auth/project key, label config (+ branch filter) |
| `xray` | `XrayReporter` (`reporters/xray.ts`) | Sends Xray test-execution payloads. | Xray client ID/secret/cloud-or-server, test-key extraction (+ branch filter) |
| `newRelic` | `NewRelicReporter` (`reporters/newRelic.ts`) | Posts per-test events to New Relic. | NR account/license, app-name, custom attributes (+ branch filter) |
| `intellum-social` | Concrete `WebhookReporterBase` subclass | Posts test summaries to Tribe/Social (Intellum-specific destination). The one allowed fork-specific reporter name. | Webhook URL, format, mode |

Shared infrastructure: `reporters/{webhookBase,branchFilter,ciAdapter}.ts`. Each reporter individually declares its config; no Intellum URLs/keys hardcoded — see [intellum-fork-design](https://github.com/anthropics/claude-code/issues) rule.

---

## 3. Fork-added matchers

Registered via `packages/playwright/src/matchers/{matchers,expect}.ts`.

| Matcher | Semantics | Test |
|---|---|---|
| `toBeWithinRange(min, max)` | Inclusive numeric range check | `tests/playwright-test/expect.spec.ts` |
| `toHaveResponseProperty(response, name, expected?)` | Asserts an HTTP `Response` has a property matching `expected` | `tests/playwright-test/expect.spec.ts` |
| `toMatchJsonSchema(schema)` | JSON-schema validation | `tests/playwright-test/expect.spec.ts` |

---

## 4. Fork-added client API

| API | Where | Implementation note |
|---|---|---|
| `Page.getById(id, options?)`, `Frame.getById`, `Locator.getById` | `packages/playwright-core/src/client/{page,frame,locator}.ts` | Composes `internal:attr=[id_op_value]` selector — NOT a new selector-engine registration. Reuses the existing attribute-matcher engine, same pattern as `getByAltText`/`getByTitle`. Default substring match; `{exact: true}` for exact ID match |
| `Page.getByClassName(className, options?)`, `Frame.getByClassName`, `Locator.getByClassName` | same files | Similar pattern but uses CSS class-token matching (`~=` token) under `exact: true`, substring (`*=`) by default |
| `AppLocator.screenshot({timeout?, path?})` | `packages/playwright-mobile/src/appLocator.ts:277` | Mobile equivalent of web `Locator.screenshot()`. Auto-waits for actionability, captures via Appium `/element/<id>/screenshot`, writes to disk when `path` given (creates parent dir) |

Test coverage: `tests/page/locator-get-by-id-class.spec.ts` (web side), `tests/mobile/screenshot.spec.ts` (mobile).

---

## 5. Fork-added plugins / runtime

| Component | File | Why |
|---|---|---|
| `AppiumServerPlugin` | `packages/playwright/src/plugins/appiumServerPlugin.ts` | Auto-starts Appium 2 server when `appium.autoStart: true` in test config. Reuse-existing-server default-true; graceful SIGTERM shutdown. Wired into `runner/testRunner.ts:398,454` via `appiumServerPluginsForConfig` |
| Bun runtime support | `packages/playwright/src/transform/bunRuntime.ts` | Bun loader plugin that strips dangling `import type` statements (Bun's native TS handler leaks them). Registered via `bunfig.toml` preload in consumers |
| `printFailuresInline` option on list reporter | `packages/playwright/src/reporters/list.ts` | Adds the option so failures print as they happen instead of in the epilogue. Upstream commit `4d2890162a` |
| Single-source reporter registry | `packages/playwright/src/reporters/registry.ts` (new) | Eliminates the two-place dance for built-in reporter shorthands (was a bug source: 5 fork reporters silently unregistered until tests caught it) |
| SQLite compilation cache | `packages/playwright/src/transform/cacheBackend.ts` (new) + `compilationCache.ts` | Single `transform.sqlite` file (WAL mode) replaces per-file `{.js,.map,.data}` triplets. ~3× inode reduction. Rollback via `PWTEST_LEGACY_CACHE=1` |

---

## 6. Fork-modified upstream files

Hand-patches to files upstream owns. These conflict on every `git pull` from upstream.

| File | Change summary | Reason |
|---|---|---|
| `packages/playwright-core/src/server/fetch.ts` | `_parseSetCookieHeader` accepts a `baseUrl` and resolves relative redirect URLs against it | Cookie parsing crash on relative redirects; obsoleted the `patches/playwright-cookie-parsing-fix.patch` in `~/one-automation` |
| `packages/playwright/src/common/config.ts:308` | `builtInReporters` re-exported from `reporters/registry.ts` instead of inline literal | Single source of truth for built-in reporter names |
| `packages/playwright/src/runner/reporters.ts` | `createReporters` uses `isBuiltInReporter` / `resolveBuiltInReporter` from the registry instead of an inline switch | Same |
| `packages/playwright/src/reporters/list.ts` | Adds `printFailuresInline` option | Eager failure visibility during long suites |
| `packages/playwright/src/reporters/ai.ts` | Removed dead `_currentTestId` field (was assigned but never read) | Cleanup from June 2026 audit |
| `packages/playwright/src/transform/transform.ts` | `logTransformFallback` warns under `DEBUG=pw:transform` when oxc/esbuild silently return empty code; transform-scope split cached at module init | Visibility into silent fallbacks; hot-path perf |
| `packages/playwright/src/transform/compilationCache.ts` | Memory cache stores code in-memory (capped at 256 KB); mkdir memoization; SQLite-backed disk cache (default), legacy file-per-hash gated by `PWTEST_LEGACY_CACHE=1` | Phase 1 + Phase 2 of the June 2026 audit |
| `packages/playwright/src/transform/bunRuntime.ts` | `Symbol.for('playwright.bunRuntimeInstalled')` cross-realm install guard | Prevent double-registration of the Bun plugin when two module copies load |
| `packages/playwright-mobile/src/mobileMatchers.ts` | Unified `DEFAULT_MATCHER_TIMEOUT_MS = 20_000` constant for both web and AppLocator matcher fallback timeouts | Previously asymmetric (5 s web, 20 s mobile) |
| `packages/playwright-mobile/src/mobileTest.ts` | Extracted `shouldCaptureFailureArtifacts(status)` helper used by the fixture gate | Regression sentinel for failure-artifact capture across retries |
| `packages/playwright-mobile/src/index.ts` | Dropped `Locator` re-export alias (only `AppLocator` exported) | Avoid shadowing web `Locator` in mixed specs |
| `packages/playwright-mobile/package.json` | Added `pngjs` to `dependencies` | Was imported but undeclared (worked only via npm hoisting) |
| `utils/check_deps.js` | Walks `playwright-mobile` package | Enforces the package's declared deps |
| `utils/build/build.js` | New standalone esbuild step for `transform/cacheBackend.ts`; `better-sqlite3` marked external in runner/common/loader/worker/esmLoader bundles | SQLite backend support |
| `packages/playwright/package.json` | Adds `better-sqlite3 ~12.10.0` dep | SQLite backend |
| `CONTRIBUTING.md` | Replaced upstream's PR-process doc with fork-specific design + code dogma | Fork is solo work, doesn't follow the upstream PR model |

---

## 7. ESM-only conversion (2026-05-23)

A whole-fork shift, not a single-file patch. Captured here so it doesn't get accidentally undone.

| Aspect | State |
|---|---|
| Distribution format | ESM only — `"type": "module"` in every workspace package |
| CJS layer | Removed (`pirates`, `fileIsModule`, dual `.mjs`/`.js` outputs, `module.transform-commonjs`). ~1300 LOC dropped |
| Worker / loader entry points | `.cjs` shims for `child_process.fork` (Node 25 ENOENT bug on ESM file URLs) |
| Primary transformer | `oxc-transform` (~10× faster than Babel for TS/JSX) |
| Babel | Retained ONLY for `@babel/plugin-proposal-decorators` (stage-3 `@` decorators) — 16 other `@babel/plugin-*` devdeps dropped |
| Proxy agents bumped | `https-proxy-agent` → 9.0.0, `socks-proxy-agent` → 10.0.0, `ws` → 8.21.0 |

Known issue: `tests/playwright-test/loader.spec.ts` has ~5 expected failures (deliberately removed CJS-mode behaviors / babel-vs-oxc syntax-error format differences). Don't "fix" by reverting ESM-only changes.

Known CT-test issue: dual `@playwright/test` modules in component-testing specs when Vite and the runner load `@playwright/test` through different module-resolution paths. Tracked separately.

---

## 8. Runtime floor

| Constraint | Why |
|---|---|
| Node `>=24` | ESM, top-level await, native test runner improvements |
| Bun first-class | Intellum's `~/one-automation` runs under Bun via `bunfig.toml` preload + `link:` deps + `bun cli.js` direct invocation. Transform pipeline (`bunRuntime.ts`) must stay Bun-safe |

---

## 9. Dependency pin tightenings

| Dep | Pin | Reason |
|---|---|---|
| `@zip.js/zip.js` | `~2.7.29` (resolves to 2.7.73) | 2.8.x dropped `lib/zip-no-worker-{inflate,deflate}.js` subpath exports → broke the trace-viewer / html-reporter / dashboard vite builds. Matches upstream's lockfile pin. See [feedback-dep-pin-semver-traps](https://github.com/anthropics/claude-code/issues) |
| `better-sqlite3` | `~12.10.0` | Earliest Node-25-prebuilt-binary line (11.x lacks Node 25 builds, fails on `node-gyp rebuild`) |

---

## 10. Strategic decisions

Decisions that constrain future work; not just code state.

| Decision | Why |
|---|---|
| No per-feature PRs against the fork | Solo work; accumulate on `main`, push to `kidby` when in a working state ([feedback-fork-workflow-no-pr-split](https://github.com/anthropics/claude-code/issues)) |
| Push to `kidby` only on explicit user instruction | Never autonomous git state mutations (CLAUDE.md global rule) |
| All packages track upstream's version string in lockstep | The fork ships as a coherent snapshot ([feedback-fork-follows-upstream-versions](https://github.com/anthropics/claude-code/issues)) |
| No user-facing API removal / `@deprecated` | The fork's role is to add, not narrow ([feedback-no-user-facing-api-removal](https://github.com/anthropics/claude-code/issues)) |
| Generic reporter names | Intellum config lives at the consumer level (`~/one-automation`), not in the fork ([feedback-intellum-fork-design](https://github.com/anthropics/claude-code/issues)) |
| No upstream PRs by default | Even otherwise-upstreamable fixes stay in the fork unless explicitly chosen for upstreaming |
| Don't preemptively split files | Defer "this is getting big" refactors until a real change forces the issue (see AI reporter, 602 LOC — single file, intentional) |

---

## 11. Conscious omissions

Upstream features the fork deliberately does **not** use or stay on a non-default path for.

| Item | Reason |
|---|---|
| Upstream's PR process | The fork doesn't accept community contributions — solo work, no PR template |
| `@zip.js/zip.js` 2.8.x range-request reader improvements | Pin tightened to 2.7.x to keep the trace-viewer build working; revisit when upstream maintainer commits to subpath stability |
| Splitting `ai.ts` into a directory | 602 LOC, in line with `catalog.ts` (634) and `html.ts` (846). Not splitting until the file or its tests cross a real pain threshold |
| Removing/replacing `@zip.js/zip.js` with `fflate` | User decision; trace viewer needs HTTP range requests for large traces, fflate doesn't have an equivalent |
