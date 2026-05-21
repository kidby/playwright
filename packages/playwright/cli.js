#!/usr/bin/env node
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

// Runtime detection happens at the very top, BEFORE any other module
// loads, so Bun.plugin onLoad handlers registered inside bunRuntime can
// intercept subsequent imports. Under Node this is a no-op — the module
// exports nothing and `typeof Bun === 'undefined'`. The shebang above
// makes Node the default; users who invoke this under Bun (e.g.
// `bun ./node_modules/.bin/playwright test` or `bun --bun run playwright`)
// get the Bun runtime path automatically with no separate bin name.
require('./lib/transform/bunRuntime');

const { program } = require('./lib/program');
program.parse(process.argv);
