import { spawn, ChildProcess } from 'child_process';
import EventEmitter from 'events';
import fs from 'fs';

let requestCounter = 1;

export class TypeScriptLanguageServerClient extends EventEmitter {
  private child: ChildProcess;
  private buffer: string = '';
  private requests: Map<number, { resolve: (val: any) => void, reject: (err: any) => void }> = new Map();
  private isInitialized = false;
  public diagnostics: Map<string, any[]> = new Map();

  constructor(private projectRoot: string) {
    super();
    this.child = spawn('npx', ['typescript-language-server', '--stdio'], { cwd: projectRoot, shell: true });

    this.child.stdout?.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.child.stderr?.on('data', (data) => {
      // oxlint-disable-next-line eslint/no-console -- intentional stderr logging for LSP server errors
      console.error('[tsserver error]', data.toString());
    });
  }

  private processBuffer() {
    while (true) {
      const match = this.buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;
      const length = parseInt(match[1], 10);
      const headerLength = match[0].length;
      if (this.buffer.length < headerLength + length) break;

      const message = this.buffer.slice(headerLength, headerLength + length);
      this.buffer = this.buffer.slice(headerLength + length);

      try {
        const payload = JSON.parse(message);
        this.handleMessage(payload);
      } catch (e) {
        // oxlint-disable-next-line eslint/no-console -- intentional error logging for failed LSP message parsing
        console.error('Failed to parse LSP message', e);
      }
    }
  }

  private handleMessage(payload: any) {
    if (payload.id !== undefined && this.requests.has(payload.id)) {
      const { resolve, reject } = this.requests.get(payload.id)!;
      this.requests.delete(payload.id);
      if (payload.error)
        reject(payload.error);
      else
        resolve(payload.result);
    } else if (payload.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = payload.params;
      this.diagnostics.set(uri, diagnostics);
      this.emit('diagnostics', uri, diagnostics);
    } else {
      this.emit('notification', payload);
    }
  }

  private send(message: any) {
    const json = JSON.stringify(message);
    const payload = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    this.child.stdin?.write(payload);
  }

  public async request(method: string, params: any): Promise<any> {
    const id = requestCounter++;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  public notify(method: string, params: any) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  public async initialize() {
    if (this.isInitialized) return;
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri: `file://${this.projectRoot}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          definition: { dynamicRegistration: true, linkSupport: true },
          hover: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          documentSymbol: { dynamicRegistration: true }
        }
      },
      workspaceFolders: [{ uri: `file://${this.projectRoot}`, name: 'project' }]
    });
    this.notify('initialized', {});
    this.isInitialized = true;
    return result;
  }

  public async openDocument(filePath: string) {
    const text = fs.readFileSync(filePath, 'utf-8');
    const uri = `file://${filePath}`;
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text }
    });
    return uri;
  }

  public async getDiagnostics(filePath: string) {
    const uri = await this.openDocument(filePath);
    await new Promise(r => setTimeout(r, 1000));
    return this.diagnostics.get(uri) || [];
  }

  public async getDefinition(filePath: string, line: number, character: number) {
    const uri = await this.openDocument(filePath);
    return this.request('textDocument/definition', {
      textDocument: { uri }, position: { line, character }
    });
  }

  public async getHover(filePath: string, line: number, character: number) {
    const uri = await this.openDocument(filePath);
    return this.request('textDocument/hover', {
      textDocument: { uri }, position: { line, character }
    });
  }

  public async getReferences(filePath: string, line: number, character: number) {
    const uri = await this.openDocument(filePath);
    return this.request('textDocument/references', {
      textDocument: { uri }, position: { line, character }, context: { includeDeclaration: true }
    });
  }

  public async getDocumentSymbols(filePath: string) {
    const uri = await this.openDocument(filePath);
    return this.request('textDocument/documentSymbol', {
      textDocument: { uri }
    });
  }
  
  public close() {
    this.child.kill();
  }
}

// Singleton instance
let tsServerInstance: TypeScriptLanguageServerClient | null = null;

export async function getTsServer(projectRoot: string) {
  if (!tsServerInstance) {
    tsServerInstance = new TypeScriptLanguageServerClient(projectRoot);
    await tsServerInstance.initialize();
  }
  return tsServerInstance;
}
