# Mobile integration tests

Real-device validation for `@playwright/mobile`. These specs drive a live
Appium 2 server against an actual iOS simulator or Android emulator and
exercise the mobile fixture, AppLocator, NativeDevice, and the artifact-
capture surface (screenshot / video / trace / mobile-trace.html /
mobile-trace.zip).

## Why a separate suite

The `tests/mobile/` suite uses an in-process mock Appium server (see
`tests/mobile/mockAppium.ts`) and runs everywhere. This suite uses a real
Appium server and real platform runtimes and only runs locally when those
are available. Skipping is automatic: tests bail out with a clear reason
if the relevant runtime isn't reachable.

## What gets auto-managed for you

The config uses the fork's `AppiumServerPlugin`. Before the suite runs:

1. The plugin probes `APPIUM_URL/status`.
2. If Appium is already running, it reuses that instance.
3. If not, it spawns `appium` from PATH and waits for `/status` to go
   green (up to 60 s).

After the suite, the plugin tears down only the instance it started. An
Appium you launched yourself stays running.

What still needs to be present before you run:

- A booted Android emulator (`adb devices` lists at least one), OR
- A booted iOS simulator (`xcrun simctl list devices booted` lists one).

Booting an emulator is not auto-managed: the time + memory cost is
substantial and the user usually already has a preferred AVD or sim
configured.

## Skip / opt-in gates

A test in this suite runs only when **all** of the following hold:

1. `MOBILE_E2E=1` is set in the environment (opt-in).
2. Appium is reachable at `APPIUM_URL` (default `http://127.0.0.1:4723`)
   — either already running, or auto-spawned by the plugin.
3. For Android specs: at least one Android emulator shows up in
   `adb devices`.
4. For iOS specs: at least one simulator shows up as `Booted` in
   `xcrun simctl list devices booted` (macOS only).

If any gate fails, the spec marks itself skipped with a reason; the rest
of the suite keeps running.

## Quick start

```bash
# 1. Boot an emulator or simulator
$ANDROID_HOME/emulator/emulator -avd Pixel_3a_API_34_extension_level_7_arm64-v8a -no-snapshot &
# or
xcrun simctl boot "iPhone 15 Pro"

# 2. Run the suite — Appium starts itself if it isn't already running
MOBILE_E2E=1 ./node_modules/playwright/cli.js test \
  --config=tests/mobile-integration/playwright.config.ts
```

To run against a custom Appium that you started with specific
plugins/drivers, set `MOBILE_E2E_NO_AUTOSTART=1` so the plugin won't try
to spawn its own.

Run a single project:

```bash
MOBILE_E2E=1 ./node_modules/playwright/cli.js test \
  --config=tests/mobile-integration/playwright.config.ts \
  --project="Android App"
```

## What each spec covers

| Spec | What it validates |
|---|---|
| `session-lifecycle.spec.ts` | mobileTest fixture opens + closes Appium session; capabilities, viewport, page-source reachable on both platforms |
| `native-device.spec.ts` | `device.screenshot()` returns real PNG bytes; `device.snapshot()` returns a YAML-shaped accessibility tree; `device.contexts()` includes `NATIVE_APP` |
| `system-app-interaction.spec.ts` | AppLocator query (`device.app.byClassName`/`byIosClassChain`), `.count()`, `.isVisible()`, `.screenshot()` against the platform Settings app |
| `trace-zip.spec.ts` | `MobileTraceZip` produces a parseable zip with `trace.trace` (valid NDJSON) + `trace.network`, first event is `context-options` with the expected platform |

The platform Settings app is used everywhere as the target — it ships on
every emulator/simulator image, so the suite doesn't depend on bundling
an APK or IPA.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `MOBILE_E2E` | unset | Set to `1` to opt in. Specs auto-skip otherwise. |
| `APPIUM_URL` | `http://127.0.0.1:4723` | Where to find the Appium server |

## Adding a new spec

1. Tag the describe block with `@android-app` and/or `@ios-app` so the
   project's `grep` picks it up. Add `@mobile-cross-platform` if it
   should run on both.
2. Call `shouldSkipAndroid()` / `shouldSkipIos()` in a `beforeAll` so the
   spec self-skips when the platform isn't available.
3. Pull capabilities from `fixtures/capabilities.ts` — extend that file
   if you need a different system app or custom caps.

## Troubleshooting

**"Appium not reachable"** — verify `appium` is running on the URL and
`curl $APPIUM_URL/status` returns a ready payload.

**"no booted Android emulator"** — `adb devices` must list at least one
device in `device` state (not `offline` or `unauthorized`).

**"no booted iOS simulator"** — `xcrun simctl list devices booted` must
list at least one device in `Booted` state.

**Tests hang on session creation** — Appium may be waiting on a slow
driver init; check the Appium server log. UIA2 first run can take 30-60s
while UiAutomator2 server installs onto the emulator.
