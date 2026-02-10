import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function mkRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'apidb-cli-'));
}

test('cli: apidb root prints chosen root', async () => {
  const root = await mkRoot();
  const res = spawnSync(process.execPath, ['src/cli.js', 'root', '--root', root], {
    encoding: 'utf8'
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, new RegExp(root.replace(/[-/\\]/g, (m) => `\\${m}`)));
});

test('cli: list works before first sync', async () => {
  const root = await mkRoot();

  let res = spawnSync(process.execPath, ['src/cli.js', 'init', '--root', root], {
    encoding: 'utf8'
  });
  assert.equal(res.status, 0);

  res = spawnSync(
    process.execPath,
    [
      'src/cli.js',
      'add',
      'openapi',
      path.join(process.cwd(), 'test/fixtures/petstore.json'),
      '--id',
      'pet',
      '--no-sync',
      '--root',
      root
    ],
    { encoding: 'utf8' }
  );
  assert.equal(res.status, 0);

  res = spawnSync(process.execPath, ['src/cli.js', 'list', '--root', root, '--json'], {
    encoding: 'utf8'
  });
  assert.equal(res.status, 0);

  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].id, 'pet');
  assert.equal(parsed.sources[0].status, null);
});

test('cli: init + add + search works end-to-end', async () => {
  const root = await mkRoot();

  let res = spawnSync(process.execPath, ['src/cli.js', 'init', '--root', root], {
    encoding: 'utf8'
  });
  assert.equal(res.status, 0);

  res = spawnSync(
    process.execPath,
    [
      'src/cli.js',
      'add',
      'openapi',
      path.join(process.cwd(), 'test/fixtures/petstore.json'),
      '--id',
      'pet',
      '--root',
      root
    ],
    { encoding: 'utf8' }
  );
  assert.equal(res.status, 0);

  res = spawnSync(process.execPath, ['src/cli.js', 'search', 'listPets', '--root', root, '--json'], {
    encoding: 'utf8'
  });
  assert.equal(res.status, 0);

  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.results.find((r) => r.id === 'op:pet:GET:/pets'));
});
