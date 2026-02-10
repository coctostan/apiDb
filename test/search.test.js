import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { searchDocs } from '../src/core/search.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-search-'));
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

test('searchDocs: finds operation by operationId token', async () => {
  const root = await mkRoot();
  const res = await searchDocs({ root, query: 'listPets', limit: 10 });
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].kind, 'operation');
});
