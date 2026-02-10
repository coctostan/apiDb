import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { findWorkspaceRoot } from '../src/core/root.js';

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'apidb-root-'));
}

test('findWorkspaceRoot: prefers nearest parent with .apidb/', async () => {
  const root = await mkTmp();
  const nested = path.join(root, 'a', 'b');
  await fs.mkdir(nested, { recursive: true });
  await fs.mkdir(path.join(root, '.apidb'));

  const res = await findWorkspaceRoot({ cwd: nested });
  assert.equal(res.root, root);
  assert.equal(res.reason, 'found .apidb directory');
});

test('findWorkspaceRoot: uses explicit --root when provided', async () => {
  const root = await mkTmp();
  const other = await mkTmp();
  await fs.mkdir(path.join(other, '.apidb'));

  const res = await findWorkspaceRoot({ cwd: other, rootFlag: root });
  assert.equal(res.root, root);
  assert.equal(res.reason, 'explicit --root');
});
