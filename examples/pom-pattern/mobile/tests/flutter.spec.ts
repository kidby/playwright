import { test } from '@playwright/mobile';
import { LoginPage } from '../pages/LoginPage';

test('Flutter POM: User can login successfully on Flutter app', async ({ device }) => {
  await device.createSession({
    platformName: 'Android',
    'appium:automationName': 'Flutter',
    // URL or path to the Flutter APK
    'appium:app': 'https://example.com/flutter-demo-app.apk', 
  });

  const loginPage = new LoginPage(device);

  await test.step('Navigate to login screen', async () => {
    await loginPage.navigateToLogin();
  });

  await test.step('Perform login with valid credentials', async () => {
    await loginPage.login('bob@example.com', '10203040');
  });

  await test.step('Verify successful login', async () => {
    // Accessibility IDs (Semantics nodes in Flutter) are cross-platform
    await loginPage.verifyLoginSuccess();
  });

  await device.deleteSession();
});
