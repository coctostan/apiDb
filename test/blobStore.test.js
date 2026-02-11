import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { sha256Hex, ensureBlobDir, writeBlobIfMissing } from '../src/core/blobStore.js';

// --- sha256Hex ---

test('sha256Hex: returns lowercase hex sha256 of a buffer', () => {
  const buf = Buffer.from('hello world');
  const expected = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha256Hex(buf), expected);
});

test('sha256Hex: returns correct hash for empty buffer', () => {
  const buf = Buffer.alloc(0);
  const expected = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha256Hex(buf), expected);
});

test('sha256Hex: returns 64-character lowercase hex string', () => {
  const hash = sha256Hex(Buffer.from('test'));
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

// --- ensureBlobDir ---

test('ensureBlobDir: creates .apidb/blobs directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-blob-'));
  const blobDir = await ensureBlobDir({ root });
  assert.equal(blobDir, path.join(root, '.apidb', 'blobs'));
  const stat = await fs.stat(blobDir);
  assert.ok(stat.isDirectory());
});

test('ensureBlobDir: is idempotent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-blob-'));
  await ensureBlobDir({ root });
  const blobDir = await ensureBlobDir({ root });
  const stat = await fs.stat(blobDir);
  assert.ok(stat.isDirectory());
});

// --- writeBlobIfMissing ---

test('writeBlobIfMissing: writes <sha>.bin file when missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-blob-'));
  await ensureBlobDir({ root });
  const bytes = Buffer.from('some spec content');
  const sha = sha256Hex(bytes);

  const result = await writeBlobIfMissing({ root, sha256: sha, bytes });
  assert.equal(result.written, true);
  assert.equal(result.blobPath, path.join(root, '.apidb', 'blobs', sha + '.bin'));

  const contents = await fs.readFile(result.blobPath);
  assert.deepEqual(contents, bytes);
});

test('writeBlobIfMissing: skips write when blob already exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-blob-'));
  await ensureBlobDir({ root });
  const bytes = Buffer.from('existing content');
  const sha = sha256Hex(bytes);

  await writeBlobIfMissing({ root, sha256: sha, bytes });
  const result = await writeBlobIfMissing({ root, sha256: sha, bytes });
  assert.equal(result.written, false);
  assert.equal(result.blobPath, path.join(root, '.apidb', 'blobs', sha + '.bin'));
});

test('writeBlobIfMissing: existing file content is preserved (not overwritten)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-blob-'));
  await ensureBlobDir({ root });
  const bytes = Buffer.from('original');
  const sha = sha256Hex(bytes);

  await writeBlobIfMissing({ root, sha256: sha, bytes });
  // Write different content to same path manually to detect overwrites
  const blobPath = path.join(root, '.apidb', 'blobs', sha + '.bin');
  await fs.writeFile(blobPath, Buffer.from('tampered'));

  await writeBlobIfMissing({ root, sha256: sha, bytes });
  const contents = await fs.readFile(blobPath, 'utf8');
  assert.equal(contents, 'tampered'); // not overwritten
});
