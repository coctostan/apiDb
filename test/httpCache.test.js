import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { searchDocs } from '../src/core/search.js';

const specBody = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'CacheSpec', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { operationId: 'listPets', summary: 'List pets', responses: { '200': { description: 'ok' } } }
    }
  }
});

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-httpcache-'));
  await initConfig({ root });
  return root;
}

test('syncWorkspace: URL source uses ETag cache; 2nd sync can index from 304 using persisted blob', async () => {
  let first = true;
  let sawIfNoneMatchOnSecond = false;

  const server = http.createServer((req, res) => {
    if (req.url !== '/spec') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    const inm = req.headers['if-none-match'];
    if (!first && inm === '"v1"') {
      sawIfNoneMatchOnSecond = true;
      res.statusCode = 304;
      res.end();
      return;
    }

    first = false;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('etag', '"v1"');
    res.end(specBody);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [{ id: 'cache', type: 'openapi', location: `http://127.0.0.1:${port}/spec`, enabled: true }]
    }
  });

  try {
    await syncWorkspace({ root, strict: true, allowPrivateNet: true, maxSpecBytes: 1024 * 1024 });

    const res1 = searchDocs({ root, query: 'listPets', limit: 10 });
    assert.ok(res1.results.some((r) => r.id === 'op:cache:GET:/pets'));

    await syncWorkspace({ root, strict: true, allowPrivateNet: true, maxSpecBytes: 1024 * 1024 });

    const res2 = searchDocs({ root, query: 'listPets', limit: 10 });
    assert.ok(res2.results.some((r) => r.id === 'op:cache:GET:/pets'));

    assert.equal(sawIfNoneMatchOnSecond, true);

    // Also assert persistent state artifacts exist.
    await fs.stat(path.join(root, '.apidb', 'state.sqlite'));
    await fs.stat(path.join(root, '.apidb', 'blobs'));
  } finally {
    server.close();
  }
});
