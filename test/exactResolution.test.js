import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { resolveOperationDocId, resolveSchemaDocId } from '../src/core/exact.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-exact-'));
  await initConfig({ root });
  return root;
}

const petJson = path.join(process.cwd(), 'test/fixtures/petstore.json');
const petYaml = path.join(process.cwd(), 'test/fixtures/petstore.yaml');

test('resolveOperationDocId: without --source succeeds when exactly one enabled source matches', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: false }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  const id = await resolveOperationDocId({ root, method: 'get', path: '/pets', sourceId: null });
  assert.equal(id, 'op:petjson:GET:/pets');
});

test('resolveOperationDocId: without --source errors when ambiguous across enabled sources', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: true }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  await assert.rejects(
    () => resolveOperationDocId({ root, method: 'GET', path: '/pets', sourceId: null }),
    /Ambiguous operation/i
  );
});

test('resolveSchemaDocId: without --source succeeds when exactly one enabled source matches', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: false }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  const id = await resolveSchemaDocId({ root, schemaName: 'Pet', sourceId: null });
  assert.equal(id, 'schema:petjson:Pet');
});

test('resolveSchemaDocId: without --source errors when ambiguous across enabled sources', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: true }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  await assert.rejects(
    () => resolveSchemaDocId({ root, schemaName: 'Pet', sourceId: null }),
    /Ambiguous schema/i
  );
});

test('resolveOperationDocId: with --source returns a promise that resolves to exact id', async () => {
  const result = resolveOperationDocId({ root: '/unused', method: 'get', path: '/pets', sourceId: 'petjson' });
  assert.ok(result instanceof Promise);
  assert.equal(await result, 'op:petjson:GET:/pets');
});

test('resolveSchemaDocId: with --source returns a promise that resolves to exact id', async () => {
  const result = resolveSchemaDocId({ root: '/unused', schemaName: 'Pet', sourceId: 'petjson' });
  assert.ok(result instanceof Promise);
  assert.equal(await result, 'schema:petjson:Pet');
});
