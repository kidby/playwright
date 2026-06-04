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

import Database from 'better-sqlite3';

import { isWorkerProcess } from '../globals.js';

export type SqliteCacheEntry = {
  code: string;
  sourceMap: string | null;
  data: string | null;
  moduleUrl: string | null;
};

// One-shot env-var check: `PWTEST_LEGACY_CACHE=1` reverts to the file-per-hash
// layout. Useful as a rollback escape hatch if the SQLite backend misbehaves.
export const useLegacyCache = !!process.env.PWTEST_LEGACY_CACHE;

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
    _db = new Database(dbPath, { readonly, fileMustExist: readonly });
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

export function sqliteAddEntry(
  cacheDir: string,
  filename: string,
  contentHash: string,
  code: string,
  sourceMap: string | null,
  data: string | null,
  moduleUrl: string | null,
): void {
  const db = openCacheDb(cacheDir);
  if (!db)
    return;
  try {
    insertStmt(db).run(filename, contentHash, code, sourceMap, data, moduleUrl, Date.now());
    deleteStmt(db).run(filename, contentHash);
  } catch {
    // Best-effort. Cache failures must not break the test run.
  }
}

export function closeCacheDb(): void {
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
