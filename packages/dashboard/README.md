# @playwright/dashboard

The browser-side UI for Playwright's interactive **annotation and recording dashboard** — a separate React app from the HTML test report and trace viewer.

## What it is

A vite-built single-page app that renders:
- Live screencast of a connected browser session
- Annotation overlay (draw boxes, attach text, mark accessibility regions on captured frames)
- Recording playback (step through captured user interactions)
- Session sidebar (switch between active browser sessions)

The app is plain React — no Playwright API surface is exposed here. It communicates with the dashboard backend over a typed WebSocket channel (`dashboardChannel.ts`) defined in this package.

## Who launches it

Not consumers directly. The dashboard server lives in `packages/playwright-core/src/tools/dashboard/` and is started by Playwright's internal CLI/MCP tooling. The server hosts this app's built `dist/` output as static assets and bridges it to the live Playwright session via WebSocket.

End-user flow:
1. User runs a Playwright CLI command that opens the dashboard (e.g. via the MCP tools layer).
2. `dashboardApp.ts` starts an HTTP server, opens a browser tab pointing at it.
3. The tab loads this package's built `index.html`, which boots the React app.
4. The app connects back to the server over WebSocket and starts rendering live state.

## Build

Built by the workspace root `npm run build` — vite emits to `dist/lib/`. The Playwright core consumes the build output via a static asset path; no `import '@playwright/dashboard'` happens at runtime in the runner.

## Source layout

| File | Role |
|---|---|
| `index.tsx` | React root + theme + main `Dashboard` mount |
| `dashboard.tsx` | Top-level layout: sidebar + main pane + toolbar |
| `dashboardModel.ts` | Client-side state model (active session, frames, annotations) |
| `dashboardClient.ts` | WebSocket transport — wraps `dashboardChannel.ts` |
| `dashboardChannel.ts` | Typed channel definition shared with the server side |
| `recording.tsx` | Recording playback UI |
| `screencast.tsx` | Live screencast rendering |
| `annotateView.tsx` / `annotations.tsx` | Annotation sidebar + overlay |
| `annotationImage.ts` / `annotationZip.ts` | Annotation export (PNG + zipped Markdown bundle) |
| `imageLayout.ts` | Viewport ↔ client coordinate math |
| `icons.tsx` | Icon set (subset shared with `@web/components`) |
| `*.css` | Component styles |

## Notes

- This package's `package.json` lists only browser-logo image deps. The React/Vite/`@web/*` deps are workspace-wide.
- The `auth-token` mini-app under `dist/lib/ui/authToken.js` is built from the same vite config but is a separate entry point used during dashboard auth handshake.
- Not intended for direct user consumption — there is no exported API. If you need to extend the dashboard, edit this package's React code and the server-side `dashboardController.ts` together.
