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

import { test, expect } from './playwright-test-fixtures';

test('validates type / required / pattern / additionalProperties / items', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('passes', async () => {
        await expect({ id: 7, name: 'a' }).toMatchJsonSchema({
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'integer', minimum: 1 },
            name: { type: 'string', minLength: 1 },
          },
        });
      });
      test('fails-missing-required', async () => {
        await expect({ id: 7 }).toMatchJsonSchema({
          type: 'object', required: ['id', 'name'],
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        });
      });
      test('fails-wrong-type', async () => {
        await expect({ id: '7' }).toMatchJsonSchema({
          type: 'object', properties: { id: { type: 'integer' } },
        });
      });
      test('fails-pattern', async () => {
        await expect({ email: 'nope' }).toMatchJsonSchema({
          type: 'object',
          properties: { email: { type: 'string', pattern: '^[^@]+@[^@]+$' } },
        });
      });
      test('fails-additional-props', async () => {
        await expect({ a: 1, b: 2 }).toMatchJsonSchema({
          type: 'object',
          properties: { a: { type: 'integer' } },
          additionalProperties: false,
        });
      });
      test('array items', async () => {
        await expect([1, 2, 3]).toMatchJsonSchema({
          type: 'array', items: { type: 'integer' },
        });
      });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.passed).toBe(2);
  expect(result.failed).toBe(4);
});
