import { test, expect } from '@playwright/mobile';
import { androidCapabilities } from '@playwright/mobile/capabilities';
import { Actor } from '../../core/Actor';
import { OperateDevice } from '../abilities/OperateDevice';
import { Login } from '../tasks/Login';
import { LoginState } from '../questions/LoginState';

test('Mobile Screenplay: User can login successfully', async ({ device }) => {
  await device.createSession(
    androidCapabilities({
      app: 'https://github.com/saucelabs/my-demo-app-rn/releases/download/v1.3.0/Android-MyDemoAppRN.1.3.0.build-244.apk',
      deviceName: 'emulator-5554',
      platformVersion: '11.0'
    })
  );

  const alice = Actor.named('Alice').whoCan('OperateDevice', OperateDevice.using(device));

  await test.step('Alice attempts to login with valid credentials', async () => {
    await alice.attemptsTo(
      Login.withCredentials('bob@example.com', '10203040')
    );
  });

  await test.step('Alice verifies she is successfully logged in', async () => {
    const isSuccessful = await alice.asks(LoginState.isSuccessful());
    expect(isSuccessful).toBe(true);
  });

  await device.deleteSession();
});
