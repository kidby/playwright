import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const cjsRequire = createRequire(import.meta.url);

export function storybookCtPlugin() {
  let framework = '@storybook/react';

  return {
    name: 'playwright:storybook',
    enforce: 'pre' as const,
    configResolved(config: any) {
      const frameworks = ['@storybook/react', '@storybook/vue3', '@storybook/svelte'];
      for (const fw of frameworks) {
        try {
          cjsRequire.resolve(`${fw}/package.json`, { paths: [config.root] });
          framework = fw;
          break;
        } catch {
          // continue checking
        }
      }
    },
    async resolveId(this: any, source: string, importer: string | undefined, options: any): Promise<any> {
      if (source.includes('.stories.') && !source.includes('?storybook')) {
        const resolution = await this.resolve(source, importer, { skipSelf: true, ...options });
        if (resolution)
          return resolution.id + '?storybook';
      }
    },
    async load(this: any, id: string): Promise<any> {
      if (id.endsWith('?storybook')) {
        const originalId = id.replace('?storybook', '');
        const code = await fs.promises.readFile(originalId, 'utf-8');
        
        let ast: any;
        try {
          ast = this.parse(code);
        } catch (e) {
          ast = null;
        }

        const exportNames: string[] = [];

        if (ast) {
          for (const node of ast.body) {
            if (node.type === 'ExportNamedDeclaration') {
              if (node.declaration) {
                const decl = node.declaration;
                if (decl.type === 'VariableDeclaration') {
                  for (const d of decl.declarations) {
                    if (d.id.type === 'Identifier') {
                      exportNames.push(d.id.name);
                    } else if (d.id.type === 'ObjectPattern') {
                      for (const prop of d.id.properties) {
                        if ((prop.type === 'Property' || prop.type === 'ObjectProperty') && prop.value.type === 'Identifier')
                          exportNames.push(prop.value.name);
                      }
                    } else if (d.id.type === 'ArrayPattern') {
                      for (const elem of d.id.elements) {
                        if (elem && elem.type === 'Identifier')
                          exportNames.push(elem.name);
                      }
                    }
                  }
                } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
                  if (decl.id && decl.id.type === 'Identifier')
                    exportNames.push(decl.id.name);
                }
              }
              if (node.specifiers) {
                for (const spec of node.specifiers) {
                  if (spec.exported && spec.exported.type === 'Identifier')
                    exportNames.push(spec.exported.name);
                }
              }
            }
          }
        } else {
          // Fallback to basic regex if AST parsing is not possible
          const exportRegex = /export\s+(?:const|function|class|let|var)\s+([a-zA-Z0-9_]+)/g;
          let match;
          while ((match = exportRegex.exec(code)) !== null) {
            if (match[1] !== 'default')
              exportNames.push(match[1]);
          }
        }
        
        const uniqueExportNames = [...new Set(exportNames)].filter(name => name !== 'default');
        return `
          import * as stories from ${JSON.stringify(originalId)};
          import { composeStories } from '${framework}';
          const composed = composeStories(stories);
          export default stories.default;
          ${uniqueExportNames.map(name => `export const ${name} = composed.${name};`).join('\n')}
        `;
      }
    }
  };
}
