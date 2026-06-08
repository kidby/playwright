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

import { test, expect } from './playwright-test-fixtures.js';

test('should respect .gitignore', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    '.gitignore': `a.spec.ts`,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `,
    'b.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
});

test('should respect nested .gitignore', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a/.gitignore': `a.spec.ts`,
    'a/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `,
    'a/b.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
});

test('should respect enclosing .gitignore', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    '.gitignore': `a/a.spec.ts`,
    'a/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `,
    'a/b.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
});

test('should respect negations and comments in .gitignore', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    '.gitignore': `
      # A comment
      dir1/
      /dir2
      #a.spec.ts
      !dir1/foo/a.spec.ts
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => console.log('\\n%%a.spec.ts'));
    `,
    'dir1/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => console.log('\\n%%dir1/a.spec.ts'));
    `,
    'dir1/foo/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => console.log('\\n%%dir1/foo/a.spec.ts'));
    `,
    'dir2/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => console.log('\\n%%dir2/a.spec.ts'));
    `,
    'dir3/.gitignore': `
      b.*.ts
    `,
    'dir3/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => console.log('\\n%%dir3/a.spec.ts'));
    `,
    'dir3/b.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => console.log('\\n%%dir3/b.spec.ts'));
    `,
  }, { workers: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(3);
  expect(result.outputLines).toEqual([
    'a.spec.ts',
    'dir1/foo/a.spec.ts',
    'dir3/a.spec.ts',
  ]);
});

test('should ignore .gitignore inside globally configured testDir', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'tests/.gitignore': `
      *.js
    `,
    'playwright.config.ts': `
      export default {
        testDir: './tests',
      };
    `,
    'tests/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `,
    'tests/foo/b.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(2);
});


test('should ignore .gitignore inside project testDir', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'tests/.gitignore': `
      *.js
    `,
    'playwright.config.ts': `
      export default { projects: [
        { testDir: './tests' },
      ] };
    `,
    'tests/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `,
    'tests/foo/b.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(2);
});

test('global config respectGitIgnore', {
  annotation: { type: 'issue', description: 'https://github.com/microsoft/playwright/issues/30553' }
}, async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'tests/.gitignore': `
      *.js
    `,
    'playwright.config.ts': `
      export default { respectGitIgnore: false, projects: [{ }] };
    `,
    'tests/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
});

test('project config respectGitIgnore', {
  annotation: { type: 'issue', description: 'https://github.com/microsoft/playwright/issues/30553' }
}, async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'tests/.gitignore': `
      *.js
    `,
    'playwright.config.ts': `
      export default { projects: [{ respectGitIgnore: false }] };
    `,
    'tests/a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', ({}) => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
});
