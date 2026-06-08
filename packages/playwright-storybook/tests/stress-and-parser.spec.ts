// @ts-nocheck -- tests reference removed APIs; needs rewrite
/* eslint-disable no-console, curly */
import { expect, test } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import {
  fetchStoryIndex,
  getStoryIndex,
  indexCache,
  storybookCtPlugin
} from '../lib/index.js';
import type { StoryIndex } from '../src/types.js';

const localFilename = fileURLToPath(import.meta.url);
const localDirname = path.dirname(localFilename);

let server: http.Server;
let port: number;
let serverLogs: string[] = [];

const mockIndex: StoryIndex = {
  v: 3,
  entries: {
    'button--primary': {
      id: 'button--primary',
      title: 'Button',
      name: 'Primary',
      importPath: './src/Button.stories.tsx',
      type: 'story',
    },
  },
};

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? '', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    serverLogs.push(`${req.method} ${req.url}`);

    // Simulate delay if requested
    const delay = parsedUrl.searchParams.get('delay');
    if (delay) {
      const delayMs = parseInt(delay, 10);
      setTimeout(() => {
        handleRequest(pathname, res);
      }, delayMs);
      return;
    }

    handleRequest(pathname, res);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as any).port;
});

test.beforeEach(() => {
  indexCache.clear();
  serverLogs = [];
});

test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

function handleRequest(pathname: string, res: http.ServerResponse) {
  if (pathname.endsWith('/index.json') && !pathname.includes('/fallback')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockIndex));
    return;
  }

  if (pathname.includes('/fallback') && pathname.endsWith('/index.json')) {
    // Return 500 so direct-fetch fails and falls back to iframe
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
    return;
  }

  if (pathname.includes('/fallback') && pathname.endsWith('/iframe.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <body>
        <script>
          window.__STORYBOOK_ADDONS_CHANNEL__ = {
            on: function(event, cb) {
              if (event === 'setIndex') {
                setTimeout(() => cb(JSON.parse('${JSON.stringify(mockIndex)}')), 0);
              }
            }
          };
          window.postMessage({
            key: 'storybook-channel',
            event: {
              type: 'setIndex',
              args: [JSON.parse('${JSON.stringify(mockIndex)}')]
            }
          }, '*');
        </script>
      </body>
      </html>
    `);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

test.describe('Storybook direct-fetch vs fallback benchmark and stress tests', () => {
  test('Benchmark performance comparison', async ({ page }) => {
    const directUrl = `http://127.0.0.1:${port}`;
    const fallbackUrl = `http://127.0.0.1:${port}/fallback`;

    const iterations = 15;
    const directTimes: number[] = [];
    const fallbackTimes: number[] = [];

    // Warm up the browser and server connection
    await page.goto(`http://127.0.0.1:${port}/fallback/iframe.html`);
    await fetchStoryIndex(page, directUrl);
    await fetchStoryIndex(page, fallbackUrl);
    indexCache.clear();

    // Measure Direct Fetch
    for (let i = 0; i < iterations; i++) {
      indexCache.clear();
      const start = performance.now();
      const index = await fetchStoryIndex(page, directUrl);
      const end = performance.now();
      expect(index).toEqual(mockIndex);
      directTimes.push(end - start);
    }

    // Measure Iframe Fallback
    for (let i = 0; i < iterations; i++) {
      indexCache.clear();
      const start = performance.now();
      const index = await fetchStoryIndex(page, fallbackUrl);
      const end = performance.now();
      expect(index).toEqual(mockIndex);
      fallbackTimes.push(end - start);
    }

    const avgDirect = directTimes.reduce((a, b) => a + b, 0) / iterations;
    const avgFallback = fallbackTimes.reduce((a, b) => a + b, 0) / iterations;

    const minDirect = Math.min(...directTimes);
    const maxDirect = Math.max(...directTimes);
    const minFallback = Math.min(...fallbackTimes);
    const maxFallback = Math.max(...fallbackTimes);

    console.log(`\n=== PERFORMANCE BENCHMARK (over ${iterations} runs) ===`);
    console.log(`Direct Fetch: avg = ${avgDirect.toFixed(2)}ms (min = ${minDirect.toFixed(2)}ms, max = ${maxDirect.toFixed(2)}ms)`);
    console.log(`Iframe Fallback: avg = ${avgFallback.toFixed(2)}ms (min = ${minFallback.toFixed(2)}ms, max = ${maxFallback.toFixed(2)}ms)`);
    console.log(`Speedup Factor: ${(avgFallback / avgDirect).toFixed(2)}x faster\n`);
    console.log(`Server requests handled during test:\n${serverLogs.join('\n')}\n`);
    
    // We expect direct fetch to be significantly faster or at least have much lower browser/iframe overhead
    // (Note: since we are on local loopback, the absolute differences are small, but iframe fallback
    // performs full page navigations and script injection which we can verify in the server logs).
  });
});

test.describe('Concurrency, Cache Sharing, and Promise Pollution', () => {
  test('Verify cross-page/cross-test promise pollution when a page is closed', async ({ context }) => {
    // We target the fallback path because the iframe navigation is page-bound,
    // which allows us to trigger page-bound failure (closing the page).
    const slowFallbackUrl = `http://127.0.0.1:${port}/fallback/iframe.html?delay=150`;

    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Call getStoryIndex with page1 (which starts a slow fetch using iframe fallback)
    const p1 = getStoryIndex(page1, slowFallbackUrl);
    // Call getStoryIndex with page2 (which shares the same cached promise)
    const p2 = getStoryIndex(page2, slowFallbackUrl);

    // Close page1 while fetch is pending
    await page1.close();

    // Check if the cached promise (p2) rejects because it is bound to page1
    let p2Failed = false;
    try {
      await p2;
    } catch (e: any) {
      p2Failed = true;
      console.log(`\n=== PROMISE POLLUTION DETECTED ===`);
      console.log(`Page2 fetch failed due to Page1 closure: ${e.message}`);
    }

    // Since page1 was closed, page1's iframe navigation fails/aborts.
    // Because the promise is shared, page2's request also fails!
    expect(p2Failed).toBe(true);

    // Cleanup page2
    await page2.close();
  });

  test('Verify cache size growth (potential memory leak with unique URLs)', async () => {
    // Verify getStoryIndex caches multiple URLs without bound limits
    const initialSize = indexCache.size;
    expect(initialSize).toBe(0);

    // Simulate 50 unique URLs
    for (let i = 0; i < 50; i++) {
      // Just seed the cache manually with dummy resolved promises
      indexCache.set(`http://localhost:6006/?run=${i}`, Promise.resolve(mockIndex));
    }

    expect(indexCache.size).toBe(50);
    console.log(`Cache size after 50 unique requests: ${indexCache.size} (No eviction policy in place)`);

    // Clear cache
    indexCache.clear();
  });
});

test.describe('AST-based parser edge-case test suite', () => {
  const mockViteContext = {
    parse(code: string) {
      const parsed = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });
      return parsed.program;
    }
  };

  async function testParser(code: string): Promise<string[]> {
    const tempFilePath = path.join(localDirname, `temp-story-${Date.now()}-${Math.random().toString(36).substring(7)}.ts`);
    fs.writeFileSync(tempFilePath, code, 'utf-8');

    const plugin = storybookCtPlugin();
    try {
      // Call load on our plugin with a mocked Rollup/Vite context
      const result = await plugin.load.call(mockViteContext, tempFilePath + '?storybook');
      if (!result) return [];

      // Extract exportNames from generated code
      // Format is: export const <name> = composed.<name>;
      const exportRegex = /export const (\w+) = composed\.\1;/g;
      const exports: string[] = [];
      let match;
      while ((match = exportRegex.exec(result)) !== null) {
        exports.push(match[1]);
      }
      return exports;
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  test('Standard export format', async () => {
    const code = `
      export const Primary = Template.bind({});
      export const Secondary = {
        args: {}
      };
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('Multiple declarators in single export statement', async () => {
    const code = `
      export const Primary = Template.bind({}), Secondary = Template.bind({});
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('Destructured object pattern exports', async () => {
    const code = `
      export const { Primary, Secondary } = composeStories(stories);
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('Destructured object pattern with renaming', async () => {
    const code = `
      export const { Primary: MyButton, Secondary } = composeStories(stories);
    `;
    const exports = await testParser(code);
    // Should capture 'MyButton' as that's the local identifier name exported
    expect(exports).toEqual(['MyButton', 'Secondary']);
  });

  test('Destructured object pattern with default value (AST parser limitation)', async () => {
    const code = `
      export const { Primary = DefaultStory } = composeStories(stories);
    `;
    const exports = await testParser(code);
    // Because prop.value.type is AssignmentPattern (not Identifier), this is not captured by AST parser.
    // Let's verify this limitation exists.
    expect(exports).toEqual([]);
  });

  test('Destructured array pattern exports', async () => {
    const code = `
      export const [Primary, Secondary] = myStories;
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('Destructured array pattern with hole/skipped element', async () => {
    const code = `
      export const [, Secondary] = myStories;
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['Secondary']);
  });

  test('Function and Class declarations', async () => {
    const code = `
      export function PrimaryStory() {}
      export class SecondaryStory {}
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['PrimaryStory', 'SecondaryStory']);
  });

  test('Async and Generator function declarations', async () => {
    const code = `
      export async function PrimaryStory() {}
      export function* SecondaryStory() {}
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['PrimaryStory', 'SecondaryStory']);
  });

  test('Specifier exports (including renames)', async () => {
    const code = `
      const Primary = () => {};
      const Secondary = () => {};
      export { Primary, Secondary as RenamedSecondary };
    `;
    const exports = await testParser(code);
    expect(exports).toEqual(['Primary', 'RenamedSecondary']);
  });

  test('Re-exporting default (Syntax Error risk)', async () => {
    const code = `
      export { default } from './Button.stories';
    `;
    const exports = await testParser(code);
    // Verify that 'default' is filtered out to prevent syntax errors (e.g. export const default = composed.default;)
    expect(exports).not.toContain('default');
  });

  test('Exporting named as default', async () => {
    const code = `
      const MyStory = () => {};
      export { MyStory as default };
    `;
    const exports = await testParser(code);
    // Verify that 'default' is filtered out to prevent syntax errors.
    expect(exports).not.toContain('default');
  });

  test('Re-exporting all (ExportAllDeclaration)', async () => {
    const code = `
      export * from './Button.stories';
    `;
    const exports = await testParser(code);
    // AST parser doesn't handle ExportAllDeclaration, so it returns empty.
    expect(exports).toEqual([]);
  });

  test('Fallback regex behavior on AST parsing failure', async () => {
    const code = `
      export const Primary = Template.bind({});
      // Syntax error code below
      const foo = ;
    `;
    const tempFilePath = path.join(localDirname, `temp-story-syntax-error.ts`);
    fs.writeFileSync(tempFilePath, code, 'utf-8');

    const plugin = storybookCtPlugin();
    try {
      // Create a mock context where parse throws an error
      const mockFailContext = {
        parse() {
          throw new Error('AST Syntax Error');
        }
      };

      const result = await plugin.load.call(mockFailContext, tempFilePath + '?storybook');
      expect(result).toBeDefined();

      const exportRegex = /export const (\w+) = composed\.\1;/g;
      const exports: string[] = [];
      let match;
      while ((match = exportRegex.exec(result)) !== null) {
        exports.push(match[1]);
      }
      // Regex fallback matches 'Primary'
      expect(exports).toEqual(['Primary']);
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  });

  test('Fallback regex failure modes (async/generator functions)', async () => {
    // When AST parsing fails, the fallback regex is used.
    // The fallback regex is: export\s+(?:const|function|class|let|var)\s+([a-zA-Z0-9_]+)
    // We want to verify that this fallback regex fails to detect async and generator function exports.
    const code = `
      export async function Primary() {}
      export function* Secondary() {}
      // Syntax error to force regex fallback
      const foo = ;
    `;
    const tempFilePath = path.join(localDirname, `temp-story-regex-fail.ts`);
    fs.writeFileSync(tempFilePath, code, 'utf-8');

    const plugin = storybookCtPlugin();
    try {
      const mockFailContext = {
        parse() {
          throw new Error('AST Syntax Error');
        }
      };

      const result = await plugin.load.call(mockFailContext, tempFilePath + '?storybook');
      const exportRegex = /export const (\w+) = composed\.\1;/g;
      const exports: string[] = [];
      let match;
      while ((match = exportRegex.exec(result)) !== null) {
        exports.push(match[1]);
      }
      // Primary and Secondary are both missed!
      // 'export async function Primary' does not match because 'async' is not matched by (const|function|class|let|var)
      // 'export function* Secondary' does not match because there is no space after 'function' before '*' and the identifier
      expect(exports).toEqual([]);
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  });
});
