# apidb docs index

## Status snapshot (2026-02-11)

- **v1 is implemented**: OpenAPI (JSON/YAML) → strict/atomic sync → SQLite FTS5 index → bounded search/show.
- **Exact lookup behavior (v1):** `op` and `schema` currently **require** `--source <id>`.
  - Planned (v2): allow omitting `--source` when unambiguous, with clear ambiguity errors.

## Where we are on the roadmap

See: `docs/plans/2026-02-10-apidb-roadmap.md`

Already shipped (v1):
- `sync` strict-by-default with last-good preservation + atomic swap (`index.sqlite` + `.bak`)
- `--allow-partial` best-effort sync
- private/loopback URL fetch denied by default + `--allow-private-net`

Likely next (v2 candidates):
- HTTP caching for URL sources (ETag / Last-Modified)
- Better `list` human output (source health/staleness)
- Optional raw spec persistence (`source_blobs`) for debugging

## Testing / verification

- Unit tests:
  - `npm test`
- End-to-end CLI smoke test:
  - `./scripts/smoke-test.sh`
  - `KEEP=1 ./scripts/smoke-test.sh` (keep temp workspace)

Details: `docs/SMOKE_TEST.md`

## Document map

Start-here docs:
- `README.md` — user-facing overview + quickstart
- `docs/PROJECT_CONTEXT.md` — current invariants + v1 CLI surface
- `docs/SMOKE_TEST.md` — repeatable smoke test
- `docs/NEXT_STEPS.md` — sequencing / handoff summary

Design / plans (some are now historical):
- `docs/plans/2026-02-10-apidb-openapi-local-indexer-design.md` — v1 design (includes some planned v2 UX; marked in-file)
- `docs/plans/2026-02-10-apidb-minimal-robust-spec.md` — v1 spec (notes v2+ items like `source_blobs`)
- `docs/plans/2026-02-10-apidb-openapi-local-indexer-implementation.md` — **executed plan** (kept as reference)
- `docs/plans/2026-02-10-apidb-roadmap.md` — v2/v3 roadmap

Context / analysis:
- `docs/plans/2026-02-10-apidb-competitor-analysis.md`
- `docs/plans/2026-02-10-apidb-project-merit-analysis.md`
- `docs/plans/2026-02-10-apidb-openapi-local-indexer-design-feedback.md`
