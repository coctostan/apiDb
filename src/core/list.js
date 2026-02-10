import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function listSources({ root }) {
  const db = new DatabaseSync(path.join(root, '.apidb', 'index.sqlite'), { readOnly: true });
  const sources = db.prepare('SELECT id, type, location, enabled, addedAt FROM sources ORDER BY id').all();
  const statuses = db
    .prepare('SELECT sourceId, lastFetchedAt, lastOkAt, lastError, docCountOperations, docCountSchemas FROM source_status')
    .all();
  db.close();

  const statusById = new Map(statuses.map((s) => [s.sourceId, s]));

  return {
    sources: sources.map((s) => ({
      ...s,
      enabled: !!s.enabled,
      status: statusById.get(s.id) ?? null
    }))
  };
}
