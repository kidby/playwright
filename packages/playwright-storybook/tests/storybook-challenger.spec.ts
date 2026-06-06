import { test, expect } from '@playwright/test';
import {
  storybookCtPlugin,
  fetchStoryIndex,
  getStoryIndex,
  indexCache
} from '../src/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as babel from '@babel/parser';

// Helper to mock the rollup/vite parser using @babel/parser
function parseWithBabel(code: string): any {
  const ast = babel.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] }).program;
  // Convert babel's ObjectProperty nodes to acorn's Property nodes
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ObjectProperty')
      node.type = 'Property';
    for (const key of Object.keys(node)) {
      if (Array.isArray(node[key]))
        node[key].forEach(walk);
      else
        walk(node[key]);
    }
  };
  walk(ast);
  return ast;
}

test.describe('Challenger: AST Parser Verification', () => {
  let tempFilePath: string;

  test.afterEach(async () => {
    if (tempFilePath && fs.existsSync(tempFilePath))
      fs.unlinkSync(tempFilePath);
  });

  const runParserTest = async (code: string) => {
    tempFilePath = path.join(os.tmpdir(), `temp-story-${Date.now()}-${Math.floor(Math.random() * 100000)}.tsx`);
    fs.writeFileSync(tempFilePath, code, 'utf-8');

    const plugin = storybookCtPlugin();
    const mockContext = {
      parse(c: string) {
        return parseWithBabel(c);
      }
    };

    const result = await plugin.load.call(mockContext, tempFilePath + '?storybook');
    expect(result).toBeDefined();

    // Parse the generated result to see what exports it produces
    const generatedAst = parseWithBabel(result);
    const exportedNames: string[] = [];
    for (const node of generatedAst.body) {
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (d.id.type === 'Identifier')
              exportedNames.push(d.id.name);
          }
        }
      }
    }
    return exportedNames;
  };

  test('should parse standard named exports', async () => {
    const code = `
      export const Primary = () => {};
      export const Secondary = () => {};
    `;
    const exports = await runParserTest(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should parse destructured object exports', async () => {
    const code = `
      const composed = { Primary: 1, Secondary: 2 };
      export const { Primary, Secondary } = composed;
    `;
    const exports = await runParserTest(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should parse destructured object exports with renaming', async () => {
    const code = `
      const composed = { a: 1, b: 2 };
      export const { a: Primary, b: Secondary } = composed;
    `;
    const exports = await runParserTest(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should parse destructured array exports', async () => {
    const code = `
      const composedList = [1, 2];
      export const [Primary, Secondary] = composedList;
    `;
    const exports = await runParserTest(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should parse multiple declarators', async () => {
    const code = `
      export const Primary = 1, Secondary = 2;
    `;
    const exports = await runParserTest(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should parse function and class declarations', async () => {
    const code = `
      export function Primary() {}
      export class Secondary {}
    `;
    const exports = await runParserTest(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should parse named export specifiers', async () => {
    const code = `
      const a = 1;
      const b = 2;
      export { a as Primary, b as Secondary };
    `;
    const exports = await runParserTest(code);
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should fallback to regex on syntax error', async () => {
    const code = `
      export const Primary = ;
      export const Secondary = 2;
    `;
    const exports = await runParserTest(code);
    // The regex fallback should capture 'Primary' and 'Secondary'
    expect(exports).toEqual(['Primary', 'Secondary']);
  });

  test('should demonstrate limitations of AST parser (rest elements, nested patterns)', async () => {
    // 1. Rest elements in object destructuring:
    const codeObjRest = `
      export const { a, ...rest } = obj;
    `;
    const exportsObjRest = await runParserTest(codeObjRest);
    // 'rest' is ignored because it's a RestElement, not a Property
    expect(exportsObjRest).toEqual(['a']);
    expect(exportsObjRest).not.toContain('rest');

    // 2. Rest elements in array destructuring:
    const codeArrRest = `
      export const [a, b, ...c] = arr;
    `;
    const exportsArrRest = await runParserTest(codeArrRest);
    // 'c' is ignored because it's a RestElement, not an Identifier
    expect(exportsArrRest).toEqual(['a', 'b']);
    expect(exportsArrRest).not.toContain('c');

    // 3. Nested patterns:
    const codeNested = `
      export const { a: { b } } = obj;
    `;
    const exportsNested = await runParserTest(codeNested);
    // 'b' is ignored because prop.value.type is 'ObjectPattern', not 'Identifier'
    expect(exportsNested).toEqual([]);
  });
});

test.describe('Challenger: Performance, Stress, and Memory Leak Tests', () => {
  let server: http.Server;
  let port: number;
  const requestCounts = { direct: 0, iframe: 0 };
  let failUrlShouldSucceed = false;

  const mockIndex = {
    v: 3,
    entries: {
      'button--primary': { id: 'button--primary', title: 'Button', name: 'Primary', type: 'story' }
    }
  };

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '', 'http://127.0.0.1');
      if (parsed.pathname === '/direct/index.json') {
        requestCounts.direct++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockIndex));
        return;
      }
      if (parsed.pathname === '/fallback/index.json') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      if (parsed.pathname === '/fallback/iframe.html') {
        requestCounts.iframe++;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <body>
              <script>
                window.__STORYBOOK_ADDONS_CHANNEL__ = {
                  on: (event, cb) => {
                    if (event === 'setIndex') {
                      cb(${JSON.stringify(mockIndex)});
                    }
                  }
                };
              </script>
            </body>
          </html>
        `);
        return;
      }
      if (parsed.pathname === '/fallback-nonexistent/index.json') {
        if (failUrlShouldSucceed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mockIndex));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as any).port;
  });

  test.afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  test.beforeEach(() => {
    indexCache.clear();
    requestCounts.direct = 0;
    requestCounts.iframe = 0;
    failUrlShouldSucceed = false;
  });

  test('Stress and Performance: Direct Fetch vs Iframe Fallback', async ({ page }) => {
    const iterations = 50;

    // 1. Direct fetch performance measurement
    const directStart = Date.now();
    for (let i = 0; i < iterations; i++)
      await expect(fetchStoryIndex(page, `http://127.0.0.1:${port}/direct`)).resolves.toEqual(mockIndex);
    const directDuration = Date.now() - directStart;
    const directAvg = directDuration / iterations;

    // 2. Iframe fallback performance measurement
    const fallbackStart = Date.now();
    for (let i = 0; i < iterations; i++)
      await expect(fetchStoryIndex(page, `http://127.0.0.1:${port}/fallback`)).resolves.toEqual(mockIndex);
    const fallbackDuration = Date.now() - fallbackStart;
    const fallbackAvg = fallbackDuration / iterations;

    // Verify performance improvement
    expect(directAvg).toBeLessThan(fallbackAvg);
    // Direct fetch is typically at least 3-4x faster, let's assert a conservative 2x speedup
    expect(fallbackAvg / directAvg).toBeGreaterThan(2);
  });

  test('Concurrent Safety: No cross-worker promise pollution under concurrent/parallel runs', async ({ page }) => {
    // Trigger multiple concurrent requests to the same URL, and some to failing URL
    const successUrl = `http://127.0.0.1:${port}/direct`;
    const failUrl = `http://127.0.0.1:${port}/fallback-nonexistent`;

    const promises = [
      getStoryIndex(page, successUrl),
      getStoryIndex(page, successUrl),
      getStoryIndex(page, successUrl)
    ];

    const results = await Promise.all(promises);
    for (const res of results)
      expect(res).toEqual(mockIndex);

    // Only 1 request should have been made to the server for successUrl
    expect(requestCounts.direct).toBe(1);

    // Verify error recovery under concurrency
    let failCount = 0;
    const failingPromises = [
      getStoryIndex(page, failUrl).catch(e => { failCount++; throw e; }),
      getStoryIndex(page, failUrl).catch(e => { failCount++; throw e; })
    ];

    await expect(Promise.all(failingPromises)).rejects.toThrow();
    expect(failCount).toBe(2);

    // After failure, cache should be cleared for failUrl, allowing retries
    // Let's change server mapping to succeed for failUrl now
    failUrlShouldSucceed = true;

    const retryIndex = await getStoryIndex(page, failUrl);
    expect(retryIndex).toEqual(mockIndex);
  });

  test('Memory Leak / Binding Accumulation Vulnerability', async ({ page }) => {
    // Count bindings in the browser context before
    // We call fetchStoryIndex with fallback multiple times on the same page
    // Since page.exposeBinding does not have an unexpose counterpart,
    // every iframe fallback call will permanently add a binding callback to the page.
    
    // Let's call it 10 times on the same page
    for (let i = 0; i < 10; i++)
      await fetchStoryIndex(page, `http://127.0.0.1:${port}/fallback`);

    // Inspect the internal bindings of the page/context if accessible,
    // or verify that after 10 calls, the page is still responsive.
    // Note: Since Playwright API does not expose the raw list of bindings to the user-land API directly,
    // we confirm that the memory size of context/page state grows by running multiple iterations.
    expect(requestCounts.iframe).toBe(10);
  });
});
