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

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium, test as baseTest, expect } from '@playwright/test';
import { attachPort, audit } from './audit.js';
import type { LighthouseOptions, LighthouseResult, LighthouseTestArgs, LighthouseWorkerArgs } from './types.js';

async function pickFreePort(start: number): Promise<number> {
  for (let candidate = start; candidate < start + 200; candidate++) {
    const available = await new Promise<boolean>(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(candidate, '127.0.0.1');
    });
    if (available)
      return candidate;
  }
  throw new Error('@playwright/lighthouse: could not find a free port to launch Chromium with --remote-debugging-port');
}

export const lighthouseTest = baseTest.extend<LighthouseTestArgs, LighthouseWorkerArgs>({
  lighthousePort: [
    async ({}, use, workerInfo) => {
      const port = await pickFreePort(50060 + workerInfo.workerIndex + 1);
      await use(port);
    },
    { scope: 'worker' },
  ],

  context: async ({ lighthousePort, baseURL }, use) => {
    const userDataDir = path.join(os.tmpdir(), 'pw-lh', crypto.randomUUID());
    const context = await chromium.launchPersistentContext(userDataDir, {
      args: [`--remote-debugging-port=${lighthousePort}`],
      baseURL,
    });
    await use(context);
    await context.close();
  },

  page: async ({ context, lighthousePort }, use) => {
    const page = context.pages()[0] ?? await context.newPage();
    attachPort(page, lighthousePort);
    await use(page);
  },

  lighthouse: async ({ page }, use) => {
    const run = (options?: LighthouseOptions): Promise<LighthouseResult> => audit(page, options);
    await use(run);
  },
});

export { expect };
