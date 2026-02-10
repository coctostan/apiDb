import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';

async function mkTmp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-sync-'));
  await fs.mkdir(path.join(root, '.apidb'));
  return root;
}

test('syncWorkspace strict: failed source does not overwrite last-good index', async () => {
  const root = await mkTmp();
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
  const dbPath = path.join(root, '.apidb', 'index.sqlite');
  const st1 = await fs.stat(dbPath);

  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        {
          id: 'pet',
          type: 'openapi',
          location: path.join(root, 'does-not-exist.json'),
          enabled: true
        }
      ]
    }
  });

  await assert.rejects(() => syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 }), /failed/i);

  const st2 = await fs.stat(dbPath);
  assert.equal(st2.size, st1.size);
});
