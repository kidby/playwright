import { test, expect } from '@playwright/mobile';
import { iosCapabilities } from '@playwright/mobile/capabilities';
import { Actor } from '../../core/Actor';
import { OperateDevice } from '../abilities/OperateDevice';
import { Login } from '../tasks/Login';
import { LoginState } from '../questions/LoginState';

test('iOS Screenplay: User can login successfully', async ({ device }) => {
  await device.createSession(
    iosCapabilities({
      app: 'https://github.com/saucelabs/my-demo-app-rn/releases/download/v1.3.0/iOS-Simulator-MyRNDemoApp.1.3.0-162.zip',
      deviceName: 'iPhone 14 Pro',
      platformVersion: '16.4'
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
