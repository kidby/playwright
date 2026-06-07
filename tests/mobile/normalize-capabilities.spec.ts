/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from '@playwright/test';

import {
  androidCapabilities,
  iosCapabilities,
  normalizeCapabilities,
} from '../../packages/playwright-mobile/src/capabilities.js';

// ---------------------------------------------------------------------------
// normalizeCapabilities - passthrough
// ---------------------------------------------------------------------------

test('normalizeCapabilities passes through already-normalized capabilities', () => {
  const input = {
    platformName: 'Android' as const,
    'appium:automationName': 'UiAutomator2' as const,
    'appium:app': 'apks/dev.apk',
  };
  const result = normalizeCapabilities(input);
  expect(result).toBe(input); // same reference, no copy
});

test('normalizeCapabilities passes through output of androidCapabilities()', () => {
  const input = androidCapabilities({ app: 'apks/dev.apk' });
  const result = normalizeCapabilities(input);
  expect(result).toBe(input);
});

test('normalizeCapabilities passes through output of iosCapabilities()', () => {
  const input = iosCapabilities({ bundleId: 'com.example' });
  const result = normalizeCapabilities(input);
  expect(result).toBe(input);
});

// ---------------------------------------------------------------------------
// normalizeCapabilities - Android inference
// ---------------------------------------------------------------------------

test('normalizeCapabilities infers Android from appPackage key', () => {
  const result = normalizeCapabilities({ appPackage: 'com.example.dev' });
  expect(result.platformName).toBe('Android');
  expect(result['appium:automationName']).toBe('UiAutomator2');
  expect(result['appium:appPackage']).toBe('com.example.dev');
});

test('normalizeCapabilities infers Android from appActivity key', () => {
  const result = normalizeCapabilities({ appActivity: '.MainActivity' });
  expect(result.platformName).toBe('Android');
  expect(result['appium:appActivity']).toBe('.MainActivity');
});

test('normalizeCapabilities infers Android from .apk file extension', () => {
  const result = normalizeCapabilities({ app: 'apks/dev.apk' });
  expect(result.platformName).toBe('Android');
  expect(result['appium:app']).toBe('apks/dev.apk');
});

test('normalizeCapabilities defaults to Android when no platform signals present', () => {
  const result = normalizeCapabilities({ deviceName: 'emulator-5554' });
  expect(result.platformName).toBe('Android');
});

test('normalizeCapabilities maps all Android shorthand keys', () => {
  const result = normalizeCapabilities({
    app: 'apks/dev.apk',
    appPackage: 'com.example',
    appActivity: '.Main',
    deviceName: 'Pixel 8',
    platformVersion: '14',
    udid: 'emulator-5554',
    noReset: true,
    newCommandTimeoutSec: 60,
  });
  expect(result['appium:app']).toBe('apks/dev.apk');
  expect(result['appium:appPackage']).toBe('com.example');
  expect(result['appium:appActivity']).toBe('.Main');
  expect(result['appium:deviceName']).toBe('Pixel 8');
  expect(result['appium:platformVersion']).toBe('14');
  expect(result['appium:udid']).toBe('emulator-5554');
  expect(result['appium:noReset']).toBe(true);
  expect(result['appium:newCommandTimeout']).toBe(60);
});

// ---------------------------------------------------------------------------
// normalizeCapabilities - iOS inference
// ---------------------------------------------------------------------------

test('normalizeCapabilities infers iOS from bundleId key', () => {
  const result = normalizeCapabilities({ bundleId: 'com.example.myapp' });
  expect(result.platformName).toBe('iOS');
  expect(result['appium:automationName']).toBe('XCUITest');
  expect(result['appium:bundleId']).toBe('com.example.myapp');
});

test('normalizeCapabilities infers iOS from .app file extension', () => {
  const result = normalizeCapabilities({ app: 'apps/MyApp.app' });
  expect(result.platformName).toBe('iOS');
  expect(result['appium:app']).toBe('apps/MyApp.app');
});

test('normalizeCapabilities infers iOS from .ipa file extension', () => {
  const result = normalizeCapabilities({ app: 'builds/release.ipa' });
  expect(result.platformName).toBe('iOS');
});

// ---------------------------------------------------------------------------
// normalizeCapabilities - conflicting signals
// ---------------------------------------------------------------------------

test('normalizeCapabilities picks Android when both bundleId and appPackage present', () => {
  const result = normalizeCapabilities({
    bundleId: 'com.example',
    appPackage: 'com.example',
  });
  expect(result.platformName).toBe('Android');
});

test('normalizeCapabilities picks Android when .app extension conflicts with appPackage', () => {
  const result = normalizeCapabilities({
    app: 'apps/Hybrid.app',
    appPackage: 'com.example',
  });
  expect(result.platformName).toBe('Android');
});

// ---------------------------------------------------------------------------
// normalizeCapabilities - extra, unknown keys, defaults
// ---------------------------------------------------------------------------

test('normalizeCapabilities merges extra record into result', () => {
  const result = normalizeCapabilities({
    appPackage: 'com.example',
    extra: { 'appium:autoGrantPermissions': true },
  });
  expect(result['appium:autoGrantPermissions']).toBe(true);
});

test('normalizeCapabilities preserves unknown keys verbatim', () => {
  const result = normalizeCapabilities({
    appPackage: 'com.example',
    'custom:myCapability': 'value',
  });
  expect(result['custom:myCapability']).toBe('value');
});

test('normalizeCapabilities skips undefined values', () => {
  const result = normalizeCapabilities({
    appPackage: 'com.example',
    app: undefined,
  });
  expect(result['appium:app']).toBeUndefined();
});

test('normalizeCapabilities sets newCommandTimeout to 240 by default', () => {
  const result = normalizeCapabilities({ appPackage: 'com.example' });
  expect(result['appium:newCommandTimeout']).toBe(240);
});

// ---------------------------------------------------------------------------
// normalizeCapabilities - round-trip equivalence with builder functions
// ---------------------------------------------------------------------------

test('normalizeCapabilities produces same result as androidCapabilities for equivalent input', () => {
  const fromBuilder = androidCapabilities({ app: 'apks/dev.apk', appPackage: 'com.example', deviceName: 'Pixel 8' });
  const fromNormalize = normalizeCapabilities({ app: 'apks/dev.apk', appPackage: 'com.example', deviceName: 'Pixel 8' });
  expect(fromNormalize).toEqual(fromBuilder);
});

test('normalizeCapabilities produces same result as iosCapabilities for equivalent input', () => {
  const fromBuilder = iosCapabilities({ app: 'apps/My.app', bundleId: 'com.example', deviceName: 'iPhone 15 Sim' });
  const fromNormalize = normalizeCapabilities({ app: 'apps/My.app', bundleId: 'com.example', deviceName: 'iPhone 15 Sim' });
  expect(fromNormalize).toEqual(fromBuilder);
});
