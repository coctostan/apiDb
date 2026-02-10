import test from 'node:test';
import assert from 'node:assert/strict';

import { opDocId, schemaDocId } from '../src/core/docIds.js';

test('opDocId: stable and uppercases method', () => {
  assert.equal(opDocId({ sourceId: 's', method: 'get', path: '/v1/pets' }), 'op:s:GET:/v1/pets');
});

test('schemaDocId: stable', () => {
  assert.equal(schemaDocId({ sourceId: 's', schemaName: 'Pet' }), 'schema:s:Pet');
});
