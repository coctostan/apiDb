import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initStateDb } from '../db/stateSchema.js';

export async function openStateDb({ root }) {
  const apidbDir = path.join(root, '.apidb');
  await fs.mkdir(apidbDir, { recursive: true });
  const dbPath = path.join(apidbDir, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  initStateDb(db);
  return db;
}
