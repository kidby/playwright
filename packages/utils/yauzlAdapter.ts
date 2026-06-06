import { createRequire as _createRequire } from 'module';
const _req = _createRequire(import.meta.url);
const StreamZip = _req('node-stream-zip');
import { EventEmitter } from 'events';

export function open(path: string, options: any, callback: (err: any, zipFile?: any) => void) {
  if (typeof options === 'function') {
    callback = options;
  }
  const zip = new StreamZip.async({ file: path });
  zip.entries().then(entries => {
    const zipFile = new EventEmitter();
    (zipFile as any).entryCount = Object.keys(entries).length;
    (zipFile as any).openReadStream = (entry: any, cb: any) => {
      zip.stream(entry.name).then(stream => cb(null, stream)).catch(err => cb(err));
    };
    (zipFile as any).close = () => {
      zip.close().catch(() => {});
    };
    
    callback(null, zipFile);
    
    for (const entry of Object.values(entries)) {
      zipFile.emit('entry', { fileName: entry.name, ...entry });
    }
    zipFile.emit('end');
  }).catch(err => callback(err));
}

export default { open };
