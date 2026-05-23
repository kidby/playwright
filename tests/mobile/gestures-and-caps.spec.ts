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

import { Device } from '../../packages/playwright-mobile/src/device.js';
import { androidCapabilities, iosCapabilities } from '../../packages/playwright-mobile/src/capabilities.js';
import { startMockAppium } from './mockAppium.js';

test('androidCapabilities builder fills sensible defaults + appium: prefix', () => {
  const caps = androidCapabilities({ app: '/apks/dev.apk', deviceName: 'Pixel 6' });
  expect(caps.platformName).toBe('Android');
  expect(caps['appium:automationName']).toBe('UiAutomator2');
  expect(caps['appium:app']).toBe('/apks/dev.apk');
  expect(caps['appium:deviceName']).toBe('Pixel 6');
  // Default newCommandTimeout shields against silent session expiry.
  expect(caps['appium:newCommandTimeout']).toBe(240);
});

test('iosCapabilities builder', () => {
  const caps = iosCapabilities({ bundleId: 'com.example.app', platformVersion: '17.4', extra: { 'appium:autoAcceptAlerts': true } });
  expect(caps.platformName).toBe('iOS');
  expect(caps['appium:automationName']).toBe('XCUITest');
  expect(caps['appium:bundleId']).toBe('com.example.app');
  expect((caps as any)['appium:autoAcceptAlerts']).toBe(true);
});

test('gestures.swipe → Android uses mobile: swipeGesture with window rect', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities({ app: 'x.apk' }));
    await device.gestures.swipe({ direction: 'up' });
    const exec = server.requests.find(r => r.method === 'POST' && /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: swipeGesture');
    expect(exec.body.args[0].direction).toBe('up');
    // Width pulled from default window rect 390x844 in the mock.
    expect(exec.body.args[0].width).toBe(195);
    expect(exec.body.args[0].height).toBe(422);
  } finally {
    await server.close();
  }
});

test('gestures.swipe → iOS uses mobile: swipe and includes elementId when target given', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, iosCapabilities({ bundleId: 'a.b' }));
    server.setNextElementId('scroll-1');
    const target = device.app.byAccessibilityId('list');
    await device.gestures.swipe({ direction: 'down', target });
    const exec = server.requests.find(r => r.method === 'POST' && /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: swipe');
    expect(exec.body.args[0].direction).toBe('down');
    expect(exec.body.args[0].elementId).toBe('scroll-1');
  } finally {
    await server.close();
  }
});

test('gestures.tap with target → standard element click', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities());
    await device.gestures.tap({ target: device.app.byAccessibilityId('btn') });
    const clickReq = server.requests.find(r => /\/click$/.test(r.path));
    expect(clickReq).toBeTruthy();
  } finally {
    await server.close();
  }
});

test('gestures.tap with x/y → mobile: clickGesture on Android', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities());
    await device.gestures.tap({ x: 100, y: 200 });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: clickGesture');
    expect(exec.body.args[0]).toEqual({ x: 100, y: 200 });
  } finally {
    await server.close();
  }
});

test('gestures.tap with x/y → mobile: tap on iOS', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, iosCapabilities());
    await device.gestures.tap({ x: 10, y: 20 });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: tap');
  } finally {
    await server.close();
  }
});

test('gestures.longPress → iOS uses touchAndHold with SECONDS, Android uses longClickGesture with MS', async () => {
  // iOS leg
  let server = await startMockAppium();
  try {
    const device = await Device.start(server.url, iosCapabilities());
    server.setNextElementId('btn-ios');
    await device.gestures.longPress({ target: device.app.byAccessibilityId('btn'), durationMs: 3000 });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: touchAndHold');
    expect(exec.body.args[0]).toEqual({ elementId: 'btn-ios', duration: 3 });
  } finally {
    await server.close();
  }
  // Android leg
  server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities());
    server.setNextElementId('btn-android');
    await device.gestures.longPress({ target: device.app.byAccessibilityId('btn'), durationMs: 3000 });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: longClickGesture');
    expect(exec.body.args[0]).toEqual({ elementId: 'btn-android', duration: 3000 });
  } finally {
    await server.close();
  }
});

test('gestures.doubleTap → mobile: doubleTap (iOS) vs mobile: doubleClickGesture (Android), with element + coord forms', async () => {
  // iOS — element-targeted
  let server = await startMockAppium();
  try {
    const device = await Device.start(server.url, iosCapabilities());
    server.setNextElementId('cell-1');
    await device.gestures.doubleTap({ target: device.app.byAccessibilityId('cell') });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: doubleTap');
    expect(exec.body.args[0]).toEqual({ elementId: 'cell-1' });
  } finally {
    await server.close();
  }
  // Android — coord-targeted
  server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities());
    await device.gestures.doubleTap({ x: 50, y: 75 });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: doubleClickGesture');
    expect(exec.body.args[0]).toEqual({ x: 50, y: 75 });
  } finally {
    await server.close();
  }
});

test('gestures.doubleTap throws when neither target nor x/y provided', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities());
    await expect(device.gestures.doubleTap({} as any)).rejects.toThrow(/target.*or.*x.*y/);
  } finally {
    await server.close();
  }
});

test('gestures.scrollToElement → iOS scrolls by element, Android scrolls by direction', async () => {
  // iOS — direction is irrelevant
  let server = await startMockAppium();
  try {
    const device = await Device.start(server.url, iosCapabilities());
    server.setNextElementId('row-7');
    await device.gestures.scrollToElement({ target: device.app.byAccessibilityId('row') });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: scrollToElement');
    expect(exec.body.args[0]).toEqual({ elementId: 'row-7' });
  } finally {
    await server.close();
  }
  // Android — direction defaults to 'down'
  server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities());
    server.setNextElementId('row-9');
    await device.gestures.scrollToElement({ target: device.app.byAccessibilityId('row'), direction: 'up', percent: 0.5 });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: scrollGesture');
    expect(exec.body.args[0]).toEqual({ elementId: 'row-9', direction: 'up', percent: 0.5 });
  } finally {
    await server.close();
  }
});

test('gestures.pullToRefresh → iOS dragFromToForDuration (sec) vs Android dragGesture (px/sec)', async () => {
  // iOS — window 390x844; defaults fromYFraction=0.15 toYFraction=0.85.
  let server = await startMockAppium();
  try {
    const device = await Device.start(server.url, iosCapabilities());
    await device.gestures.pullToRefresh();
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: dragFromToForDuration');
    expect(exec.body.args[0]).toEqual({
      duration: 5, // ms → seconds
      fromX: 195,  // 390/2
      fromY: 127,  // 844 * 0.15
      toX: 195,
      toY: 717,    // 844 * 0.85
    });
  } finally {
    await server.close();
  }
  // Android — same geometry, speed = distance / seconds.
  server = await startMockAppium();
  try {
    const device = await Device.start(server.url, androidCapabilities());
    await device.gestures.pullToRefresh({ durationMs: 1000 });
    const exec = server.requests.find(r => /\/execute\/sync$/.test(r.path))!;
    expect(exec.body.script).toBe('mobile: dragGesture');
    expect(exec.body.args[0]).toEqual({
      startX: 195,
      startY: 127,
      endX: 195,
      endY: 717,
      speed: 590, // 717-127 = 590 px over 1s
    });
  } finally {
    await server.close();
  }
});
