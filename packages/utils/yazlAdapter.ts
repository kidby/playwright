import { createRequire } from 'module';
const customRequire = createRequire(import.meta.url);
const archiver = customRequire('archiver');
import { EventEmitter } from 'events';

export class ZipFile extends EventEmitter {
  public outputStream: any;
  private archive: any;

  constructor() {
    super();
    this.archive = new archiver.ZipArchive({
      zlib: { level: 6 } // default level
    });
    this.outputStream = this.archive;

    this.archive.on('error', (err: any) => this.emit('error', err));
    this.archive.on('warning', (err: any) => this.emit('error', err));
  }

  addFile(realPath: string, metadataPath: string) {
    this.archive.file(realPath, { name: metadataPath });
  }

  addReadStream(readStream: NodeJS.ReadableStream, metadataPath: string) {
    this.archive.append(readStream as any, { name: metadataPath });
  }

  addBuffer(buffer: Buffer, metadataPath: string) {
    this.archive.append(buffer, { name: metadataPath });
  }

  end(options?: any, callback?: () => void) {
    if (callback) {
      let called = false;
      const cb = () => {
        if (called)
          return;
        called = true;
        callback();
      };
      this.archive.on('end', cb);
      process.nextTick(cb);
    }
    this.archive.finalize();
  }
}
