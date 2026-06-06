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

import * as z from 'zod';
import { defineTestTool } from './testTool.js';
import { getTsServer } from './typescriptLanguageServer.js';

export const getTypescriptDiagnostics = defineTestTool({
  schema: {
    name: 'get_typescript_diagnostics',
    title: 'Get TypeScript Diagnostics',
    description: 'Get TypeScript diagnostics for a specific file',
    inputSchema: z.object({
      file: z.string().describe('Absolute path to the TypeScript file'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params, signal) => {
    // Assuming context has a property for project root, if not we fall back to process.cwd()
    const projectRoot = process.cwd();
    const tsServer = await getTsServer(projectRoot);
    const diagnostics = await tsServer.getDiagnostics(params.file);
    return { content: [{ type: 'text', text: JSON.stringify(diagnostics, null, 2) }] };
  },
});

export const getTypescriptDefinition = defineTestTool({
  schema: {
    name: 'get_typescript_definition',
    title: 'Get TypeScript Definition',
    description: 'Get the definition of a symbol at a specific position in a file',
    inputSchema: z.object({
      file: z.string().describe('Absolute path to the TypeScript file'),
      line: z.number().describe('Line number (0-indexed)'),
      character: z.number().describe('Character position (0-indexed)'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params, signal) => {
    const projectRoot = process.cwd();
    const tsServer = await getTsServer(projectRoot);
    const definition = await tsServer.getDefinition(params.file, params.line, params.character);
    return { content: [{ type: 'text', text: JSON.stringify(definition, null, 2) }] };
  },
});

export const getTypescriptHover = defineTestTool({
  schema: {
    name: 'get_typescript_hover',
    title: 'Get TypeScript Hover',
    description: 'Get the hover information for a symbol at a specific position',
    inputSchema: z.object({
      file: z.string(),
      line: z.number(),
      character: z.number(),
    }),
    type: 'readOnly',
  },
  handle: async (context, params, signal) => {
    const tsServer = await getTsServer(process.cwd());
    const hover = await tsServer.getHover(params.file, params.line, params.character);
    return { content: [{ type: 'text', text: JSON.stringify(hover, null, 2) }] };
  },
});

export const getTypescriptReferences = defineTestTool({
  schema: {
    name: 'get_typescript_references',
    title: 'Get TypeScript References',
    description: 'Get the references to a symbol at a specific position',
    inputSchema: z.object({
      file: z.string(),
      line: z.number(),
      character: z.number(),
    }),
    type: 'readOnly',
  },
  handle: async (context, params, signal) => {
    const tsServer = await getTsServer(process.cwd());
    const refs = await tsServer.getReferences(params.file, params.line, params.character);
    return { content: [{ type: 'text', text: JSON.stringify(refs, null, 2) }] };
  },
});

export const getTypescriptDocumentSymbols = defineTestTool({
  schema: {
    name: 'get_typescript_document_symbols',
    title: 'Get TypeScript Document Symbols',
    description: 'Get all symbols in a TypeScript file',
    inputSchema: z.object({
      file: z.string(),
    }),
    type: 'readOnly',
  },
  handle: async (context, params, signal) => {
    const tsServer = await getTsServer(process.cwd());
    const symbols = await tsServer.getDocumentSymbols(params.file);
    return { content: [{ type: 'text', text: JSON.stringify(symbols, null, 2) }] };
  },
});
