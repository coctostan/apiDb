---
name: apidb-roadmap
date: 2026-02-10
status: draft
---

# apidb roadmap (v2+)

This roadmap captures the **post-v1** work items and design intel from the brainstorming + peer review so the v1 design can stay focused.

## Guiding principles
- Keep the **retrieval contract** stable: deterministic doc IDs, bounded outputs, predictable JSON output.
- Prefer **durability/debuggability** over cleverness (indexes should not silently degrade).
- New transports (MCP, pi tools) should be thin adapters over the same core.

## Themes and milestones

### Theme A — Sync durability & debuggability (v2)
**Goal:** make sync faster, cheaper, and easier to debug without sacrificing correctness.

- **Best-effort sync mode** (opt-in):
  - `apidb sync --allow-partial` / `--skip-failed`
  - `apidb list` must clearly show which sources are stale/failed
  - avoid silent disappearance; always show source health
- **HTTP caching** when fetching specs:
  - ETag / If-None-Match
  - Last-Modified / If-Modified-Since
- **Raw spec persistence (optional):** store fetched spec bytes per source (DB table or cache dir)
  - enables offline rebuild, diffing, and better `show` fidelity
- **Locking hardening:** stale lock detection, better cross-platform locking

### Theme B — More sources (v2)
**Goal:** expand beyond OpenAPI without losing quality.

- **Postman collections ingestion**
  - operations + example requests/responses as searchable docs
- **npm allowlist ingestion**
  - index `node_modules/<pkg>/**/*.d.ts` (+ JSDoc) for version-pinned APIs
  - index package README/CHANGELOG where present
- **URL snapshots (explicit pages)**
  - user adds specific doc pages; no crawling by default

### Theme C — Auth & config layering (v2)
**Goal:** enable private sources without committing secrets.

- `auth` support for sources (headers / bearer / api key)
- Environment variable interpolation in config values
- Optional `.apidb/config.local.json` (gitignored) merged over `config.json`

### Theme D — Safety (v2)
**Goal:** reduce SSRF-style risk when fetching URLs.

- Deny private/loopback IP ranges by default for URL fetching
- `--allow-private-net` escape hatch
- Optional allowlist/denylist by host

### Theme E — Adapters & ecosystem (v2)
**Goal:** broaden client adoption without changing core logic.

- **MCP server wrapper** exposing:
  - `listSources`, `search`, `show/get`
  - reuse core library and JSON output schema
- Packaging/distribution improvements (npx/uvx style equivalents as appropriate)

### Theme F — Pruning & hygiene (v2)
**Goal:** keep workspaces tidy and predictable over time.

- `apidb prune`
  - delete temp DBs, old backups, caches (if introduced)
  - retention policy: max size, max age
- pi extension UX: “Prune workspace data” / “Rebuild index” / “Manage sources”

### Theme G — Semantic search (v3)
**Goal:** optional higher recall/ranking without making v1/v2 harder.

- Optional embeddings index (local-first)
- Hybrid ranking (FTS + vector)
- Maintain deterministic IDs and bounded `show` outputs
