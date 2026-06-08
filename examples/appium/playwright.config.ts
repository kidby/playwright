import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './',
  // To run on multiple emulators in parallel, set workers and list devices:
  //   workers: 2,
  //   use: {
  //     appium: {
  //       autoStart: true,
  //       devices: [
  //         { udid: 'emulator-5554' },
  //         { udid: 'emulator-5556' },
  //       ],
  //     },
  //   },
  // The fixture rotates devices by workerIndex and auto-allocates per-worker
  // systemPort (UIA2) / wdaLocalPort (XCUITest) so drivers don't collide.
  use: {
    appium: { autoStart: true, reuseExistingServer: true },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
});
