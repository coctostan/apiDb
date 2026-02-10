---
name: apidb-project-merit-analysis
date: 2026-02-10
status: draft
---

# Does apidb (local OpenAPI indexer) have merit?

This document captures a first-principles assessment and a 4-perspective council review of whether the apidb project is worth building at all.

## First-principles: does apidb have merit?

### Base truths (what we know is real)
- Teams (and agents) routinely need to answer: **“Which endpoint does X?”**, **“What’s the request/response shape?”**, **“What does this error schema look like?”**
- OpenAPI specs are often **large**, **remote**, **multi-file**, and **not pleasant to navigate** under time pressure.
- Agents work best when you can provide **bounded, structured retrieval** (not “here’s an 8MB JSON spec, good luck”).

### Key assumptions (audit)
- A1: “This is best solved by a bespoke SQLite FTS index.” → **INHERITED** (plausible, not proven)
- A2: “Plain text search (ripgrep) over spec(s) is insufficient.” → **INHERITED** (often false for power users)
- A3: “Agents need a tool boundary (`search/show`) to stay bounded.” → **TRUE** in practice
- A4: “Most repos have multiple specs or remote specs.” → **MIXED** (varies widely)
- A5: “Normalization (ops/schemas) can be done robustly across real-world OpenAPI.” → **TRUE but costly** (edge cases)

### Invalidate at least one assumption
- **A2 is often false for humans**: if the spec is in-repo and reasonably structured, `rg "customers" openapi.*` + Swagger UI/Redoc may be “good enough” for many devs.
- The *real differentiator* isn’t search per se; it’s **agent-grade retrieval**: stable IDs, bounded show output, ranking, offline cache of remote specs, and a consistent CLI/tool interface.

### Rebuilt from ground truth: when does it have merit?
Apidb has strong merit **if at least one** is true:
- Specs are **remote** (not vendored) and you want **offline / reproducible** access.
- There are **multiple APIs/specs** and you want one unified search surface.
- You need **bounded, structured output** for agents (tooling integration is the point).
- Specs are big enough that ad-hoc parsing/UI navigation is a drag, and you repeatedly answer the same “where is X” questions.

Apidb has weak merit if:
- There’s **one small spec** already in the repo and your workflow is already fine with Swagger UI/Redoc + `rg`.
- The primary goal is “better OpenAPI docs browsing” (web UIs already do that well).
- The project’s true cost is underestimated (robust normalization is the iceberg).

**First-principles conclusion:** apidb’s merit is primarily as **agent infrastructure** (bounded retrieval + caching + stable identifiers), not as “yet another OpenAPI browser.”

---

## Council: should you build it?

### 1) Pragmatist (ship impact fast)
- Merit is real *if you can prove it quickly* with a spike.
- Fastest validation: a tool that can:
  - ingest 1–3 real specs you care about,
  - answer “find endpoint” in <1s,
  - `show` returns a compact payload you can paste into code/tests.
- If you can’t demonstrate that within a short spike, it’s likely not worth it.

**Pragmatist vote:** proceed only if you can validate usefulness in days, not weeks.

### 2) Architect (long-term fit)
- Conceptually clean: “config is truth, index is derived, atomic swap.”
- But OpenAPI is messy; long-term maintenance risk is **spec edge cases** and “what users expect search to mean.”
- To have lasting merit, apidb must become a **reliable retrieval contract** (stable IDs, predictable indexing rules, robust limits), not a best-effort parser.

**Architect vote:** merit exists, but only if you commit to being boringly reliable.

### 3) Skeptic (what could make it not worth doing)
**Deal-breaker scenario**
- You spend real time building it and users (or you) still default to Swagger UI / `rg` because results are incomplete, ranking is weird, or sync breaks on real specs. Then apidb becomes shelfware.

Other skepticism points:
- If the surrounding repo mission is workflow skills (e.g., pi-superpowers-plus), apidb may be **scope drift** unless it’s clearly a supporting tool used by those skills.

**Skeptic vote:** high risk of “nice idea, unused” unless you validate with real workflows immediately.

### 4) User Advocate (actual user pain)
Users don’t want “a database.” They want:
- “Tell me the endpoint + exact request shape” in one command.
- “Show me the schema fields that matter” without wading through `$ref` spaghetti.
- “Don’t break when the network is flaky.”

If apidb nails *that*, it has merit. If it’s just “searchable text,” it’s marginal.

**User Advocate vote:** merit depends on whether `show` is genuinely useful and copy/paste friendly.

---

## Where the perspectives disagree
- Pragmatist wants a **thin spike**; Architect wants **reliability contracts**; Skeptic warns about **edge-case tax**; User Advocate demands **high-quality show output**.
- Tension: you can ship fast by cutting corners, but the value only exists if it’s trustworthy.

---

## Recommendation (go/no-go framing)

**Go** if you can commit to a short validation that answers:
1) Does it beat `rg + swagger` for *your* real specs and questions?
2) Does it materially improve agent interactions via bounded `search/show`?
3) Can sync be made reliable enough (limits, cycles, partial failures) to not feel brittle?

**No-go / postpone** if you can’t identify a recurring real workflow where apidb is the default tool.

### Merit validation success criteria (minimum)
- [ ] For 2 real specs, you can find 5 endpoints by intent (“create customer”, “list invoices”) faster than your current workflow.
- [ ] `apidb show` outputs a bounded summary that is directly usable in code/tests/prompts.
- [ ] Sync is robust to at least one nasty spec feature (cycles/large schemas) without hanging or nuking last-good.
