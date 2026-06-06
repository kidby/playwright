import { test as baseTest, expect as webExpect } from '@playwright/test';
import { expect as mobileExpect, NativeDevice, androidCapabilities, iosCapabilities } from 'playwright/experimental-mobile';

// We can extend the Playwright test fixture to spin up mobile devices alongside the web page!
const test = baseTest.extend<{ android: NativeDevice; ios: NativeDevice; windows: NativeDevice; mac: NativeDevice; flutter: NativeDevice }>({
  android: async ({}, use) => {
    // Connect to local Appium server for Android
    const caps = androidCapabilities({ appPackage: 'com.example.android', appActivity: '.MainActivity' });
    const device = await NativeDevice.start('http://127.0.0.1:4723', caps);
    await use(device);
    await device.stop();
  },
  ios: async ({}, use) => {
    // Connect to local Appium server for iOS
    const caps = iosCapabilities({ bundleId: 'com.example.ios' });
    const device = await NativeDevice.start('http://127.0.0.1:4723', caps);
    await use(device);
    await device.stop();
  },
  windows: async ({}, use) => {
    // Connect to WinAppDriver / Windows Appium Server
    const caps = {
      platformName: 'Windows',
      'appium:automationName': 'Windows',
      'appium:app': 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'
    };
    const device = await NativeDevice.start('http://127.0.0.1:4723', caps);
    await use(device);
    await device.stop();
  },
  mac: async ({}, use) => {
    // Connect to Mac2Driver for macOS
    const caps = {
      platformName: 'Mac',
      'appium:automationName': 'Mac2',
      'appium:bundleId': 'com.apple.calculator'
    };
    const device = await NativeDevice.start('http://127.0.0.1:4723', caps);
    await use(device);
    await device.stop();
  },
  flutter: async ({}, use) => {
    // Connect to Appium Flutter Driver
    const caps = {
      platformName: 'Android',
      'appium:automationName': 'Flutter',
      'appium:app': '/path/to/flutter-app.apk'
    };
    const device = await NativeDevice.start('http://127.0.0.1:4723', caps);
    await use(device);
    await device.stop();
  }
});

test('Cross-platform sync: Web triggers Mobile notification', async ({ page, android, ios }) => {
  // 1. Trigger an action on the Web Dashboard
  await page.goto('https://example.com/admin');
  await page.getByRole('button', { name: 'Send Push Notification' }).click();

  // 2. Verify the notification arrived on the Android device
  const androidNotification = android.app.getByText('New Message Received');
  await mobileExpect(androidNotification).toBeVisible({ timeout: 10000 });
  await androidNotification.tap();

  // 3. Verify the notification arrived on the iOS device
  const iosNotification = ios.app.getByText('New Message Received');
  await mobileExpect(iosNotification).toBeVisible({ timeout: 10000 });
  await iosNotification.tap();

  // 4. Verify the web dashboard shows 'Delivered'
  await webExpect(page.getByText('Status: Delivered to all devices')).toBeVisible();
});

test('Desktop to Web integration', async ({ page, windows }) => {
  // Example: Copy a calculated value from a Windows Desktop app to a Web form
  
  // 1. Calculate in Desktop App (Windows Calculator)
  await windows.app.byAccessibilityId('num1Button').click();
  await windows.app.byAccessibilityId('plusButton').click();
  await windows.app.byAccessibilityId('num2Button').click();
  await windows.app.byAccessibilityId('equalButton').click();
  
  const result = await windows.app.byAccessibilityId('CalculatorResults').text();
  const numericResult = result.replace('Display is ', '').trim();

  // 2. Submit calculated value to the Web App
  await page.goto('https://example.com/accounting');
  await page.getByPlaceholder('Enter result').fill(numericResult);
  await page.getByRole('button', { name: 'Submit' }).click();

  await webExpect(page.getByText('Calculation saved successfully')).toBeVisible();
});

test('Mac to Flutter integration', async ({ mac, flutter }) => {
  // Example: macOS native app modifies a state that syncs to a Flutter mobile app
  
  // 1. Perform action on macOS native calculator (just as an example native app)
  await mac.app.getByRole('button', { name: '9' }).click();
  await mac.app.getByRole('button', { name: 'multiply' }).click();
  await mac.app.getByRole('button', { name: '9' }).click();
  await mac.app.getByRole('button', { name: 'equals' }).click();
  
  const macResult = await mac.app.byAccessibilityId('mainDisplay').text();
  
  // 2. Verify state synced to the Flutter app
  // Flutter uses `accessibility id` for `Semantics` labels natively
  const flutterDisplay = flutter.app.getByTestId('sync-display');
  await mobileExpect(flutterDisplay).toHaveText(macResult, { timeout: 15000 });
});
