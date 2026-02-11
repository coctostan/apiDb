export function initStateDb(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS source_http_cache (
      sourceId TEXT PRIMARY KEY,
      location TEXT NOT NULL,
      effectiveUrl TEXT,
      etag TEXT,
      lastModified TEXT,
      lastCheckedAt TEXT,
      lastFetchedAt TEXT,
      lastError TEXT
    );

    CREATE TABLE IF NOT EXISTS source_blobs (
      sha256 TEXT NOT NULL,
      sourceId TEXT NOT NULL,
      fetchedAt TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('url','file')),
      location TEXT NOT NULL,
      effectiveUrl TEXT,
      contentType TEXT,
      bytesLength INTEGER NOT NULL,
      blobPath TEXT NOT NULL,
      PRIMARY KEY (sourceId, sha256)
    );

    CREATE INDEX IF NOT EXISTS source_blobs_by_source_time ON source_blobs(sourceId, fetchedAt DESC);
  `);
}
