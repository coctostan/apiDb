import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { getDocById, renderDocHuman } from '../src/core/show.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-show-'));
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

test('getDocById: loads doc and renderDocHuman includes title', async () => {
  const root = await mkRoot();
  const doc = await getDocById({ root, id: 'op:pet:GET:/pets' });
  assert.equal(doc.id, 'op:pet:GET:/pets');
  const text = renderDocHuman(doc);
  assert.match(text, /GET \/pets/);
});
