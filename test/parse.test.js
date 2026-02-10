import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parseOpenApiBytes } from '../src/openapi/parse.js';

test('parseOpenApiBytes: parses JSON', async () => {
  const p = path.join(process.cwd(), 'test/fixtures/petstore.json');
  const bytes = await fs.readFile(p);
  const spec = parseOpenApiBytes({ bytes, filename: p });
  assert.equal(spec.openapi, '3.0.0');
  assert.equal(spec.info.title, 'Petstore');
});

test('parseOpenApiBytes: parses YAML', async () => {
  const p = path.join(process.cwd(), 'test/fixtures/petstore.yaml');
  const bytes = await fs.readFile(p);
  const spec = parseOpenApiBytes({ bytes, filename: p });
  assert.equal(spec.openapi, '3.0.0');
  assert.equal(spec.info.title, 'PetstoreYaml');
});

test('parseOpenApiBytes: rejects non-OpenAPI document', () => {
  const bytes = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
  assert.throws(() => parseOpenApiBytes({ bytes, filename: 'bad.json' }), /openapi/i);
});

test('parseOpenApiBytes: rejects unsupported OpenAPI version', () => {
  const bytes = Buffer.from(JSON.stringify({ openapi: '2.0.0', info: {}, paths: {} }), 'utf8');
  assert.throws(() => parseOpenApiBytes({ bytes, filename: 'swagger.json' }), /3\.x|unsupported/i);
});
