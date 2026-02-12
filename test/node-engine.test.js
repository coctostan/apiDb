import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

test('package.json declares minimum supported Node version for node:sqlite', () => {
  assert.equal(pkg.engines?.node, '>=22.5.0');
});

test('package-lock root metadata stays in sync with package.json engines', () => {
  assert.equal(lock.packages?.['']?.engines?.node, pkg.engines?.node);
});
