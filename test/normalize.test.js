import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parseOpenApiBytes } from '../src/openapi/parse.js';
import { normalizeOpenApiToDocs } from '../src/openapi/normalize.js';

test('normalizeOpenApiToDocs: produces one operation doc and one schema doc for fixture', async () => {
  const p = path.join(process.cwd(), 'test/fixtures/petstore.json');
  const spec = parseOpenApiBytes({ bytes: await fs.readFile(p), filename: p });

  const docs = normalizeOpenApiToDocs({ sourceId: 'pet', spec });

  const op = docs.find((d) => d.kind === 'operation');
  const schema = docs.find((d) => d.kind === 'schema');

  assert.ok(op);
  assert.ok(schema);
  assert.equal(op.method, 'GET');
  assert.equal(op.path, '/pets');
  assert.equal(schema.schemaName, 'Pet');
});
