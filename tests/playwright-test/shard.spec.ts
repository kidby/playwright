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

import { test, expect } from './playwright-test-fixtures';

const tests = {
  'a1.spec.ts': `
    import { test } from '@playwright/test';
    test('test1', async () => {
      console.log('\\n%%a1-test1-done');
    });
    test('test2', async () => {
      console.log('\\n%%a1-test2-done');
    });
    test('test3', async () => {
      console.log('\\n%%a1-test3-done');
    });
    test('test4', async () => {
      console.log('\\n%%a1-test4-done');
    });
  `,
  'a2.spec.ts': `
    import { test } from '@playwright/test';
    test.describe.configure({ mode: 'parallel' });
    test('test1', async () => {
      console.log('\\n%%a2-test1-done');
    });
    test('test2', async () => {
      console.log('\\n%%a2-test2-done');
    });
  `,
  'a3.spec.ts': `
    import { test } from '@playwright/test';
    test.describe.configure({ mode: 'parallel' });
    test('test1', async () => {
      console.log('\\n%%a3-test1-done');
    });
    test('test2', async () => {
      console.log('\\n%%a3-test2-done');
    });
  `,
  'a4.spec.ts': `
    import { test } from '@playwright/test';
    test('test1', async () => {
      console.log('\\n%%a4-test1-done');
    });
    test('test2', async () => {
      console.log('\\n%%a4-test2-done');
    });
  `,
};

test('should respect shard=1/2', async ({ runInlineTest }) => {
  const result = await runInlineTest(tests, { shard: '1/2', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(5);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'a1-test1-done',
    'a1-test2-done',
    'a1-test3-done',
    'a1-test4-done',
    'a2-test1-done',
  ]);
});

test('should respect shard=2/2', async ({ runInlineTest }) => {
  const result = await runInlineTest(tests, { shard: '2/2', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(5);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'a2-test2-done',
    'a3-test1-done',
    'a3-test2-done',
    'a4-test1-done',
    'a4-test2-done',
  ]);
});

test('should respect shard=1/3', async ({ runInlineTest }) => {
  const result = await runInlineTest(tests, { shard: '1/3', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(4);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'a1-test1-done',
    'a1-test2-done',
    'a1-test3-done',
    'a1-test4-done',
  ]);
});

test('should respect shard=2/3', async ({ runInlineTest }) => {
  const result = await runInlineTest(tests, { shard: '2/3', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(3);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'a2-test1-done',
    'a2-test2-done',
    'a3-test1-done',
  ]);
});

test('should respect shard=3/3', async ({ runInlineTest }) => {
  const result = await runInlineTest(tests, { shard: '3/3', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(3);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'a3-test2-done',
    'a4-test1-done',
    'a4-test2-done',
  ]);
});

test('should respect shard=3/4', async ({ runInlineTest }) => {
  const result = await runInlineTest(tests, { shard: '3/4', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(2);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'a3-test1-done',
    'a3-test2-done',
  ]);
});

test('should exit with shard=/3', async ({ runInlineTest }) => {
  test.info().annotations.push({ type: 'issue', description: 'https://github.com/microsoft/playwright/issues/34463' });
  const result = await runInlineTest(tests, { shard: '/3' });
  expect(result.exitCode).toBe(1);
});

test('should not produce skipped tests for zero-sized shards', async ({ runInlineTest }) => {
  const result = await runInlineTest(tests, { shard: '10/10', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(0);
  expect(result.failed).toBe(0);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([]);
});

test('should respect shard=1/2 in config', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    ...tests,
    'playwright.config.js': `
      module.exports = { shard: { current: 1, total: 2 } };
    `,
  }, { workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(5);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'a1-test1-done',
    'a1-test2-done',
    'a1-test3-done',
    'a1-test4-done',
    'a2-test1-done',
  ]);
});

test('should work with workers=1 and --fully-parallel', async ({ runInlineTest }) => {
  test.info().annotations.push({ type: 'issue', description: 'https://github.com/microsoft/playwright/issues/21226' });
  const tests = {
    'a1.spec.ts': `
      import { test } from '@playwright/test';
      test('should pass', async ({ }) => {
      });
      test.skip('should skip', async ({ }) => {
      });
    `,
    'a2.spec.ts': `
    import { test } from '@playwright/test';
    test('should pass', async ({ }) => {
    });
  `,
  };

  const result = await runInlineTest(tests, { shard: '1/2', ['fully-parallel']: true, workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
  expect(result.skipped).toBe(1);
});

test('should skip dependency when project is sharded out', async ({ runInlineTest }) => {
  const tests = {
    'playwright.config.ts': `
      module.exports = {
        projects: [
          { name: 'setup1', testMatch: /setup.ts/ },
          { name: 'tests1', dependencies: ['setup1'] },
          { name: 'setup2', testMatch: /setup.ts/ },
          { name: 'tests2', dependencies: ['setup2'] },
        ],
      };
    `,
    'test.spec.ts': `
      import { test } from '@playwright/test';
      test('test', async ({}) => {
        console.log('\\n%%test in ' + test.info().project.name);
      });
    `,
    'setup.ts': `
      import { test } from '@playwright/test';
      test('setup', async ({}) => {
        console.log('\\n%%setup in ' + test.info().project.name);
      });
    `,
  };

  const result = await runInlineTest(tests, { shard: '2/2', workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(2);
  expect(result.skipped).toBe(0);
  expect(result.outputLines).toEqual([
    'setup in setup2',
    'test in tests2',
  ]);
});

test('should not shard mode:default suites', async ({ runInlineTest }) => {
  test.info().annotations.push({ type: 'issue', description: 'https://github.com/microsoft/playwright/issues/22891' });

  const tests = {
    'a1.spec.ts': `
      import { test } from '@playwright/test';
      test('test0', async ({ }) => {
        console.log('\\n%%test0');
      });
      test('test1', async ({ }) => {
        console.log('\\n%%test1');
      });
    `,
    'a2.spec.ts': `
      import { test } from '@playwright/test';
      test.describe.configure({ mode: 'parallel' });

      test.describe(() => {
        test.describe.configure({ mode: 'default' });
        test.beforeAll(() => {
          console.log('\\n%%beforeAll1');
        });
        test('test2', async ({ }) => {
          console.log('\\n%%test2');
        });
        test('test3', async ({ }) => {
          console.log('\\n%%test3');
        });
      });

      test.describe(() => {
        test.describe.configure({ mode: 'default' });
        test.beforeAll(() => {
          console.log('\\n%%beforeAll2');
        });
        test('test4', async ({ }) => {
          console.log('\\n%%test4');
        });
        test('test5', async ({ }) => {
          console.log('\\n%%test5');
        });
      });
  `,
  };

  {
    const result = await runInlineTest(tests, { shard: '2/3', workers: 1 });
    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(2);
    expect(result.outputLines).toEqual(['beforeAll1', 'test2', 'test3']);
  }
  {
    const result = await runInlineTest(tests, { shard: '3/3', workers: 1 });
    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(2);
    expect(result.outputLines).toEqual(['beforeAll2', 'test4', 'test5']);
  }
});

test('should shard tests with beforeAll based on shards total instead of workers', {
  annotation: { type: 'issue', description: 'https://github.com/microsoft/playwright/issues/33077' },
}, async ({ runInlineTest }) => {
  const tests = {
    'a.spec.ts': `
      import { test } from '@playwright/test';

      test.describe.configure({ mode: 'parallel' });
      test.beforeAll(() => {
        console.log('\\n%%beforeAll');
      });

      for (let i = 1; i <= 8; i++) {
        test('test ' + i, async ({ }) => {
          console.log('\\n%%test' + i);
        });
      }
    `,
  };

  {
    const result = await runInlineTest(tests, { shard: '1/4', workers: 1 });
    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(2);
    expect(result.outputLines).toEqual(['beforeAll', 'test1', 'test2']);
  }
  {
    const result = await runInlineTest(tests, { shard: '2/4', workers: 1 });
    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(2);
    expect(result.outputLines).toEqual(['beforeAll', 'test3', 'test4']);
  }
  {
    const result = await runInlineTest(tests, { shard: '7/8', workers: 6 });
    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(1);
    expect(result.outputLines).toEqual(['beforeAll', 'test7']);
  }
});

test('should properly account for skipped tests when using weighted balancing', async ({ runInlineTest }) => {
  const tests = {
    'with-skipped.spec.ts': `
      import { test } from '@playwright/test';
      test('test1', async () => {
        console.log('\\n%%regular1-done');
      });
      test.skip('skipped1', async () => {});
      test.skip('skipped2', async () => {});
      test.skip('skipped3', async () => {});
    `,
    'all-active.spec.ts': `
      import { test } from '@playwright/test';
      test('test2', async () => {
        console.log('\\n%%regular2-done');
      });
      test('test3', async () => {
        console.log('\\n%%regular3-done');
      });
    `,
    'playwright.config.js': `
      module.exports = {
        testDir: '.',
        testBalancing: 'weight'
      };
    `
  };

  // First run to collect runtime data
  const firstRun = await runInlineTest(tests, { workers: 1 });
  expect(firstRun.exitCode).toBe(0);
  expect(firstRun.passed).toBe(3);
  expect(firstRun.skipped).toBe(3);

  // Run with sharding - with proper skipped test handling, we should have
  // a balanced distribution of active tests, ignoring skipped ones
  const firstShard = await runInlineTest(tests, { shard: '1/2', workers: 1 });
  expect(firstShard.exitCode).toBe(0);

  const secondShard = await runInlineTest(tests, { shard: '2/2', workers: 1 });
  expect(secondShard.exitCode).toBe(0);

  // Total non-skipped tests between shards should be 3
  expect(firstShard.passed + secondShard.passed).toBe(3);

  // If not properly accounting for skipped tests, the 'with-skipped.spec.ts'
  // file would have more "weight" due to total test count including skipped tests
  // Proper balancing should result in a 1/2 or 2/1 split of active tests
  const firstShardCount = firstShard.passed;
  const secondShardCount = secondShard.passed;

  const isProperlyBalanced =
    (firstShardCount === 1 && secondShardCount === 2) ||
    (firstShardCount === 2 && secondShardCount === 1);

  expect(isProperlyBalanced).toBe(true);

  // Make sure all skipped tests are counted in the report
  expect(firstShard.skipped + secondShard.skipped).toBe(3);

  // All active tests should be run exactly once across both shards
  const allRegularOutput = [
    ...firstShard.outputLines.filter(line => line.includes('regular')),
    ...secondShard.outputLines.filter(line => line.includes('regular'))
  ].sort();

  expect(allRegularOutput).toEqual([
    'regular1-done',
    'regular2-done',
    'regular3-done'
  ]);
});

test('should balance shards based on file size when using weighted balancing', async ({ runInlineTest }) => {
  // Create test files with different sizes
  const tests = {
    'large.spec.ts': `
      import { test } from '@playwright/test';
      ${Array(200).fill('// Large file line of text').join('\n')}
      test('large-file-test', async () => {
        console.log('\\n%%large-file-test-done');
      });
    `,
    'small.spec.ts': `
      import { test } from '@playwright/test';
      // This file is small with 5 tests
      for (let i = 1; i <= 5; i++) {
        test('small-test-' + i, async () => {
          console.log('\\n%%small-test-' + i + '-done');
        });
      }
    `,
    'playwright.config.js': `
      module.exports = {
        testDir: '.',
        testBalancing: 'weight'
      };
    `
  };

  // Run with sharding - with file size balancing, we expect a balanced distribution
  const firstShard = await runInlineTest(tests, { shard: '1/2', workers: 1 });
  expect(firstShard.exitCode).toBe(0);

  const secondShard = await runInlineTest(tests, { shard: '2/2', workers: 1 });
  expect(secondShard.exitCode).toBe(0);

  // Total tests run should be 6
  expect(firstShard.passed + secondShard.passed).toBe(6);

  // All tests should be run exactly once
  const allOutput = [...firstShard.outputLines, ...secondShard.outputLines].sort();
  expect(allOutput).toEqual([
    'large-file-test-done',
    'small-test-1-done',
    'small-test-2-done',
    'small-test-3-done',
    'small-test-4-done',
    'small-test-5-done'
  ]);
});
