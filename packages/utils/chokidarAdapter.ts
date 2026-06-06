import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export class FSWatcher extends EventEmitter {
  private _watchers = new Set<fs.FSWatcher>();

  constructor() {
    super();
  }

  close() {
    for (const w of this._watchers) w.close();
    this._watchers.clear();
  }

  // Exposed for tests/internal logic that adds to the Set
  _addWatcher(w: fs.FSWatcher) {
    this._watchers.add(w);
  }
}

export function watch(paths: string | string[], options: any = {}) {
  const watcher = new FSWatcher();
  const pathArray = Array.isArray(paths) ? paths : [paths];
  let ignored = options.ignored;
  if (typeof ignored !== 'function') {
    const ignoredPaths = Array.isArray(ignored) ? ignored : (ignored ? [ignored] : []);
    ignored = (targetPath: string) => ignoredPaths.some((p: string) => targetPath.includes(p));
  }

  const watchDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    try {
      const w = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const fullPath = path.join(dir, filename);
        if (ignored && ignored(fullPath)) return;
        watcher.emit('all', 'change', fullPath);
        watcher.emit('change', fullPath);
      });
      watcher._addWatcher(w);
    } catch (e: any) {
      if (e.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
        const w = fs.watch(dir, (event, filename) => {
          if (!filename) return;
          const fullPath = path.join(dir, filename);
          if (ignored && ignored(fullPath)) return;
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
              watchDir(fullPath);
            }
          } catch { }
          watcher.emit('all', 'change', fullPath);
          watcher.emit('change', fullPath);
        });
        watcher._addWatcher(w);
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              watchDir(path.join(dir, entry.name));
            }
          }
        } catch { }
      } else {
        watcher.emit('error', e);
      }
    }
  };

  for (const p of pathArray) {
    watchDir(p);
  }

  setTimeout(() => watcher.emit('ready'), 0);
  return watcher;
}

export default { watch, FSWatcher };
