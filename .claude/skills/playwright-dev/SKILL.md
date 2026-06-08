---
name: playwright-dev
description: Explains how to develop Playwright - add APIs, MCP tools, CLI commands, and vendor dependencies.
---

# Playwright Development Guide

See [CLAUDE.md](../../../CLAUDE.md) for monorepo structure, build/test/lint commands, and coding conventions.

## Detailed Guides

- [Library Architecture](library.md) — client/server/dispatcher structure, protocol layer, DEPS rules
- [Adding and Modifying APIs](api.md) — define API docs, implement client/server, add tests
- [MCP Tools and CLI Commands](tools.md) — add MCP tools, CLI commands, config options
- [Vendor Dependencies & Bundling](vendor.md) — utilsBundle, coreBundle, babelBundle; adding vendored npm packages; DEPS.list; `check_deps`
- [Updating WebKit Safari Version](webkit-safari-version.md) — update the Safari version string in the WebKit user-agent
- [WebView (iOS Safari) Backend](webview.md) — `webkit/webview/` against stock Mobile Safari; provisional-target pause/resume; what's upstream vs Playwright patches; local + CI test setup
- [Bisecting Across Published Versions](bisect-published-versions.md) — reproduce regressions side-by-side from npm and diff `node_modules/playwright/lib/` between versions
- [Dashboard](dashboard.md) - the UI powering the "playwright cli show" command, and how to work on it
- [Trace System Guide](trace_system_guide.md) -- trace recording, loading, viewer architecture, and data formats

### Fork-Specific

The fork adds `playwright-mobile` (`@playwright/experimental-mobile`), `playwright-storybook` (`@playwright/storybook`), and `playwright-lighthouse` (`@playwright/lighthouse`). See [Library Architecture](library.md#fork-specific-packages) for details. The fork also uses ESM-only modules and targets Bun as a first-class runtime. See [Vendor Dependencies](vendor.md#fork-specific-mcputilsbundle) for the `mcpUtilsBundle` split and Bun-compatible adapter files.

