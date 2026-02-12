---
name: apidb-openapi-local-indexer-design
date: 2026-02-10
status: draft
owners:
  - you
---

# apidb: local OpenAPI sync + searchable index (pi extension + CLI)

## 1. Summary
`apidb` is a **local-first** API reference cache that lets a developer register OpenAPI specs (URLs or local files), **sync** them locally, and **search** them quickly via a SQLite FTS index.

v1 scope is intentionally narrow:
- **OpenAPI-only** sources (JSON/YAML).
- **Lexical search only** (SQLite FTS5); no embeddings/semantic search.
- **Full index rebuild** on sync.
- **Strict sync + atomic swap**: if any enabled source fails, do not overwrite the last-good index.

Packaging is layered:
- A small **core library** (sync/search/get)
- A **CLI** (`apidb ...`) for universal use (including other CLI agents)
- A **pi extension** that wraps the core and exposes a curated toolset
- A possible **MCP wrapper** later (v2+) as a transport adapter (not a new indexing system)

## 2. Problem
Developers rely on multiple public APIs (e.g., Stripe) and spend time tab-switching and searching web docs. LLMs also hallucinate or mix versions. We want a local index that:
- is fast
- is deterministic for a chosen set of APIs
- provides a stable query surface for coding agents

## 3. Goals / success criteria
### 3.1 Goals
- Add and sync multiple OpenAPI specs (URL or file).
- Search across operations + schemas.
- Provide a `show` command that is copy/paste friendly into prompts and does not require network.
- Keep outputs bounded (agent-friendly) by default.

### 3.2 Success criteria
- `apidb add openapi <stripe-openapi-url>` results in searchable operations within one command.
- Typical searches return <20 results and are readable (<5KB output).
- Sync on a small set of specs completes within seconds to a minute.
- Failed sync never destroys the last good index.

## 4. Non-goals (v1)
- Authentication/header injection for fetching specs.
- Postman ingestion.
- Indexing `node_modules` types/READMEs.
- HTML crawling/scraping or JS-rendered doc sites.
- Incremental indexing.
- Semantic embeddings/vector databases.

## 5. Key product decisions
1. **Workspace-root discovery** (simple, monorepo-friendly):
   - `--root` if provided
   - else nearest parent containing `.apidb/`
   - else git toplevel if inside a git repo
   - else current directory

2. **Config + derived artifacts**:
   - `.apidb/config.json` is the source of truth (human-editable and CLI-managed).
   - `.apidb/index.sqlite` is derived and should be gitignored.

3. **Sync strategy**:
   - Rebuild the entire index each sync.
   - Strict: if any source fails, sync fails and the last-good index remains.
   - Atomic replace via `index.sqlite.tmp` → rename.
   - Use a workspace mutex (lock file) to prevent concurrent syncs.

4. **Index granularity**:
   - One doc per OpenAPI **operation** (`method + path`).
   - One doc per **named component schema** (`components.schemas.*`) for predictable coverage.

5. **Deterministic document IDs**:
   - Operation: `op:${sourceId}:${METHOD}:${path}` (METHOD uppercased)
   - Schema: `schema:${sourceId}:${schemaName}`

6. **Two retrieval paths**:
   - Fuzzy: `search` (FTS)
   - Exact: `op`/`schema` lookups (preferred when the agent already knows a method/path or schema name)

6. **Ranking**:
   - Prefer `kind=operation` over `kind=schema` for the same query.

## 6. User experience
### 6.1 Workspace layout (v1)
At workspace root:
- `.apidb/config.json` (source of truth)
- `.apidb/index.sqlite` (derived)
- `.apidb/index.sqlite.tmp` (during sync)
- `.apidb/lock` (sync mutex)

Optional safety file (nice-to-have): `.apidb/index.sqlite.bak` (previous last-good).

### 6.2 CLI commands (v1)
- `apidb init` — create `.apidb/config.json` in workspace root.
- `apidb add openapi <url|path> --id <id> [--no-sync]` — add source and (by default) **auto-sync**.
- `apidb sync` — strict full rebuild.
- `apidb list` — sources + last sync summary (doc counts + last error).
- `apidb search <query> [--kind operation|schema|any] [--source <id>] [--limit N] [--json]`
- `apidb show <docId> [--json]`
- `apidb op <METHOD> <PATH> [--source <id>] [--json]` — exact operation lookup (preferred over fuzzy search when possible)
- `apidb schema <NAME> [--source <id>] [--json]` — exact schema lookup
- `apidb root [--verbose]` — print detected workspace root + reason.

Note: the current v1 implementation requires `--source` for `op`/`schema`. Planned (v2): allow omitting `--source` when unambiguous.

Defaults:
- `search --limit` defaults to 10 (cap at 50).
- human output is bounded and summary-first.
- `--json` produces a stable machine-readable schema for other tools/agents.

### 6.3 pi extension tools (v1)
Expose a small set of tools (names TBD):
- `api_add_openapi({ id, location })` → adds source + sync
- `api_sync({})` → strict rebuild
- `api_search({ query, kind?, sourceId?, limit?, json? })` → bounded search results
- `api_show({ id, json? })` → show one operation/schema
- `api_list_sources({})` → source status summary

The pi extension should call the same core library used by the CLI.

## 7. Config format (v1)
`.apidb/config.json` (sketch):

```json
{
  "version": 1,
  "sources": [
    {
      "id": "stripe",
      "type": "openapi",
      "location": "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
      "enabled": true
    }
  ]
}
```

Rules:
- `id` is user-visible and must be stable.
- `enabled` defaults to true.

## 8. Sync pipeline (v1)
For each sync:
1. Resolve workspace root.
2. Acquire `.apidb/lock`.
3. Load + validate config.
4. For each enabled source:
   - load bytes from local file or fetch URL (no auth in v1)
   - parse JSON/YAML into OpenAPI 3.x object
   - validate lightly; log warnings
5. Normalize into `docs[]`:
   - **operations**: method/path/summary/description/tags/params; request/response schema summaries (bounded)
   - **schemas**: one doc per `components.schemas[name]` with shallow flattening (bounded)
6. Build `index.sqlite.tmp`:
   - write `sources`, `source_status`, `docs`, `docs_fts`
7. If any enabled source fails at fetch/parse/normalize, abort:
   - delete tmp
   - keep last-good DB
   - exit non-zero
8. Atomic replace:
   - optionally rename `index.sqlite` → `index.sqlite.bak`
   - rename temp DB → `index.sqlite`
9. Release lock.

## 9. SQLite schema (conceptual)
- `sources(id TEXT PRIMARY KEY, type TEXT, location TEXT, enabled INT, addedAt TEXT)`
- `source_status(sourceId TEXT PRIMARY KEY, lastFetchedAt TEXT, lastOkAt TEXT, lastError TEXT, docCountOperations INT, docCountSchemas INT)`
- `docs(id TEXT PRIMARY KEY, sourceId TEXT, kind TEXT, title TEXT, method TEXT, path TEXT, schemaName TEXT, json TEXT, body TEXT)`
- `docs_fts` (FTS5): `title`, `body` (linked to docs)

Indexes:
- `docs(sourceId, kind)`

## 10. Normalization rules (bounded, predictable)
### 10.1 Operation docs
Minimum useful JSON shape per `(method,path)`:
- `method`, `path`, `operationId?`
- `summary?`, `description?`, `tags[]?`
- `parameters[]` (name, in, required, schema/type summary)
- `requestBody` (content types + schema summary)
- `responses` (status → description + schema summary)

### 10.2 Schema docs
Per `components.schemas[name]`:
- `name`
- `type?`, `description?`
- shallow property view (bounded): property names, types, descriptions, `$ref` strings

### 10.3 FTS body text
- Operations: method/path/operationId/summary/description/tags/param names/response codes/schema names.
- Schemas: name/description/property names/types/refs.

## 11. Robustness guardrails (v1)
Even in v1, OpenAPI in the wild is gnarly; we should include hard limits to avoid hangs/OOM:
- `MAX_SPEC_BYTES`
- `MAX_SCHEMA_DEPTH`
- `MAX_SCHEMA_PROPERTIES`
- `MAX_DOC_BODY_CHARS`

On truncation: emit warnings (initially via logs; optionally persisted later).

## 12. Search + show behavior
`apidb search`:
- query `docs_fts` and join to `docs`
- return compact results: `id`, `kind`, `title`, `sourceId`, short snippet

Ranking heuristics (v1, simple):
- boost exact method/path matches (e.g., query contains `GET /v1/customers`)
- boost `operationId` matches
- boost `kind=operation` over `kind=schema`

### 12.1 Exact retrieval (`op` / `schema`)
Exact retrieval is preferred when the caller already knows the identifier.

> **Status (v1 implementation):** the current CLI requires `--source <id>` for `op` and `schema`.
> The “omit `--source` + ambiguity resolution” behavior below is planned (v2).

- `apidb op <METHOD> <PATH>` resolves the deterministic document ID:
  - `op:${sourceId}:${METHOD}:${path}`
- `apidb schema <NAME>` resolves:
  - `schema:${sourceId}:${schemaName}`

Resolution rules:
1. If `--source <id>` is provided, resolve within that source or error if not found.
2. If `--source` is not provided:
   - If exactly one match exists across enabled sources, return it.
   - If multiple matches exist (ambiguous), return an error requiring `--source`, and print the candidate `sourceId`s.

`--json` output should include the resolved `docId`.

`apidb show`:
- renders from `docs.json` (offline; no network)
- operations: method/path, summary, params, request body summary, responses summary
- schemas: name, description, key properties (bounded)

## 13. Error handling
- Strict sync: any failure → non-zero exit; do not overwrite last-good index.
- Keep error messages short by default; add `--verbose` later if needed.

## 14. Testing strategy
- Unit tests:
  - OpenAPI parsing (JSON/YAML)
  - operation normalization
  - schema normalization + bounding/truncation
  - deterministic doc IDs across syncs
  - FTS search returns expected hits
- Fixture tests:
  - small valid spec
  - intentionally broken spec (assert strict failure + DB preserved)

## 15. Roadmap (v2+)
The v2+ roadmap is tracked separately so this v1 design stays focused:

- See: `docs/plans/2026-02-10-apidb-roadmap.md`
