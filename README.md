# apidb

Local-first OpenAPI sync + searchable offline index.

- Design doc (v1): `docs/plans/2026-02-10-apidb-openapi-local-indexer-design.md`
- Lightweight project context: `docs/PROJECT_CONTEXT.md`

> v1 focus: OpenAPI (JSON/YAML) only, lexical search (SQLite FTS5), strict/atomic sync that never clobbers the last-good index.

## Install

```bash
npm install
```

## Quickstart

Initialize a workspace:

```bash
node src/cli.js init
```

Add an OpenAPI source and sync it:

```bash
node src/cli.js add openapi <path-or-url> --id stripe
```

Search indexed docs:

```bash
node src/cli.js search customer --json
```

Show a specific doc:

```bash
node src/cli.js show op:stripe:GET:/v1/customers --json
```

## Exact lookups
If you already know the method/path or schema name, you can do exact retrieval:

```bash
node src/cli.js op GET /v1/customers --source stripe --json
node src/cli.js schema Customer --source stripe --json
```

(Planned v2 improvement: allow omitting `--source` when unambiguous.)

## Sync behavior

- Sync is strict by default: any enabled source failure fails the sync.
- Use `--allow-partial` with `sync` to continue on per-source failures.
- Sync uses an atomic swap of `.apidb/index.sqlite` and preserves a last-good backup as `.apidb/index.sqlite.bak`.

## Network safety

- URL sources deny localhost/private/loopback targets by default.
- To opt in to private network fetching, use `--allow-private-net` with `sync`.

## Testing

- Unit tests:

```bash
npm test
```

- End-to-end CLI smoke test:

```bash
./scripts/smoke-test.sh
# KEEP=1 ./scripts/smoke-test.sh
```

See `docs/SMOKE_TEST.md`.

## Docs

- `docs/INDEX.md` (start here)
- `docs/PROJECT_CONTEXT.md` (current invariants + CLI surface)
- `docs/plans/2026-02-10-apidb-roadmap.md` (v2/v3 roadmap)
