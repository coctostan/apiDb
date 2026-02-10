import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { withWorkspaceLock } from '../src/core/lock.js';

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'apidb-lock-'));
}

test('withWorkspaceLock: prevents concurrent lock acquisition', async () => {
  const root = await mkTmp();
  await fs.mkdir(path.join(root, '.apidb'));

  let release1;
  const p1 = withWorkspaceLock({ root }, async () => {
    await new Promise((r) => {
      release1 = r;
    });
  });

  await new Promise((r) => setTimeout(r, 50));

  await assert.rejects(() => withWorkspaceLock({ root }, async () => {}), /locked/i);

  release1();
  await p1;
});
