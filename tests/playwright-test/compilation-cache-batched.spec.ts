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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { test, expect } from './playwright-test-fixtures.js';

const cacheBackendPath = require.resolve(
    path.resolve(__dirname, '../../packages/playwright/lib/transform/cacheBackend.js'),
);

test('batched writes survive close + reopen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cache-batched-'));
  try {
    delete require.cache[cacheBackendPath];
    let backend = require(cacheBackendPath) as typeof import('../../packages/playwright/lib/transform/cacheBackend.js');

    for (let i = 0; i < 50; i++) {
      backend.sqliteAddEntry(
          dir,
          `/virt/file-${i}.ts`,
          `hash-${i}`,
          `// code ${i}`,
          null,
          null,
          null,
      );
    }

    backend.closeCacheDb();

    // Re-load the module to simulate a fresh process opening the same DB.
    delete require.cache[cacheBackendPath];
    backend = require(cacheBackendPath);

    for (let i = 0; i < 50; i++) {
      const entry = backend.sqliteGetEntry(dir, `/virt/file-${i}.ts`, `hash-${i}`);
      expect(entry).toBeTruthy();
      expect(entry!.code).toBe(`// code ${i}`);
    }

    backend.closeCacheDb();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same-process read after queued write hits in-memory queue', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cache-batched-'));
  try {
    delete require.cache[cacheBackendPath];
    const backend = require(cacheBackendPath) as typeof import('../../packages/playwright/lib/transform/cacheBackend.js');

    // Write a single entry — won't flush to DB yet (under FLUSH_AFTER threshold,
    // timer hasn't fired). The read MUST still find it via the in-memory queue.
    backend.sqliteAddEntry(dir, '/virt/x.ts', 'h1', '// x', null, null, null);
    const hit = backend.sqliteGetEntry(dir, '/virt/x.ts', 'h1');
    expect(hit).toBeTruthy();
    expect(hit!.code).toBe('// x');

    // A different (filename, hash) pair should still be a miss.
    const miss = backend.sqliteGetEntry(dir, '/virt/y.ts', 'h1');
    expect(miss).toBeUndefined();

    backend.closeCacheDb();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flushSqliteWrites is idempotent on empty queue', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cache-batched-'));
  try {
    delete require.cache[cacheBackendPath];
    const backend = require(cacheBackendPath) as typeof import('../../packages/playwright/lib/transform/cacheBackend.js');

    backend.flushSqliteWrites();
    backend.flushSqliteWrites();
    backend.closeCacheDb();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
