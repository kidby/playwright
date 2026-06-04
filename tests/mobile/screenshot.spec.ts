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

// `toHaveScreenshot` against the mock server. The mock returns a real PNG
// buffer (generated below) so the comparator gets valid input.

import fs from 'fs';
import path from 'path';

import { test } from '@playwright/test';
import { PNG } from 'pngjs';

import { NativeDevice, expect, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';

import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

function makePng(width: number, height: number, fillRgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = fillRgba[0];
      png.data[i + 1] = fillRgba[1];
      png.data[i + 2] = fillRgba[2];
      png.data[i + 3] = fillRgba[3];
    }
  }
  return PNG.sync.write(png);
}

let mock: MockAppium;
let pngWhite: Buffer;
let pngBlack: Buffer;
test.beforeAll(() => {
  pngWhite = makePng(8, 8, [255, 255, 255, 255]);
  pngBlack = makePng(8, 8, [0, 0, 0, 255]);
});
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

async function newDevice() {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app', deviceName: 'iPhone Sim' }));
  device.defaultActionTimeoutMs = 3_000;
  return device;
}

test('toHaveScreenshot writes baseline on first run, compares on second', async ({}, testInfo) => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/screenshot$/.test(req.path))
      return { body: { value: pngWhite.toString('base64') } };
  });
  const device = await newDevice();

  // First run — `missing` mode means we write the baseline.
  testInfo.config.updateSnapshots = 'missing';
  await expect(device).toHaveScreenshot('white-first.png', { stabilizationFrames: 1, pollMs: 10, timeout: 2_000 });
  const baselinePath = path.join(testInfo.snapshotDir, 'white-first.png');
  expect(fs.existsSync(baselinePath)).toBe(true);

  // Second run — identical capture, should compare as pass.
  await expect(device).toHaveScreenshot('white-first.png', { stabilizationFrames: 1, pollMs: 10, timeout: 2_000 });
  await device.stop();
});

test('toHaveScreenshot fails when capture differs from baseline', async ({}, testInfo) => {
  // First, write a baseline of the white image.
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/screenshot$/.test(req.path))
      return { body: { value: pngWhite.toString('base64') } };
  });
  let device = await newDevice();
  testInfo.config.updateSnapshots = 'missing';
  await expect(device).toHaveScreenshot('white-then-black.png', { stabilizationFrames: 1, pollMs: 10, timeout: 2_000 });
  await device.stop();

  // Now flip the mock to return black and assert a mismatch.
  await mock.close();
  mock = await startMockAppium();
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/screenshot$/.test(req.path))
      return { body: { value: pngBlack.toString('base64') } };
  });
  device = await newDevice();
  const err = await expect(device)
      .toHaveScreenshot('white-then-black.png', { stabilizationFrames: 1, pollMs: 10, timeout: 2_000 })
      .then(() => null, e => e as Error);
  expect(err).not.toBeNull();
  // Comparator's mismatch message includes the pixel-diff count.
  expect(err!.message.toLowerCase()).toMatch(/pixel|diff|threshold/);
  await device.stop();
});

test('toHaveScreenshot on an AppLocator captures via element/{id}/screenshot', async ({}, testInfo) => {
  let elementShotCalls = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/element\/[^/]+\/screenshot$/.test(req.path)) {
      elementShotCalls++;
      return { body: { value: pngWhite.toString('base64') } };
    }
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: true } };
    if (req.method === 'GET' && /\/enabled$/.test(req.path))
      return { body: { value: true } };
  });
  const device = await newDevice();
  testInfo.config.updateSnapshots = 'missing';
  await expect(device.app.byAccessibilityId('card')).toHaveScreenshot('card.png', { stabilizationFrames: 1, pollMs: 10, timeout: 2_000 });
  expect(elementShotCalls).toBeGreaterThanOrEqual(1);
  await device.stop();
});

test('toHaveScreenshot baseline name includes platform and device when no name given', async ({}, testInfo) => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/screenshot$/.test(req.path))
      return { body: { value: pngWhite.toString('base64') } };
  });
  const device = await newDevice();
  testInfo.config.updateSnapshots = 'missing';
  await expect(device).toHaveScreenshot({ stabilizationFrames: 1, pollMs: 10, timeout: 2_000 });
  // Walk the snapshotDir; expect at least one file matching the test title
  // with iOS + iPhone-Sim segments.
  const files = fs.existsSync(testInfo.snapshotDir) ? fs.readdirSync(testInfo.snapshotDir) : [];
  const matching = files.find(f => /iOS/.test(f) && /iPhone-Sim/.test(f) && f.endsWith('.png'));
  expect(matching, `looking for iOS + iPhone-Sim baseline in ${testInfo.snapshotDir}, got ${files.join(',')}`).toBeTruthy();
  await device.stop();
});

test('toHaveScreenshot stabilizes — waits for two matching captures', async ({}, testInfo) => {
  let n = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/screenshot$/.test(req.path)) {
      n++;
      // Frames 1 (white) and 2 (black) disagree; frames 3 and 4 (both
      // black) match — that's when the matcher commits.
      return { body: { value: (n === 1 ? pngWhite : pngBlack).toString('base64') } };
    }
  });
  const device = await newDevice();
  testInfo.config.updateSnapshots = 'missing';
  await expect(device).toHaveScreenshot('stable.png', { stabilizationFrames: 2, pollMs: 10, timeout: 2_000 });
  expect(n).toBeGreaterThanOrEqual(3);
  await device.stop();
});

test('AppLocator.screenshot() returns the element PNG buffer', async () => {
  let elementShotCalls = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/element\/[^/]+\/screenshot$/.test(req.path)) {
      elementShotCalls++;
      return { body: { value: pngWhite.toString('base64') } };
    }
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: true } };
    if (req.method === 'GET' && /\/enabled$/.test(req.path))
      return { body: { value: true } };
  });
  const device = await newDevice();
  const buffer = await device.app.byAccessibilityId('card').screenshot();
  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(buffer.length).toBeGreaterThan(0);
  expect(elementShotCalls).toBe(1);
  await device.stop();
});

test('AppLocator.screenshot({ path }) writes the PNG to disk', async ({}, testInfo) => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/element\/[^/]+\/screenshot$/.test(req.path))
      return { body: { value: pngWhite.toString('base64') } };
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: true } };
    if (req.method === 'GET' && /\/enabled$/.test(req.path))
      return { body: { value: true } };
  });
  const device = await newDevice();
  const outPath = path.join(testInfo.outputDir, 'card.png');
  const buffer = await device.app.byAccessibilityId('card').screenshot({ path: outPath });
  expect(fs.existsSync(outPath)).toBe(true);
  expect(fs.readFileSync(outPath).equals(buffer)).toBe(true);
  await device.stop();
});
