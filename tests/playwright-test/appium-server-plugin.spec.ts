/**
 * Copyright Microsoft Corporation. All rights reserved.
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

import http from 'http';
import path from 'path';
import { test, expect } from './playwright-test-fixtures.js';

const STUB_APPIUM_PATH = path.join(__dirname, 'assets', 'stub-appium-server.js');

test('autoStart spawns stub Appium and probes /status', async ({ runInlineTest }, { workerIndex }) => {
  const port = 14723 + workerIndex * 2;
  const result = await runInlineTest({
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('probes /status before tests run', async ({}, testInfo) => {
        const response = await fetch('http://127.0.0.1:${port}/status');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.value.ready).toBe(true);
      });
    `,
    'playwright.config.ts': `
      export default {
        projects: [{
          name: 'mobile-stub',
          use: {
            appium: {
              serverUrl: 'http://127.0.0.1:${port}',
              autoStart: true,
              command: 'node ${JSON.stringify(STUB_APPIUM_PATH)} ${port}',
              timeout: 10000,
            },
          },
        }],
      };
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
});

test('reuseExistingServer skips spawn when server is already up', async ({ runInlineTest }, { workerIndex }) => {
  const port = 14823 + workerIndex * 2;
  const server = http.createServer((req, res) => {
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ value: { ready: true } }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));

  try {
    const result = await runInlineTest({
      'a.spec.ts': `
        import { test, expect } from '@playwright/test';
        test('uses already-running server', async () => {
          const response = await fetch('http://127.0.0.1:${port}/status');
          expect(response.status).toBe(200);
        });
      `,
      'playwright.config.ts': `
        export default {
          projects: [{
            name: 'mobile-stub-existing',
            use: {
              appium: {
                serverUrl: 'http://127.0.0.1:${port}',
                autoStart: true,
                command: 'node -e "process.exit(99)"',
                reuseExistingServer: true,
                timeout: 5000,
              },
            },
          }],
        };
      `,
    });
    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('autoStart=false leaves the server alone', async ({ runInlineTest }, { workerIndex }) => {
  const port = 14923 + workerIndex * 2;
  const result = await runInlineTest({
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('no Appium spawned', async () => {
        const fetched = await fetch('http://127.0.0.1:${port}/status').catch(() => null);
        expect(fetched).toBeNull();
      });
    `,
    'playwright.config.ts': `
      export default {
        projects: [{
          name: 'mobile-noautostart',
          use: {
            appium: {
              serverUrl: 'http://127.0.0.1:${port}',
              autoStart: false,
              command: 'node ${JSON.stringify(STUB_APPIUM_PATH)} ${port}',
            },
          },
        }],
      };
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
});
