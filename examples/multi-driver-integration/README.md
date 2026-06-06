# Multi-Driver Integration Example

This example demonstrates how to orchestrate multiple automated targets in a single Playwright test.

Playwright's fixture system makes it easy to spin up a web `page`, alongside an `android` device, an `ios` device, and a `windows` desktop app, all communicating in real-time.

## The Test File

[`multi-platform.spec.ts`](./multi-platform.spec.ts) showcases two common multi-driver scenarios:

### 1. Cross-Platform Sync
A user performs an action on a web dashboard (e.g. sending a push notification), and the test concurrently validates that the push notification is received on both the native Android and native iOS apps.

### 2. Desktop to Web Handoff
A user performs complex operations in a Windows desktop app (using WinAppDriver), extracts the result, and inputs it into a Web form.

## Running the Examples

Since these tests instantiate real driver sessions targeting local `localhost:4723` Appium servers, you'll need the respective Appium drivers running (UiAutomator2, XCUITest, Windows) to execute them fully:

```bash
# Start an Appium server
npx appium

# Run the integration test
npx playwright test examples/multi-driver-integration/multi-platform.spec.ts
```
