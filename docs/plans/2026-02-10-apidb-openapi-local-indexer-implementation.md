# apidb v1 (OpenAPI sync + SQLite FTS) Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Implement a local-first `apidb` CLI that can register OpenAPI (JSON/YAML) sources, sync them into a local SQLite FTS5 index, and support bounded offline search + retrieval.

**Architecture:** A small Node.js core library (root discovery, config, sync, search, render) used by a CLI entrypoint. Sync rebuilds a temporary SQLite DB using `node:sqlite` (FTS5), then atomically swaps it into place while preserving the last-good DB on failure.

**Tech Stack:** Node.js 22 (ESM), built-in `node:sqlite` (FTS5), `commander` (CLI), `yaml` (YAML parsing), `ipaddr.js` (private-network URL denylist), Node built-in test runner (`node --test`).

---

## Pre-flight notes (read before starting)
- This repo currently contains only docs. You will be creating the entire implementation from scratch.
- The plan assumes a *workspace root* where `.apidb/` is created.
- The plan includes `git commit` steps. If this directory is not a git repo, either:
  - run `git init` once (recommended), or
  - skip commit steps.

## Directory layout to create
- `package.json`
- `src/cli.js`
- `src/core/root.js`
- `src/core/config.js`
- `src/core/lock.js`
- `src/core/net.js`
- `src/core/fetchSource.js`
- `src/core/docIds.js`
- `src/openapi/parse.js`
- `src/openapi/normalize.js`
- `src/db/schema.js`
- `src/core/sync.js`
- `src/core/search.js`
- `src/core/show.js`
- `src/core/list.js`
- `src/core/util.js`
- `test/fixtures/petstore.json`
- `test/fixtures/petstore.yaml`
- `test/*.test.js`

---

### Task 1: Scaffold Node project + test runner

**Files:**
- Create: `package.json`
- Create: `src/cli.js`
- Create: `src/core/util.js`
- Create: `test/smoke.test.js`

**Step 1: Write the failing test**

Create `test/smoke.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('smoke: test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test`

Expected: FAIL because there is no `package.json` / project scaffold yet is fine; after scaffold it should PASS.

**Step 3: Write minimal implementation**

Create `package.json`:
```json
{
  "name": "apidb",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "apidb": "./src/cli.js"
  },
  "scripts": {
    "test": "node --test",
    "apidb": "node src/cli.js"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "ipaddr.js": "^2.2.0",
    "yaml": "^2.5.1"
  }
}
```

Create `src/cli.js` (placeholder so `bin` resolves):
```js
#!/usr/bin/env node
console.log('apidb: not implemented yet');
process.exitCode = 2;
```

Create `src/core/util.js`:
```js
export function nowIso() {
  return new Date().toISOString();
}
```

**Step 4: Run test to verify it passes**

Run: `npm install`

Then: `npm test`

Expected: PASS (`smoke: test runner works`).

**Step 5: Commit**

```bash
git add package.json src/cli.js src/core/util.js test/smoke.test.js
git commit -m "chore: scaffold node project and test runner"
```

---

### Task 2: Implement workspace root discovery

**Files:**
- Create: `src/core/root.js`
- Create: `test/root.test.js`

**Step 1: Write the failing test**

Create `test/root.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { findWorkspaceRoot } from '../src/core/root.js';

async function mkTmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-root-'));
}

test('findWorkspaceRoot: prefers nearest parent with .apidb/', async () => {
  const root = await mkTmp();
  const nested = path.join(root, 'a', 'b');
  await fs.mkdir(nested, { recursive: true });
  await fs.mkdir(path.join(root, '.apidb'));

  const res = await findWorkspaceRoot({ cwd: nested });
  assert.equal(res.root, root);
  assert.equal(res.reason, 'found .apidb directory');
});

test('findWorkspaceRoot: uses explicit --root when provided', async () => {
  const root = await mkTmp();
  const other = await mkTmp();
  await fs.mkdir(path.join(other, '.apidb'));

  const res = await findWorkspaceRoot({ cwd: other, rootFlag: root });
  assert.equal(res.root, root);
  assert.equal(res.reason, 'explicit --root');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/root.test.js`

Expected: FAIL with “Cannot find module ../src/core/root.js”.

**Step 3: Write minimal implementation**

Create `src/core/root.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';

async function existsDir(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function findWorkspaceRoot({ cwd = process.cwd(), rootFlag } = {}) {
  if (rootFlag) {
    return { root: path.resolve(rootFlag), reason: 'explicit --root' };
  }

  let cur = path.resolve(cwd);
  // Walk up until filesystem root.
  while (true) {
    if (await existsDir(path.join(cur, '.apidb'))) {
      return { root: cur, reason: 'found .apidb directory' };
    }

    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return { root: path.resolve(cwd), reason: 'default to cwd' };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/root.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/root.js test/root.test.js
git commit -m "feat: implement workspace root discovery"
```

---

### Task 3: Implement config init/load/validate/save

**Files:**
- Create: `src/core/config.js`
- Create: `test/config.test.js`

**Step 1: Write the failing test**

Create `test/config.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, loadConfig, saveConfig, addOpenApiSource } from '../src/core/config.js';

async function mkTmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-config-'));
}

test('initConfig: creates .apidb/config.json with version=1', async () => {
  const root = await mkTmp();
  await initConfig({ root });

  const cfg = await loadConfig({ root });
  assert.equal(cfg.version, 1);
  assert.deepEqual(cfg.sources, []);
});

test('addOpenApiSource: validates id and adds enabled=true by default', async () => {
  const root = await mkTmp();
  await initConfig({ root });

  const cfg1 = await loadConfig({ root });
  const cfg2 = addOpenApiSource(cfg1, { id: 'stripe', location: 'https://example.com/spec.json' });
  await saveConfig({ root, config: cfg2 });

  const cfg3 = await loadConfig({ root });
  assert.equal(cfg3.sources.length, 1);
  assert.equal(cfg3.sources[0].id, 'stripe');
  assert.equal(cfg3.sources[0].type, 'openapi');
  assert.equal(cfg3.sources[0].enabled, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/config.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/config.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from './util.js';

function configPath(root) {
  return path.join(root, '.apidb', 'config.json');
}

export async function initConfig({ root }) {
  await fs.mkdir(path.join(root, '.apidb'), { recursive: true });
  const p = configPath(root);
  try {
    await fs.stat(p);
    return; // idempotent
  } catch {
    // continue
  }
  const cfg = { version: 1, sources: [] };
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

export async function loadConfig({ root }) {
  const raw = await fs.readFile(configPath(root), 'utf8');
  const cfg = JSON.parse(raw);
  validateConfig(cfg);
  // Normalize
  cfg.sources ??= [];
  return cfg;
}

export async function saveConfig({ root, config }) {
  validateConfig(config);
  await fs.mkdir(path.join(root, '.apidb'), { recursive: true });
  await fs.writeFile(configPath(root), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('Invalid config: not an object');
  if (cfg.version !== 1) throw new Error('Invalid config: version must be 1');
  if (!Array.isArray(cfg.sources)) throw new Error('Invalid config: sources must be an array');

  const seen = new Set();
  for (const s of cfg.sources) {
    if (!s || typeof s !== 'object') throw new Error('Invalid source: not an object');
    if (typeof s.id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(s.id)) throw new Error(`Invalid source id: ${s.id}`);
    if (seen.has(s.id)) throw new Error(`Duplicate source id: ${s.id}`);
    seen.add(s.id);
    if (s.type !== 'openapi') throw new Error(`Invalid source type for ${s.id}: ${s.type}`);
    if (typeof s.location !== 'string' || !s.location) throw new Error(`Invalid location for ${s.id}`);
    if (typeof s.enabled !== 'boolean') throw new Error(`Invalid enabled for ${s.id}`);
  }
}

export function addOpenApiSource(cfg, { id, location, enabled = true }) {
  const next = structuredClone(cfg);
  next.sources = [...(next.sources ?? [])];
  next.sources.push({ id, type: 'openapi', location, enabled, addedAt: nowIso() });
  validateConfig(next);
  return next;
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/config.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/config.js test/config.test.js
git commit -m "feat: add config init/load/save and source validation"
```

---

### Task 4: Implement lock file (sync mutex)

**Files:**
- Create: `src/core/lock.js`
- Create: `test/lock.test.js`

**Step 1: Write the failing test**

Create `test/lock.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { withWorkspaceLock } from '../src/core/lock.js';

async function mkTmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-lock-'));
}

test('withWorkspaceLock: prevents concurrent lock acquisition', async () => {
  const root = await mkTmp();
  await fs.mkdir(path.join(root, '.apidb'));

  let release1;
  const p1 = withWorkspaceLock({ root }, async () => {
    // Hold lock until released
    await new Promise((r) => (release1 = r));
  });

  // Wait a moment for p1 to acquire lock
  await new Promise((r) => setTimeout(r, 50));

  await assert.rejects(
    () => withWorkspaceLock({ root }, async () => {}),
    /locked/i
  );

  release1();
  await p1;
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/lock.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/lock.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';

function lockPath(root) {
  return path.join(root, '.apidb', 'lock');
}

export async function withWorkspaceLock({ root }, fn) {
  await fs.mkdir(path.join(root, '.apidb'), { recursive: true });

  let fh;
  try {
    fh = await fs.open(lockPath(root), 'wx');
  } catch (e) {
    throw new Error(`Workspace is locked: ${lockPath(root)}`);
  }

  try {
    await fh.writeFile(`${process.pid}\n`, 'utf8');
    return await fn();
  } finally {
    try { await fh.close(); } catch {}
    try { await fs.unlink(lockPath(root)); } catch {}
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/lock.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/lock.js test/lock.test.js
git commit -m "feat: add workspace lock for sync"
```

---

### Task 5: Add safe URL checks (deny private/loopback)

**Files:**
- Create: `src/core/net.js`
- Create: `test/net.test.js`

**Step 1: Write the failing test**

Create `test/net.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeHttpUrl } from '../src/core/net.js';

test('assertSafeHttpUrl: rejects localhost', async () => {
  await assert.rejects(() => assertSafeHttpUrl('http://localhost:1234/x'), /private|loopback|localhost/i);
});

test('assertSafeHttpUrl: allows public https URL', async () => {
  await assertSafeHttpUrl('https://example.com/openapi.json');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/net.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/net.js`:
```js
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

function isPrivateIp(ip) {
  const addr = ipaddr.parse(ip);
  const range = addr.range();
  return (
    range === 'private' ||
    range === 'loopback' ||
    range === 'linkLocal' ||
    range === 'uniqueLocal' ||
    range === 'carrierGradeNat'
  );
}

export async function assertSafeHttpUrl(urlString, { allowPrivateNet = false } = {}) {
  const u = new URL(urlString);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported');
  }

  if (allowPrivateNet) return;

  const host = u.hostname;

  // Fast-path localhost
  if (host === 'localhost') throw new Error('Refusing to fetch localhost URL');

  // If literal IP
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Refusing to fetch private/loopback IP');
    return;
  }

  // Resolve DNS and check all addresses
  const res = await dns.lookup(host, { all: true });
  for (const { address } of res) {
    if (isPrivateIp(address)) {
      throw new Error(`Refusing to fetch private/loopback address for host ${host}`);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/net.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/net.js test/net.test.js
git commit -m "feat: deny private-network URL fetch by default"
```

---

### Task 6: Add source fetching (file or URL) with max bytes

**Files:**
- Create: `src/core/fetchSource.js`
- Create: `test/fetchSource.test.js`
- Create: `test/fixtures/petstore.json`

**Step 1: Write the failing test**

Create `test/fixtures/petstore.json`:
```json
{
  "openapi": "3.0.0",
  "info": { "title": "Petstore", "version": "1.0.0" },
  "paths": {
    "/pets": {
      "get": {
        "operationId": "listPets",
        "summary": "List pets",
        "responses": {
          "200": {
            "description": "ok"
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "Pet": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" }
        }
      }
    }
  }
}
```

Create `test/fetchSource.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { fetchSourceBytes } from '../src/core/fetchSource.js';

test('fetchSourceBytes: reads local file', async () => {
  const p = path.join(process.cwd(), 'test', 'fixtures', 'petstore.json');
  const { bytes, kind } = await fetchSourceBytes({ location: p, maxBytes: 1024 * 1024 });
  assert.equal(kind, 'file');
  assert.ok(bytes.length > 10);
});

test('fetchSourceBytes: enforces maxBytes', async () => {
  const p = path.join(process.cwd(), 'test', 'fixtures', 'petstore.json');
  await assert.rejects(
    () => fetchSourceBytes({ location: p, maxBytes: 10 }),
    /MAX_SPEC_BYTES|maxBytes/i
  );
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/fetchSource.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/fetchSource.js`:
```js
import fs from 'node:fs/promises';
import { assertSafeHttpUrl } from './net.js';

export async function fetchSourceBytes({ location, maxBytes, allowPrivateNet = false }) {
  // Heuristic: URL if parseable and has protocol.
  let url;
  try {
    url = new URL(location);
  } catch {
    url = null;
  }

  if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
    await assertSafeHttpUrl(location, { allowPrivateNet });
    const res = await fetch(location);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

    const ab = await res.arrayBuffer();
    const bytes = Buffer.from(ab);
    if (bytes.length > maxBytes) throw new Error(`MAX_SPEC_BYTES exceeded: ${bytes.length} > ${maxBytes}`);
    return { bytes, kind: 'url', contentType: res.headers.get('content-type') ?? null };
  }

  const bytes = await fs.readFile(location);
  if (bytes.length > maxBytes) throw new Error(`MAX_SPEC_BYTES exceeded: ${bytes.length} > ${maxBytes}`);
  return { bytes, kind: 'file', contentType: null };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/fetchSource.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/fetchSource.js test/fetchSource.test.js test/fixtures/petstore.json
git commit -m "feat: fetch OpenAPI sources from file or URL with byte limits"
```

---

### Task 7: Parse OpenAPI as JSON or YAML

**Files:**
- Create: `src/openapi/parse.js`
- Create: `test/fixtures/petstore.yaml`
- Create: `test/parse.test.js`

**Step 1: Write the failing test**

Create `test/fixtures/petstore.yaml`:
```yaml
openapi: 3.0.0
info:
  title: PetstoreYaml
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      responses:
        "200":
          description: ok
components:
  schemas:
    Pet:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
```

Create `test/parse.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parseOpenApiBytes } from '../src/openapi/parse.js';

test('parseOpenApiBytes: parses JSON', async () => {
  const p = path.join(process.cwd(), 'test/fixtures/petstore.json');
  const bytes = await fs.readFile(p);
  const spec = parseOpenApiBytes({ bytes, filename: p });
  assert.equal(spec.openapi, '3.0.0');
  assert.equal(spec.info.title, 'Petstore');
});

test('parseOpenApiBytes: parses YAML', async () => {
  const p = path.join(process.cwd(), 'test/fixtures/petstore.yaml');
  const bytes = await fs.readFile(p);
  const spec = parseOpenApiBytes({ bytes, filename: p });
  assert.equal(spec.openapi, '3.0.0');
  assert.equal(spec.info.title, 'PetstoreYaml');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/parse.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/openapi/parse.js`:
```js
import YAML from 'yaml';

export function parseOpenApiBytes({ bytes, filename = 'spec' }) {
  const text = bytes.toString('utf8');

  // Try JSON first.
  try {
    const obj = JSON.parse(text);
    return obj;
  } catch {
    // fall through
  }

  // Then YAML.
  try {
    return YAML.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse OpenAPI as JSON or YAML (${filename}): ${e.message}`);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/parse.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/openapi/parse.js test/parse.test.js test/fixtures/petstore.yaml
git commit -m "feat: parse OpenAPI from JSON or YAML"
```

---

### Task 8: Deterministic doc IDs (operation + schema)

**Files:**
- Create: `src/core/docIds.js`
- Create: `test/docIds.test.js`

**Step 1: Write the failing test**

Create `test/docIds.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { opDocId, schemaDocId } from '../src/core/docIds.js';

test('opDocId: stable and uppercases method', () => {
  assert.equal(opDocId({ sourceId: 's', method: 'get', path: '/v1/pets' }), 'op:s:GET:/v1/pets');
});

test('schemaDocId: stable', () => {
  assert.equal(schemaDocId({ sourceId: 's', schemaName: 'Pet' }), 'schema:s:Pet');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/docIds.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/docIds.js`:
```js
export function opDocId({ sourceId, method, path }) {
  return `op:${sourceId}:${String(method).toUpperCase()}:${path}`;
}

export function schemaDocId({ sourceId, schemaName }) {
  return `schema:${sourceId}:${schemaName}`;
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/docIds.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/docIds.js test/docIds.test.js
git commit -m "feat: add deterministic document ID helpers"
```

---

### Task 9: Normalize OpenAPI into operation + schema docs (bounded)

**Files:**
- Create: `src/openapi/normalize.js`
- Create: `test/normalize.test.js`

**Step 1: Write the failing test**

Create `test/normalize.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parseOpenApiBytes } from '../src/openapi/parse.js';
import { normalizeOpenApiToDocs } from '../src/openapi/normalize.js';

test('normalizeOpenApiToDocs: produces one operation doc and one schema doc for fixture', async () => {
  const p = path.join(process.cwd(), 'test/fixtures/petstore.json');
  const spec = parseOpenApiBytes({ bytes: await fs.readFile(p), filename: p });

  const docs = normalizeOpenApiToDocs({ sourceId: 'pet', spec });

  const op = docs.find((d) => d.kind === 'operation');
  const schema = docs.find((d) => d.kind === 'schema');

  assert.ok(op);
  assert.ok(schema);
  assert.equal(op.method, 'GET');
  assert.equal(op.path, '/pets');
  assert.equal(schema.schemaName, 'Pet');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/normalize.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/openapi/normalize.js`:
```js
import { opDocId, schemaDocId } from '../core/docIds.js';

const DEFAULT_LIMITS = {
  MAX_SCHEMA_PROPERTIES: 200,
  MAX_DOC_BODY_CHARS: 50_000
};

function trunc(s, n) {
  if (s == null) return s;
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function schemaSummary(schema, limits) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.$ref) return { $ref: String(schema.$ref) };
  const out = {
    type: schema.type ?? null,
    format: schema.format ?? null,
    description: trunc(schema.description ?? null, 500)
  };
  if (schema.properties && typeof schema.properties === 'object') {
    const keys = Object.keys(schema.properties).slice(0, limits.MAX_SCHEMA_PROPERTIES);
    out.properties = keys.map((k) => {
      const p = schema.properties[k];
      return {
        name: k,
        type: p?.type ?? null,
        $ref: p?.$ref ? String(p.$ref) : null,
        description: trunc(p?.description ?? null, 200)
      };
    });
  }
  return out;
}

export function normalizeOpenApiToDocs({ sourceId, spec, limits = DEFAULT_LIMITS }) {
  const docs = [];
  const paths = spec?.paths ?? {};

  for (const [p, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [methodRaw, op] of Object.entries(pathItem)) {
      const method = methodRaw.toUpperCase();
      if (!['GET','PUT','POST','DELETE','PATCH','HEAD','OPTIONS','TRACE'].includes(method)) continue;
      if (!op || typeof op !== 'object') continue;

      const id = opDocId({ sourceId, method, path: p });
      const title = `${method} ${p}`;

      const json = {
        method,
        path: p,
        operationId: op.operationId ?? null,
        summary: op.summary ?? null,
        description: op.description ?? null,
        tags: Array.isArray(op.tags) ? op.tags.slice(0, 20) : []
      };

      const bodyParts = [
        title,
        op.operationId,
        op.summary,
        op.description,
        ...(Array.isArray(op.tags) ? op.tags : [])
      ].filter(Boolean);

      const body = trunc(bodyParts.join('\n'), limits.MAX_DOC_BODY_CHARS);

      docs.push({
        id,
        sourceId,
        kind: 'operation',
        title,
        method,
        path: p,
        schemaName: null,
        json,
        body
      });
    }
  }

  const schemas = spec?.components?.schemas ?? {};
  for (const [name, schema] of Object.entries(schemas)) {
    const id = schemaDocId({ sourceId, schemaName: name });
    const title = name;
    const json = {
      name,
      type: schema?.type ?? null,
      description: schema?.description ?? null,
      summary: schemaSummary(schema, limits)
    };

    const body = trunc(
      [name, schema?.description, schema?.type, JSON.stringify(schemaSummary(schema, limits))]
        .filter(Boolean)
        .join('\n'),
      limits.MAX_DOC_BODY_CHARS
    );

    docs.push({
      id,
      sourceId,
      kind: 'schema',
      title,
      method: null,
      path: null,
      schemaName: name,
      json,
      body
    });
  }

  return docs;
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/normalize.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/openapi/normalize.js test/normalize.test.js
git commit -m "feat: normalize OpenAPI into bounded operation and schema docs"
```

---

### Task 10: Create SQLite schema + helper to initialize DB

**Files:**
- Create: `src/db/schema.js`
- Create: `test/dbSchema.test.js`

**Step 1: Write the failing test**

Create `test/dbSchema.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { initDb } from '../src/db/schema.js';

test('initDb: creates required tables including FTS', () => {
  const db = new DatabaseSync(':memory:');
  initDb(db);

  // Should not throw
  db.exec('INSERT INTO sources(id,type,location,enabled,addedAt) VALUES (\'s\',\'openapi\',\'x\',1,\'t\')');
  db.exec('CREATE VIRTUAL TABLE t USING fts5(x)');
  assert.ok(true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/dbSchema.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/db/schema.js`:
```js
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
      kind TEXT NOT NULL CHECK(kind IN ('operation','schema')),
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
```

**Step 4: Run test to verify it passes**

Run: `node --test test/dbSchema.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/db/schema.js test/dbSchema.test.js
git commit -m "feat: add SQLite schema (tables + FTS5)"
```

---

### Task 11: Build index DB from docs (insert docs + FTS)

**Files:**
- Create: `src/core/sync.js` (DB builder portion)
- Create: `test/dbBuild.test.js`

**Step 1: Write the failing test**

Create `test/dbBuild.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { initDb } from '../src/db/schema.js';
import { insertDocs } from '../src/core/sync.js';

test('insertDocs: inserts docs and makes them searchable via FTS', () => {
  const db = new DatabaseSync(':memory:');
  initDb(db);

  db.exec("INSERT INTO sources(id,type,location,enabled,addedAt) VALUES ('pet','openapi','x',1,'t')");

  insertDocs(db, [
    { id: 'op:pet:GET:/pets', sourceId: 'pet', kind: 'operation', title: 'GET /pets', method: 'GET', path: '/pets', schemaName: null, json: { a: 1 }, body: 'GET /pets listPets' },
    { id: 'schema:pet:Pet', sourceId: 'pet', kind: 'schema', title: 'Pet', method: null, path: null, schemaName: 'Pet', json: { b: 2 }, body: 'Pet schema' }
  ]);

  const rows = db.prepare("SELECT d.id FROM docs_fts f JOIN docs d ON d.rowid = f.rowid WHERE docs_fts MATCH 'listPets'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'op:pet:GET:/pets');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/dbBuild.test.js`

Expected: FAIL because `insertDocs` not implemented.

**Step 3: Write minimal implementation**

In `src/core/sync.js` create (or extend) with `insertDocs`:
```js
import { DatabaseSync } from 'node:sqlite';

export function insertDocs(db, docs) {
  const ins = db.prepare(`
    INSERT INTO docs(id, sourceId, kind, title, method, path, schemaName, json, body)
    VALUES ($id, $sourceId, $kind, $title, $method, $path, $schemaName, $json, $body)
  `);

  const getRowId = db.prepare('SELECT rowid FROM docs WHERE id = ?');
  const insFts = db.prepare('INSERT INTO docs_fts(rowid, title, body) VALUES (?, ?, ?)');

  db.exec('BEGIN');
  try {
    for (const d of docs) {
      ins.run({
        id: d.id,
        sourceId: d.sourceId,
        kind: d.kind,
        title: d.title,
        method: d.method,
        path: d.path,
        schemaName: d.schemaName,
        json: JSON.stringify(d.json),
        body: d.body
      });

      const rowid = getRowId.get(d.id).rowid;
      insFts.run(rowid, d.title, d.body);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/dbBuild.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/sync.js test/dbBuild.test.js
git commit -m "feat: insert docs and populate FTS index"
```

---

### Task 12: Implement full sync pipeline (strict + atomic swap + preserve last-good)

**Files:**
- Modify: `src/core/sync.js`
- Create: `test/syncStrict.test.js`

**Step 1: Write the failing test**

Create `test/syncStrict.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';

async function mkTmp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-sync-'));
  await fs.mkdir(path.join(root, '.apidb'));
  return root;
}

test('syncWorkspace strict: failed source does not overwrite last-good index', async () => {
  const root = await mkTmp();
  await initConfig({ root });

  // First: valid sync
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'pet', type: 'openapi', location: path.join(process.cwd(), 'test/fixtures/petstore.json'), enabled: true }
      ]
    }
  });

  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });
  const dbPath = path.join(root, '.apidb', 'index.sqlite');
  const st1 = await fs.stat(dbPath);

  // Second: make config invalid (missing file)
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'pet', type: 'openapi', location: path.join(root, 'does-not-exist.json'), enabled: true }
      ]
    }
  });

  await assert.rejects(
    () => syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 }),
    /failed/i
  );

  const st2 = await fs.stat(dbPath);
  assert.equal(st2.size, st1.size);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/syncStrict.test.js`

Expected: FAIL because `syncWorkspace` not implemented.

**Step 3: Write minimal implementation**

Modify `src/core/sync.js` to include `syncWorkspace` (keep existing `insertDocs`):
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initDb } from '../db/schema.js';
import { loadConfig } from './config.js';
import { withWorkspaceLock } from './lock.js';
import { fetchSourceBytes } from './fetchSource.js';
import { parseOpenApiBytes } from '../openapi/parse.js';
import { normalizeOpenApiToDocs } from '../openapi/normalize.js';
import { nowIso } from './util.js';

export async function syncWorkspace({ root, strict = true, maxSpecBytes = 50 * 1024 * 1024, allowPrivateNet = false }) {
  return await withWorkspaceLock({ root }, async () => {
    const cfg = await loadConfig({ root });

    const enabledSources = cfg.sources.filter((s) => s.enabled);
    const tmpPath = path.join(root, '.apidb', 'index.sqlite.tmp');
    const finalPath = path.join(root, '.apidb', 'index.sqlite');
    const bakPath = path.join(root, '.apidb', 'index.sqlite.bak');

    // Ensure clean tmp
    try { await fs.unlink(tmpPath); } catch {}

    const db = new DatabaseSync(tmpPath);
    try {
      initDb(db);

      // Insert sources
      const insSource = db.prepare('INSERT INTO sources(id,type,location,enabled,addedAt) VALUES (?,?,?,?,?)');
      for (const s of cfg.sources) {
        insSource.run(s.id, s.type, s.location, s.enabled ? 1 : 0, s.addedAt ?? nowIso());
      }

      const docs = [];
      for (const s of enabledSources) {
        try {
          const { bytes } = await fetchSourceBytes({ location: s.location, maxBytes: maxSpecBytes, allowPrivateNet });
          const spec = parseOpenApiBytes({ bytes, filename: s.location });
          const sd = normalizeOpenApiToDocs({ sourceId: s.id, spec });
          docs.push(...sd);

          const ops = sd.filter((d) => d.kind === 'operation').length;
          const schemas = sd.filter((d) => d.kind === 'schema').length;

          db.prepare(`
            INSERT INTO source_status(sourceId,lastFetchedAt,lastOkAt,lastError,docCountOperations,docCountSchemas)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(sourceId) DO UPDATE SET
              lastFetchedAt=excluded.lastFetchedAt,
              lastOkAt=excluded.lastOkAt,
              lastError=excluded.lastError,
              docCountOperations=excluded.docCountOperations,
              docCountSchemas=excluded.docCountSchemas
          `).run(s.id, nowIso(), nowIso(), null, ops, schemas);
        } catch (e) {
          db.prepare(`
            INSERT INTO source_status(sourceId,lastFetchedAt,lastOkAt,lastError,docCountOperations,docCountSchemas)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(sourceId) DO UPDATE SET
              lastFetchedAt=excluded.lastFetchedAt,
              lastError=excluded.lastError
          `).run(s.id, nowIso(), null, String(e.message), 0, 0);

          if (strict) throw new Error(`Source ${s.id} failed: ${e.message}`);
        }
      }

      insertDocs(db, docs);
      db.close();

      // Atomic swap
      try {
        await fs.stat(finalPath);
        // Rotate last-good to .bak
        try { await fs.unlink(bakPath); } catch {}
        await fs.rename(finalPath, bakPath);
      } catch {
        // no previous DB
      }

      await fs.rename(tmpPath, finalPath);
    } catch (e) {
      try { db.close(); } catch {}
      try { await fs.unlink(tmpPath); } catch {}
      throw e;
    }
  });
}
```

(If your `src/core/sync.js` grows too large, you can later refactor `insertDocs()` into a small helper module. For now, keep it in the same file to minimize moving parts.)

**Step 4: Run test to verify it passes**

Run: `node --test test/syncStrict.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/sync.js test/syncStrict.test.js
git commit -m "feat: implement strict sync with atomic swap and last-good preservation"
```

---

### Task 13: Implement search API (FTS + bounded results)

**Files:**
- Create: `src/core/search.js`
- Create: `test/search.test.js`

**Step 1: Write the failing test**

Create `test/search.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { searchDocs } from '../src/core/search.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-search-'));
  await fs.mkdir(path.join(root, '.apidb'));
  await initConfig({ root });
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'pet', type: 'openapi', location: path.join(process.cwd(), 'test/fixtures/petstore.json'), enabled: true }
      ]
    }
  });
  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });
  return root;
}

test('searchDocs: finds operation by operationId token', async () => {
  const root = await mkRoot();
  const res = await searchDocs({ root, query: 'listPets', limit: 10 });
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].kind, 'operation');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/search.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/search.js`:
```js
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function searchDocs({ root, query, kind = 'any', sourceId = null, limit = 10 }) {
  const capped = Math.max(1, Math.min(50, Number(limit || 10)));
  const dbPath = path.join(root, '.apidb', 'index.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });

  // Basic FTS search; snippet is bounded.
  const where = [];
  const params = { $q: query, $limit: capped };
  if (kind !== 'any') {
    where.push('d.kind = $kind');
    params.$kind = kind;
  }
  if (sourceId) {
    where.push('d.sourceId = $sourceId');
    params.$sourceId = sourceId;
  }

  const sql = `
    SELECT
      d.id,
      d.kind,
      d.title,
      d.sourceId,
      snippet(docs_fts, 1, '', '', '…', 12) AS snippet
    FROM docs_fts
    JOIN docs d ON d.rowid = docs_fts.rowid
    WHERE docs_fts MATCH $q
      ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ORDER BY
      bm25(docs_fts) ASC,
      CASE WHEN d.kind = 'operation' THEN 0 ELSE 1 END ASC
    LIMIT $limit
  `;

  const results = db.prepare(sql).all(params);
  db.close();

  return { query, results };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/search.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/search.js test/search.test.js
git commit -m "feat: add FTS search with bounded results"
```

---

### Task 14: Implement show API (load by docId, human + json)

**Files:**
- Create: `src/core/show.js`
- Create: `test/show.test.js`

**Step 1: Write the failing test**

Create `test/show.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { getDocById, renderDocHuman } from '../src/core/show.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-show-'));
  await fs.mkdir(path.join(root, '.apidb'));
  await initConfig({ root });
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'pet', type: 'openapi', location: path.join(process.cwd(), 'test/fixtures/petstore.json'), enabled: true }
      ]
    }
  });
  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });
  return root;
}

test('getDocById: loads doc and renderDocHuman includes title', async () => {
  const root = await mkRoot();
  const doc = await getDocById({ root, id: 'op:pet:GET:/pets' });
  assert.equal(doc.id, 'op:pet:GET:/pets');
  const text = renderDocHuman(doc);
  assert.match(text, /GET \/pets/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/show.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/show.js`:
```js
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function getDocById({ root, id }) {
  const db = new DatabaseSync(path.join(root, '.apidb', 'index.sqlite'), { readOnly: true });
  const row = db.prepare('SELECT id, sourceId, kind, title, method, path, schemaName, json, body FROM docs WHERE id = ?').get(id);
  db.close();
  if (!row) throw new Error(`Doc not found: ${id}`);
  return {
    ...row,
    json: JSON.parse(row.json)
  };
}

export function renderDocHuman(doc) {
  if (doc.kind === 'operation') {
    const lines = [
      `${doc.method} ${doc.path}`,
      doc.json.summary ? `Summary: ${doc.json.summary}` : null,
      doc.json.operationId ? `OperationId: ${doc.json.operationId}` : null
    ].filter(Boolean);
    return lines.join('\n') + '\n';
  }

  // schema
  const lines = [
    `Schema ${doc.schemaName}`,
    doc.json.description ? `Description: ${doc.json.description}` : null
  ].filter(Boolean);
  return lines.join('\n') + '\n';
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/show.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/show.js test/show.test.js
git commit -m "feat: add show API and human renderer"
```

---

### Task 15: Implement list API (sources + status summary)

**Files:**
- Create: `src/core/list.js`
- Create: `test/list.test.js`

**Step 1: Write the failing test**

Create `test/list.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { listSources } from '../src/core/list.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-list-'));
  await fs.mkdir(path.join(root, '.apidb'));
  await initConfig({ root });
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'pet', type: 'openapi', location: path.join(process.cwd(), 'test/fixtures/petstore.json'), enabled: true }
      ]
    }
  });
  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });
  return root;
}

test('listSources: returns status with doc counts', async () => {
  const root = await mkRoot();
  const res = listSources({ root });
  assert.equal(res.sources.length, 1);
  assert.equal(res.sources[0].id, 'pet');
  assert.ok(res.sources[0].status.docCountOperations >= 1);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/list.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/list.js`:
```js
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function listSources({ root }) {
  const db = new DatabaseSync(path.join(root, '.apidb', 'index.sqlite'), { readOnly: true });
  const sources = db.prepare('SELECT id, type, location, enabled, addedAt FROM sources ORDER BY id').all();
  const statuses = db.prepare('SELECT sourceId, lastFetchedAt, lastOkAt, lastError, docCountOperations, docCountSchemas FROM source_status').all();
  db.close();

  const statusById = new Map(statuses.map((s) => [s.sourceId, s]));
  return {
    sources: sources.map((s) => ({
      ...s,
      enabled: !!s.enabled,
      status: statusById.get(s.id) ?? null
    }))
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/list.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/list.js test/list.test.js
git commit -m "feat: list sources and per-source sync status"
```

---

### Task 16: Implement exact op/schema lookup helpers (ambiguity rules)

**Files:**
- Create: `src/core/exact.js`
- Create: `test/exact.test.js`

**Step 1: Write the failing test**

Create `test/exact.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initConfig, saveConfig } from '../src/core/config.js';
import { syncWorkspace } from '../src/core/sync.js';
import { resolveOperationDocId } from '../src/core/exact.js';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-exact-'));
  await fs.mkdir(path.join(root, '.apidb'));
  await initConfig({ root });
  await saveConfig({
    root,
    config: {
      version: 1,
      sources: [
        { id: 'pet', type: 'openapi', location: path.join(process.cwd(), 'test/fixtures/petstore.json'), enabled: true }
      ]
    }
  });
  await syncWorkspace({ root, strict: true, maxSpecBytes: 1024 * 1024 });
  return root;
}

test('resolveOperationDocId: returns deterministic docId', async () => {
  const root = await mkRoot();
  const id = resolveOperationDocId({ method: 'GET', path: '/pets', sourceId: 'pet' });
  assert.equal(id, 'op:pet:GET:/pets');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/exact.test.js`

Expected: FAIL module not found.

**Step 3: Write minimal implementation**

Create `src/core/exact.js`:
```js
import { opDocId, schemaDocId } from './docIds.js';

export function resolveOperationDocId({ method, path, sourceId }) {
  if (!sourceId) throw new Error('sourceId is required for v1 exact lookups');
  return opDocId({ sourceId, method, path });
}

export function resolveSchemaDocId({ schemaName, sourceId }) {
  if (!sourceId) throw new Error('sourceId is required for v1 exact lookups');
  return schemaDocId({ sourceId, schemaName });
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/exact.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/exact.js test/exact.test.js
git commit -m "feat: add exact docId resolvers for op and schema"
```

---

### Task 17: Wire CLI (root/init/add/sync/list/search/show/op/schema)

**Files:**
- Modify: `src/cli.js`
- Create: `test/cli.test.js`

**Step 1: Write the failing test**

Create `test/cli.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function mkRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apidb-cli-'));
  return root;
}

test('cli: apidb root prints chosen root', async () => {
  const root = await mkRoot();
  const res = spawnSync(process.execPath, ['src/cli.js', 'root', '--root', root], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, new RegExp(root.replace(/[-/\\]/g, (m) => `\\${m}`)));
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js`

Expected: FAIL because CLI not implemented.

**Step 3: Write minimal implementation**

Modify `src/cli.js` to:
```js
#!/usr/bin/env node
import { Command } from 'commander';

import { findWorkspaceRoot } from './core/root.js';
import { initConfig, loadConfig, saveConfig, addOpenApiSource } from './core/config.js';
import { syncWorkspace } from './core/sync.js';
import { listSources } from './core/list.js';
import { searchDocs } from './core/search.js';
import { getDocById, renderDocHuman } from './core/show.js';
import { resolveOperationDocId, resolveSchemaDocId } from './core/exact.js';

const program = new Command();
program.name('apidb');

function commonRootOption(cmd) {
  return cmd.option('--root <path>', 'workspace root (overrides auto-discovery)');
}

commonRootOption(program.command('root')
  .option('--verbose', 'print reason')
  .action(async (opts) => {
    const res = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    process.stdout.write(res.root + '\n');
    if (opts.verbose) process.stdout.write(res.reason + '\n');
  })
);

commonRootOption(program.command('init')
  .action(async (opts) => {
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    await initConfig({ root });
    process.stdout.write(`Initialized ${root}/.apidb/config.json\n`);
  })
);

commonRootOption(program.command('add')
  .description('add a source')
  .command('openapi <location>')
  .requiredOption('--id <id>', 'source id')
  .option('--no-sync', 'do not sync immediately')
  .action(async (location, opts, cmd) => {
    const rootOpt = cmd.parent?.opts()?.root;
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: rootOpt });
    await initConfig({ root });
    const cfg = await loadConfig({ root });
    const next = addOpenApiSource(cfg, { id: opts.id, location });
    await saveConfig({ root, config: next });
    process.stdout.write(`Added source ${opts.id}\n`);
    if (opts.sync !== false) {
      await syncWorkspace({ root, strict: true });
      process.stdout.write('Sync OK\n');
    }
  })
);

commonRootOption(program.command('sync')
  .option('--allow-partial', 'continue syncing other sources on failure')
  .option('--allow-private-net', 'allow fetching from private network ranges')
  .action(async (opts) => {
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    await syncWorkspace({ root, strict: !opts.allowPartial, allowPrivateNet: !!opts.allowPrivateNet });
    process.stdout.write('Sync OK\n');
  })
);

commonRootOption(program.command('list')
  .option('--json', 'machine-readable JSON')
  .action(async (opts) => {
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    const res = listSources({ root });
    if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    else {
      for (const s of res.sources) {
        process.stdout.write(`${s.id}\t${s.enabled ? 'enabled' : 'disabled'}\t${s.location}\n`);
      }
    }
  })
);

commonRootOption(program.command('search <query>')
  .option('--kind <kind>', 'operation|schema|any', 'any')
  .option('--source <id>', 'source id')
  .option('--limit <n>', 'limit (max 50)', '10')
  .option('--json', 'machine-readable JSON')
  .action(async (query, opts) => {
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    const res = searchDocs({ root, query, kind: opts.kind, sourceId: opts.source ?? null, limit: Number(opts.limit) });
    if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    else {
      for (const r of res.results) {
        process.stdout.write(`${r.id}\t${r.kind}\t${r.title}\t${r.sourceId}\n`);
      }
    }
  })
);

commonRootOption(program.command('show <docId>')
  .option('--json', 'machine-readable JSON')
  .action(async (docId, opts) => {
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    const doc = await getDocById({ root, id: docId });
    if (opts.json) process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
    else process.stdout.write(renderDocHuman(doc));
  })
);

commonRootOption(program.command('op <method> <path>')
  .requiredOption('--source <id>', 'source id')
  .option('--json', 'machine-readable JSON')
  .action(async (method, p, opts) => {
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    const id = resolveOperationDocId({ method, path: p, sourceId: opts.source });
    const doc = await getDocById({ root, id });
    if (opts.json) process.stdout.write(JSON.stringify({ docId: id, doc }, null, 2) + '\n');
    else process.stdout.write(renderDocHuman(doc));
  })
);

commonRootOption(program.command('schema <name>')
  .requiredOption('--source <id>', 'source id')
  .option('--json', 'machine-readable JSON')
  .action(async (name, opts) => {
    const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
    const id = resolveSchemaDocId({ schemaName: name, sourceId: opts.source });
    const doc = await getDocById({ root, id });
    if (opts.json) process.stdout.write(JSON.stringify({ docId: id, doc }, null, 2) + '\n');
    else process.stdout.write(renderDocHuman(doc));
  })
);

program.parseAsync(process.argv).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

**Step 4: Run test to verify it passes**

Run: `node --test test/cli.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "feat: wire CLI commands (root/init/add/sync/list/search/show/op/schema)"
```

---

### Task 18: End-to-end CLI happy path (init → add → search → show)

**Files:**
- Modify: `test/cli.test.js`

**Step 1: Write the failing test**

Append to `test/cli.test.js`:
```js
test('cli: init + add + search works end-to-end', async () => {
  const root = await mkRoot();

  let res = spawnSync(process.execPath, ['src/cli.js', 'init', '--root', root], { encoding: 'utf8' });
  assert.equal(res.status, 0);

  res = spawnSync(
    process.execPath,
    ['src/cli.js', 'add', 'openapi', path.join(process.cwd(), 'test/fixtures/petstore.json'), '--id', 'pet', '--root', root],
    { encoding: 'utf8' }
  );
  assert.equal(res.status, 0);

  res = spawnSync(process.execPath, ['src/cli.js', 'search', 'listPets', '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.results.find((r) => r.id === 'op:pet:GET:/pets'));
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js`

Expected: If it fails, fix CLI wiring / command parsing until it passes.

**Step 3: Write minimal implementation**

Minimal code changes should be in `src/cli.js` only (avoid touching core).

Common fixes:
- Ensure subcommand parsing for `add openapi` is correct (commander nesting is easy to get wrong).
- Ensure `--root` is read from the correct command level.

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS all tests.

**Step 5: Commit**

```bash
git add test/cli.test.js src/cli.js
git commit -m "test: add end-to-end CLI happy path"
```

---

### Task 19: Documentation polish (README usage + output expectations)

**Files:**
- Modify: `README.md`

**Step 1: Write the failing test**

(No test for docs; instead add a doc checklist.)

**Step 2: Run a verification command to see current behavior**

Run:
- `node src/cli.js --help`
- `node src/cli.js init --help`

Expected: help output lists commands.

**Step 3: Write minimal implementation**

Update `README.md` to include:
- install: `npm install`
- run: `node src/cli.js init`
- add: `node src/cli.js add openapi <path-or-url> --id stripe`
- search: `node src/cli.js search customer --json`
- show: `node src/cli.js show op:stripe:GET:/v1/customers --json`
- note on strict sync and `--allow-partial`
- note on private-net denial and `--allow-private-net`

**Step 4: Run a quick manual verification**

Run:
```bash
node src/cli.js init --root /tmp/apidb-demo
node src/cli.js add openapi test/fixtures/petstore.json --id pet --root /tmp/apidb-demo
node src/cli.js search listPets --root /tmp/apidb-demo
```

Expected: search prints an entry containing `op:pet:GET:/pets`.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add CLI usage examples"
```

---

## Optional v1.1 tasks (do not start until v1 tests are green)
- Add ambiguity-resolution across sources for `op`/`schema` when `--source` is omitted.
- Add `apidb show` to render parameters/requestBody/responses (requires deeper normalization).
- Store `source_blobs` (raw spec bytes) in DB for debugging.
- Add configurable limits (`MAX_*`) via CLI flags.

---

## Definition of done (v1)
- `npm test` passes.
- Happy path works: `init` → `add openapi` → `search` → `show`.
- Sync strict mode preserves last-good index on failure.
- Outputs are bounded (search limit default 10, max 50).
