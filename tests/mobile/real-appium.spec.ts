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

import { AppiumClient } from '../../packages/playwright-mobile/src/index.js';

const enabled = process.env.APPIUM_TEST === '1';
const url = process.env.APPIUM_URL || 'http://127.0.0.1:4723';

test.skip(!enabled, `Set APPIUM_TEST=1 to run real-Appium smoke against ${url}`);

test('GET /status returns Appium-shaped ready payload', async () => {
  const res = await fetch(`${url}/status`);
  expect(res.status).toBe(200);
  const body = await res.json() as { value?: { ready?: boolean; build?: { version?: string } } };
  expect(body.value).toBeDefined();
  expect(typeof body.value!.ready).toBe('boolean');
});

test('createSession with invalid capabilities returns a clean error', async () => {
  const client = new AppiumClient(url);
  const error: Error = await client.createSession({
    'platformName': 'Bogus' as never,
    'appium:automationName': 'NoSuch',
  }).then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('Appium POST /session');
});

test('session-required methods throw before createSession is called', async () => {
  const client = new AppiumClient(url);
  const error: Error = await client.findElement('accessibility id', 'x')
      .then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('No active Appium session');
});
