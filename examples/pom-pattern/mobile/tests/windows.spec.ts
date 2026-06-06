import { test } from '@playwright/mobile';
import { LoginPage } from '../pages/LoginPage';

test('Windows POM: User can login successfully on native Windows app', async ({ device }) => {
  await device.createSession({
    platformName: 'Windows',
    'appium:automationName': 'Windows',
    // App ID of the Windows application to test
    'appium:app': 'com.example.DemoApp_8wekyb3d8bbwe!App', 
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
