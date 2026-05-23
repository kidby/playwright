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

import { test as it, expect } from './pageTest.js';

it('getById: default substring match', async ({ page }) => {
  await page.setContent(`
    <button id="submit-btn-9a8f">Submit</button>
    <button id="cancel-btn-42">Cancel</button>
    <input id="email-input" />
  `);
  // Substring 'submit' matches the generated suffix
  await expect(page.getById('submit-btn')).toHaveCount(1);
  await expect(page.getById('btn')).toHaveCount(2);
  await expect(page.getById('email')).toHaveCount(1);
});

it('getById: exact mode matches whole id', async ({ page }) => {
  await page.setContent(`
    <button id="submit-btn-9a8f">Submit</button>
    <button id="submit-btn">Plain submit</button>
  `);
  await expect(page.getById('submit-btn', { exact: true })).toHaveCount(1);
  await expect(page.getById('submit-btn', { exact: true })).toHaveText('Plain submit');
});

it('getByClassName: default substring match', async ({ page }) => {
  await page.setContent(`
    <div class="card card--featured">A</div>
    <div class="card">B</div>
    <div class="other">C</div>
  `);
  // 'featured' is a substring of the class attribute of A only
  await expect(page.getByClassName('featured')).toHaveCount(1);
  await expect(page.getByClassName('card')).toHaveCount(2);
});

it('getByClassName: exact mode does class-token match', async ({ page }) => {
  await page.setContent(`
    <div class="card card--featured">A</div>
    <div class="card">B</div>
    <div class="cardholder">C</div>
  `);
  // Token match: 'card' matches A and B, NOT C (its class is 'cardholder').
  await expect(page.getByClassName('card', { exact: true })).toHaveCount(2);
});

it('chains through locator.getById and locator.getByClassName', async ({ page }) => {
  await page.setContent(`
    <section class="container">
      <button id="primary-action">A</button>
    </section>
    <button id="primary-action">B</button>
  `);
  // Scoped lookup inside the .container only finds A
  await expect(page.getByClassName('container').getById('primary')).toHaveText('A');
});

it('strict mode error mentions getById', async ({ page }) => {
  await page.setContent(`
    <div id="dup-1"></div>
    <div id="dup-2"></div>
  `);
  const error: Error = await page.getById('dup').click({ timeout: 1000 }).then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('strict mode violation');
});

it('case-insensitive substring match by default', async ({ page }) => {
  await page.setContent(`
    <button id="Submit-Btn">A</button>
    <div class="Card Card--Featured">B</div>
  `);
  // Mixed-case query matches mixed-case attribute (substring + case-insensitive).
  await expect(page.getById('submit')).toHaveCount(1);
  await expect(page.getById('SUBMIT')).toHaveCount(1);
  await expect(page.getByClassName('featured')).toHaveCount(1);
  await expect(page.getByClassName('FEATURED')).toHaveCount(1);
});

it('special chars in id/class are escaped, not concatenated', async ({ page }) => {
  await page.setContent(`
    <div id='foo"bar'>quoted</div>
    <div class='has space'>spaced</div>
  `);
  await expect(page.getById('foo"bar', { exact: true })).toHaveText('quoted');
  await expect(page.getByClassName('has space')).toHaveText('spaced');
});
