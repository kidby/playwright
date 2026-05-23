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

// Re-export both surfaces directly. The runner introspects `test` via the
// `[testTypeSymbol]` it stamped on; going through an object-spread loses the
// symbol because `{ ...mod }` only copies string keys. Direct ESM re-exports
// preserve the original `test` reference.
export {
  test,
  expect,
  defineConfig,
  mergeTests,
  mergeExpects,
  _baseTest,
  _utilityTest,
} from './lib/index.js';

import { test as _testDefault } from './lib/index.js';
export default _testDefault;

export {
  chromium,
  firefox,
  webkit,
  selectors,
  devices,
  errors,
  request,
  _electron,
  _android,
} from 'playwright-core';
