#!/usr/bin/env bash
set -euo pipefail

# apidb smoke test
# - creates a temporary workspace
# - exercises init/add/sync/search/show/op/schema
# - verifies strict vs partial sync behavior
# - verifies private/loopback URL fetch is denied by default
#
# Usage:
#   ./scripts/smoke-test.sh
#   KEEP=1 ./scripts/smoke-test.sh   # keep temp workspace for inspection

say() { printf "\n==> %s\n" "$*"; }
fail() { printf "\n[FAIL] %s\n" "$*" >&2; exit 1; }
pass() { printf "[PASS] %s\n" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ROOT="$(mktemp -d)"
if [[ "${KEEP:-}" != "1" ]]; then
  trap 'rm -rf "$ROOT"' EXIT
else
  say "KEEP=1 set; not deleting workspace: $ROOT"
fi

say "Workspace root: $ROOT"

say "Init"
node src/cli.js init --root "$ROOT" >/dev/null
pass "init"

say "Add JSON fixture + sync"
node src/cli.js add openapi "$REPO_ROOT/test/fixtures/petstore.json" --id petjson --root "$ROOT" >/dev/null
pass "add petjson"

say "Add YAML fixture + sync"
node src/cli.js add openapi "$REPO_ROOT/test/fixtures/petstore.yaml" --id petyaml --root "$ROOT" >/dev/null
pass "add petyaml"

say "Search sanity"
SEARCH_OUT="$(node src/cli.js search pets --root "$ROOT" --json)"
[[ "$SEARCH_OUT" == *"op:petjson:GET:/pets"* ]] || fail "search missing op:petjson:GET:/pets"
[[ "$SEARCH_OUT" == *"op:petyaml:GET:/pets"* ]] || fail "search missing op:petyaml:GET:/pets"
pass "search includes both sources"

say "Exact op lookup (requires --source in v1)"
OP_OUT="$(node src/cli.js op GET /pets --source petjson --root "$ROOT" --json)"
[[ "$OP_OUT" == *"op:petjson:GET:/pets"* ]] || fail "op lookup missing expected docId"
pass "op exact lookup"

say "Exact schema lookup (requires --source in v1)"
SCHEMA_OUT="$(node src/cli.js schema Pet --source petjson --root "$ROOT" --json)"
[[ "$SCHEMA_OUT" == *"schema:petjson:Pet"* ]] || fail "schema lookup missing expected docId"
pass "schema exact lookup"

say "URL safety (private/loopback denied by default)"
node src/cli.js add openapi "http://127.0.0.1:1234/openapi.json" --id localurl --no-sync --root "$ROOT" >/dev/null

set +e
URL_OUT="$(node src/cli.js sync --root "$ROOT" 2>&1)"
URL_CODE=$?
set -e
[[ $URL_CODE -ne 0 ]] || fail "sync unexpectedly succeeded with localhost URL source"

# We don't require exact wording, but it should clearly indicate a safety block.
# Also ensure the failure is attributed to the localurl source.
if [[ ( "$URL_OUT" == *"private"* || "$URL_OUT" == *"loopback"* || "$URL_OUT" == *"127.0.0.1"* ) && "$URL_OUT" == *"localurl"* ]]; then
  pass "localhost/private-net URL fetch blocked by default"
else
  fail "sync failed for localhost URL source, but output did not look like a safety block for localurl; output was: $URL_OUT"
fi

# Ensure last-good index is still usable after failed sync.
POST_URL_FAIL_SEARCH="$(node src/cli.js search pets --root "$ROOT" --json)"
[[ "$POST_URL_FAIL_SEARCH" == *"op:petjson:GET:/pets"* ]] || fail "post-URL-failure search missing expected doc; last-good index may have been clobbered"
pass "last-good index preserved after URL safety failure"

say "(Optional) escape hatch demo: allow private-net + allow-partial"
set +e
node src/cli.js sync --allow-private-net --allow-partial --root "$ROOT" >/dev/null 2>&1
set -e
pass "escape hatch command executed (it may still fail to fetch if nothing is listening)"

# Disable the localurl source so later strict-sync checks are testing the intended failure mode.
node -e 'const fs=require("fs"); const p=process.argv[1]; const cfg=JSON.parse(fs.readFileSync(p,"utf8")); cfg.sources=cfg.sources.map(s=>s.id==="localurl"?{...s,enabled:false}:s); fs.writeFileSync(p, JSON.stringify(cfg,null,2));' "$ROOT/.apidb/config.json"
pass "disabled localurl source for subsequent tests"

say "Strict vs partial sync"
printf '{' >"$ROOT/broken.json"
node src/cli.js add openapi "$ROOT/broken.json" --id broken --no-sync --root "$ROOT" >/dev/null

# strict sync should fail
set +e
STRICT_OUT="$(node src/cli.js sync --root "$ROOT" 2>&1)"
STRICT_CODE=$?
set -e
[[ $STRICT_CODE -ne 0 ]] || fail "strict sync unexpectedly succeeded"
pass "strict sync fails on broken source (as expected)"

# last-good index should still be usable
POST_FAIL_SEARCH="$(node src/cli.js search pets --root "$ROOT" --json)"
[[ "$POST_FAIL_SEARCH" == *"op:petjson:GET:/pets"* ]] || fail "post-failure search missing expected doc; last-good index may have been clobbered"
pass "last-good index preserved after strict sync failure"

# partial sync should succeed
node src/cli.js sync --allow-partial --root "$ROOT" >/dev/null
pass "partial sync succeeds"

LIST_OUT="$(node src/cli.js list --root "$ROOT" --json)"
[[ "$LIST_OUT" == *"\"id\":\"broken\""* ]] || [[ "$LIST_OUT" == *"broken"* ]] || fail "list output did not mention broken source"
pass "list reports broken source"

say "All smoke checks passed"
