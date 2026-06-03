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

import type { Page } from 'playwright/test';

export async function runPlayFunction(page: Page, storyId: string): Promise<void> {
  await page.evaluate(async (id: string) => {
    const preview = (globalThis as { __STORYBOOK_PREVIEW__?: {
      storyStoreValue?: {
        loadStory: (args: { storyId: string }) => Promise<{ playFunction?: (ctx: { canvasElement: Element }) => Promise<void> }>;
      };
    } }).__STORYBOOK_PREVIEW__;
    if (!preview?.storyStoreValue)
      throw new Error('runPlayFunction: Storybook preview API not available on this page.');
    const story = await preview.storyStoreValue.loadStory({ storyId: id });
    if (typeof story.playFunction !== 'function')
      return;
    const canvasElement = document.querySelector('#storybook-root') ?? document.querySelector('#root');
    if (!canvasElement)
      throw new Error('runPlayFunction: #storybook-root not found.');
    await story.playFunction({ canvasElement });
  }, storyId);
}
