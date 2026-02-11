# Smoke test (apidb)

This repo includes a quick end-to-end smoke test script that exercises the **CLI + sync + index + search** path using the built-in Petstore fixtures.

## What it covers

- Workspace init (`apidb init`)
- Add OpenAPI sources from **local JSON** and **local YAML** fixtures (with sync)
- Search sanity (verifies both sources contribute docs)
- Exact lookups (v2 behavior)
  - `op GET /pets` without `--source` fails with ambiguity when multiple enabled sources match
  - after disabling one source + sync, `op GET /pets` and `schema Pet` without `--source` succeed when unambiguous
- Strict vs partial sync behavior
  - strict sync fails when an enabled source fails
  - last-good index is preserved (search still works after failure)
  - partial sync succeeds and `list` reports the broken source
- URL safety
  - private/loopback URL fetch is denied by default
  - demonstrates the escape hatch flags

## Run

From repo root:

```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh
```

To keep the temporary workspace for inspection:

```bash
KEEP=1 ./scripts/smoke-test.sh
```

## Notes

- The script creates a temporary workspace directory via `mktemp -d`.
- By default, it deletes the workspace on exit. Use `KEEP=1` to retain it.
- The script is intentionally dependency-free (no `jq`), using simple string checks.
- You may see Node warnings like `ExperimentalWarning: SQLite is an experimental feature` depending on your Node version.

## Sample run (2026-02-11)

```text
==> Init
[PASS] init
...
==> URL safety (private/loopback denied by default)
[PASS] localhost/private-net URL fetch blocked by default
[PASS] last-good index preserved after URL safety failure
...
==> Strict vs partial sync
[PASS] strict sync fails on broken source (as expected)
[PASS] last-good index preserved after strict sync failure
[PASS] partial sync succeeds
[PASS] list reports broken source

==> All smoke checks passed
```
