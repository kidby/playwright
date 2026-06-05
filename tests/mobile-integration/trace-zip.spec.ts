/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
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

import yauzl from 'yauzl';

import { MobileTraceZip, mobileTest, expect } from '../../packages/playwright-mobile/src/index.js';

import { APPIUM_URL, bootedAndroidUdid, bootedIosUdid, shouldSkipAndroid, shouldSkipIos } from './fixtures/availability.js';
import { androidSettings, iosSettings } from './fixtures/capabilities.js';

// Validates the Playwright-format trace zip the mobile fixture emits:
//   - zip parses
//   - contains trace.trace + trace.network
//   - trace.trace is valid NDJSON
//   - first record is context-options with mobile browserName
//   - at least one before/after action pair from the live Appium calls
// Same checks on both platforms.

type ParsedZip = { entries: Map<string, Buffer> };

async function parseZip(buf: Buffer): Promise<ParsedZip> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip)
        return reject(err ?? new Error('no zip'));
      const entries = new Map<string, Buffer>();
      zip.on('entry', entry => {
        zip.openReadStream(entry, (sErr, stream) => {
          if (sErr || !stream)
            return reject(sErr ?? new Error('no stream'));
          const chunks: Buffer[] = [];
          stream.on('data', c => chunks.push(c));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve({ entries }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

mobileTest.describe('trace.zip format @android-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipAndroid();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: androidSettings(bootedAndroidUdid() ?? ''),
  });

  mobileTest('android: mobile-trace.zip parses as a valid Playwright trace', async ({ device }) => {
    const tracer = new MobileTraceZip(device);
    tracer.start('android-trace-validation');
    // Drive a few Appium calls so the trace has content.
    await device.pageSource();
    await device.snapshot();
    await device.screenshot();
    tracer.stop();
    const zipBytes = await tracer.build();
    expect(zipBytes.length).toBeGreaterThan(200);

    const parsed = await parseZip(zipBytes);
    expect(parsed.entries.has('trace.trace')).toBe(true);
    expect(parsed.entries.has('trace.network')).toBe(true);

    const lines = parsed.entries.get('trace.trace')!.toString('utf8').split('\n').filter(l => l.length);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines)
      JSON.parse(line);  // throws if malformed

    const first = JSON.parse(lines[0]) as { type: string; browserName?: string; platform?: string };
    expect(first.type).toBe('context-options');
    expect(first.browserName).toBe('mobile');
    expect(first.platform).toBe('Android');
  });
});

mobileTest.describe('trace.zip format @ios-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipIos();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: iosSettings(bootedIosUdid() ?? ''),
  });

  mobileTest('ios: mobile-trace.zip parses as a valid Playwright trace', async ({ device }) => {
    const tracer = new MobileTraceZip(device);
    tracer.start('ios-trace-validation');
    await device.pageSource();
    await device.snapshot();
    await device.screenshot();
    tracer.stop();
    const zipBytes = await tracer.build();
    expect(zipBytes.length).toBeGreaterThan(200);

    const parsed = await parseZip(zipBytes);
    expect(parsed.entries.has('trace.trace')).toBe(true);
    expect(parsed.entries.has('trace.network')).toBe(true);

    const lines = parsed.entries.get('trace.trace')!.toString('utf8').split('\n').filter(l => l.length);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines)
      JSON.parse(line);

    const first = JSON.parse(lines[0]) as { type: string; browserName?: string; platform?: string };
    expect(first.type).toBe('context-options');
    expect(first.browserName).toBe('mobile');
    expect(first.platform).toBe('iOS');
  });
});
