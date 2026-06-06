import { test } from '@playwright/mobile';
import { LoginPage } from '../pages/LoginPage';

test('Mac POM: User can login successfully on native macOS app', async ({ device }) => {
  await device.createSession({
    platformName: 'Mac',
    'appium:automationName': 'Mac2',
    // Bundle ID of the macOS application to test
    'appium:bundleId': 'com.example.DemoApp', 
  });

  const loginPage = new LoginPage(device);

  await test.step('Navigate to login screen', async () => {
    await loginPage.navigateToLogin();
  });

  await test.step('Perform login with valid credentials', async () => {
    await loginPage.login('bob@example.com', '10203040');
  });

  await test.step('Verify successful login', async () => {
    // Accessibility IDs are usually cross-platform in React Native/MAUI apps
    await loginPage.verifyLoginSuccess();
  });

  await device.deleteSession();
});
