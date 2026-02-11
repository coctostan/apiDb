import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initDb } from '../db/schema.js';
import { parseOpenApiBytes } from '../openapi/parse.js';
import { normalizeOpenApiToDocs } from '../openapi/normalize.js';
import { loadConfig } from './config.js';
import { fetchSourceBytes } from './fetchSource.js';
import { withWorkspaceLock } from './lock.js';
import { nowIso } from './util.js';
import { openStateDb } from './stateDb.js';

export function insertDocs(db, docs) {
  const ins = db.prepare(`
    INSERT INTO docs(id, sourceId, kind, title, method, path, schemaName, json, body)
    VALUES ($id, $sourceId, $kind, $title, $method, $path, $schemaName, $json, $body)
  `);

  const getRowId = db.prepare('SELECT rowid FROM docs WHERE id = ?');
  const insFts = db.prepare('INSERT INTO docs_fts(rowid, title, body) VALUES (?, ?, ?)');

  db.exec('BEGIN');
  try {
    for (const d of docs) {
      ins.run({
        id: d.id,
        sourceId: d.sourceId,
        kind: d.kind,
        title: d.title,
        method: d.method,
        path: d.path,
        schemaName: d.schemaName,
        json: JSON.stringify(d.json),
        body: d.body
      });

      const row = getRowId.get(d.id);
      insFts.run(row.rowid, d.title, d.body);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function syncWorkspace({
  root,
  strict = true,
  maxSpecBytes = 50 * 1024 * 1024,
  allowPrivateNet = false
}) {
  return withWorkspaceLock({ root }, async () => {
    const cfg = await loadConfig({ root });
    const enabledSources = cfg.sources.filter((s) => s.enabled);

    const apidbDir = path.join(root, '.apidb');
    const tmpPath = path.join(apidbDir, 'index.sqlite.tmp');
    const finalPath = path.join(apidbDir, 'index.sqlite');
    const bakPath = path.join(apidbDir, 'index.sqlite.bak');

    await fs.mkdir(apidbDir, { recursive: true });
    try {
      await fs.unlink(tmpPath);
    } catch {}

    // Open persistent state DB for caching
    const stateDb = await openStateDb({ root });

    const db = new DatabaseSync(tmpPath);
    try {
      initDb(db);

      const insertSource = db.prepare(
        'INSERT INTO sources(id, type, location, enabled, addedAt) VALUES (?, ?, ?, ?, ?)'
      );
      for (const s of cfg.sources) {
        insertSource.run(s.id, s.type, s.location, s.enabled ? 1 : 0, s.addedAt ?? nowIso());
      }

      const upsertStatus = db.prepare(`
        INSERT INTO source_status(sourceId, lastFetchedAt, lastOkAt, lastError, docCountOperations, docCountSchemas)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(sourceId) DO UPDATE SET
          lastFetchedAt=excluded.lastFetchedAt,
          lastOkAt=excluded.lastOkAt,
          lastError=excluded.lastError,
          docCountOperations=excluded.docCountOperations,
          docCountSchemas=excluded.docCountSchemas
      `);

      const allDocs = [];
      for (const s of enabledSources) {
        const fetchedAt = nowIso();
        try {
          const { bytes } = await fetchSourceBytes({
            location: s.location,
            maxBytes: maxSpecBytes,
            allowPrivateNet,
            stateDb,
            sourceId: s.id,
            root
          });

          const spec = parseOpenApiBytes({ bytes, filename: s.location });
          const docs = normalizeOpenApiToDocs({ sourceId: s.id, spec });
          allDocs.push(...docs);

          const opCount = docs.filter((d) => d.kind === 'operation').length;
          const schemaCount = docs.filter((d) => d.kind === 'schema').length;

          upsertStatus.run(s.id, fetchedAt, fetchedAt, null, opCount, schemaCount);
        } catch (e) {
          upsertStatus.run(s.id, fetchedAt, null, String(e.message), 0, 0);
          if (strict) {
            throw new Error(`Source ${s.id} failed: ${e.message}`);
          }
        }
      }

      insertDocs(db, allDocs);
      db.close();

      try {
        await fs.stat(finalPath);
        try {
          await fs.unlink(bakPath);
        } catch {}
        await fs.rename(finalPath, bakPath);
      } catch {
        // no previous db
      }

      await fs.rename(tmpPath, finalPath);
      return { sourcesProcessed: enabledSources.length, docsInserted: allDocs.length };
    } catch (e) {
      try {
        db.close();
      } catch {}
      try {
        await fs.unlink(tmpPath);
      } catch {}
      throw e;
    } finally {
      try {
        stateDb.close();
      } catch {}
    }
  });
}
