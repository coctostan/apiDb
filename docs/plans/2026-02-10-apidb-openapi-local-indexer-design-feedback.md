---
name: apidb-openapi-local-indexer-design-feedback
date: 2026-02-10
status: draft
relates_to: 2026-02-10-apidb-openapi-local-indexer-design.md
---

# Feedback: apidb local OpenAPI sync + searchable index

This feedback covers three structured lenses (council, first-principles, red-team) plus a concrete recommendation.

## Council analysis (4 perspectives)

### 1) The Pragmatist (ship v1 fast)
**Strengths**
- **Full rebuild + strict atomic swap** is the fastest route to correctness without migrations.
- **Local-first + bounded output** matches agent needs (deterministic, not chatty).
- **Shared core library** used by CLI + pi extension avoids divergence.

**What may be overcomplicated for v1**
- “Reachable schema traversal” is one of the hardest parts (cycles, dialect variation, subtle misses). Consider **indexing all `components/schemas`** by default for predictability.
- Add one early debuggability command: `apidb list` (sources + last sync time + doc counts).

### 2) The Architect (6-month regrets)
**Good abstractions already present**
- Clear split: **config is source-of-truth**, SQLite DB is derived.
- **Atomic replace** + “last-good DB preserved” is the correct durability invariant.

**Likely pain points to address now (cheap fixes)**
- **Deterministic doc IDs** so `apidb show <id>` remains stable across syncs:
  - operation: `${sourceId}:${METHOD}:${PATH}` (optionally include operationId if you want uniqueness beyond method/path)
  - schema: `${sourceId}:schema:${componentName}` (or JSON pointer)
- Consider storing **source-level raw spec** (bytes) + fetch metadata (etag/last-modified/fetchedAt). Even if docs are derived for search, raw spec improves:
  - show fidelity
  - debugging
  - future incremental features

### 3) The Skeptic (deal-breakers)
**Potential deal-breaker**
- Strict “any source fails → sync fails” can make the tool feel unusable when one remote source is flaky: user has 5 APIs and 1 times out → **nothing updates**.

**Mitigation**
- Keep strict as default, but add `apidb sync --allow-partial` (or `--skip-failed`):
  - updates what it can
  - records per-source status
  - still performs atomic swap

**Other likely disappointments**
- Reachable-schema traversal may **miss** schemas users expect to search for, reducing trust.
- Large specs may cause **slow sync / high RAM** if the system explodes docs or stores large duplicated JSON.

### 4) The User Advocate (user complaints)
Likely complaints:
- “Searching `customer` returns a bunch of schemas before the endpoint I need.”
- “`show` isn’t copy/paste friendly into code (params/body/response).”
- “Which root did you pick? Why is search empty?” (root detection feels magical)

Small UX wins:
- In search results, always show **`METHOD /path`** for operations.
- `apidb root` should explain selection reason (found `.apidb`, git toplevel, cwd) with `--verbose`.
- Add `--json` output mode early (even if human mode stays default).

### Key tensions / disagreements
- **Strict sync** (correctness) vs **partial sync** (availability).
- **Reachable schemas** (smaller index) vs **all components schemas** (predictable coverage).
- **Store full per-doc JSON** (simple show) vs **store raw spec once** (less bloat, easier future).

### Recommendation (acknowledging tensions)
- Keep the current v1 shape, but adjust two fundamentals:
  1) Make **doc IDs deterministic** and versioned.
  2) Prefer **indexing all component schemas** (or make it the default) to avoid trust failures.
- Add an **optional partial sync** mode to remain useful under real network conditions.

---

## First-principles analysis

### Assumptions being made
- A1: “Reachable schemas are what users need.” (**Inherited; often false in practice**)
- A2: “FTS5 lexical search is enough for v1.” (**True**)
- A3: “Strict sync is best for determinism.” (**True for safety, not always best UX**)
- A4: “Full rebuild is required for correctness.” (**Inherited**)
- A5: “Storing full JSON per doc in SQLite is acceptable.” (**Inherited; size/perf risk**)

### Invalidate at least one assumption
- **A1 is frequently false**: users expect to find shared error schemas, base polymorphic types, deprecated-but-documented models, etc., even when not directly reachable.

### Base truths
- T1: Users need **fast offline search** for a selected set of APIs.
- T2: The system must be **deterministic** (same inputs → same index).
- T3: A failed sync must **not destroy** last-good index.
- T4: Outputs must be **bounded + structured** for agents.

### Rebuilt reasoning (minimal reliable system)
- Store **sources** and optionally cached raw **spec blob** per source.
- Derive **operation docs** for search.
- Derive **schema docs** from **all named component schemas**.
- Use FTS5 over a stable “body” representation.

### Impact (changes vs current plan)
- Prefer **all components schemas** over reachability for v1 simplicity/trust.
- Optional storage of **raw spec bytes** avoids duplication and aids debug.
- Keep strict atomic replace (directly supports T3).

---

## Red-team analysis (failure modes)

### Failure mode 1: Spec traversal DoS (cycles/explosion)
- **What fails:** `$ref` cycles, deep nesting, huge allOf/oneOf, YAML anchors.
- **Worst case:** sync hangs/OOM.
- **Mitigation:** hard limits (depth, nodes visited, bytes), cycle detection, memoization, per-source timeouts.

### Failure mode 2: Strict sync availability failure
- **What fails:** one URL timeout/404 aborts all updates.
- **Worst case:** index never updates; users abandon tool.
- **Mitigation:** optional `--allow-partial` with per-source status.

### Failure mode 3: Root discovery footgun
- **What fails:** monorepo/nested git repos cause unexpected `.apidb/` location.
- **Worst case:** “search returns nothing” due to different roots.
- **Mitigation:** explain root selection; require explicit `--root` when ambiguous.

### Failure mode 4: Security/SSRF-ish behavior
- **What fails:** fetching URLs that hit localhost/private networks unintentionally.
- **Worst case:** sensitive data fetched and stored.
- **Mitigation:** default deny private IP ranges unless `--allow-private-net`, allowlist hosts.

### Failure mode 5: Concurrency/DB corruption
- **What fails:** two syncs race; rename/locks cause corruption or locked DB.
- **Worst case:** broken index.
- **Mitigation:** workspace lock file + stale detection; WAL mode for readers; controlled atomic swap.

### Deal-breaker scenario
- If common large specs reliably OOM or take 10–20 minutes due to doc explosion or duplicated JSON storage, the “fast local index” promise fails.

### Overall risk narrative
The must-get-right item is **robust ingestion under gnarly specs** (limits, cycles, parser tolerance) while preserving the last-good DB invariant.
