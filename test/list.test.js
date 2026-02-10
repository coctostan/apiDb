import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { listSources } from '../src/core/list.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-list-'));
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

test('listSources: returns status with doc counts', async () => {
  const root = await mkRoot();
  const res = listSources({ root });
  assert.equal(res.sources.length, 1);
  assert.equal(res.sources[0].id, 'pet');
  assert.ok(res.sources[0].status.docCountOperations >= 1);
});
