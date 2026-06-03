/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test as base, expect as baseExpect } from 'playwright/test';

import { fetchStoryIndex, iframeUrl } from './discover.js';

import type { StoryEntry, StoryIndex } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type StorybookWorkerFixtures = {};

export type StorybookTestFixtures = {
  story: StoryEntry | undefined;
  mountStory: (id?: string) => Promise<void>;
  storybookUrl: string;
  storyIndex: StoryIndex;
};

const indexCache = new Map<string, Promise<StoryIndex>>();

function getStoryIndex(url: string): Promise<StoryIndex> {
  let cached = indexCache.get(url);
  if (!cached) {
    cached = fetchStoryIndex(url);
    indexCache.set(url, cached);
  }
  return cached;
}

export const storybookTest = base.extend<StorybookTestFixtures>({
  storybookUrl: async ({ baseURL }, use) => {
    if (!baseURL)
      throw new Error('storybookTest requires playwright.config baseURL pointing at the Storybook dev server (e.g. http://localhost:6006).');
    await use(baseURL);
  },

  storyIndex: async ({ storybookUrl }, use) => {
    await use(await getStoryIndex(storybookUrl));
  },

  story: async ({}, use) => {
    await use(undefined);
  },

  mountStory: async ({ page, story, storybookUrl }, use) => {
    await use(async (id?: string) => {
      const storyId = id ?? story?.id;
      if (!storyId)
        throw new Error('mountStory: pass a story id, or set the `story` fixture via defineStorybookTests.');
      await page.goto(iframeUrl(storybookUrl, storyId), { waitUntil: 'load' });
      await page.waitForSelector('#storybook-root, #root', { state: 'attached', timeout: 30_000 });
    });
  },
});

export const expect = baseExpect;
