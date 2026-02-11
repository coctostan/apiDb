# apidb v2 Source Resolution + HTTP Caching + Blobs + CI Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Improve apidb v1 by (1) allowing `op`/`schema` to omit `--source` when unambiguous, (2) adding HTTP conditional caching for URL sources, (3) persisting raw spec bytes (“blobs”) so 304 responses can be indexed offline, and (4) adding minimal GitHub Actions CI.

**Architecture:** Add a persistent workspace state DB (`.apidb/state.sqlite`) + blob store (`.apidb/blobs/`) that survives `index.sqlite` rebuilds. Implement exact lookup resolution by querying `index.sqlite` and filtering by enabled sources from config. Extend URL fetching to send `If-None-Match`/`If-Modified-Since`, handle `304` by loading last blob, and update state.

**Tech Stack:** Node.js (built-in `node:test`, `node:sqlite`, `fetch`), SQLite, GitHub Actions.

---

## Preconditions / working conventions
- All commands below run from repo root: `/home/pi/apiDb`.
- Tests use Node’s built-in runner: `npm test` (runs `node --test`).
- Commit frequently; each task ends with a commit.

## Branch setup (do this once)

### Task 0: Create a fresh feature branch

**Files:**
- Modify: none

**Step 1: Create branch**

Run:
```bash
git checkout -b feat/v2-source-resolution-http-cache-blobs-ci
```
Expected: switched to new branch.

**Step 2: Commit nothing**
No commit in this task.

---

# A) Exact lookup source resolution (v2)

## Task 1: Add failing unit tests for exact op/schema resolution (0/1/many)

**Files:**
- Create: `test/exactResolution.test.js`
- Modify: none

**Step 1: Write the failing test**

Create `test/exactResolution.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { resolveOperationDocId, resolveSchemaDocId } from '../src/core/exact.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-exact-'));
  await initConfig({ root });
  return root;
}

const petJson = path.join(process.cwd(), 'test/fixtures/petstore.json');
const petYaml = path.join(process.cwd(), 'test/fixtures/petstore.yaml');

test('resolveOperationDocId: without --source succeeds when exactly one enabled source matches', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: false }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  const id = await resolveOperationDocId({ root, method: 'get', path: '/pets', sourceId: null });
  assert.equal(id, 'op:petjson:GET:/pets');
});

test('resolveOperationDocId: without --source errors when ambiguous across enabled sources', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: true }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  await assert.rejects(
    () => resolveOperationDocId({ root, method: 'GET', path: '/pets', sourceId: null }),
    /Ambiguous operation/i
  );
});

test('resolveSchemaDocId: without --source succeeds when exactly one enabled source matches', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: false }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  const id = await resolveSchemaDocId({ root, schemaName: 'Pet', sourceId: null });
  assert.equal(id, 'schema:petjson:Pet');
});

test('resolveSchemaDocId: without --source errors when ambiguous across enabled sources', async () => {
  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'petjson', type: 'openapi', location: petJson, enabled: true },
        { id: 'petyaml', type: 'openapi', location: petYaml, enabled: true }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });

  await assert.rejects(
    () => resolveSchemaDocId({ root, schemaName: 'Pet', sourceId: null }),
    /Ambiguous schema/i
  );
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
node --test test/exactResolution.test.js
```
Expected: FAIL because `resolveOperationDocId`/`resolveSchemaDocId` are currently synchronous and require `sourceId`.

**Step 3: Write minimal implementation**
Defer to Task 2.

**Step 4: Run test to verify it passes**
Defer to Task 2.

**Step 5: Commit**

```bash
git add test/exactResolution.test.js
git commit -m "test: add failing v2 exact resolution tests"
```

---

## Task 2: Implement v2 exact resolution in `src/core/exact.js`

**Files:**
- Modify: `src/core/exact.js`
- Modify: `src/cli.js`
- Test: `test/exactResolution.test.js`

**Step 1: Write the failing test**
Already written (Task 1).

**Step 2: Run test to verify it fails**

Run:
```bash
node --test test/exactResolution.test.js
```
Expected: FAIL.

**Step 3: Write minimal implementation**

Replace `src/core/exact.js` with an async resolver that:
- if `sourceId` is provided → return deterministic doc id (as v1)
- if omitted → load enabled sources from config and query `docs` table for matches within enabled sources
- return the unique doc id or throw an actionable ambiguity error

Implementation sketch:
```js
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from './config.js';
import { opDocId, schemaDocId } from './docIds.js';

function enabledSourceIds(cfg) {
  return (cfg.sources ?? []).filter((s) => s.enabled).map((s) => s.id);
}

function placeholders(n) {
  return Array.from({ length: n }, () => '?').join(',');
}

export async function resolveOperationDocId({ root, method, path: p, sourceId }) {
  if (sourceId) return opDocId({ sourceId, method, path: p });

  const cfg = await loadConfig({ root });
  const enabled = enabledSourceIds(cfg);
  if (enabled.length === 0) throw new Error('No enabled sources');

  const db = new DatabaseSync(path.join(root, '.apidb', 'index.sqlite'), { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, sourceId FROM docs
         WHERE kind='operation'
           AND method=?
           AND path=?
           AND sourceId IN (${placeholders(enabled.length)})
         ORDER BY sourceId ASC`
      )
      .all(String(method).toUpperCase(), p, ...enabled);

    if (rows.length === 1) return rows[0].id;
    if (rows.length === 0) throw new Error(`Operation not found: ${String(method).toUpperCase()} ${p}`);

    const candidates = rows.map((r) => r.sourceId).join(', ');
    throw new Error(
      `Ambiguous operation ${String(method).toUpperCase()} ${p} (found in ${rows.length} sources): ${candidates}. ` +
        `Try: apidb op ${String(method).toUpperCase()} ${p} --source <id>`
    );
  } finally {
    db.close();
  }
}

export async function resolveSchemaDocId({ root, schemaName, sourceId }) {
  if (sourceId) return schemaDocId({ sourceId, schemaName });

  const cfg = await loadConfig({ root });
  const enabled = enabledSourceIds(cfg);
  if (enabled.length === 0) throw new Error('No enabled sources');

  const db = new DatabaseSync(path.join(root, '.apidb', 'index.sqlite'), { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, sourceId FROM docs
         WHERE kind='schema'
           AND schemaName=?
           AND sourceId IN (${placeholders(enabled.length)})
         ORDER BY sourceId ASC`
      )
      .all(schemaName, ...enabled);

    if (rows.length === 1) return rows[0].id;
    if (rows.length === 0) throw new Error(`Schema not found: ${schemaName}`);

    const candidates = rows.map((r) => r.sourceId).join(', ');
    throw new Error(
      `Ambiguous schema ${schemaName} (found in ${rows.length} sources): ${candidates}. ` +
        `Try: apidb schema ${schemaName} --source <id>`
    );
  } finally {
    db.close();
  }
}
```

Then update `src/cli.js`:
- remove `.requiredOption('--source <id>')` from `op` and `schema`
- call the async resolver with `{ root, ..., sourceId: opts.source ?? null }`

Example CLI patch for `op`:
```js
  program
    .command('op <method> <path>')
    .description('show operation doc by exact method/path/source')
    .option('--source <id>', 'source id')
    .option('--json', 'machine-readable JSON')
    .action(async (method, p, opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      const id = await resolveOperationDocId({ root, method, path: p, sourceId: opts.source ?? null });
      const doc = await getDocById({ root, id });
      ...
    })
```

Do the same for `schema`.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test test/exactResolution.test.js
```
Expected: PASS.

Also run full suite:
```bash
npm test
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/exact.js src/cli.js
git commit -m "feat(v2): resolve op/schema without --source when unambiguous"
```

---

## Task 3: Update the smoke test script for v2 exact lookups

**Files:**
- Modify: `scripts/smoke-test.sh`
- Modify: `docs/SMOKE_TEST.md`

**Step 1: Write the failing test**
Update smoke test assertions to match new UX:
- When two sources are enabled, calling `op GET /pets` **without** `--source` must fail with an ambiguity message.
- When only one of the two is enabled, `op`/`schema` without `--source` must succeed.

Suggested patch inside `scripts/smoke-test.sh` (replace the “Exact op lookup” / “Exact schema lookup” blocks):
```bash
say "Exact op lookup: ambiguous without --source when multiple enabled"
set +e
AMB_OP_OUT="$(node src/cli.js op GET /pets --root "$ROOT" --json 2>&1)"
AMB_OP_CODE=$?
set -e
[[ $AMB_OP_CODE -ne 0 ]] || fail "op without --source unexpectedly succeeded"
[[ "$AMB_OP_OUT" == *"Ambiguous operation"* ]] || fail "expected ambiguous op error; got: $AMB_OP_OUT"
pass "op ambiguity error"

say "Exact lookup without --source succeeds when unambiguous"
# Disable one source so resolution is unambiguous
node -e 'const fs=require("fs"); const p=process.argv[1]; const cfg=JSON.parse(fs.readFileSync(p,"utf8")); cfg.sources=cfg.sources.map(s=>s.id==="petyaml"?{...s,enabled:false}:s); fs.writeFileSync(p, JSON.stringify(cfg,null,2));' "$ROOT/.apidb/config.json"
node src/cli.js sync --root "$ROOT" >/dev/null

OP_OUT="$(node src/cli.js op GET /pets --root "$ROOT" --json)"
[[ "$OP_OUT" == *"op:petjson:GET:/pets"* ]] || fail "op lookup missing expected docId"
pass "op exact lookup without --source"

SCHEMA_OUT="$(node src/cli.js schema Pet --root "$ROOT" --json)"
[[ "$SCHEMA_OUT" == *"schema:petjson:Pet"* ]] || fail "schema lookup missing expected docId"
pass "schema exact lookup without --source"
```

**Step 2: Run test to verify it fails**

Run:
```bash
./scripts/smoke-test.sh
```
Expected: FAIL until Tasks 1–2 are complete (or if you run it before committing Task 2).

**Step 3: Write minimal implementation**
- Apply the script changes above.
- Update `docs/SMOKE_TEST.md` bullets to say v2 behavior (omit source when unambiguous; ambiguity errors when multiple sources).

**Step 4: Run test to verify it passes**

Run:
```bash
./scripts/smoke-test.sh
```
Expected: `[PASS] ...` and final “All smoke checks passed”.

**Step 5: Commit**

```bash
git add scripts/smoke-test.sh docs/SMOKE_TEST.md
git commit -m "test: update smoke test for v2 exact resolution behavior"
```

---

# B+C) HTTP caching + persisted spec blobs

## Task 4: Add failing tests for HTTP cache (200 then 304) reusing persisted bytes

**Files:**
- Create: `test/httpCache.test.js`
- Modify: none

**Step 1: Write the failing test**

Create `test/httpCache.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { searchDocs } from '../src/core/search.js';

const specBody = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'CacheSpec', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { operationId: 'listPets', summary: 'List pets', responses: { '200': { description: 'ok' } } }
    }
  }
});

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-httpcache-'));
  await initConfig({ root });
  return root;
}

test('syncWorkspace: URL source uses ETag cache; 2nd sync can index from 304 using persisted blob', async () => {
  let first = true;
  let sawIfNoneMatchOnSecond = false;

  const server = http.createServer((req, res) => {
    if (req.url !== '/spec') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    const inm = req.headers['if-none-match'];
    if (!first && inm === '"v1"') {
      sawIfNoneMatchOnSecond = true;
      res.statusCode = 304;
      res.end();
      return;
    }

    first = false;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('etag', '"v1"');
    res.end(specBody);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const root = await mkRoot();
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [{ id: 'cache', type: 'openapi', location: `http://127.0.0.1:${port}/spec`, enabled: true }]
    }
  });

  try {
    await syncWorkspace({ root, strict: true, allowPrivateNet: true, maxSpecBytes: 1024 * 1024 });

    const res1 = searchDocs({ root, query: 'listPets', limit: 10 });
    assert.ok(res1.results.some((r) => r.id === 'op:cache:GET:/pets'));

    await syncWorkspace({ root, strict: true, allowPrivateNet: true, maxSpecBytes: 1024 * 1024 });

    const res2 = searchDocs({ root, query: 'listPets', limit: 10 });
    assert.ok(res2.results.some((r) => r.id === 'op:cache:GET:/pets'));

    assert.equal(sawIfNoneMatchOnSecond, true);

    // Also assert persistent state artifacts exist.
    await fs.stat(path.join(root, '.apidb', 'state.sqlite'));
    await fs.stat(path.join(root, '.apidb', 'blobs'));
  } finally {
    server.close();
  }
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
node --test test/httpCache.test.js
```
Expected: FAIL because `.apidb/state.sqlite` / `.apidb/blobs` don’t exist and URL fetching doesn’t send validators nor handle 304.

**Step 3: Write minimal implementation**
Defer to Tasks 5–7.

**Step 4: Run test to verify it passes**
Defer to Task 7.

**Step 5: Commit**

```bash
git add test/httpCache.test.js
git commit -m "test: add failing http cache + 304 reuse test"
```

---

## Task 5: Create persistent workspace state DB (`.apidb/state.sqlite`)

**Files:**
- Create: `src/db/stateSchema.js`
- Create: `src/core/stateDb.js`
- Test: `test/httpCache.test.js`

**Step 1: Write the failing test**
Already written (Task 4).

**Step 2: Run test to verify it fails**

Run:
```bash
node --test test/httpCache.test.js
```
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `src/db/stateSchema.js`:
```js
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
      sha256 TEXT PRIMARY KEY,
      sourceId TEXT NOT NULL,
      fetchedAt TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('url','file')),
      location TEXT NOT NULL,
      effectiveUrl TEXT,
      contentType TEXT,
      bytesLength INTEGER NOT NULL,
      blobPath TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS source_blobs_by_source_time ON source_blobs(sourceId, fetchedAt DESC);
  `);
}
```

Create `src/core/stateDb.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initStateDb } from '../db/stateSchema.js';

export async function openStateDb({ root }) {
  const apidbDir = path.join(root, '.apidb');
  await fs.mkdir(apidbDir, { recursive: true });
  const dbPath = path.join(apidbDir, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  initStateDb(db);
  return db;
}
```

Don’t wire into sync yet; just add scaffolding.

**Step 4: Run test to verify it passes**
Not expected to pass yet.

Run:
```bash
node --test test/httpCache.test.js
```
Expected: still FAIL.

**Step 5: Commit**

```bash
git add src/db/stateSchema.js src/core/stateDb.js
git commit -m "feat(v2): add persistent state sqlite schema + opener"
```

---

## Task 6: Implement blob persistence utilities (sha256 + file storage + "latest per source" retention)

**Files:**
- Create: `src/core/blobStore.js`
- Modify: `src/core/stateDb.js`
- Test: `test/httpCache.test.js`

**Step 1: Write the failing test**
Still `test/httpCache.test.js`.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test test/httpCache.test.js
```
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `src/core/blobStore.js`:
```js
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function ensureBlobDir({ root }) {
  const dir = path.join(root, '.apidb', 'blobs');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeBlobIfMissing({ root, sha256, bytes }) {
  const dir = await ensureBlobDir({ root });
  const finalPath = path.join(dir, `${sha256}.bin`);

  try {
    await fs.stat(finalPath);
    return finalPath;
  } catch {
    // continue
  }

  const tmpPath = `${finalPath}.tmp.${process.pid}`;
  await fs.writeFile(tmpPath, bytes);
  await fs.rename(tmpPath, finalPath);
  return finalPath;
}
```

Extend `src/core/stateDb.js` with small helpers (in same file or new one):
- `upsertHttpCacheRow(db, {...})`
- `insertBlobRow(db, {...})`
- `getLatestBlobForSource(db, sourceId)`
- `pruneBlobsKeepLatestPerSource(db, { root, sourceId })`:
  - keep newest row for source
  - delete older `source_blobs` rows for that `sourceId`
  - delete the corresponding files from `.apidb/blobs/` (best-effort)

(Implement pruning in Task 7 when wiring into sync.)

**Step 4: Run test to verify it passes**
Not expected to pass yet.

**Step 5: Commit**

```bash
git add src/core/blobStore.js src/core/stateDb.js
git commit -m "feat(v2): add blob store utilities (sha256 + on-disk blobs)"
```

---

## Task 7: Add HTTP conditional fetching + 304 reuse into `fetchSourceBytes` and wire state/blobs into `syncWorkspace`

**Files:**
- Modify: `src/core/fetchSource.js`
- Modify: `src/core/sync.js`
- Modify: `src/core/stateDb.js`
- Modify: `src/core/blobStore.js`
- Test: `test/httpCache.test.js`

**Step 1: Write the failing test**
Already written (Task 4).

**Step 2: Run test to verify it fails**

Run:
```bash
node --test test/httpCache.test.js
```
Expected: FAIL.

**Step 3: Write minimal implementation**

### 7.1 Extend fetchSourceBytes to support conditional requests

Modify `src/core/fetchSource.js`:
- Add optional params: `sourceId`, `root`, and `stateDb` (or `root` only and open state DB inside sync)
- For URL sources:
  - lookup `etag`/`lastModified` for `sourceId` in `state.sqlite`
  - send `If-None-Match` / `If-Modified-Since`
  - handle response:
    - 200: read bytes, persist blob row + update http cache row
    - 304: load latest blob bytes and return them

Suggested return shape (keep existing callers simple):
```js
return { bytes, kind: 'url', contentType, cacheStatus: 200|304, effectiveUrl };
```

### 7.2 Wire state DB + blob store into sync

In `src/core/sync.js` inside the workspace lock:
- open state DB once: `const stateDb = await openStateDb({ root });`
- for each enabled source call `fetchSourceBytes({ root, sourceId: s.id, location: s.location, ... , stateDb })`
- when the whole sync finishes (success or failure), close `stateDb` in a `finally` block.

### 7.3 Minimal pruning
After successfully persisting a new blob for a source, prune old blobs for that source (keep latest only).

**Step 4: Run test to verify it passes**

Run:
```bash
node --test test/httpCache.test.js
```
Expected: PASS.

Then run full suite:
```bash
npm test
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/fetchSource.js src/core/sync.js src/core/stateDb.js src/core/blobStore.js
git commit -m "feat(v2): add http caching + blob persistence + 304 reuse"
```

---

# D) Minimal CI

## Task 8: Add GitHub Actions workflow running unit tests + smoke test

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Write the failing test**
N/A (CI-only). The “failure” is that CI does not exist.

**Step 2: Run test to verify it fails**
N/A locally.

**Step 3: Write minimal implementation**

Create `.github/workflows/ci.yml`:
```yaml
name: ci

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'

      - name: Install
        run: npm ci

      - name: Unit tests
        run: npm test

      - name: Smoke test
        run: ./scripts/smoke-test.sh
```

Also ensure `scripts/smoke-test.sh` is executable in git; if not:
```bash
git update-index --chmod=+x scripts/smoke-test.sh
```

**Step 4: Run test to verify it passes**

Run locally:
```bash
npm test
./scripts/smoke-test.sh
```
Expected: PASS.

**Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for tests + smoke"
```

---

# Final verification (required before PR/merge)

## Task 9: Full verification

**Files:**
- Modify: none

**Step 1: Run unit tests**

Run:
```bash
npm test
```
Expected: PASS.

**Step 2: Run smoke test**

Run:
```bash
./scripts/smoke-test.sh
```
Expected: All checks pass.

**Step 3: Quick manual CLI spot-check**

Run:
```bash
node src/cli.js --help
```
Expected: `op`/`schema` show `--source` as optional.

**Step 4: Commit (if needed)**
No code changes expected.

---

## Execution handoff
Plan complete and saved to `docs/plans/2026-02-11-apidb-v2-source-resolution-http-caching-blobs-ci-design.md`.

Two execution options:

1. Subagent-Driven (this session) — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) — Open a new session and use the executing-plans skill to run tasks with checkpoints

Which approach?