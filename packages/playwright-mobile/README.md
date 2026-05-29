# @playwright/experimental-mobile

Appium-driven mobile test automation for iOS and Android, exposed through a Playwright-shaped `mobileTest` fixture. Speaks W3C WebDriver classic to an Appium 2 server (default `http://127.0.0.1:4723`); no `selenium-webdriver` or `webdriverio` runtime dependency.

## When to use this vs. `_android`

Playwright already ships a native `_android` API (`packages/playwright-core/src/server/android/`) that drives Android devices over ADB and uses the Android JUnit instrumentation driver. The two cover different ground.

| | `_android` (native) | `@playwright/experimental-mobile` (Appium) |
|---|---|---|
| Underlying protocol | ADB + custom JUnit driver + CDP | Appium 2 over HTTP, W3C WebDriver classic |
| Strength | Chrome / Chromium-on-Android automation via full CDP, ADB shell, file push/pull, screen capture | Native app automation across iOS *and* Android, full element tree, gesture extensions |
| Element queries | Android accessibility tree only (`res`, `pkg`, `desc`, `text`, `clazz`) | Any Appium strategy: accessibility id, XPath, class chain, predicate, UiAutomator |
| iOS | **Not supported** | XCUITest |
| Hybrid native↔webview | Limited webview detection | Built-in: `device.waitForWebViewContext`, `switchToWebViewContext` |

Pick `_android` when you're testing Chrome-on-Android with full CDP (network mocking, performance, headless). Pick this package when you're testing a native iOS or Android app, or when you need both platforms with one API. Both can coexist in the same `playwright.config.ts` as separate fixtures.

## Quick start

```ts
import { mobileTest as test, expect, androidCapabilities } from '@playwright/experimental-mobile';

test.use({
  capabilities: androidCapabilities({
    app: 'apks/dev.apk',
    appPackage: 'com.example.dev',
  }),
});

test('login then check the dashboard', async ({ device }) => {
  await device.app.byAccessibilityId('email').fill('user@example.com');
  await device.app.byAccessibilityId('password').fill('p4ssw0rd');
  await device.app.byAccessibilityId('signin').click();
  await device.waitForVisible(device.app.byAccessibilityId('dashboard'));
});
```

iOS is the symmetric case:

```ts
import { iosCapabilities } from '@playwright/experimental-mobile';

test.use({
  capabilities: iosCapabilities({
    app: 'apps/dev.app',
    bundleId: 'com.example.dev',
  }),
});
```

## API areas

### Device session

`NativeDevice.start(serverUrl, capabilities, { descriptor? })` creates a new Appium session. `NativeDevice.attach(serverUrl, sessionId, { descriptor? })` reuses one. The `mobileTest` fixture handles both for you, and the test-side fixture key stays `device` (lowercase) — only the class name carries the `Native` prefix, to disambiguate from Playwright web's `devices['iPhone 15']` descriptor.

```ts
device.platform                // 'iOS' | 'Android' | undefined
device.isAndroid / device.isIos
device.contexts() / currentContext() / switchToContext(name)
device.screenshot(): Promise<Buffer>
device.stop(): Promise<void>

device.descriptor              // the Playwright DeviceDescriptor, if supplied
device.deviceScaleFactor       // number | undefined — from descriptor, else `appium:pixelRatio`
device.viewport()              // { width, height } — from descriptor, else live from Appium
```

### Locators

`device.app` is the root `AppLocator`. Chain selectors to drill in:

```ts
device.app.byAccessibilityId('cart')        // accessibility id (W3C)
device.app.byXpath('//XCUIElementTypeButton[@name="Done"]')
device.app.byClassName('android.widget.EditText')
device.app.byIosPredicate('name == "Search"')
device.app.byIosClassChain('**/XCUIElementTypeButton[`name == "Done"`]')
device.app.byAndroidUiSelector('new UiSelector().text("Submit")')
device.app.byId('com.example:id/submit')
```

Locators are lazy — they resolve to an element only when an action runs. Action surface: `click()`, `fill(text)`, `type(text)`, `text()`, `getAttribute(name)`, `isDisplayed()`, `count()`. Each action accepts an optional `{ timeout }` to override `device.defaultActionTimeoutMs`.

#### Semantic queries

Platform-aware shortcuts so one test reads the same on iOS and Android. The right Appium strategy is picked from the session's `platformName`:

```ts
device.app.getByText('Submit')          // iOS predicate `label CONTAINS[c]` / Android UiAutomator textContains
device.app.getByText(/Item \d+/)         // RegExp → MATCHES / textMatches
device.app.getByLabel('Email')           // iOS accessibility id / Android content-desc
device.app.getByTestId('save-btn')       // accessibility id on both platforms
device.app.getByType('Button')           // iOS XCUIElementTypeButton / Android android.widget.Button
```

Chains compose with the existing `byX()` calls and with `filter() / first() / nth() / last()`.

### Assertions

`expect.extend(mobileMatchers)` is registered when you `import` from this package, so the standard `expect` exported here understands locators and the device:

```ts
import { mobileTest as test, expect } from '@playwright/experimental-mobile';

test('login', async ({ device }) => {
  await expect(device.app.getByTestId('email')).toBeVisible();
  await expect(device.app.getByTestId('signin')).toBeEnabled();
  await expect(device.app.getByText('Welcome back')).toHaveText(/Welcome/);
  await expect(device).toHaveScreenshot();   // full-screen baseline
});
```

Matcher surface: `toBeVisible`, `toBeHidden`, `toBeEnabled`, `toBeDisabled`, `toHaveText`, `toContainText`, `toHaveAttribute`, `toHaveValue`, `toHaveCount`, `toBeChecked`, `toBeFocused`, `toHaveScreenshot`. Each polls until the condition is met or the matcher timeout fires (default: `device.defaultActionTimeoutMs`).

`toHaveScreenshot` works on both `device` (full-screen) and a locator (element-level via W3C `/element/{id}/screenshot`). Baseline filenames include the platform, `appium:deviceName`, and — when a `DeviceDescriptor` is supplied — an `@Nx` suffix from `deviceScaleFactor` so iPhone 15 (3x) and iPad Air (2x) baselines don't collide.

### WebView contexts

```ts
device.webViewContexts(): Promise<WebViewContextDescriptor[]>
device.waitForWebViewContext({ title, url, packageOrBundleId, timeoutMs?, pollMs? })
device.switchToWebViewContext(sel)   // waits + switches
```

Selectors accept `string | RegExp` for `title` and `url`. Android multi-page webviews surface each `WEBVIEW_pkg/pageId` as its own descriptor with `attached` and `visible` flags. Non-attached or non-visible pages are skipped from matches.

### Keyboard + key events

```ts
device.pressBack() / pressEnter() / pressDelete() / pressTab()    // Android only
device.pressAndroidKey('HOME' | 'SEARCH' | ...)                   // Android only
device.hideKeyboard()                                              // both; silent on no-keyboard
```

Android key codes (`BACK=4`, `HOME=3`, `ENTER=66`, `TAB=61`, `DELETE=112`, `SEARCH=84`) are exposed via the `AndroidKey` union.

### Page source + accessibility snapshot

```ts
device.pageSource(): Promise<string>     // raw Appium XML
device.snapshot(): Promise<string>        // YAML accessibility tree, AI-reporter-ready
```

The snapshot maps native element classes (`XCUIElementTypeButton`, `android.widget.EditText`, etc.) to semantic ARIA-like roles. Interactable nodes get ref labels (`[ref=m1]`, `[ref=m2]`, …) so LLM-driven test repair tools can address them by id.

Or use `convertPageSourceToSnapshot(pageSource, platform)` / `parsePageSource(...)` directly when you already have the XML in hand.

**Auto-capture on failure:** the `mobileTest` fixture automatically attaches `mobile-snapshot` (YAML) and `mobile-screenshot` (PNG) to any test that fails or times out. The `ai` reporter inlines the YAML snapshot into the failure briefing under a "Mobile UI snapshot" section so an LLM-driven triage tool sees the accessibility tree without re-running the test. No spec-side code needed.

### Lifecycle + device system

```ts
device.shell(command, args?): Promise<string>     // Android only
device.activateApp(bundleId)
device.terminateApp(bundleId)
device.pushFile(remotePath, content)              // Buffer | string
device.pullFile(remotePath): Promise<Buffer>
device.filesCount(directory, grepPattern?)        // Android only
```

### Alerts

```ts
device.handleAlert({ action: 'accept' | 'dismiss', buttonName?, retries?, pollMs? })
```

Retries up to `retries` (default 10) with `pollMs` (default 500ms) backoff. Returns silently after exhausting retries — alert may or may not have been present, the test shouldn't fail on its absence.

### Form input

```ts
device.setValue(locator, value, opts?)
```

Clicks to focus, clears (with Android `mobile: longClickGesture` fallback if `/clear` errors), then sends keys. Pass `{ clearBefore: false }` to type without clearing.

### Polling helpers

```ts
device.waitForVisible(target, { timeoutMs?, pollMs? })
device.tapUntilVisible(target, { scrollTarget?, maxTaps?, direction?, timeoutMs?, pollMs? })
```

`waitForVisible` honors `device.defaultActionTimeoutMs` (settable; defaults to 30s under `CI`, 20s otherwise — wired automatically from the `mobileTest` fixture). `tapUntilVisible` caps on whichever of `maxTaps` or `timeoutMs` fires first.

### Gestures

```ts
device.gestures.swipe({ direction, target?, distance?, durationMs? })
device.gestures.tap({ target? | x?, y? })
device.gestures.longPress({ target, durationMs? })
device.gestures.doubleTap({ target? | x?, y? })
device.gestures.scrollToElement({ target, direction?, percent? })
device.gestures.pullToRefresh({ fromYFraction?, toYFraction?, durationMs? })
```

Cross-platform: each gesture picks the right Appium `mobile:` extension command based on session `platformName`. iOS commands use percentages and element ids; Android takes absolute coordinates from window rect.

### Capability builders

```ts
androidCapabilities({ app?, appPackage?, appActivity?, deviceName?, platformVersion?, udid?, noReset?, newCommandTimeoutSec?, extra? })
iosCapabilities({ app?, bundleId?, deviceName?, platformVersion?, udid?, noReset?, newCommandTimeoutSec?, extra? })
```

Both default `newCommandTimeoutSec` to 240. Use `extra` to pass any capability the builders don't know about.

## Configuration

The `mobileTest` fixture exposes three option fixtures you can override in `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [
    {
      name: 'android-smoke',
      use: {
        appiumServerUrl: 'http://appium.internal:4723',
        capabilities: androidCapabilities({ app: 'apks/smoke.apk' }),
        defaultActionTimeoutMs: 25_000,
      },
    },
  ],
});
```

`appiumServerUrl` also reads `APPIUM_URL` from the environment if not set.

### Device profiles via Playwright `devices`

Pass any entry from Playwright's exported `devices` map as the `descriptor` option to give the session metadata (viewport, pixel ratio, user agent) that the screenshot matcher and `device.viewport()` use. The descriptor is **metadata only** — it does not synthesize Appium capabilities, since the iOS-name → simulator-version mapping is too lossy to do automatically.

```ts
import { devices } from '@playwright/test';
import { mobileTest as test, iosCapabilities } from '@playwright/experimental-mobile';

test.use({
  capabilities: iosCapabilities({ bundleId: 'com.example.dev', deviceName: 'iPhone 15 Sim' }),
  descriptor: devices['iPhone 15'],
});

test('captures @3x baseline automatically', async ({ device }) => {
  expect(device.deviceScaleFactor).toBe(3);
  expect((await device.viewport()).width).toBe(393);
  await expect(device).toHaveScreenshot();   // baseline: …-iOS-iPhone-15-Sim-@3x.png
});
```

Types: `import type { DeviceDescriptor, MobileTestArgs, MobileTestOptions, Viewport } from '@playwright/experimental-mobile'`. Use `MobileTestArgs` when extending the fixture (`test.extend<MyArgs & MobileTestArgs>(…)`); use `MobileTestOptions` for the option-only shape passed to `test.use({…})`.

### Smoke testing against a real Appium server

The package ships with a skipped-by-default smoke spec that exercises the W3C client against a live Appium 2.x server. It does not require a connected device — only Appium itself.

```bash
APPIUM_TEST=1 APPIUM_URL=http://127.0.0.1:4723 npx playwright test \
  --config=tests/mobile/playwright.config.ts real-appium
```

Without `APPIUM_TEST=1` the three tests show as skipped with a clear reason. Useful for catching Appium 2 API drift before it breaks a real test run.

## Limitations + known gaps

- **No iOS-specific text-menu clear fallback.** `device.setValue` uses the W3C `/clear` endpoint, falling back to `mobile: longClickGesture` on Android only. iOS text fields that don't honor `/clear` (e.g., some secure inputs) need a custom routine.
- **No Sauce / BrowserStack adapters.** Vendor-cloud integrations belong above this package — pass cloud credentials through `appiumServerUrl` + `extra` capabilities.
- **No native push notifications API.** Use platform-specific approaches (ADB intent, `mobile: pushNotification` if your Appium server supports it).
- **Phase B handleAlert: silent-on-exhaust.** If you need an alert to be present, check explicitly via your test logic — `handleAlert` returns silently after retries because alerts may or may not appear depending on system state.
