---
project: apidb
status: v1-design
source: docs/plans/2026-02-10-apidb-openapi-local-indexer-design.md
updated: 2026-02-10
---

# Project context (lightweight)

## What this is
`apidb` is a **local-first API reference cache**:
- Register OpenAPI specs (URL or local file)
- Sync them locally
- Query them fast/offline via **SQLite FTS5**

Primary consumers:
- Developers in a shell (CLI)
- Coding agents (via bounded output + stable JSON)
- pi extension tools (thin wrapper over the same core)

## v1 scope (intentionally narrow)
In scope:
- OpenAPI 3.x JSON/YAML ingestion (file or URL)
- Full rebuild on sync
- Strict sync: **if any enabled source fails, keep the last-good index**
- Search + exact retrieval (operation + schema)
- Bounded, copy/paste-friendly output

Out of scope (v1):
- Auth/header injection for fetching specs
- HTML crawling / scraping
- Incremental indexing
- Embeddings / semantic search

## Repo / workspace model
`apidb` runs **per workspace** and stores derived artifacts in a hidden dir at the workspace root:

- `.apidb/config.json` (source of truth; CLI-managed but human-editable)
- `.apidb/index.sqlite` (derived)
- `.apidb/index.sqlite.tmp` (during sync)
- `.apidb/lock` (mutex)
- optional: `.apidb/index.sqlite.bak` (previous last-good)

Workspace root discovery (priority):
1. `--root`
2. nearest parent containing `.apidb/`
3. git toplevel (if in a git repo)
4. current directory

## Core entities
### Sources
Config contains multiple sources:
- `id` (stable, user-visible)
- `type` (v1: `openapi`)
- `location` (URL or file path)
- `enabled` (default true)

### Documents (what gets indexed)
Index granularity:
- **One doc per operation**: `method + path`
- **One doc per named schema**: `components.schemas.<name>`

Deterministic IDs:
- operation: `op:${sourceId}:${METHOD}:${path}` (METHOD uppercased)
- schema: `schema:${sourceId}:${schemaName}`

## CLI surface (v1)
- `apidb init`
- `apidb add openapi <url|path> --id <id> [--no-sync]`
- `apidb sync` (strict full rebuild + atomic swap)
- `apidb list` (sources + last sync summary)
- `apidb search <query> [--kind operation|schema|any] [--source <id>] [--limit N] [--json]`
- `apidb show <docId> [--json]`
- `apidb op <METHOD> <PATH> [--source <id>] [--json]` (exact)
- `apidb schema <NAME> [--source <id>] [--json]` (exact)
- `apidb root [--verbose]`

Defaults:
- `search --limit` defaults to 10 (cap at 50)
- human output is bounded (~<5KB) and summary-first
- `--json` is stable for other tools/agents

## Sync pipeline (v1)
High-level:
1. Resolve workspace root
2. Acquire `.apidb/lock`
3. Load + validate `.apidb/config.json`
4. For each enabled source: fetch/read → parse (JSON/YAML) → normalize → accumulate docs
5. Build `index.sqlite.tmp`
6. If any enabled source fails: delete tmp, exit non-zero, keep last-good DB
7. Atomic replace (`.tmp` → `index.sqlite`; optionally rotate `.bak`)
8. Release lock

## Index model (SQLite)
Conceptual tables:
- `sources`
- `source_status` (lastOkAt, lastError, doc counts)
- `docs` (id, sourceId, kind, title, method/path/schemaName, json, body)
- `docs_fts` (FTS5 over `title`, `body`)

Search ranking heuristics (simple):
- boost exact method/path tokens
- boost `operationId`
- prefer `kind=operation` over `kind=schema`

## Normalization rules (bounded/predictable)
Operations capture:
- method/path/operationId/summary/description/tags
- parameters (name/in/required/schema summary)
- requestBody (content types + schema summary)
- responses (status → description + schema summary)

Schemas capture:
- name/type/description
- shallow property view (bounded): names, types, `$ref`s, short descriptions

FTS body includes:
- ops: method/path/opId/summary/tags/params/response codes/schema names
- schemas: name/description/property names/types/refs

## Robustness guardrails
Hard limits to avoid hangs/OOM:
- `MAX_SPEC_BYTES`
- `MAX_SCHEMA_DEPTH`
- `MAX_SCHEMA_PROPERTIES`
- `MAX_DOC_BODY_CHARS`

On truncation: emit warnings (logs; later could persist).

## pi extension (v1)
Thin wrapper over the same core library:
- `api_add_openapi({ id, location })`
- `api_sync({})`
- `api_search({ query, kind?, sourceId?, limit?, json? })`
- `api_show({ id, json? })`
- `api_list_sources({})`

## Open questions / next decisions
- Exact JSON output schema for `--json` (fields + versioning)
- Concrete normalization details (how to summarize schemas; `$ref` handling)
- Dependency choices (OpenAPI parser, YAML parser, SQLite driver)
- Logging/verbosity flags

## Next step (smallest slice)
Implement the “happy path” for a single OpenAPI spec:
- `init` → create config
- `add` → write source + sync
- `sync` → build SQLite + FTS
- `search`/`show` → query + render bounded output
