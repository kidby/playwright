import { FixtureRunner } from '../../packages/playwright/src/worker/fixtureRunner';
import * as fixtures from '../../packages/playwright/src/common/fixtures';

async function run() {
  console.log('Starting FixtureRunner unit test...');
  const runner = new FixtureRunner();
  
  const fixturesList: fixtures.FixturesWithLocation[] = [
    {
      fixtures: {
        mockFixture: [async (params: any, use: any) => {
          await use('mock-value');
        }, { scope: 'test' }]
      },
      location: { file: 'mock.ts', line: 1, column: 1 }
    }
  ];

  const pool = new fixtures.FixturePool(fixturesList, (msg, loc) => {
    console.error('Load error:', msg);
  });
  runner.setPool(pool);

  // We need a mock TestInfoImpl
  const fakeTestInfo: any = {
    config: {},
    project: {},
    annotations: [],
    attachments: [],
    errors: [],
    _timeoutManager: {
      isTimeExhaustedFor: () => false,
    },
    _runWithTimeout: async (runnable: any, fn: any) => {
      return fn();
    },
    _runAsStep: async (stepInfo: any, fn: any) => {
      return fn();
    }
  };

  const registration = pool.resolve('mockFixture')!;

  // Setup the fixture
  const fixture = await (runner as any)._setupFixtureForRegistration(registration, fakeTestInfo, { type: 'test' });
  console.log('Fixture setup completed. Value:', fixture.value);

  // Verify _usages is initially empty
  if (fixture._usages.size !== 0)
    throw new Error('Expected _usages to be empty');

  // Manually violate fixture integrity by adding a mock usage
  fixture._usages.add({} as any);

  // Call teardown, which should trigger the new assertion!
  try {
    await fixture.teardown(fakeTestInfo, { type: 'test' });
    console.error('FAIL: Teardown did not throw an assertion error!');
    process.exit(1);
  } catch (err: any) {
    console.log('Caught expected error:', err.message);
    if (err.message.includes('Internal error: fixture integrity at mockFixture')) {
      console.log('PASS: Assert fired and threw the correct error message!');
      process.exit(0);
    } else {
      console.error('FAIL: Unexpected error message:', err.message);
      process.exit(1);
    }
  }
}

run().catch(err => {
  console.error('Unhandled error in unit test:', err);
  process.exit(1);
});
