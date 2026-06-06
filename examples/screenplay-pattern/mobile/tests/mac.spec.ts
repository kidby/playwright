import { test, expect } from '@playwright/mobile';
import { Actor } from '../../core/Actor';
import { OperateDevice } from '../abilities/OperateDevice';
import { Login } from '../tasks/Login';
import { LoginState } from '../questions/LoginState';

test('Mac Screenplay: User can login successfully', async ({ device }) => {
  await device.createSession({
    platformName: 'Mac',
    'appium:automationName': 'Mac2',
    'appium:bundleId': 'com.example.DemoApp', 
  });

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
