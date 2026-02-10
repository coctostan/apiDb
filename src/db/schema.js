export function initDb(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      location TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      addedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_status (
      sourceId TEXT PRIMARY KEY,
      lastFetchedAt TEXT,
      lastOkAt TEXT,
      lastError TEXT,
      docCountOperations INTEGER NOT NULL DEFAULT 0,
      docCountSchemas INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(sourceId) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      sourceId TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('operation', 'schema')),
      title TEXT NOT NULL,
      method TEXT,
      path TEXT,
      schemaName TEXT,
      json TEXT NOT NULL,
      body TEXT NOT NULL,
      FOREIGN KEY(sourceId) REFERENCES sources(id)
    );

    CREATE INDEX IF NOT EXISTS docs_source_kind ON docs(sourceId, kind);

    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      title,
      body,
      content='docs',
      content_rowid='rowid'
    );
  `);
}
