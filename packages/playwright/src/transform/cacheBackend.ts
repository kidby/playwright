/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';

import { isWorkerProcess } from '../globals.js';

// `better-sqlite3` is a native binding — loading it parses ~30 KB of JS plus
// the .node addon binding (50-100 ms cold). Defer to `openCacheDb()` so the
// cost lands on first cache access, not at module-import time.
// `import type` here keeps the types available for declarations without
// triggering the runtime require.
import type Database from 'better-sqlite3';

export type SqliteCacheEntry = {
  code: string;
  sourceMap: string | null;
  data: string | null;
  moduleUrl: string | null;
};

// One-shot env-var check: `PWTEST_LEGACY_CACHE=1` reverts to the file-per-hash
// layout. Useful as a rollback escape hatch if the SQLite backend misbehaves.
export const useLegacyCache = !!process.env.PWTEST_LEGACY_CACHE;

let _DatabaseCtor: typeof Database | undefined;
function loadDatabaseCtor(): typeof Database {
  if (!_DatabaseCtor) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _DatabaseCtor = require('better-sqlite3');
  }
  return _DatabaseCtor!;
}

let _db: Database.Database | undefined;
let _dbOpenAttempted = false;
let _selectStmt: Database.Statement | undefined;
let _selectMapStmt: Database.Statement | undefined;
let _insertStmt: Database.Statement | undefined;
let _deleteStmt: Database.Statement | undefined;

function dbPathFor(cacheDir: string): string {
  return path.join(cacheDir, 'transform.sqlite');
}

// Lazy open. Workers open read-only (and tolerate a missing DB by returning
// undefined — the main process is expected to have transpiled most files
// before workers spawn, but worker-only dynamic imports fall through to a
// fresh re-transpile). Main opens read-write and creates the schema.
export function openCacheDb(cacheDir: string): Database.Database | undefined {
  if (_db)
    return _db;
  if (_dbOpenAttempted)
    return _db;
  _dbOpenAttempted = true;
  const dbPath = dbPathFor(cacheDir);
  const readonly = isWorkerProcess();
  try {
    if (!readonly)
      fs.mkdirSync(cacheDir, { recursive: true });
    const DatabaseCtor = loadDatabaseCtor();
    _db = new DatabaseCtor(dbPath, { readonly, fileMustExist: readonly });
    if (!readonly) {
      _db.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          filename TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          code TEXT NOT NULL,
          source_map TEXT,
          data TEXT,
          module_url TEXT,
          mtime INTEGER NOT NULL,
          PRIMARY KEY (filename, content_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_filename ON cache (filename);
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
      `);
    }
    return _db;
  } catch {
    // Worker hits this when the DB doesn't exist yet (main hasn't transpiled),
    // OR when SQLite is unavailable for some platform reason. Either way, the
    // caller falls back to re-transpiling — same contract as a cache miss.
    _db = undefined;
    return undefined;
  }
}

function selectStmt(db: Database.Database): Database.Statement {
  return _selectStmt ??= db.prepare('SELECT code, source_map, data, module_url FROM cache WHERE filename = ? AND content_hash = ?');
}

function selectMapStmt(db: Database.Database): Database.Statement {
  return _selectMapStmt ??= db.prepare('SELECT source_map FROM cache WHERE filename = ? AND content_hash = ?');
}

function insertStmt(db: Database.Database): Database.Statement {
  return _insertStmt ??= db.prepare(
      'INSERT OR REPLACE INTO cache (filename, content_hash, code, source_map, data, module_url, mtime) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
}

function deleteStmt(db: Database.Database): Database.Statement {
  return _deleteStmt ??= db.prepare('DELETE FROM cache WHERE filename = ? AND content_hash != ?');
}

export function sqliteGetEntry(cacheDir: string, filename: string, contentHash: string): SqliteCacheEntry | undefined {
  const queued = _queueIndex.get(queueKey(filename, contentHash));
  if (queued)
    return { code: queued[2], sourceMap: queued[3], data: queued[4], moduleUrl: queued[5] };
  const db = openCacheDb(cacheDir);
  if (!db)
    return undefined;
  try {
    const row = selectStmt(db).get(filename, contentHash) as { code: string; source_map: string | null; data: string | null; module_url: string | null } | undefined;
    if (!row)
      return undefined;
    return { code: row.code, sourceMap: row.source_map, data: row.data, moduleUrl: row.module_url };
  } catch {
    return undefined;
  }
}

export function sqliteGetSourceMap(cacheDir: string, filename: string, contentHash: string): string | undefined {
  const queued = _queueIndex.get(queueKey(filename, contentHash));
  if (queued)
    return queued[3] ?? undefined;
  const db = openCacheDb(cacheDir);
  if (!db)
    return undefined;
  try {
    const row = selectMapStmt(db).get(filename, contentHash) as { source_map: string | null } | undefined;
    return row?.source_map ?? undefined;
  } catch {
    return undefined;
  }
}

// Write batching. Each `transformHook` cache miss calls sqliteAddEntry; on a
// cold cache that's hundreds of synchronous INSERT OR REPLACE + DELETE pairs,
// each paying WAL fsync overhead. Wrap consecutive inserts in a single
// transaction (32 rows or 10 ms, whichever comes first), amortising the
// fsync across the batch. Drops the synthetic-transform overhead from
// +22% over the upstream file-per-hash path back toward parity.
type QueuedEntry = [
  filename: string,
  contentHash: string,
  code: string,
  sourceMap: string | null,
  data: string | null,
  moduleUrl: string | null,
  mtime: number,
];
const FLUSH_AFTER = 32;
const FLUSH_MS = 10;
const _queue: QueuedEntry[] = [];
// Mirror the queue keyed by (filename, contentHash) so same-process reads
// after a batched write find the in-memory copy before falling back to the
// DB. Without this, a write-then-read in the same process would miss the
// cache for up to FLUSH_MS.
const _queueIndex = new Map<string, QueuedEntry>();
let _queuedCacheDir: string | undefined;
let _flushTimer: NodeJS.Timeout | undefined;
let _flushTransaction: ((rows: QueuedEntry[]) => void) | undefined;

function queueKey(filename: string, contentHash: string): string {
  return filename + '\0' + contentHash;
}

function buildFlushTransaction(db: Database.Database): (rows: QueuedEntry[]) => void {
  const ins = insertStmt(db);
  const del = deleteStmt(db);
  return db.transaction((rows: QueuedEntry[]) => {
    for (const r of rows) {
      ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6]);
      // Prune older content-hashes for the same filename — same as the
      // pre-batching path, just inside the transaction so it amortises too.
      del.run(r[0], r[1]);
    }
  }) as unknown as (rows: QueuedEntry[]) => void;
}

export function flushSqliteWrites(): void {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = undefined;
  }
  if (!_queue.length || !_queuedCacheDir)
    return;
  const db = openCacheDb(_queuedCacheDir);
  if (!db) {
    _queue.length = 0;
    return;
  }
  try {
    if (!_flushTransaction)
      _flushTransaction = buildFlushTransaction(db);
    _flushTransaction(_queue);
  } catch {
    // Best-effort: cache failures must not break the test run.
  }
  _queue.length = 0;
  _queueIndex.clear();
}

export function sqliteAddEntry(
  cacheDir: string,
  filename: string,
  contentHash: string,
  code: string,
  sourceMap: string | null,
  data: string | null,
  moduleUrl: string | null,
): void {
  // Workers open the DB read-only; queueing in-process is wasted memory.
  if (isWorkerProcess())
    return;
  _queuedCacheDir = cacheDir;
  const entry: QueuedEntry = [filename, contentHash, code, sourceMap, data, moduleUrl, Date.now()];
  _queue.push(entry);
  _queueIndex.set(queueKey(filename, contentHash), entry);
  if (_queue.length >= FLUSH_AFTER) {
    flushSqliteWrites();
    return;
  }
  if (!_flushTimer)
    _flushTimer = setTimeout(flushSqliteWrites, FLUSH_MS).unref();
}

export function closeCacheDb(): void {
  // Flush any pending writes before tearing down. installSourceMapSupport
  // registers this on `process.once('exit', ...)`, so this is the last
  // chance to persist a partial batch.
  flushSqliteWrites();
  if (!_db)
    return;
  try {
    _db.close();
  } catch {
    // Already closed or never opened cleanly.
  }
  _db = undefined;
  _selectStmt = undefined;
  _selectMapStmt = undefined;
  _insertStmt = undefined;
  _deleteStmt = undefined;
  _flushTransaction = undefined;
  _dbOpenAttempted = false;
}

// Background cleanup: the legacy backend wrote per-file `{2-char}/{hash}_{name}.{js,map,data}`
// triplets. Schedule a fire-and-forget removal so users migrating from the file
// layout don't accumulate stale inodes forever.
let _migrationScheduled = false;
export function scheduleLegacyLayoutCleanup(cacheDir: string): void {
  if (_migrationScheduled || isWorkerProcess())
    return;
  _migrationScheduled = true;
  setImmediate(() => {
    try {
      const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
      for (const entry of entries) {
        // Old layout used 2-character hex subdirectories.
        if (entry.isDirectory() && /^[0-9a-f]{2}$/.test(entry.name))
          fs.rmSync(path.join(cacheDir, entry.name), { recursive: true, force: true });
      }
    } catch {
      // Cache dir may not exist yet; nothing to clean.
    }
  });
}
