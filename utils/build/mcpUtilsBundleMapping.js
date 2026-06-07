// Mapping between idiomatic npm imports and the keys exported from
// `playwright-core/lib/mcpUtilsBundle`.
//
// Split from utilsBundleMapping.js so that MCP SDK + zod imports are
// rewritten to the separate mcpUtilsBundle, keeping the main utilsBundle
// small for test worker cold-start.

/** @type {Record<string, { default?: string, named?: Record<string,string>, namespace?: string }>} */
const MAPPING = {
  'zod': { namespace: 'z' },
  'zod-to-json-schema': { named: { zodToJsonSchema: 'zodToJsonSchema' } },
  '@modelcontextprotocol/sdk/client/index.js': { named: { Client: 'Client' } },
  '@modelcontextprotocol/sdk/server/index.js': { named: { Server: 'Server' } },
  '@modelcontextprotocol/sdk/client/sse.js': { named: { SSEClientTransport: 'SSEClientTransport' } },
  '@modelcontextprotocol/sdk/server/sse.js': { named: { SSEServerTransport: 'SSEServerTransport' } },
  '@modelcontextprotocol/sdk/client/stdio.js': { named: { StdioClientTransport: 'StdioClientTransport' } },
  '@modelcontextprotocol/sdk/server/stdio.js': { named: { StdioServerTransport: 'StdioServerTransport' } },
  '@modelcontextprotocol/sdk/server/streamableHttp.js': { named: { StreamableHTTPServerTransport: 'StreamableHTTPServerTransport' } },
  '@modelcontextprotocol/sdk/client/streamableHttp.js': { named: { StreamableHTTPClientTransport: 'StreamableHTTPClientTransport' } },
  '@modelcontextprotocol/sdk/types.js': {
    named: {
      CallToolRequestSchema: 'CallToolRequestSchema',
      ListRootsRequestSchema: 'ListRootsRequestSchema',
      ListToolsRequestSchema: 'ListToolsRequestSchema',
      PingRequestSchema: 'PingRequestSchema',
      ProgressNotificationSchema: 'ProgressNotificationSchema',
    },
  },
};

const VENDORED_PACKAGES = new Set(Object.keys(MAPPING));

module.exports = { MAPPING, VENDORED_PACKAGES };
