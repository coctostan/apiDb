import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { resolveOperationDocId } from '../src/core/exact.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-exact-'));
  await fs.mkdir(path.join(root, '.apidb'));
  await initConfig({ root });
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        {
          id: 'pet',
          type: 'openapi',
          location: path.join(process.cwd(), 'test/fixtures/petstore.json'),
          enabled: true
        }
      ]
    }
  });
  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });
  return root;
}

test('resolveOperationDocId: returns deterministic docId', async () => {
  await mkRoot();
  const id = await resolveOperationDocId({ method: 'GET', path: '/pets', sourceId: 'pet' });
  assert.equal(id, 'op:pet:GET:/pets');
});
