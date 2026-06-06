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

import { mergeTests } from '@playwright/test';
import { storybookTest, expect, runPlayFunction } from '../../packages/playwright-storybook/src';
import { test as fixtureTest } from './playwright-test-fixtures';

const test = mergeTests(storybookTest, fixtureTest);

test.use({
  storybookUrl: async ({ server }, use) => {
    await use(server.PREFIX + '/storybook');
  }
});

test('storybookTest should mount story from mocked server', async ({ page, server, mountStory }) => {
  server.setRoute('/storybook/index.json', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      v: 5,
      entries: {
        'button--primary': { id: 'button--primary', title: 'Button', name: 'Primary', type: 'story' },
      }
    }));
  });

  server.setRoute('/storybook/iframe.html?id=button--primary&viewMode=story', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <script>
            window.__STORYBOOK_PREVIEW__ = {
              storyStoreValue: {
                loadStory: async ({ storyId }) => {
                  return {
                    playFunction: async ({ canvasElement }) => {
                      canvasElement.innerHTML = '<button>Clicked ' + storyId + '</button>';
                    }
                  };
                }
              }
            };
          </script>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>
    `);
  });

  await mountStory('button--primary');
  await runPlayFunction(page, 'button--primary');
  await expect(page.locator('button')).toHaveText('Clicked button--primary');
});
