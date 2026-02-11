# Next steps (handoff)

Audience: product/design review + engineering sequencing.

Date: 2026-02-11

## 0) Housekeeping (recommended: do this next)

Goal: lock in the current state with repeatable verification and a clean history.

- Run verification:
  - Unit tests: `npm test`
  - End-to-end smoke test: `./scripts/smoke-test.sh`
- Commit the documentation + smoke-test additions as a single changeset (e.g. `docs/testing: add smoke test + index`).

Acceptance criteria:
- Both commands succeed locally.
- Repo has a clear “start here” doc (`docs/INDEX.md`) and a reproducible smoke test (`docs/SMOKE_TEST.md`).

---

## Optional next items (v2 candidates)

### A) UX improvement: omit `--source` when unambiguous (exact lookup)

Problem:
- v1 requires `--source` for exact `op`/`schema` lookup, which is extra friction.

Proposed behavior:
- `apidb op <METHOD> <PATH>`
  - If exactly one enabled source contains that operation: return it.
  - If multiple sources match: return a clear ambiguity error that lists candidates and suggests `--source`.
  - If none match: return a not-found error and optionally suggest close matches.
- `apidb schema <NAME>` follows the same rules.

UX notes for design review:
- Error copy should be short and actionable.
- Candidate list should be bounded (e.g. max 10) and stable.

Success criteria:
- Works without `--source` for the common single-source workspace.
- Never returns the “wrong” source silently.

---

### B) Reliability/perf: HTTP caching for URL sources (ETag / Last-Modified)

Problem:
- URL sync always refetches; slower and more failure-prone.

Proposed behavior:
- Persist per-source cache metadata (ETag and/or Last-Modified).
- Use conditional requests on sync.
- If 304 Not Modified, skip parse/index work for that source.

Success criteria:
- Re-sync of unchanged URL sources is fast.
- Clear logging/telemetry in `list`/JSON output about whether a source was fetched vs reused.

---

### C) Debuggability: optional raw spec persistence (`source_blobs`)

Problem:
- When parsing/indexing fails, it’s hard to inspect exactly what bytes were fetched and indexed.

Proposed behavior:
- Add an optional `source_blobs` table to store fetched bytes + content-type + timestamp.
- Only store on successful fetch/parse (policy decision).

Success criteria:
- Makes failures reproducible offline.
- Enables future “rebuild index from stored blobs” workflows.

---

### D) CI: add a minimal pipeline

Problem:
- No automated gate to prevent regressions.

Proposed behavior:
- Add GitHub Actions (or equivalent) to run:
  - `npm test`
  - (optional) `./scripts/smoke-test.sh`

Success criteria:
- Every PR runs tests automatically.
- Failures are easy to understand from logs.
