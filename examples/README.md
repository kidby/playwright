# Playwright Integrations Examples

This directory contains advanced examples demonstrating how to use the `@playwright/mobile` (Appium), `@playwright/lighthouse`, and `@playwright/storybook` integrations.

The examples are structured around two industry-standard testing patterns:
1. **Page Object Model (POM)**: Found in `pom-pattern/`
2. **Screenplay Pattern**: Found in `screenplay-pattern/`

## Running the Examples

### Appium (Mobile)
Zero-configuration is now supported! Playwright will automatically spawn the internal Appium daemon and install required drivers in the background based on your `playwright.config.ts`.
The examples use a public Android APK from SauceLabs.

```bash
npx playwright test examples/pom-pattern/mobile/tests/login.spec.ts
npx playwright test examples/screenplay-pattern/mobile/tests/login.spec.ts
```

### Lighthouse (Web Performance)
Zero-configuration is supported natively! The `lighthouseTest` fixture automatically connects to the browser over the internal Playwright CDPSession WebSocket. You do not need to manually configure debugging ports. 
Cross-browser skipping is also handled automatically (Lighthouse only runs on Chromium).

```bash
npx playwright test examples/pom-pattern/web/tests/performance.spec.ts
npx playwright test examples/screenplay-pattern/web/tests/performance.spec.ts
```

### Storybook (Component Testing)
With the new Dual-Engine architecture, you can test against a running Storybook server (E2E mode) or compile the components dynamically using Playwright CT (CT mode). 

```bash
npx playwright test examples/pom-pattern/components/tests/button.spec.ts
```

## Structure
- `pom-pattern/`: Traditional Page Object classes encapsulating locators and actions.
- `screenplay-pattern/`: Actor-centric design separating Abilities (e.g. OperateDevice), Tasks (e.g. Login), and Questions (e.g. LoginState).
