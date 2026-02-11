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

export function upsertHttpCacheRow(db, row) {
  db.prepare(`
    INSERT INTO source_http_cache
      (sourceId, location, effectiveUrl, etag, lastModified, lastCheckedAt, lastFetchedAt, lastError)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sourceId) DO UPDATE SET
      location = excluded.location,
      effectiveUrl = excluded.effectiveUrl,
      etag = excluded.etag,
      lastModified = excluded.lastModified,
      lastCheckedAt = excluded.lastCheckedAt,
      lastFetchedAt = excluded.lastFetchedAt,
      lastError = excluded.lastError
  `).run(
    row.sourceId,
    row.location,
    row.effectiveUrl ?? null,
    row.etag ?? null,
    row.lastModified ?? null,
    row.lastCheckedAt ?? null,
    row.lastFetchedAt ?? null,
    row.lastError ?? null
  );
}

export function insertBlobRow(db, row) {
  db.prepare(`
    INSERT INTO source_blobs
      (sha256, sourceId, fetchedAt, kind, location, effectiveUrl, contentType, bytesLength, blobPath)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sourceId, sha256) DO UPDATE SET
      fetchedAt = excluded.fetchedAt,
      kind = excluded.kind,
      location = excluded.location,
      effectiveUrl = excluded.effectiveUrl,
      contentType = excluded.contentType,
      bytesLength = excluded.bytesLength,
      blobPath = excluded.blobPath
  `).run(
    row.sha256,
    row.sourceId,
    row.fetchedAt,
    row.kind,
    row.location,
    row.effectiveUrl ?? null,
    row.contentType ?? null,
    row.bytesLength,
    row.blobPath
  );
}

export function getLatestBlobForSource(db, sourceId) {
  return db.prepare(`
    SELECT * FROM source_blobs
    WHERE sourceId = ?
    ORDER BY fetchedAt DESC
    LIMIT 1
  `).get(sourceId);
}

export async function pruneBlobsKeepLatestPerSource(db, { root, sourceId }) {
  // Find the latest row
  const latest = getLatestBlobForSource(db, sourceId);
  if (!latest) return;

  // Find older rows
  const older = db.prepare(`
    SELECT * FROM source_blobs
    WHERE sourceId = ? AND sha256 != ?
  `).all(sourceId, latest.sha256);

  // Delete older rows from DB
  db.prepare(`
    DELETE FROM source_blobs
    WHERE sourceId = ? AND sha256 != ?
  `).run(sourceId, latest.sha256);

  // Best-effort delete blob files, but only if no other source row still references the same hash
  const hasOtherRefs = db.prepare(`
    SELECT 1 FROM source_blobs
    WHERE sha256 = ? AND sourceId != ?
    LIMIT 1
  `);
  for (const row of older) {
    const inUseElsewhere = hasOtherRefs.get(row.sha256, sourceId);
    if (inUseElsewhere) continue;

    try {
      await fs.unlink(row.blobPath);
    } catch {
      // best-effort: file may already be gone
    }
  }
}
