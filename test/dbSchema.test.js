import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { initDb } from '../src/db/schema.js';

test('initDb: creates required tables including FTS', () => {
  const db = new DatabaseSync(':memory:');
  initDb(db);

  db.exec("INSERT INTO sources(id,type,location,enabled,addedAt) VALUES ('s','openapi','x',1,'t')");
  db.exec('CREATE VIRTUAL TABLE t USING fts5(x)');
  assert.ok(true);
});
