import { test } from '@playwright/mobile';
import { androidCapabilities } from '@playwright/mobile/capabilities';
import { LoginPage } from '../pages/LoginPage';

test('Mobile POM: User can login successfully', async ({ device }) => {
  // Setup: Use a publicly available demo APK
  await device.createSession(
    androidCapabilities({
      app: 'https://github.com/saucelabs/my-demo-app-rn/releases/download/v1.3.0/Android-MyDemoAppRN.1.3.0.build-244.apk',
      deviceName: 'emulator-5554',
      platformVersion: '11.0'
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
    await loginPage.verifyLoginSuccess();
  });

  // Cleanup
  await device.deleteSession();
});
