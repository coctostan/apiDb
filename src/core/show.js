import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function getDocById({ root, id }) {
  const db = new DatabaseSync(path.join(root, '.apidb', 'index.sqlite'), { readOnly: true });
  const row = db
    .prepare('SELECT id, sourceId, kind, title, method, path, schemaName, json, body FROM docs WHERE id = ?')
    .get(id);
  db.close();

  if (!row) {
    throw new Error(`Doc not found: ${id}`);
  }

  return {
    ...row,
    json: JSON.parse(row.json)
  };
}

export function renderDocHuman(doc) {
  if (doc.kind === 'operation') {
    return [
      `${doc.method} ${doc.path}`,
      doc.json.summary ? `Summary: ${doc.json.summary}` : null,
      doc.json.operationId ? `OperationId: ${doc.json.operationId}` : null
    ]
      .filter(Boolean)
      .join('\n') + '\n';
  }

  return [`Schema ${doc.schemaName}`, doc.json.description ? `Description: ${doc.json.description}` : null]
    .filter(Boolean)
    .join('\n') + '\n';
}
