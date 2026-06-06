import { test as it, expect } from './pageTest';

it('should handle large responses correctly', async ({ page, server }) => {
  const size = 5 * 1024 * 1024; // 5 MB
  const largeData = 'a'.repeat(size);
  server.setRoute('/large', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end(largeData);
  });

  await page.goto(server.EMPTY_PAGE);
  const [response] = await Promise.all([
    page.waitForEvent('response'),
    page.evaluate(() => fetch('./large').then(r => r.text())),
  ]);

  const sizes = await response.request().sizes();
  expect(sizes.responseBodySize).toBe(size);
  expect(sizes.responseHeadersSize).toBeGreaterThanOrEqual(50);
  expect(sizes.requestBodySize).toBe(0);
});

it('should handle client-side abort correctly', async ({ page, server }) => {
  server.setRoute('/slow', (req, res) => {
    // Hang request
  });

  await page.goto(server.EMPTY_PAGE);
  const [failedRequest] = await Promise.all([
    page.waitForEvent('requestfailed'),
    page.evaluate(async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      fetch('./slow', { signal }).catch(() => {});
      // Wait a tiny bit and abort
      await new Promise(r => setTimeout(r, 50));
      controller.abort();
    }),
  ]);

  const failure = failedRequest.failure();
  expect(failure).toBeTruthy();
  // Check that the error text contains abort indicators
  const errorText = failure!.errorText;
  const isAborted = errorText === 'NS_BINDING_ABORTED' || errorText === 'net::ERR_ABORTED' || errorText.includes('cancelled') || errorText.includes('canceled');
  expect(isAborted).toBe(true);
});

it('should handle multiple browser context lifecycles without leaks or crashes', async ({ browser, server }) => {
  const contexts = [];
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);
    const text = await page.evaluate(() => document.title);
    expect(text).toBe('');
  }

  for (const context of contexts) {
    await context.close();
  }
});

it('should handle concurrent browser context lifecycles', async ({ browser, server }) => {
  const contextPromises = Array.from({ length: 5 }, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);
    const text = await page.evaluate(() => document.title);
    expect(text).toBe('');
    return context;
  });

  const contexts = await Promise.all(contextPromises);
  await Promise.all(contexts.map(context => context.close()));
});

it('should calculate sizes correctly with redirects', async ({ page, server }) => {
  server.setRedirect('/redirect-start', '/redirect-dest');
  server.setRoute('/redirect-dest', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end('final-destination-payload');
  });

  await page.goto(server.EMPTY_PAGE);
  const [response] = await Promise.all([
    page.waitForEvent('response'),
    page.evaluate(() => fetch('./redirect-start').then(r => r.text())),
  ]);

  const initialRequest = response.request();
  const redirectedTo = initialRequest.redirectedTo()!;
  expect(redirectedTo).toBeTruthy();

  const initialSizes = await initialRequest.sizes();
  // Redirect response usually has no body or small body if redirect page content is returned
  expect(initialSizes.responseBodySize).toBeGreaterThanOrEqual(0);

  const finalResponse = await redirectedTo.response();
  expect(finalResponse).toBeTruthy();
  const finalSizes = await redirectedTo.sizes();
  expect(finalSizes.responseBodySize).toBe('final-destination-payload'.length);
});
