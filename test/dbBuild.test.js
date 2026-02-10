import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { initDb } from '../src/db/schema.js';
import { insertDocs } from '../src/core/sync.js';

test('insertDocs: inserts docs and makes them searchable via FTS', () => {
  const db = new DatabaseSync(':memory:');
  initDb(db);

  db.exec("INSERT INTO sources(id,type,location,enabled,addedAt) VALUES ('pet','openapi','x',1,'t')");

  insertDocs(db, [
    {
      id: 'op:pet:GET:/pets',
      sourceId: 'pet',
      kind: 'operation',
      title: 'GET /pets',
      method: 'GET',
      path: '/pets',
      schemaName: null,
      json: { a: 1 },
      body: 'GET /pets listPets'
    },
    {
      id: 'schema:pet:Pet',
      sourceId: 'pet',
      kind: 'schema',
      title: 'Pet',
      method: null,
      path: null,
      schemaName: 'Pet',
      json: { b: 2 },
      body: 'Pet schema'
    }
  ]);

  const rows = db
    .prepare("SELECT d.id FROM docs_fts f JOIN docs d ON d.rowid = f.rowid WHERE docs_fts MATCH 'listPets'")
    .all();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'op:pet:GET:/pets');
});
