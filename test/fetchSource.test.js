import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { fetchSourceBytes } from '../src/core/fetchSource.js';

test('fetchSourceBytes: reads local file', async () => {
  const p = path.join(process.cwd(), 'test', 'fixtures', 'petstore.json');
  const { bytes, kind } = await fetchSourceBytes({ location: p, maxBytes: 1024 * 1024 });
  assert.equal(kind, 'file');
  assert.ok(bytes.length > 10);
});

test('fetchSourceBytes: enforces maxBytes', async () => {
  const p = path.join(process.cwd(), 'test', 'fixtures', 'petstore.json');
  await assert.rejects(() => fetchSourceBytes({ location: p, maxBytes: 10 }), /MAX_SPEC_BYTES|maxBytes/i);
});
