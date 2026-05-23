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

export { setupExitWatchdog } from './mcp/watchdog.js';

export { BrowserBackend } from './backend/browserBackend.js';
export { parseResponse } from './backend/response.js';
export { Tab } from './backend/tab.js';
export { browserTools, filteredTools } from './backend/tools.js';
export { start } from './utils/mcp/server.js';
export { createConnection } from './mcp/index.js';
export { resolveCLIConfigForCLI, resolveCLIConfigForMCP } from './mcp/config.js';
export { outputDir } from './backend/context.js';
export { isSystemDirectory } from '@utils/fileUtils';
export { isProfileLocked } from './mcp/browserFactory.js';
export { compareSemver } from './utils/socketConnection.js';
export { extractTrace, DirTraceLoaderBackend } from './trace/traceParser.js';
export { decorateMCPCommand } from './mcp/program.js';
export { program as cliProgram } from './cli-client/program.js';
export { generateHelp, generateHelpJSON } from './cli-daemon/helpGenerator.js';
export { decorateProgram as decorateCliDaemonProgram } from './cli-daemon/program.js';
export { openDashboardApp, openDashboardForContext } from './dashboard/dashboardApp.js';

export type { ContextConfig } from './backend/context.js';
export type { CallToolRequest, CallToolResult, Tool } from './backend/tool.js';
export type { ClientInfo } from './utils/mcp/server.js';
export type { FullConfig } from './mcp/config.js';
export type { ServerBackend } from './utils/mcp/server.js';
export type { ToolSchema } from './utils/mcp/tool.js';
export type { ServerBackendFactory } from './utils/mcp/server.js';
