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

import { test, expect } from '@playwright/test';
import { filterStories, iframeUrl } from '../../packages/playwright-storybook/src/discover.js';
import type { StoryIndex } from '../../packages/playwright-storybook/src/types.js';

const INDEX: StoryIndex = {
  v: 5,
  entries: {
    'button--primary': { id: 'button--primary', title: 'Button', name: 'Primary', type: 'story', tags: ['ci'] },
    'button--secondary': { id: 'button--secondary', title: 'Button', name: 'Secondary', type: 'story', tags: ['ci', 'flaky'] },
    'forms-login--default': { id: 'forms-login--default', title: 'Forms/Login', name: 'Default', type: 'story', tags: ['ci'] },
    'docs-intro': { id: 'docs-intro', title: 'Docs/Intro', name: 'Page', type: 'docs', tags: [] },
  },
};

test('filterStories skips docs entries', () => {
  const stories = filterStories(INDEX, {});
  expect(stories.map(s => s.id)).toEqual(['button--primary', 'button--secondary', 'forms-login--default']);
});

test('filterStories include glob matches Button/*', () => {
  const stories = filterStories(INDEX, { include: 'Button*' });
  expect(stories.map(s => s.id)).toEqual(['button--primary', 'button--secondary']);
});

test('filterStories exclude glob removes Forms/*', () => {
  const stories = filterStories(INDEX, { exclude: 'Forms/*' });
  expect(stories.map(s => s.id)).toEqual(['button--primary', 'button--secondary']);
});

test('filterStories tags.exclude removes flaky', () => {
  const stories = filterStories(INDEX, { tags: { exclude: ['flaky'] } });
  expect(stories.map(s => s.id)).toEqual(['button--primary', 'forms-login--default']);
});

test('filterStories tags.include enforces ci', () => {
  const stories = filterStories(INDEX, { tags: { include: ['ci'] } });
  expect(stories.map(s => s.id)).toEqual(['button--primary', 'button--secondary', 'forms-login--default']);
});

test('iframeUrl builds Storybook preview URL', () => {
  expect(iframeUrl('http://localhost:6006', 'button--primary'))
      .toBe('http://localhost:6006/iframe.html?id=button--primary&viewMode=story');
  expect(iframeUrl('http://localhost:6006/', 'forms-login--default'))
      .toBe('http://localhost:6006/iframe.html?id=forms-login--default&viewMode=story');
});

test('iframeUrl url-encodes the story id', () => {
  expect(iframeUrl('http://localhost:6006', 'a/b c'))
      .toBe('http://localhost:6006/iframe.html?id=a%2Fb%20c&viewMode=story');
});
