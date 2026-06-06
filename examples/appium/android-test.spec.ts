import { test, expect } from '@playwright/mobile';
import { androidCapabilities } from '@playwright/mobile/capabilities';

test('Android app basic interactions', async ({ device }) => {
  // 1. Establish session with Appium Server
  await device.createSession(
    androidCapabilities({
      app: 'path/to/your/app.apk',
      deviceName: 'emulator-5554',
      platformVersion: '11.0'
    })
  );

  // 2. Interact with native elements using Appium standard locator strategies
  const loginButton = device.locator('id=my.app:id/submit_button');
  await expect(loginButton).toBeVisible();
  await loginButton.tap();

  // 3. Take screenshots matching baseline
  await expect(device).toHaveScreenshot('login-screen.png');

  // 4. Fill text and make assertions
  const input = device.locator('id=my.app:id/input_field');
  await input.fill('Hello Playwright');
  await expect(input).toHaveText('Hello Playwright');

  // 5. Cleanup
  await device.deleteSession();
});
