import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { initStateDb } from '../src/db/stateSchema.js';
import {
  upsertHttpCacheRow,
  insertBlobRow,
  getLatestBlobForSource,
  pruneBlobsKeepLatestPerSource
} from '../src/core/stateDb.js';
import { ensureBlobDir, writeBlobIfMissing, sha256Hex } from '../src/core/blobStore.js';

function memDb() {
  const db = new DatabaseSync(':memory:');
  initStateDb(db);
  return db;
}

// --- upsertHttpCacheRow ---

test('upsertHttpCacheRow: inserts a new row', () => {
  const db = memDb();
  upsertHttpCacheRow(db, {
    sourceId: 's1',
    location: 'http://example.com/spec',
    etag: '"v1"',
    lastModified: null,
    lastCheckedAt: '2025-01-01T00:00:00Z',
    lastFetchedAt: '2025-01-01T00:00:00Z',
    lastError: null,
    effectiveUrl: null
  });
  const row = db.prepare("SELECT * FROM source_http_cache WHERE sourceId = 's1'").get();
  assert.equal(row.sourceId, 's1');
  assert.equal(row.location, 'http://example.com/spec');
  assert.equal(row.etag, '"v1"');
  db.close();
});

test('upsertHttpCacheRow: updates existing row on conflict', () => {
  const db = memDb();
  upsertHttpCacheRow(db, {
    sourceId: 's1',
    location: 'http://example.com/spec',
    etag: '"v1"',
    lastModified: null,
    lastCheckedAt: '2025-01-01T00:00:00Z',
    lastFetchedAt: '2025-01-01T00:00:00Z',
    lastError: null,
    effectiveUrl: null
  });
  upsertHttpCacheRow(db, {
    sourceId: 's1',
    location: 'http://example.com/spec',
    etag: '"v2"',
    lastModified: 'Mon, 01 Jan 2025 00:00:00 GMT',
    lastCheckedAt: '2025-01-02T00:00:00Z',
    lastFetchedAt: '2025-01-02T00:00:00Z',
    lastError: null,
    effectiveUrl: 'http://example.com/spec-v2'
  });
  const rows = db.prepare("SELECT * FROM source_http_cache WHERE sourceId = 's1'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].etag, '"v2"');
  assert.equal(rows[0].effectiveUrl, 'http://example.com/spec-v2');
  db.close();
});

// --- insertBlobRow ---

test('insertBlobRow: inserts a blob row', () => {
  const db = memDb();
  insertBlobRow(db, {
    sha256: 'abc123',
    sourceId: 's1',
    fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url',
    location: 'http://example.com/spec',
    effectiveUrl: null,
    contentType: 'application/json',
    bytesLength: 100,
    blobPath: '/tmp/blobs/abc123.bin'
  });
  const row = db.prepare("SELECT * FROM source_blobs WHERE sha256 = 'abc123'").get();
  assert.equal(row.sourceId, 's1');
  assert.equal(row.bytesLength, 100);
  db.close();
});

test('insertBlobRow: replaces existing row with same sha256 for same source', () => {
  const db = memDb();
  const base = {
    sha256: 'abc123',
    sourceId: 's1',
    fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url',
    location: 'http://example.com/spec',
    effectiveUrl: null,
    contentType: 'application/json',
    bytesLength: 100,
    blobPath: '/tmp/blobs/abc123.bin'
  };
  insertBlobRow(db, base);
  insertBlobRow(db, { ...base, fetchedAt: '2025-01-02T00:00:00Z' });
  const rows = db.prepare("SELECT * FROM source_blobs WHERE sourceId = 's1' AND sha256 = 'abc123'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fetchedAt, '2025-01-02T00:00:00Z');
  db.close();
});

test('insertBlobRow: allows same sha256 for different sources', () => {
  const db = memDb();
  const shared = {
    sha256: 'samehash',
    fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url',
    location: 'http://example.com/spec',
    effectiveUrl: null,
    contentType: 'application/json',
    bytesLength: 100,
    blobPath: '/tmp/blobs/samehash.bin'
  };

  insertBlobRow(db, { ...shared, sourceId: 's1' });
  insertBlobRow(db, { ...shared, sourceId: 's2' });

  const rows = db.prepare("SELECT sourceId, sha256 FROM source_blobs WHERE sha256 = 'samehash' ORDER BY sourceId").all();
  const plainRows = rows.map((r) => ({ sourceId: r.sourceId, sha256: r.sha256 }));
  assert.deepEqual(plainRows, [
    { sourceId: 's1', sha256: 'samehash' },
    { sourceId: 's2', sha256: 'samehash' }
  ]);

  db.close();
});

// --- getLatestBlobForSource ---

test('getLatestBlobForSource: returns null when no blobs exist', () => {
  const db = memDb();
  const row = getLatestBlobForSource(db, 's1');
  assert.equal(row, undefined);
  db.close();
});

test('getLatestBlobForSource: returns the blob with latest fetchedAt', () => {
  const db = memDb();
  insertBlobRow(db, {
    sha256: 'old', sourceId: 's1', fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url', location: 'http://x', effectiveUrl: null,
    contentType: null, bytesLength: 10, blobPath: '/p/old.bin'
  });
  insertBlobRow(db, {
    sha256: 'new', sourceId: 's1', fetchedAt: '2025-01-02T00:00:00Z',
    kind: 'url', location: 'http://x', effectiveUrl: null,
    contentType: null, bytesLength: 20, blobPath: '/p/new.bin'
  });
  insertBlobRow(db, {
    sha256: 'other', sourceId: 's2', fetchedAt: '2025-01-03T00:00:00Z',
    kind: 'url', location: 'http://y', effectiveUrl: null,
    contentType: null, bytesLength: 30, blobPath: '/p/other.bin'
  });
  const row = getLatestBlobForSource(db, 's1');
  assert.equal(row.sha256, 'new');
  assert.equal(row.bytesLength, 20);
  db.close();
});

// --- pruneBlobsKeepLatestPerSource ---

test('pruneBlobsKeepLatestPerSource: keeps latest, deletes older rows and blob files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-prune-'));
  await ensureBlobDir({ root });

  const db = memDb();

  // Write two blobs to disk
  const bytes1 = Buffer.from('old content');
  const sha1 = sha256Hex(bytes1);
  await writeBlobIfMissing({ root, sha256: sha1, bytes: bytes1 });

  const bytes2 = Buffer.from('new content');
  const sha2 = sha256Hex(bytes2);
  await writeBlobIfMissing({ root, sha256: sha2, bytes: bytes2 });

  const blobPath1 = path.join(root, '.apidb', 'blobs', sha1 + '.bin');
  const blobPath2 = path.join(root, '.apidb', 'blobs', sha2 + '.bin');

  insertBlobRow(db, {
    sha256: sha1, sourceId: 's1', fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url', location: 'http://x', effectiveUrl: null,
    contentType: null, bytesLength: bytes1.length, blobPath: blobPath1
  });
  insertBlobRow(db, {
    sha256: sha2, sourceId: 's1', fetchedAt: '2025-01-02T00:00:00Z',
    kind: 'url', location: 'http://x', effectiveUrl: null,
    contentType: null, bytesLength: bytes2.length, blobPath: blobPath2
  });

  await pruneBlobsKeepLatestPerSource(db, { root, sourceId: 's1' });

  // Latest row kept
  const kept = db.prepare("SELECT * FROM source_blobs WHERE sha256 = ?").get(sha2);
  assert.ok(kept);

  // Old row deleted
  const gone = db.prepare("SELECT * FROM source_blobs WHERE sha256 = ?").get(sha1);
  assert.equal(gone, undefined);

  // Old blob file deleted
  await assert.rejects(fs.access(blobPath1));

  // New blob file still exists
  await fs.access(blobPath2); // should not throw

  db.close();
});

test('pruneBlobsKeepLatestPerSource: no-op when only one blob exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-prune-'));
  await ensureBlobDir({ root });

  const db = memDb();

  const bytes = Buffer.from('only content');
  const sha = sha256Hex(bytes);
  const { blobPath } = await writeBlobIfMissing({ root, sha256: sha, bytes });

  insertBlobRow(db, {
    sha256: sha, sourceId: 's1', fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url', location: 'http://x', effectiveUrl: null,
    contentType: null, bytesLength: bytes.length, blobPath
  });

  await pruneBlobsKeepLatestPerSource(db, { root, sourceId: 's1' });

  const row = db.prepare("SELECT * FROM source_blobs WHERE sha256 = ?").get(sha);
  assert.ok(row);
  await fs.access(blobPath); // still exists
  db.close();
});

test('pruneBlobsKeepLatestPerSource: does not touch other sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-prune-'));
  await ensureBlobDir({ root });

  const db = memDb();

  const bytes1 = Buffer.from('source2 content');
  const sha1 = sha256Hex(bytes1);
  await writeBlobIfMissing({ root, sha256: sha1, bytes: bytes1 });

  insertBlobRow(db, {
    sha256: sha1, sourceId: 's2', fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url', location: 'http://y', effectiveUrl: null,
    contentType: null, bytesLength: bytes1.length,
    blobPath: path.join(root, '.apidb', 'blobs', sha1 + '.bin')
  });

  await pruneBlobsKeepLatestPerSource(db, { root, sourceId: 's1' });

  const row = db.prepare("SELECT * FROM source_blobs WHERE sha256 = ?").get(sha1);
  assert.ok(row, 's2 blob should not be pruned');
  db.close();
});

test('pruneBlobsKeepLatestPerSource: handles missing blob file gracefully', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-prune-'));
  await ensureBlobDir({ root });

  const db = memDb();

  const blobPath1 = path.join(root, '.apidb', 'blobs', 'deadbeef.bin');
  // Don't create file on disk — it's already gone

  insertBlobRow(db, {
    sha256: 'deadbeef', sourceId: 's1', fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url', location: 'http://x', effectiveUrl: null,
    contentType: null, bytesLength: 10, blobPath: blobPath1
  });

  const bytes2 = Buffer.from('latest');
  const sha2 = sha256Hex(bytes2);
  await writeBlobIfMissing({ root, sha256: sha2, bytes: bytes2 });

  insertBlobRow(db, {
    sha256: sha2, sourceId: 's1', fetchedAt: '2025-01-02T00:00:00Z',
    kind: 'url', location: 'http://x', effectiveUrl: null,
    contentType: null, bytesLength: bytes2.length,
    blobPath: path.join(root, '.apidb', 'blobs', sha2 + '.bin')
  });

  // Should not throw even though blobPath1 doesn't exist on disk
  await pruneBlobsKeepLatestPerSource(db, { root, sourceId: 's1' });

  const gone = db.prepare("SELECT * FROM source_blobs WHERE sha256 = 'deadbeef'").get();
  assert.equal(gone, undefined);
  db.close();
});

test('pruneBlobsKeepLatestPerSource: does not delete shared blob file still referenced by another source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-prune-'));
  await ensureBlobDir({ root });

  const db = memDb();

  const sharedBytes = Buffer.from('shared content');
  const sharedSha = sha256Hex(sharedBytes);
  const { blobPath: sharedBlobPath } = await writeBlobIfMissing({
    root,
    sha256: sharedSha,
    bytes: sharedBytes
  });

  insertBlobRow(db, {
    sha256: sharedSha,
    sourceId: 's1',
    fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url',
    location: 'http://s1/spec',
    effectiveUrl: null,
    contentType: null,
    bytesLength: sharedBytes.length,
    blobPath: sharedBlobPath
  });
  insertBlobRow(db, {
    sha256: sharedSha,
    sourceId: 's2',
    fetchedAt: '2025-01-01T00:00:00Z',
    kind: 'url',
    location: 'http://s2/spec',
    effectiveUrl: null,
    contentType: null,
    bytesLength: sharedBytes.length,
    blobPath: sharedBlobPath
  });

  const newerBytes = Buffer.from('newer s1 content');
  const newerSha = sha256Hex(newerBytes);
  const { blobPath: newerBlobPath } = await writeBlobIfMissing({
    root,
    sha256: newerSha,
    bytes: newerBytes
  });

  insertBlobRow(db, {
    sha256: newerSha,
    sourceId: 's1',
    fetchedAt: '2025-01-02T00:00:00Z',
    kind: 'url',
    location: 'http://s1/spec',
    effectiveUrl: null,
    contentType: null,
    bytesLength: newerBytes.length,
    blobPath: newerBlobPath
  });

  await pruneBlobsKeepLatestPerSource(db, { root, sourceId: 's1' });

  // s1 old row pruned
  const s1Old = db.prepare("SELECT * FROM source_blobs WHERE sourceId = 's1' AND sha256 = ?").get(sharedSha);
  assert.equal(s1Old, undefined);

  // s2 row still references shared hash
  const s2Shared = db.prepare("SELECT * FROM source_blobs WHERE sourceId = 's2' AND sha256 = ?").get(sharedSha);
  assert.ok(s2Shared);

  // shared blob file must still exist because s2 still references it
  await fs.access(sharedBlobPath);
  db.close();
});
