import { test, expect } from '@playwright/test';
import { _android as android } from 'playwright';

// Benchmark Script for Playwright's newly re-architected Native Appium Dispatcher
// Run this on your local machine with an actual Android Emulator or iOS Simulator booted.

test('Mobile Benchmark: Server-side Polling Overhead', async () => {
  test.skip(true, 'Requires a live Android emulator and Appium server');
  // 1. Connect to your local Appium server using the new `playwright-core` backend
  // Note: Appium 2.x server must be running locally via `npx appium`
  const device = await android.connectToAppium('http://localhost:4723', {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    // 'appium:app': '/path/to/your/app.apk'
  });

  // Warmup
  const startBtn = device.locator('~Start Benchmark');
  
  console.log('Starting Benchmark... 🏎️');
  const startTime = Date.now();

  // The new server-side dispatcher will now execute this natively within the C++ loop.
  // It avoids the node-user-land REST bottlenecks of the previous architecture.
  for (let i = 0; i < 50; i++) {
    // 50 sequential clicks, verifying visibility and actionable state each time.
    await startBtn.click();
    
    // Server-side polling to verify the counter updated
    await expect(device.locator(`~Counter-${i + 1}`)).toBeVisible({ timeout: 1000 });
  }

  const endTime = Date.now();
  console.log(`✅ 50 interactions completed in ${endTime - startTime}ms`);
  
  // Close the session
  await device.close();
});
