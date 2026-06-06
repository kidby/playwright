import { test } from '@playwright/mobile';
import { iosCapabilities } from '@playwright/mobile/capabilities';
import { LoginPage } from '../pages/LoginPage';

test('iOS POM: User can login successfully on native iOS app', async ({ device }) => {
  await device.createSession(
    iosCapabilities({
      app: 'https://github.com/saucelabs/my-demo-app-rn/releases/download/v1.3.0/iOS-Simulator-MyRNDemoApp.1.3.0-162.zip',
      deviceName: 'iPhone 14 Pro',
      platformVersion: '16.4'
    })
  );

  const loginPage = new LoginPage(device);

  await test.step('Navigate to login screen', async () => {
    await loginPage.navigateToLogin();
  });

  await test.step('Perform login with valid credentials', async () => {
    await loginPage.login('bob@example.com', '10203040');
  });

  await test.step('Verify successful login', async () => {
    // Accessibility IDs are usually cross-platform in React Native apps
    await loginPage.verifyLoginSuccess();
  });

  await device.deleteSession();
});
