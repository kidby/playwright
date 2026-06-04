# Possible Refactor Roadmap

Living backlog of code-quality / perf / structural improvements for `~/playwright`. Drawn from the June 2026 audit. Append new ideas as they come up; flip status as work lands.

**Rule:** removing or `@deprecated`-marking user-facing Playwright API surface is **off the table** (see [CONTRIBUTING.md](./CONTRIBUTING.md) and the matching memory rule). Items below are internal refactors only.

Status legend: 🟢 done · 🟡 in progress · ⚪ open · ⚫ won't fix · 🔁 deferred (revisit later)

---

## 1. High-ROI / opportunistic

| # | Item | Where | Status |
|---|---|---|---|
| 1.1 | Memory cache stores code in-memory (cap 256 KB), skips redundant disk read on hit | `packages/playwright/src/transform/compilationCache.ts:130-160` | 🟢 done |
| 1.2 | Cache `PW_TEST_SOURCE_TRANSFORM_SCOPE` split at module init | `packages/playwright/src/transform/transform.ts:142-153,274` | 🟢 done |
| 1.3 | Memoize `mkdirSync(recursive: true)` calls | `packages/playwright/src/transform/compilationCache.ts:78-83` | 🟢 done |
| 1.4 | Drop redundant `Object.fromEntries(map.entries())` → `Object.fromEntries(map)` | `packages/playwright/src/transform/compilationCache.ts:187,270` | 🟢 done |
| 1.5 | Single-source reporter registry (`reporters/registry.ts`) | new file + `common/config.ts:308` + `runner/reporters.ts:46` | 🟢 done |
| 1.6 | SQLite-backed compilation cache (rollback via `PWTEST_LEGACY_CACHE=1`) | `packages/playwright/src/transform/cacheBackend.ts` (new) + `compilationCache.ts` | 🟢 done |
| 1.7 | `packages/dashboard/README.md` documents the package's role | `packages/dashboard/README.md` | 🟢 done |
| 1.8 | Better locator-resolution error message (elapsed time, selector, debug hints) | `packages/playwright-core/src/client/locator.ts:85` | ⚪ open — half a day, high-visibility polish |
| 1.9 | Promote `WebhookReporterBase` to a real shared transport for `jira`/`xray`/`newRelic` | `packages/playwright/src/reporters/{webhookBase,jira,xray,newRelic}.ts` | ⚪ open — DRY win, share retry/jitter/CI-metadata extraction |
| 1.10 | Custom matcher single-source registry (mirror 1.5 pattern) | `packages/playwright/src/matchers/{matchers,expect}.ts` | ⚪ open — eliminates the two-place add-a-matcher dance |
| 1.11 | Catalog reporter snapshot tests (area buckets, product-area mapping, regression detection) | `tests/playwright-test/reporter-catalog.spec.ts` | ⚪ open — ~138 LOC of tests for 800+ LOC reporter, thin coverage |
| 1.12 | `AppLocator.evaluate()` for parity with web `Locator.evaluate()` | `packages/playwright-mobile/src/appLocator.ts` | ⚪ open — escape hatch to W3C executeScript without reaching through `.client` |
| 1.13 | `AppLocator.and()` / `AppLocator.or()` combinators (web Locator has these) | `packages/playwright-mobile/src/appLocator.ts` (next to `filter()` at line 191) | ⚪ open — ~2 days with tests, real parity win |

---

## 2. Modernization swaps

Hygiene-level updates to use newer Node APIs where it cleans up code without changing behavior.

| # | Swap | Where | Status |
|---|---|---|---|
| 2.1 | Manual `setTimeout` + `clearTimeout` debouncer → `AbortController` + `AbortSignal.timeout()` | `packages/playwright/src/runner/fsWatcher.ts:30-65` | ⚪ open — code clarity, no perf change |
| 2.2 | tsconfig loader file-mtime LRU cache (memoized at module level today, not by mtime) | `packages/playwright/src/transform/tsconfig-loader.ts:92,102` | ⚪ open — helps watch-mode rebuilds |
| 2.3 | `process.nextTick` → `queueMicrotask` where ordering doesn't matter | `packages/playwright/src/worker/workerMain.ts` (a few sites) | ⚪ open — standard API, small ordering diff to verify |
| 2.4 | `Promise.withResolvers()` (Node 22+) where deferred-promise pattern exists | grep `let resolve` near `new Promise` for candidates | ⚪ open — 4-line dance → 1 line |
| 2.5 | Extend `AsyncLocalStorage` (already used for `Zone`) to carry reporter context, fixture scope, request metadata | `packages/utils/zones.ts:17-21` + threading sites | 🔁 deferred — strategic, not opportunistic |
| 2.6 | `crypto.randomUUID()` for short ID generation | grep `crypto.randomBytes` | ⚫ won't fix — sites checked are either WebAuthn (correct byte widths required) or intentionally-compact 6-char session IDs |

---

## 3. API ergonomics polish

These improve the user experience without changing or removing existing API. Documentation + IDE hints + new helpers only.

| # | Item | Where | Status |
|---|---|---|---|
| 3.1 | JSDoc note contrasting `Locator.filter()` with `Array.filter()` to clear up the mental collision | `packages/playwright-core/src/client/locator.ts:216-218` | ⚪ open — pure docs |
| 3.2 | Docs callout for `baseURL` living in `use.*` (it's a top-level concern, common newbie surprise) | `docs/src/` + `packages/playwright/types/test.d.ts:155,172` JSDoc | ⚪ open — pure docs |
| 3.3 | `mergeTests` builder pattern documented for users to use instead of chaining 5+ `.extend()` calls | `docs/src/` | ⚪ open — workaround for the type-inference degradation under deep `.extend` chains |
| 3.4 | Document that `result.retry` on `onTestEnd` already provides retry observability (no new `onTestRetry` hook needed) | `packages/playwright/src/reporters/reporterV2.ts:36` JSDoc | ⚪ open — clear up a common reporter-author question |

---

## 4. Strategic / longer-horizon

Worth doing when there's a real forcing function. Each is a multi-week investment.

| # | Item | Where | Notes |
|---|---|---|---|
| 4.1 | Add a "thin dispatcher" fast path for in-process execution (the common case for `@playwright/test`) | `packages/playwright-core/src/server/dispatchers/dispatcher.ts:52-86` + ~100 subclasses | Halving per-call overhead for local execution would noticeably speed up large suites. Pattern: similar to how `toImpl` tries to bypass channels (`connection.ts:81`). L effort; payoff real but only worth it if test-runtime perf is the bottleneck (often fixture/browser startup dominates) |
| 4.2 | Replace `protocol.yml` → `channels.d.ts` hand-rolled generator with a schema-as-source-of-truth library | `utils/generate_channels.js` (~1000 LOC), `packages/protocol/src/channels.d.ts` (~175 KB) | TypeBox or Zod would let TS types infer from the schema. Eliminates the "I forgot to regenerate" footgun. The generator has been stable for years though — file this as part of a generator overhaul, not a standalone item |
| 4.3 | Split AI reporter (`reporters/ai.ts`, 602 LOC) into `ai/{index,capture,briefing,format,profile,config}.ts` | `packages/playwright/src/reporters/ai.ts` | 🔁 deferred — don't preemptively split. Wait for a real change that needs to touch the file as the forcing function. Sibling `catalog.ts` (634 LOC) and `html.ts` (846 LOC) live in single files without complaint |

---

## 5. Things explicitly NOT in the roadmap

Recording these so they don't get re-proposed each audit:

| Idea | Why it's off the table |
|---|---|
| Deprecate `Locator()` string-selector forms (`role=`, `text=`, etc.) | Removing user-facing API is off the table per fork-wide rule |
| Add `Reporter.onTestRetry` hook | `result.retry` is already on every `onTestEnd` call (verified). Hook would be additive sugar, not a missing capability |
| Consolidate ReporterV1 vs V2 split | Migration cost (every published reporter plugin) exceeds the ongoing pain |
| Delete `packages/dashboard/` | Verified to be a real React app with 20+ files, not orphaned |
| Replace `@zip.js/zip.js` with `fflate` | User decision: stay with zip.js, accept the random-access trace-load win is worth the lockstep with upstream |

---

## 6. Conventions for items added here

When adding a new idea:
- One row in the relevant section table; mark status ⚪.
- File:line refs verified against the current tree (drift is real — re-grep if the audit was old).
- "Risk" not "Effort" if either is non-trivial.
- Items that turn out to be phantoms / non-issues / wontfix don't get deleted — flip status, leave a row. The trail matters for the next audit.
- Items that get done get 🟢 + a one-line note pointing at the commit / PR.
