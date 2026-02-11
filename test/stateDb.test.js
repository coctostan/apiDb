import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { initStateDb } from '../src/db/stateSchema.js';
import { openStateDb } from '../src/core/stateDb.js';

test('initStateDb: creates source_http_cache table with correct columns', () => {
  const db = new DatabaseSync(':memory:');
  initStateDb(db);

  const info = db.prepare("PRAGMA table_info(source_http_cache)").all();
  const cols = info.map((r) => r.name);
  assert.deepEqual(cols, [
    'sourceId',
    'location',
    'effectiveUrl',
    'etag',
    'lastModified',
    'lastCheckedAt',
    'lastFetchedAt',
    'lastError'
  ]);

  // sourceId is PRIMARY KEY
  const pk = info.find((r) => r.name === 'sourceId');
  assert.equal(pk.pk, 1);

  // location is NOT NULL
  const loc = info.find((r) => r.name === 'location');
  assert.equal(loc.notnull, 1);

  db.close();
});

test('initStateDb: creates source_blobs table with correct columns and CHECK constraint', () => {
  const db = new DatabaseSync(':memory:');
  initStateDb(db);

  const info = db.prepare("PRAGMA table_info(source_blobs)").all();
  const cols = info.map((r) => r.name);
  assert.deepEqual(cols, [
    'sha256',
    'sourceId',
    'fetchedAt',
    'kind',
    'location',
    'effectiveUrl',
    'contentType',
    'bytesLength',
    'blobPath'
  ]);

  // sha256 is PRIMARY KEY
  const pk = info.find((r) => r.name === 'sha256');
  assert.equal(pk.pk, 1);

  // NOT NULL columns
  for (const col of ['sourceId', 'fetchedAt', 'kind', 'location', 'bytesLength', 'blobPath']) {
    const c = info.find((r) => r.name === col);
    assert.equal(c.notnull, 1, `${col} should be NOT NULL`);
  }

  // CHECK constraint on kind: only 'url' and 'file' allowed
  db.prepare(
    `INSERT INTO source_blobs (sha256, sourceId, fetchedAt, kind, location, bytesLength, blobPath)
     VALUES ('abc', 's1', '2025-01-01', 'url', '/x', 10, '/p')`
  ).run();
  db.prepare(
    `INSERT INTO source_blobs (sha256, sourceId, fetchedAt, kind, location, bytesLength, blobPath)
     VALUES ('def', 's1', '2025-01-01', 'file', '/x', 10, '/p')`
  ).run();

  assert.throws(() => {
    db.prepare(
      `INSERT INTO source_blobs (sha256, sourceId, fetchedAt, kind, location, bytesLength, blobPath)
       VALUES ('ghi', 's1', '2025-01-01', 'invalid', '/x', 10, '/p')`
    ).run();
  });

  db.close();
});

test('initStateDb: creates source_blobs_by_source_time index', () => {
  const db = new DatabaseSync(':memory:');
  initStateDb(db);

  const indexes = db.prepare("PRAGMA index_list(source_blobs)").all();
  const idx = indexes.find((r) => r.name === 'source_blobs_by_source_time');
  assert.ok(idx, 'index source_blobs_by_source_time should exist');

  const idxInfo = db.prepare("PRAGMA index_info(source_blobs_by_source_time)").all();
  const idxCols = idxInfo.map((r) => r.name);
  assert.deepEqual(idxCols, ['sourceId', 'fetchedAt']);

  db.close();
});

test('initStateDb: is idempotent (can run twice)', () => {
  const db = new DatabaseSync(':memory:');
  initStateDb(db);
  initStateDb(db); // should not throw
  db.close();
});

test('initStateDb: sets WAL journal mode', () => {
  // WAL only works on-disk; in-memory always returns 'memory'
  // We verify the PRAGMA is present by testing with a real file
  const tmpDir = os.tmpdir();
  const dbPath = path.join(tmpDir, `statedb-test-${Date.now()}.sqlite`);
  const db = new DatabaseSync(dbPath);
  initStateDb(db);

  const result = db.prepare('PRAGMA journal_mode').get();
  assert.equal(result.journal_mode, 'wal');
  db.close();

  // Cleanup
  fs.unlink(dbPath).catch(() => {});
  fs.unlink(dbPath + '-wal').catch(() => {});
  fs.unlink(dbPath + '-shm').catch(() => {});
});

test('openStateDb: creates .apidb dir and state.sqlite, returns usable db', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-state-'));

  const db = await openStateDb({ root });

  // Verify .apidb/state.sqlite exists
  const stat = await fs.stat(path.join(root, '.apidb', 'state.sqlite'));
  assert.ok(stat.isFile());

  // Verify tables are usable
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('source_http_cache'));
  assert.ok(names.includes('source_blobs'));

  db.close();
});

test('openStateDb: is idempotent (can open existing db)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-state-'));

  const db1 = await openStateDb({ root });
  db1.prepare(
    `INSERT INTO source_http_cache (sourceId, location) VALUES ('s1', 'http://example.com')`
  ).run();
  db1.close();

  const db2 = await openStateDb({ root });
  const row = db2.prepare("SELECT * FROM source_http_cache WHERE sourceId = 's1'").get();
  assert.equal(row.sourceId, 's1');
  assert.equal(row.location, 'http://example.com');
  db2.close();
});
