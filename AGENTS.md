# Agent Guidelines

## After Modifying Code

### Static Checks
Run static checks before considering work complete:
```bash
npx oxlint                           # linting (0 errors required)
npx tsgo -p tsconfig.check.json      # type checking main code
npx tsgo -p ./tests/                 # type checking tests
node utils/check_deps.js             # cross-package import validation
```

### Tests
Run tests that cover any modified code. Use `--grep` or file path filters to scope the run:
```bash
# For playwright-core changes:
node packages/playwright/cli.js test --config=tests/library/playwright.config.ts -g '<relevant test name>'

# For BiDi changes:
node packages/playwright/cli.js test --config=tests/bidi/playwright.config.ts --project=bidi-chromium-library -g '<relevant test name>'

# For playwright-test runner changes:
node packages/playwright/cli.js test --config=tests/playwright-test/playwright.config.ts -g '<relevant test name>'

# For mobile/appium changes:
node packages/playwright/cli.js test --config=tests/mobile/playwright.config.ts
```

Do not skip tests. If a test fails, fix the root cause rather than disabling the test, unless the failure is a known upstream limitation (e.g. BiDi protocol gaps), in which case add a `test.skip` with a clear reason.

## Code Style
- No em dashes
- Use `progress.race()` to wrap async calls in methods that accept a `Progress` parameter
- Follow the existing `curly` lint rule (no braces on single-statement blocks)
- When fixing an error, search the codebase for similar occurrences and fix them all

## Cleanup

Do not leave temporary files in the repository. Before considering work complete:
- Delete one-off scripts, scratch files, and temporary markdown/data files created during the task
- If a script or file could be reused locally (benchmarks, analysis tools, debug helpers), move it to `.artifacts/` (gitignored, not committed)
- Never commit generated artifacts, test output, or throwaway analysis files to the repo

## Monorepo Packages

| Package | npm name | Purpose |
|---------|----------|---------|
| `playwright-core` | `playwright-core` | Browser automation engine: client, server, dispatchers, protocol |
| `playwright` | `playwright` | Test runner + browser automation (public package) |
| `playwright-test` | `@playwright/test` | Test runner entry point |
| `playwright-client` | `@playwright/client` | Standalone client package |
| `protocol` | *(internal)* | RPC protocol definitions (`protocol.yml` -> generated `channels.d.ts`) |

### Browser Packages

`playwright-chromium`, `playwright-firefox`, `playwright-webkit` -- per-browser distributions.
`playwright-browser-chromium`, `playwright-browser-firefox`, `playwright-browser-webkit` -- binary packages.

### Tooling Packages

| Package | Purpose |
|---------|---------|
| `html-reporter` | HTML test report viewer |
| `trace-viewer` | Trace viewer UI |
| `recorder` | Test recorder |
| `web` | Shared web UI components |
| `injected` | Scripts injected into browser pages |

### Component Testing

`playwright-ct-core`, `playwright-ct-react`, `playwright-ct-vue`

### Fork-Specific Experimental Packages

| Package | npm name | Purpose |
|---------|----------|---------|
| `playwright-mobile` | `@playwright/experimental-mobile` | Native mobile testing via Appium 2 (iOS + Android) |
| `playwright-storybook` | `@playwright/storybook` | Storybook auto-discovery, iframe + CT modes |
| `playwright-lighthouse` | `@playwright/lighthouse` | Lighthouse audits from within Playwright tests |

### Bun Compatibility

This fork runs under Bun as a first-class target. Tests can use `Bun.*` APIs directly. Both runtimes pass the full fork suite reliably.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `tests/` | All test suites (page, library, playwright-test, mcp, components, mobile, etc.) |
| `tests/mobile/` | Mobile / Appium integration tests (mock server, no real device needed) |
| `docs/src/` | API documentation -- **source of truth** for public TypeScript types |
| `docs/src/api/` | Per-class API reference (`class-page.md`, `class-locator.md`, etc.) |
| `utils/` | Build scripts, code generation, linting, doc tools, upstream sync |
| `browser_patches/` | Browser engine patches |
| `.docs/` | Fork-specific plans, critiques, and implementation status docs |

## Build

```bash
npm run build       # Full build
npm run watch       # Watch mode (recommended during development)
```

Assume watch is running and code is up to date. Generated files (types, channels, validators) are produced by watch automatically.

## Full Lint Suite

```bash
npm run flint
```

Runs all lint checks in parallel: oxlint, tsc, doclint, check-deps, generate_channels, generate_types, lint-tests, test-types, lint-packages, code-snippet linting.

## Test Commands

| Command | Scope |
|---------|-------|
| `npm run ctest <filter>` | Chromium only library tests -- **use during development** |
| `npm run test <filter> -- --project=<chromium,firefox,webkit>` | All library / per project |
| `npm run ttest <filter>` | Test runner (`tests/playwright-test/`) |
| `npm run ctest-mcp <filter>` | Chromium only MCP tools (`tests/mcp/`) |
| `npm run test-mcp <filter> -- --project=<chromium,firefox,webkit>` | MCP tools (`tests/mcp/`) |
| `node packages/playwright/cli.js test tests/mobile/` | Fork mobile tests (no browser needed) |
| `node packages/playwright/cli.js test tests/playwright-test/storybook*.spec.ts` | Fork storybook tests |

### Filtering

```bash
npm run ctest tests/page/locator-click.spec.ts         # Specific file
npm run ctest tests/page/locator-click.spec.ts:12      # Specific location
npm run ctest -- --grep "should click"                 # By test name
npm run ctest-mcp snapshot                             # By file name part
```

### Test Directories and Fixtures

| Directory | Import | Key Fixtures | What to Test |
|-----------|--------|--------------|--------------|
| `tests/page/` | `import { test, expect } from './pageTest'` | `page`, `server`, `browserName` | User interactions: click, fill, navigate, locators, assertions |
| `tests/library/` | `import { browserTest, expect } from '../config/browserTest'` | `browser`, `context`, `browserType` | Browser/context lifecycle, cookies, permissions, browser-specific features |
| `tests/playwright-test/` | `import { test, expect } from './playwright-test-fixtures'` | test runner fixtures | Test runner: reporters, config, annotations, retries |
| `tests/mcp/` | `import { test, expect } from './fixtures'` | `client`, `server` | MCP tools via `client.callTool()` |

**Decision rule**: Does the test need `browser`/`browserType`/`context` -> `tests/library/`. Just needs `page` + `server` -> `tests/page/`. Mobile tests -> `tests/mobile/`.

## Upstream Sync

This fork tracks `microsoft/playwright` as the `upstream` remote.

```bash
utils/sync_upstream.sh       # Dry-run merge analysis
utils/analyze_upstream.sh    # Conflict prediction report
git fetch upstream main      # Fetch latest upstream
```

## DEPS System

Import boundaries are enforced via `DEPS.list` files across the repo, checked by `node utils/check_deps.js`.

**Key rule**: Client code NEVER imports server code. Server code NEVER imports client code. Communication is only through the protocol.
When creating or moving files, update the relevant `DEPS.list` to declare allowed imports.

## Coding Convention

For exported classes:
- `private _method()` -- only used within the class itself
- `_method()` (no `private`) -- used by other code in the same file, but not outside the file
- `method()` (public) -- used in other files

Non-exported classes have no naming convention; they are internal implementation details.

## Commit Convention

Before committing, run `npm run flint` and fix errors.

Semantic commit messages: `label(scope): description`

Labels: `fix`, `feat`, `chore`, `docs`, `test`, `devops`

```bash
git checkout -b fix-39562
# ... make changes ...
git add <changed-files>
git commit -m "$(cat <<'EOF'
fix(proxy): handle SOCKS proxy authentication

Fixes: https://github.com/microsoft/playwright/issues/39562
EOF
)"
# **Never `git push` without an explicit instruction to push.**
git push origin fix-39562
gh pr create --repo microsoft/playwright --head username:fix-39562 \
  --title "fix(proxy): handle SOCKS proxy authentication" \
  --body "$(cat <<'EOF'
## Summary
- <describe the change very! briefly>

Fixes https://github.com/microsoft/playwright/issues/39562
EOF
)"
```

Never add Co-Authored-By agents in commit message.
Never add "Generated with" in commit message.
Never add test plan to PR description. Keep PR description short -- a few bullet points at most.
Branch naming for issue fixes: `fix-<issue-number>`

**Never amend commits.** Always create a new commit for follow-up changes, even when iterating on an open PR. Amending rewrites history and forces a force-push, losing the incremental review trail. Only amend if the user explicitly says so.

**Never `git push` without an explicit instruction to push.** Applies even when a PR is already open for the branch -- additional commits are immediately visible to reviewers. Commit locally, report what was committed, and wait. Only push when the user's message contains "push", "upload", "create PR", "ship it", or equivalent.

## Development Guides

Detailed guides for common development tasks:

- **[Architecture: Client, Server, and Dispatchers](.claude/skills/playwright-dev/library.md)** -- package layout, protocol layer, ChannelOwner/SdkObject/Dispatcher base classes, DEPS rules, end-to-end RPC flow, object lifecycle
- **[Adding and Modifying APIs](.claude/skills/playwright-dev/api.md)** -- 6-step process: define docs, implement client, define protocol, implement dispatcher, implement server, write tests
- **[MCP Tools and CLI Commands](.claude/skills/playwright-dev/tools.md)** -- `defineTool()`/`defineTabTool()`, tool capabilities, CLI `declareCommand()`, config options, testing with MCP fixtures
- **[Vendoring Dependencies](.claude/skills/playwright-dev/vendor.md)** -- bundle architecture, esbuild setup, typed wrappers, adding deps to existing bundles
