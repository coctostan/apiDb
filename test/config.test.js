import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, loadConfig, saveConfig, addOpenApiSource } from '../src/core/config.js';

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'apidb-config-'));
}

test('initConfig: creates .apidb/config.json with version=1', async () => {
  const root = await mkTmp();
  await initConfig({ root });

  const cfg = await loadConfig({ root });
  assert.equal(cfg.version, 1);
  assert.deepEqual(cfg.sources, []);
});

test('addOpenApiSource: validates id and adds enabled=true by default', async () => {
  const root = await mkTmp();
  await initConfig({ root });

  const cfg1 = await loadConfig({ root });
  const cfg2 = addOpenApiSource(cfg1, { id: 'stripe', location: 'https://example.com/spec.json' });
  await saveConfig({ root, config: cfg2 });

  const cfg3 = await loadConfig({ root });
  assert.equal(cfg3.sources.length, 1);
  assert.equal(cfg3.sources[0].id, 'stripe');
  assert.equal(cfg3.sources[0].type, 'openapi');
  assert.equal(cfg3.sources[0].enabled, true);
});
