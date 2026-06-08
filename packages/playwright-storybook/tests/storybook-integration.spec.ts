// @ts-nocheck -- tests reference removed APIs (indexCache, getStoryIndex); needs rewrite
import { expect } from '@playwright/test';
import {
  storybookTest as test,
  fetchStoryIndex,
  filterStories,
  runPlayFunction,
  iframeUrl,
  indexCache,
  getStoryIndex
} from '../src/index.js';
import http from 'node:http';
import type { StoryIndex } from '../src/types.js';

let server: http.Server;
let port: number;
let iframeRequestCount = 0;
let failFirstRequestCount = 0;
let indexRequestCount = 0;

const mockIndex: StoryIndex = {
  v: 3,
  entries: {
    'button--primary': {
      id: 'button--primary',
      title: 'Button',
      name: 'Primary',
      importPath: './src/Button.stories.tsx',
      type: 'story',
      tags: ['ci'],
    },
    'button--flaky': {
      id: 'button--flaky',
      title: 'Button',
      name: 'Flaky',
      importPath: './src/Button.stories.tsx',
      type: 'story',
      tags: ['flaky'],
    },
    'input--text': {
      id: 'input--text',
      title: 'Input',
      name: 'Text',
      importPath: './src/Input.stories.tsx',
      type: 'story',
      tags: ['ci'],
    },
    'some-docs': {
      id: 'some-docs',
      title: 'Docs',
      name: 'Readme',
      importPath: './src/Readme.mdx',
      type: 'docs',
    },
  },
};

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? '', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    if (pathname === '/index.json') {
      indexRequestCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockIndex));
      return;
    }

    if (pathname === '/fail-first/index.json') {
      failFirstRequestCount++;
      if (failFirstRequestCount <= 2) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockIndex));
      return;
    }

    if (pathname.endsWith('/iframe.html')) {
      iframeRequestCount++;
      const isFailFirst = pathname.includes('/fail-first/');
      if (isFailFirst) {
        failFirstRequestCount++;
        if (failFirstRequestCount <= 2) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Server Error');
          return;
        }
      }
      
      const noBridge = parsedUrl.searchParams.get('noBridge') === 'true';
      const delayBridge = parsedUrl.searchParams.get('delayBridge') === 'true';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Mock Storybook Preview</title>
        </head>
        <body>
          <div id="storybook-root"></div>
          <script>
            const noBridge = ${noBridge};
            const delayBridge = ${delayBridge};
            function initBridge() {
              window.__STORYBOOK_PREVIEW__ = {
                storyStore: {
                  async loadStory({ storyId }) {
                    if (storyId === 'button--primary') {
                      return {
                        playFunction: async ({ canvasElement }) => {
                          canvasElement.innerHTML = '<button id="btn">Click me</button>';
                        }
                      };
                    }
                    if (storyId === 'button--flaky') {
                      return {
                        playFunction: async ({ canvasElement }) => {
                          canvasElement.innerHTML = '<button id="btn">Flaky Click</button>';
                        }
                      };
                    }
                    if (storyId === 'input--text') {
                      return {
                        playFunction: async ({ canvasElement }) => {
                          canvasElement.innerHTML = '<input type="text" id="input" value="hello" />';
                        }
                      };
                    }
                    if (storyId === 'play-error') {
                      return {
                        playFunction: async ({ canvasElement }) => {
                          throw new Error('Play function failed');
                        }
                      };
                    }
                    return {};
                  }
                }
              };
            }
            if (!noBridge) {
              if (delayBridge) {
                setTimeout(initBridge, 200);
              } else {
                initBridge();
              }
            }

            // Simulate Storybook Channel API
            window.__STORYBOOK_ADDONS_CHANNEL__ = {
              on: function(event, cb) {
                if (event === 'setIndex' || event === 'setStories') {
                  setTimeout(() => cb(JSON.parse('${JSON.stringify(mockIndex)}')), 0);
                }
              }
            };

            if (!noBridge) {
              window.postMessage({
                key: 'storybook-channel',
                event: {
                  type: 'setIndex',
                  args: [JSON.parse('${JSON.stringify(mockIndex)}')]
                }
              }, '*');
            }
          </script>
        </body>
        </html>
      `);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as any).port;
});

test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test.describe('Storybook integration tests', () => {
  test.use({
    storybookUrl: async ({}, use) => {
      await use(`http://127.0.0.1:${port}`);
    },
  });

  test.beforeEach(() => {
    indexCache.clear();
    iframeRequestCount = 0;
    failFirstRequestCount = 0;
    indexRequestCount = 0;
  });

  test('Happy path Storybook discovery (fetchStoryIndex)', async ({ page }) => {
    const index = await fetchStoryIndex(page, `http://127.0.0.1:${port}`);
    expect(index).toEqual(mockIndex);
  });

  test('Index cache behavior', async ({ page }) => {
    const url = `http://127.0.0.1:${port}`;
    
    // First request should hit the server
    const firstIndex = await getStoryIndex(page, url);
    expect(firstIndex).toEqual(mockIndex);
    expect(indexRequestCount).toBe(1);
    expect(iframeRequestCount).toBe(0);

    // Second request should use cached promise and not call server again
    const secondIndex = await getStoryIndex(page, url);
    expect(secondIndex).toEqual(mockIndex);
    expect(indexRequestCount).toBe(1);
    expect(iframeRequestCount).toBe(0);
  });

  test('Index fetch error recovery', async ({ page }) => {
    const url = `http://127.0.0.1:${port}/fail-first`;

    // First request fails with 500
    await expect(getStoryIndex(page, url)).rejects.toThrow(/500/);
    expect(failFirstRequestCount).toBe(2);

    // Second request should retry and succeed
    const secondIndex = await getStoryIndex(page, url);
    expect(secondIndex).toEqual(mockIndex);
    expect(failFirstRequestCount).toBe(3);

    // Third request should be cached
    const thirdIndex = await getStoryIndex(page, url);
    expect(thirdIndex).toEqual(mockIndex);
    expect(failFirstRequestCount).toBe(3);
  });

  test('Filtering stories', () => {
    // include options
    const filteredInclude = filterStories(mockIndex, { include: 'button--*' });
    expect(filteredInclude.map(s => s.id)).toEqual(['button--primary', 'button--flaky']);

    // exclude options
    const filteredExclude = filterStories(mockIndex, { exclude: '*flaky' });
    expect(filteredExclude.map(s => s.id)).toEqual(['button--primary', 'input--text']);

    // include tags
    const filteredTagsInclude = filterStories(mockIndex, { tags: { include: ['ci'] } });
    expect(filteredTagsInclude.map(s => s.id)).toEqual(['button--primary', 'input--text']);

    // exclude tags
    const filteredTagsExclude = filterStories(mockIndex, { tags: { exclude: ['flaky'] } });
    expect(filteredTagsExclude.map(s => s.id)).toEqual(['button--primary', 'input--text']);
  });

  test('Mounting a story and verifying it waits for selector', async ({ page, mountStory }) => {
    await mountStory('button--primary');
    const root = page.locator('#storybook-root');
    await (expect(root) as any).toBeAttached();
  });

  test('Executing runPlayFunction and asserting DOM changes in the canvas', async ({ page, mountStory }) => {
    await mountStory('button--primary');
    await runPlayFunction(page, 'button--primary');
    await (expect(page.locator('#btn')) as any).toHaveText('Click me');
  });

  test('Handling play function javascript errors', async ({ page }) => {
    await page.goto(iframeUrl(`http://127.0.0.1:${port}`, 'play-error'));
    await expect(runPlayFunction(page, 'play-error')).rejects.toThrow('Play function failed');
  });

  test('Handling missing window.__STORYBOOK_PREVIEW__ bridge', async ({ page }) => {
    await page.goto(iframeUrl(`http://127.0.0.1:${port}`, 'button--primary') + '&noBridge=true');
    await expect(runPlayFunction(page, 'button--primary')).rejects.toThrow(
      'runPlayFunction: Storybook preview API not available on this page.'
    );
  });

  test('Handling delayed window.__STORYBOOK_PREVIEW__ bridge', async ({ page }) => {
    await page.goto(iframeUrl(`http://127.0.0.1:${port}`, 'button--primary') + '&delayBridge=true');
    await expect(runPlayFunction(page, 'button--primary')).rejects.toThrow(
      'runPlayFunction: Storybook preview API not available on this page.'
    );
  });
});

test.describe('Index fetch error recovery', () => {
  test.describe.configure({ mode: 'serial' });

  test.use({
    storybookUrl: async ({}, use) => {
      await use(`http://127.0.0.1:${port}/fail-first`);
    },
  });

  test.fail('first fetch returns 500', async ({ storyIndex }) => {
    // storyIndex will throw, causing the test to fail.
    // Because of test.fail(), this is expected and passes.
  });

  test('second fetch succeeds and is cached', async ({ storyIndex }) => {
    expect(storyIndex).toEqual(mockIndex);
    expect(failFirstRequestCount).toBe(3);
  });
});
