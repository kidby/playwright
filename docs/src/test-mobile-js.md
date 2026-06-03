---
id: test-mobile
title: "Mobile (experimental)"
---

## Introduction

[`@playwright/experimental-mobile`](https://github.com/microsoft/playwright/tree/main/packages/playwright-mobile) is a separate package that lets Playwright drive native iOS and Android apps via [Appium 2](https://appium.io). It provides a `mobileTest` fixture and a `NativeDevice` + `AppLocator` API that mirrors Playwright's web `Page` + `Locator` shape.

The package speaks the W3C WebDriver protocol directly to an Appium 2 server — no `selenium-webdriver` or `webdriverio` runtime dependency.

It complements (does not replace) Playwright's existing native [`_android`](./api/class-android.md) driver: `_android` controls a Chromium-based Android browser via DevTools; `@playwright/experimental-mobile` controls any native app via Appium.

## Install

```bash
npm i -D @playwright/experimental-mobile
```

You also need a running Appium 2 server and the appropriate driver (`xcuitest` for iOS, `uiautomator2` for Android). See the [Appium docs](https://appium.io/docs/en/latest/quickstart/install/).

## Example

```js
import { mobileTest as test, expect, iosCapabilities } from '@playwright/experimental-mobile';

test.use({
  capabilities: iosCapabilities({
    platformVersion: '17.5',
    deviceName: 'iPhone 15',
    app: '/path/to/MyApp.app',
  }),
});

test('login flow', async ({ device }) => {
  await device.app.byAccessibilityId('Username').fill('alice');
  await device.app.byAccessibilityId('Password').fill('secret');
  await device.app.byAccessibilityId('Login').click();

  await expect(device.app.byText('Welcome, Alice')).toBeVisible();
});
```

## Fixtures

The `mobileTest` test instance contributes these fixtures on top of standard Playwright:

| Fixture | Type | Notes |
|---|---|---|
| `device` | `NativeDevice` | The connected Appium session. |
| `capabilities` | `AppiumCapabilities` | Required — set per project, per test via `test.use(...)`, or via `appium.capabilities` in `playwright.config.ts` (preferred). |
| `appiumServerUrl` | `string` | Defaults to `appium.serverUrl` from config, then `process.env.APPIUM_URL`, then `http://127.0.0.1:4723`. |
| `descriptor` | `DeviceDescriptor \| undefined` | Pass `devices['iPhone 15']` to give Playwright the metadata for screenshot baseline naming. |
| `defaultActionTimeoutMs` | `number` | Per-action timeout for the `AppLocator` API. Defaults to 20s locally / 30s in CI. |

## Appium server in `playwright.config.ts`

You can declare the Appium server URL, capabilities, and an `autoStart` flag directly in `playwright.config.ts` via the `appium` test option. When `autoStart: true`, Playwright spawns and tears down the Appium server for you (mirrors the `webServer` config pattern).

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';
import { androidCapabilities, iosCapabilities } from '@playwright/mobile';

export default defineConfig({
  projects: [
    {
      name: 'android-pixel7',
      use: {
        appium: {
          serverUrl: 'http://localhost:4723',
          capabilities: androidCapabilities({
            deviceName: 'Pixel_7_API_34',
            app: '/path/to/app.apk',
          }),
          autoStart: true,
        },
      },
    },
    {
      name: 'ios-simulator',
      use: {
        appium: {
          serverUrl: 'http://localhost:4724',
          capabilities: iosCapabilities({
            deviceName: 'iPhone 15',
            platformVersion: '17.5',
            app: '/path/to/app.app',
          }),
          autoStart: true,
        },
      },
    },
  ],
});
```

Precedence for resolving capabilities at runtime: project `appium.capabilities` → per-test `test.use({ capabilities })` → `process.env.APPIUM_URL` / env-var fallbacks. The standalone `capabilities` fixture (legacy) still works but is superseded by the config-driven path.

When two projects share a `serverUrl` and both set `autoStart: true`, the second one short-circuits via `reuseExistingServer: true` (default). Set it to `false` if you want strict ownership of the port. See [`TestOptions.appium`](./test-api/class-testoptions.mdx#test-options-appium) for the full option list.

## API surface

* `device.app` — root `AppLocator` (chainable: `byAccessibilityId`, `byId`, `byXpath`, `byClassName`, `byIosPredicate`, `byIosClassChain`, `byAndroidUiSelector`, `getByText`, `getByLabel`, `getByTestId`).
* `AppLocator` actions — `click`, `fill`, `type`, `text`, `getAttribute`, `isVisible`, `isDisplayed`, `isEnabled`, `count`, `screenshot`, plus chaining via `byXpath` etc.
* `device` lifecycle — `screenshot`, `pageSource`, `snapshot` (YAML), `switchToContext`, `webViewContexts`, `pressBack`/`pressEnter`/`pressDelete`/`pressTab`, `hideKeyboard`, `handleAlert`, `shell`, `activateApp`, `pushFile`, `pullFile`, `wait`, `waitUntil`, `startScreenRecording`/`stopScreenRecording`.
* `device.client` — raw `AppiumClient` escape hatch for protocol commands not yet covered by the typed API (e.g., `executeScript('mobile: setLocale', [{...}])`).
* `device.gestures` — `swipe`, `tap`, `longPress`, `doubleTap`, `scrollToElement`, `pullToRefresh`.

## Failure artifacts

On test failure, the fixture automatically attaches a `mobile-snapshot` (YAML page source) and a `mobile-screenshot` (PNG) via `captureFailureArtifacts`. These show up in the HTML reporter alongside web traces, and the snapshot drives the AI error-context feature for native apps.

See the [package README](https://github.com/microsoft/playwright/tree/main/packages/playwright-mobile#readme) for the full API reference, capability helpers (`iosCapabilities`, `androidCapabilities`), and integration patterns with the standard Playwright `test`.
