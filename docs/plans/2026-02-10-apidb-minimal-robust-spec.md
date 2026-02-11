---
name: apidb-minimal-robust-spec
version: v1.0
created: 2026-02-10
status: draft
---

# apidb v1.0 — Minimal-but-robust spec

This is a concrete v1.0 specification for a local OpenAPI indexer/search tool (“apidb”) optimized for agent-friendly bounded retrieval.

## 0) Non-negotiable invariants
1. **Deterministic IDs**: same source + same spec ⇒ same doc IDs.
2. **Last-good preserved**: failed sync never overwrites the last-good DB.
3. **Bounded outputs**: defaults always agent-safe (target <5KB typical).
4. **Robust ingestion**: cycle-safe parsing/normalization with hard limits.

---

## 1) Workspace layout
At workspace root (detected or passed via `--root`):

- `.apidb/config.json` (source of truth)
- `.apidb/index.sqlite` (derived)
- `.apidb/index.sqlite.tmp` (derived during sync)
- `.apidb/lock` (sync mutex)

Optional (recommended):
- `.apidb/index.sqlite.bak` (previous last-good after successful swap)

---

## 2) Root discovery (predictable + debuggable)
Order:
1. `--root <path>` if provided
2. nearest parent containing `.apidb/`
3. git toplevel (if inside a git repo)
4. `cwd`

If multiple candidates exist, require `--root` or print a clear warning.

Command:
- `apidb root [--verbose]` → prints chosen root + reason

---

## 3) Config format (v1)
`.apidb/config.json`:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "stripe",
      "type": "openapi",
      "location": "https://…/spec.json",
      "enabled": true
    }
  ]
}
```

Rules:
- `id` is stable + user-visible. Validate: `[a-zA-Z0-9._-]+`, unique.
- `enabled` defaults to true.
- Auth/headers are out of scope for v1.

---

## 4) CLI surface (minimal set)
- `apidb init [--root …]`
- `apidb add openapi <url|path> --id <id> [--no-sync]`
- `apidb sync [--strict] [--allow-partial]`
- `apidb list` (sources + last sync summary + doc counts + last error per source)
- `apidb search <query> [--kind operation|schema|any] [--source <id>] [--limit N] [--json]`
- `apidb show <docId> [--json]`
- `apidb op <METHOD> <PATH> --source <id> [--json]` (exact operation lookup)
- `apidb schema <NAME> --source <id> [--json]` (exact schema lookup)
- `apidb root [--verbose]`

Note: the v1 implementation requires `--source` for `op`/`schema`. Planned (v2): allow omitting `--source` with ambiguity resolution.

Defaults:
- `sync` defaults to `--strict` unless `--allow-partial` is passed.
- `search --limit` default 10 (cap at 50).

---

## 5) Document identity (deterministic IDs)
IDs are derived from stable fields; no DB-generated IDs are user-visible.

- **Operation docId**:
  - `op:${sourceId}:${methodUpper}:${path}`
  - Example: `op:stripe:GET:/v1/customers/{id}`

- **Schema docId** (index *all* named component schemas by default):
  - `schema:${sourceId}:${componentName}`
  - Example: `schema:stripe:Customer`

---

## 6) SQLite schema (minimal but robust)

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  location TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  addedAt TEXT NOT NULL
);

CREATE TABLE source_status (
  sourceId TEXT PRIMARY KEY,
  lastFetchedAt TEXT,
  lastOkAt TEXT,
  lastError TEXT,
  docCountOperations INTEGER NOT NULL DEFAULT 0,
  docCountSchemas INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(sourceId) REFERENCES sources(id)
);

-- Optional (v2+): raw spec persistence for debugging/offline rebuilds.
-- Note: not implemented in the current v1 DB schema.
CREATE TABLE source_blobs (
  sourceId TEXT PRIMARY KEY,
  fetchedAt TEXT NOT NULL,
  contentType TEXT,
  bytes BLOB NOT NULL,
  FOREIGN KEY(sourceId) REFERENCES sources(id)
);

CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  sourceId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('operation','schema')),
  title TEXT NOT NULL,
  method TEXT,
  path TEXT,
  schemaName TEXT,
  json TEXT NOT NULL,
  body TEXT NOT NULL,
  FOREIGN KEY(sourceId) REFERENCES sources(id)
);

CREATE INDEX docs_source_kind ON docs(sourceId, kind);

CREATE VIRTUAL TABLE docs_fts USING fts5(
  title,
  body,
  content='docs',
  content_rowid='rowid'
);
```

Notes:
- `docs.json` must be **bounded** (avoid storing whole spec per doc).
- `source_blobs` (if implemented) stores the raw spec once (useful for debugging/future; planned v2+).

---

## 7) Normalization rules (bounded, predictable)

### Operation doc JSON (minimum useful shape)
For each `(method,path)`:
- `method`, `path`, `operationId?`
- `summary?`, `description?`, `tags[]?`
- `parameters[]` (name, in, required, schema summary; truncate examples)
- `requestBody` (content types + schema ref/name summary; bounded)
- `responses` (status → description + schema summary; bounded)

### Schema doc JSON
For each `components.schemas[name]`:
- `name`
- `type?`, `description?`
- shallow property view:
  - include up to `MAX_SCHEMA_PROPERTIES` (e.g. 200)
  - nested depth up to `MAX_SCHEMA_DEPTH` (e.g. 6)
- preserve `$ref` strings; avoid infinite expansion

### Body text (for FTS)
- Operations: method/path/operationId/summary/description/param names/schema names/response codes.
- Schemas: name/description/property names/types/refs.

---

## 8) Sync algorithm (safe + debuggable)
1. Detect root.
2. Acquire `.apidb/lock` (exclusive).
3. Load + validate config.
4. For each enabled source:
   - Fetch bytes (file or URL).
   - Enforce hard byte limit.
   - Parse JSON/YAML safely.
   - Normalize into docs.
   - (Optional) save spec bytes to `source_blobs` if parse succeeded.
5. Build `index.sqlite.tmp`:
   - create schema
   - insert `sources`, `source_status`, `docs` (and `source_blobs` if implemented)
   - populate `docs_fts`
   - all inside a transaction
6. **Strict mode**: if any enabled source fails → abort, delete tmp, keep last-good DB, exit non-zero.
7. **Partial mode**: skip failed sources, record per-source status, still produce atomic swap.
8. Atomic swap:
   - optionally rename `index.sqlite` → `index.sqlite.bak`
   - rename `index.sqlite.tmp` → `index.sqlite`
9. Release lock.

---

## 9) Search behavior (minimal ranking)
- Query `docs_fts` joined to `docs`.
- Use FTS `bm25`.
- Apply a simple kind boost: operations ahead of schemas for similar scores.
- Optional heuristic boosts:
  - exact `METHOD /path` match
  - exact `operationId` match

Human output fields:
- `id`, `kind`, `sourceId`
- operations: `METHOD /path — summary`
- schemas: `SchemaName — description`
- short snippet (bounded)

`--json` returns a structured array.

---

## 10) Show behavior (copy/paste friendly, offline)
`apidb show <docId>` renders from `docs.json`:
- operations: method/path, summary, params, request body summary, responses summary
- schemas: name, description, key properties (bounded), refs

No network access required.

---

## 11) Security/safety defaults (minimal)
- URL fetching: deny private/loopback IP ranges by default (avoid accidental localhost/private-net fetch). Optionally allow `--allow-private-net`.
- Path handling: relative paths resolved predictably (document this).

---

## 12) Hard limits (avoid OOM / hangs)
Recommended constants (configurable later):
- `MAX_SPEC_BYTES` (e.g. 50MB)
- `MAX_SCHEMA_DEPTH` (e.g. 6)
- `MAX_SCHEMA_PROPERTIES` (e.g. 200)
- `MAX_DOC_BODY_CHARS` (e.g. 50k per doc; truncate)
- `MAX_DOCS_PER_SOURCE` (optional guardrail)

On truncation: record a warning (either in `source_status.lastError` or add a `lastWarnings` column).

---

## 13) Minimal test matrix (must-have)
1. Sync success on small fixtures (JSON + YAML).
2. Strict failure preserves last-good DB.
3. Partial sync updates what it can and records failures.
4. Deterministic doc IDs across multiple syncs.
5. Cycle/depth guard tests (ref cycles don’t hang).
