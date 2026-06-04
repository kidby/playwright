# Contributing to this Playwright fork

This is Intellum's fork of [microsoft/playwright](https://github.com/microsoft/playwright). It tracks upstream closely and adds the features Intellum's QE platform depends on without monkey-patching the library at runtime. Read this whole file before sending a change — the rules below are not arbitrary preferences, every one was paid for by a real incident.

> Looking for the upstream microsoft/playwright contribution guide (CLA, community PR rules, etc.)? Use `git show origin/main:CONTRIBUTING.md` — that file lives upstream; this one is the fork's.

---

## Philosophy

The fork is a **clean superset** of upstream Playwright, not a parallel project. Any feature here should look like something Microsoft could accept upstream — generic names, generic config surface, no Intellum branding in identifiers. Intellum-specific configuration lives at the consumer level (`~/one-automation`'s `playwright.config.ts`), not in the fork's code. The single sanctioned exception to the no-branding rule is the `intellum-social` reporter, which targets a genuinely Intellum-platform-specific destination.

Every fork-added feature exists because a contributor hit a real, recurring pain point. **Don't remove features.** "Simplification" that drops capability is a regression, not a cleanup.

---

## Architecture bets (durable; don't re-litigate)

| Decision | Why | Consequence |
|---|---|---|
| **Node 24+** required | ESM + top-level await + native test runner improvements | No CJS compatibility shims for the runtime; package.json `engines.node` is `>=24` |
| **ESM-only distribution** | Dropped ~1300 LOC of dual-runtime layer + shrunk dep tree | Never reintroduce `pirates`, `fileIsModule`, dual `.mjs`/`.js` outputs, or `module.transform-commonjs` |
| **oxc as sole primary transformer** | ~10× faster than Babel for TS/JSX | Babel survives only for `@babel/plugin-proposal-decorators` (stage-3 `@` decorators) |
| **Bun is first-class** | Intellum's `~/one-automation` runs under Bun | `packages/playwright/src/transform/bunRuntime.ts` registers a Bun loader plugin; transform pipeline must stay Bun-safe |
| **Fork-added packages**: `@playwright/mobile`, `@playwright/storybook`, `@playwright/lighthouse`, `@playwright/dashboard` | Genuinely new capability, lightweight facades over the existing API | All four ship in the workspace, all four track upstream's version string |
| **Generic reporter names** | Intellum config lives at the consumer level | Reporter shorthands are `ai` / `csv` / `jira` / `xray` / `newRelic` / `catalog` — no Intellum-specific URLs, project keys, or area mappings hardcoded |
| **Single working branch (`main`)** | Solo-developer fork, not multi-team | No `intellum-main`, no `release-X.Y`; feature branches live ~2 days, merge to `main` |
| **Versioning tracks upstream verbatim** | The fork ships as a coherent snapshot of upstream + Intellum additions | Never bump a single fork-added package to a higher minor than upstream; every package moves in lockstep when upstream bumps |

---

## Code dogma

These rules are checked manually during review — and most of them by `npm run flint`. Don't fight them; the alternatives have been tried and rejected.

### Types

- **No `any`.** Not `: any`, not `as any`, not in test code. Use `unknown` and explicit narrowing (`if (typeof x === 'string') { ... }`) or a specific type. The point isn't purity, it's that the *unsafe step is visible*.
- **No `@ts-expect-error` / `@ts-ignore` to suppress real errors.** When upstream `@types` lag the runtime, add a module-augmentation `.d.ts` in `types/<name>/` instead of silencing at the call site.
- **No `as unknown as SomeType` chains for convenience.** If a double-cast is genuinely needed (e.g. bridging two strict APIs that don't share a base), one is allowed — never a stack of them.

### Comments

- **Default to writing no comments.** Names + types + structure must carry the meaning. A function called `requireCapabilitiesFixture` doesn't need a comment that says "this is the capabilities fixture and it's required."
- **Comments explain *why*, not *what*.** Acceptable triggers: a hidden constraint, a subtle invariant, a workaround for a specific upstream bug, behavior that would surprise a reader six months from now.
- **PRs and commit messages hold the "why" that isn't in code.** Don't leave breadcrumbs like `// added for the LE-1234 flow` in source — that belongs in the commit message and rots in code.
- **Never multi-paragraph docstrings.** One line. If you need more, you need better names, not more prose.

### Code shape

- **Don't add features, refactors, or abstractions beyond what the task requires.** A bug fix doesn't need surrounding cleanup. Three similar lines are better than a premature abstraction. No half-implementations.
- **Don't add error handling for scenarios that can't happen.** Trust internal code and framework guarantees. Validate at system boundaries (user input, external APIs), not in the middle.
- **Don't add backwards-compat shims.** No `// removed` comments, no renamed `_unused`, no re-export of deleted types. Delete completely or don't change.
- **Don't write feature flags unless someone asked.** Just change the code.

### Tests

- **Write tests alongside the change.** Not at the end "as a smoke test." Every PR that adds non-trivial code adds the test that covers it.
- **Match the test directory to what's under test** (see the table in `CLAUDE.md`). `tests/page/` for user-facing locator/assertion behavior, `tests/library/` for browser/context lifecycle, `tests/playwright-test/` for the runner, `tests/mobile/` for `@playwright/mobile`, etc.
- **Tests that need a fake server, mock it.** `tests/mobile/mockAppium.ts` is the canonical example: in-process HTTP server that records requests and returns canned responses. Don't reach for `jest.mock` patterns or runtime monkey-patching.
- **Test the invariant, not the implementation.** Tests like "this regex appears in the source" are sometimes necessary (e.g. `tests/mobile/matcher-timeout.spec.ts`'s constant-name assertion) but should be the exception — prefer black-box assertions on observable behavior.

### Dependencies

- **Pin libraries with lax semver tightly.** Use `~X.Y.Z` (patch-only) when the upstream maintainer ships breaking minor releases — see `@zip.js/zip.js` which removed subpath exports in a 2.7→2.8 bump and broke the build.
- **Cross-check upstream's lockfile when an install breaks.** If `node_modules/<pkg>/package.json` resolved to a different version than `git show origin/main:package-lock.json` shows, you found the regression — tighten the pin, don't migrate code in lockstep with an undisciplined maintainer.
- **Every external import declared in `package.json`.** `check_deps.js` enforces this for the enumerated packages (`utils/check_deps.js`). If you add a new package directory, add it to the walker list.
- **DEPS.list is optional but encouraged for fine-grained boundaries.** `[*]` is fine for single-purpose packages where the `package.json` declaration is enough enforcement.

---

## Process dogma

### Branches and remotes

```
origin  git@github.com:microsoft/playwright.git   (upstream — pull-only)
kidby   git@github.com:kidby/playwright.git       (Intellum's GitHub fork — push target)
```

- **Pull from `origin`**, push to `kidby`. Never push to `origin`.
- **Single working branch: `main`.** Short-lived feature branches (`fix-<topic>`, ~2 days) merge back to `main` and get deleted.
- **No per-feature PRs against the fork.** This is solo work — multiple unrelated changes accumulate on `main` and ship together when the tree is in a working state.
- **Never `git push` until the author says so explicitly.** Even when a topic branch is open, additional commits become visible immediately — collect them locally, report what changed, wait for the green light.
- **Never amend a published commit.** Always make a new commit, even when iterating on an open PR. Amend rewrites history and forces a force-push.

### Working with upstream

- **`git pull --rebase origin main`** to sync. Resolve conflicts in the merge commit; never `git reset --hard` to discard.
- **Don't propose upstream PRs by default.** Even otherwise-upstreamable fixes (e.g. cookie-parsing bugs) stay in the fork unless the author explicitly asks to upstream a specific change.

### Plans, audits, and verification

- **Plan before non-trivial work.** Spec the task or ask clarifying questions if requirements are ambiguous. Don't make assumptions and proceed silently.
- **Verify audit findings before scheduling fixes.** Explore-agent audits miss class boundaries, cross-package implementations, and existing registries. One `grep` saves an hour of phantom-chasing — three of the ten findings in the June 2026 audit were wrong because the agent only searched the obvious package.
- **Run `npm run flint`** before considering work shippable. It runs eslint, tsc, doclint, check-deps, generate_channels, generate_types, lint-tests, test-types, lint-packages, and code-snippet lint in parallel.
- **For UI/frontend changes, exercise the feature in a browser before declaring it done.** Type checks verify code correctness, not feature correctness — if you can't test the UI, say so explicitly rather than claiming success.

### Risky actions

- **Generally free**: editing files, running tests, building, local git read commands.
- **Always confirm before**: pushing to a remote, force-push, `git reset --hard`, deleting branches, dropping database tables, killing processes, modifying CI pipelines, posting to external services (Slack, Jira, GitHub issues/PRs), uploading code/artifacts to third-party web tools.
- **Investigate before deleting unfamiliar state.** Unknown branches, unrecognized files, surprising config — that's potentially in-progress work, not garbage. Resolve merge conflicts; don't discard them. If a lock file exists, find what holds it before removing.
- **Never bypass safety checks** (`--no-verify`, `--no-gpg-sign`) to make an obstacle go away. Find the root cause and fix it.

---

## Commit and PR conventions

When you do open a PR (rare for fork work, common for upstream):

- **Title**: `label(scope): description` — labels are `fix`, `feat`, `chore`, `docs`, `test`, `devops`.
- **Body**: a few bullet points at most. PR description holds the "why," not source comments.
- **Never** add `Co-Authored-By: claude` or `Generated with` markers.
- **Never** include a "test plan" in the PR body.
- **Branch naming** for issue fixes: `fix-<issue-number>` — e.g. `fix-39562`.

Example PR body:

```
## Summary
- Fix SOCKS proxy auth handling for chained proxies.

Fixes https://github.com/microsoft/playwright/issues/39562
```

---

## Common operations

```bash
npm run build           # full build (vite UI bundles + esbuild runner bundle + generated types)
npm run watch           # watch mode — recommended during development
npm run flint           # all lint checks in parallel

npm run ctest <filter>      # chromium-only library tests (development default)
npm run ttest <filter>      # playwright-test runner tests
npm run ctest-mcp <filter>  # MCP tools tests
node utils/check_deps.js    # validate DEPS.list + package.json deps standalone

# tests for fork-added packages
npx playwright test --config=tests/mobile/playwright.config.ts <filter>
```

If watch isn't running and you're seeing stale `lib/` output, run `npm run build` once. The trace-viewer vite step occasionally fails on environmental issues unrelated to your change — if it does, check `node_modules/@zip.js/zip.js/package.json` first (the 2.7→2.8 trap).

---

## When in doubt

The two questions to ask before any change:
1. **"Would Microsoft accept this upstream?"** — if no, generalize until they would. Strip Intellum branding from identifiers. Surface integration-target config (URLs, project keys, mappings) as reporter/fixture options.
2. **"Does the author know I'm doing this?"** — for anything beyond a small local edit, say what you're about to do in one sentence before doing it, and what changed in one or two sentences after.
