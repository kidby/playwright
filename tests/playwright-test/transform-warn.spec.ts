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

// Regression sentinel for the transform.ts fallback-warn behavior. When oxc
// or esbuild returns an empty result without throwing, transformHook silently
// falls back to the original source. The DEBUG=pw:transform gate now emits a
// stderr line so the masked recovery is visible. This file pins both halves:
// silent without the env var, vocal with it.

import { test, expect } from './playwright-test-fixtures.js';

test('logTransformFallback is silent when DEBUG=pw:transform is unset', async () => {
  const { logTransformFallback } = await import('../../packages/playwright/src/transform/transform.js');
  const originalDebug = process.env.DEBUG;
  delete process.env.DEBUG;
  const written: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line no-restricted-properties
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    return true;
  }) as typeof process.stderr.write;
  try {
    logTransformFallback('oxc', '/tmp/sample.ts');
    expect(written.join('')).toBe('');
  } finally {
    // eslint-disable-next-line no-restricted-properties
    process.stderr.write = realWrite;
    if (originalDebug !== undefined)
      process.env.DEBUG = originalDebug;
  }
});

test('logTransformFallback emits a stderr line when DEBUG=pw:transform is set', async () => {
  const { logTransformFallback } = await import('../../packages/playwright/src/transform/transform.js');
  const originalDebug = process.env.DEBUG;
  process.env.DEBUG = 'pw:transform';
  const written: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line no-restricted-properties
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    return true;
  }) as typeof process.stderr.write;
  try {
    logTransformFallback('oxc', '/tmp/sample.ts');
    const combined = written.join('');
    expect(combined).toContain('[pw:transform]');
    expect(combined).toContain('oxc');
    expect(combined).toContain('/tmp/sample.ts');
    expect(combined).toContain('falling back to original source');
  } finally {
    // eslint-disable-next-line no-restricted-properties
    process.stderr.write = realWrite;
    if (originalDebug === undefined)
      delete process.env.DEBUG;
    else
      process.env.DEBUG = originalDebug;
  }
});

test('logTransformFallback also fires when DEBUG includes pw:transform among others', async () => {
  const { logTransformFallback } = await import('../../packages/playwright/src/transform/transform.js');
  const originalDebug = process.env.DEBUG;
  process.env.DEBUG = 'pw:api,pw:transform,pw:test';
  const written: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line no-restricted-properties
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    return true;
  }) as typeof process.stderr.write;
  try {
    logTransformFallback('esbuild', '/tmp/foo.tsx');
    expect(written.join('')).toContain('esbuild');
  } finally {
    // eslint-disable-next-line no-restricted-properties
    process.stderr.write = realWrite;
    if (originalDebug === undefined)
      delete process.env.DEBUG;
    else
      process.env.DEBUG = originalDebug;
  }
});
