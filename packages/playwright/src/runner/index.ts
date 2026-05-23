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

// Public surface of the bundled runner/ + reporters/ + plugins/ module.
// Only modules consumed from outside these three directories are
// re-exported here. Files inside the bundle keep using direct relative
// imports.

export * as testRunner from './testRunner.js';
export * as testServer from './testServer.js';
export * as watchMode from './watchMode.js';
export * as projectUtils from './projectUtils.js';
export * as runnerReporters from './reporters.js';
export * as base from '../reporters/base.js';
export * as html from '../reporters/html.js';
export * as merge from '../reporters/merge.js';
export { default as ListReporter } from '../reporters/list.js';
export { default as ListModeReporter } from '../reporters/listModeReporter.js';
export type { ReporterV2 } from '../reporters/reporterV2.js';

// Public re-export of TestServerConnection used by external test fixtures.
export { TestServerConnection } from '../isomorphic/testServerConnection.js';

// Public re-export of webServer plugin used by test fixtures.
export { webServer } from '../plugins/webServerPlugin.js';
