import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function searchDocs({ root, query, kind = 'any', sourceId = null, limit = 10 }) {
  const capped = Math.max(1, Math.min(50, Number(limit || 10)));
  const dbPath = path.join(root, '.apidb', 'index.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const where = [];
  const params = { $q: query, $limit: capped };

  if (kind !== 'any') {
    where.push('d.kind = $kind');
    params.$kind = kind;
  }
  if (sourceId) {
    where.push('d.sourceId = $sourceId');
    params.$sourceId = sourceId;
  }

  const sql = `
    SELECT
      d.id,
      d.kind,
      d.title,
      d.sourceId,
      snippet(docs_fts, 1, '', '', '…', 12) AS snippet
    FROM docs_fts
    JOIN docs d ON d.rowid = docs_fts.rowid
    WHERE docs_fts MATCH $q
      ${where.length ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY
      bm25(docs_fts) ASC,
      CASE WHEN d.kind = 'operation' THEN 0 ELSE 1 END ASC
    LIMIT $limit
  `;

  const results = db.prepare(sql).all(params);
  db.close();
  return { query, results };
}
