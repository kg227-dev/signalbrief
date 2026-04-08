# Codebase Cleanup & Refactoring Plan

*Originally created: March 28, 2026*  
*Refreshed against current codebase: April 8, 2026*  
*Status: Ready for execution*  
*Planning horizon: 6-8 focused working days across 2 passes*

## Current Snapshot

| Metric | Current |
|---|---|
| Total JS files | 606 |
| Source files (`src/` + `web/`) | 266 |
| Total LOC (`src/` + `web/`) | 55,235 |
| Average source file size | 208 LOC |
| Largest file | 2,119 LOC (`src/digest/domain/storyline-domain-runtime.js`) |
| Files >800 LOC | 9 |
| Files >600 LOC | 16 |
| Small JS shims/facades <=15 LOC | 11 |
| Contract tests | 218 |
| Sidecar tests | 42 |
| Direct `process.env` reads in production source (`src/` + `web/`) | 0 |
| Remaining `process.env` reads in source tree | 4, both in sidecar tests |
| Non-test source/web files hardcoding MVP topic tags | 17 |
| Direct `../digest/runtime/*` imports inside orchestrator entrypoints | 5 |
| Empty service-grouping directories | 3 (`web/services/admin`, `web/services/shared`, `web/services/user`) |

## What Changed Since The March Draft

The March 28 plan is directionally useful, but several of its assumptions are now stale:

- `src/platform/config/mvp-topics.js` already exists and is now the canonical tag list.
- `web/routes/` is already split into `admin/`, `core/`, and `public-static.js`.
- `tests/README.md` already documents the sidecar-vs-contract test convention.
- Direct `process.env` reads have already been pushed out of production source code.
- Several barrel/facade docs already landed: `src/domains/digest/index.js`, `src/domains/engagement/index.js`, `src/platform/config/index.js`, `src/platform/mailer/index.js`, `src/platform/store/index.js`, `src/runtime/store.js`, and `web/server.js`.
- `web/routes/admin/admin-api-users-actions-runtime.js` is already a thin facade (27 LOC), with user work split into query/lifecycle/digest action modules.
- Source-registry work is already partly separated into `web/services/admin-source-registry-runtime.js`, `admin-source-registry-summary-runtime.js`, and `admin-source-registry-metrics-runtime.js`.
- `src/digest/runtime/digest-data-enrich-runtime.js` has already been partially split into prompt/result helpers.

The repo also grew materially since March:

- Source size increased from the mid-40k LOC range to 55k+ LOC.
- The largest production hot spots shifted from a few old files to a broader orchestrator cluster plus new web/admin modules.
- The most valuable cleanup is no longer "foundation hygiene"; it is targeted decomposition of high-risk runtime files plus consolidation of duplicated helper logic.

## March Tasks That Are Now Complete Or Obsolete

Do not spend execution time redoing these:

- Broad env centralization sweep across `src/` and `web/`. Production source is already clean.
- `web/routes/` reorganization. It is already done.
- Standalone test-location policy cleanup. The rule is already documented; only move tests when file boundaries change.
- Standalone JSDoc sweep for the major barrels listed in the original draft. Most of that work is already done.
- `admin-api-users-actions-runtime.js` split. It already happened.
- `web/server.js` split. The real web hot spot is now `web/server-runtime.js`, not `web/server.js`.

## Current Cleanup Priorities

### 1. Split the production orchestrator cluster first

This is now the highest-leverage work. The main operational complexity sits in the digest orchestrator pipeline, not in config or routing structure.

| File | LOC | Why it matters | First split seams |
|---|---:|---|---|
| `src/entrypoints/digest-orchestrator-core-runtime.js` | 1,994 | Highest-fan-in production file; owns bootstrap, caches, runtime wiring, audit paths, and run assembly | bootstrap/config wiring, runtime factories/caches, audit+incident logging, pipeline execution helpers |
| `src/entrypoints/digest-orchestrator-fetch-runtime.js` | 1,819 | Mixes run-mode policy, topic/query policy, broker/discovery orchestration, and rate-limit behavior | run-mode/topic selection policy, query-pack config, broker/discovery execution, inventory/backoff helpers |
| `src/entrypoints/digest-orchestrator-selection-runtime.js` | 1,172 | Holds freshness logic, source-tier logic, domain-topic scopes, fallback pools, and final selection | source-tier/freshness helpers, domain-topic-scope policy, pool builder, final slot-selection/backfill rules |
| `src/entrypoints/digest-orchestrator-enrichment-runtime.js` | 1,030 | Mixes enrichment orchestration with stats normalization and ship-ready evaluation | writeup stats accumulators, topic-bucket flatten/map helpers, ship-ready/final-assembly evaluators |
| `src/entrypoints/digest-orchestrator-delivery-runtime.js` | 1,031 | Delivery policy, ranking, and payload assembly are still bundled together | ranking/slotting helpers, render payload assembly, delivery orchestration |

### 2. Extract shared candidate/topic utilities before touching the next hot spots

Several large files now duplicate the same helper families:

- `normalizeSourceTier` appears in 6 source files.
- Trusted-tier counting helpers are duplicated across selection and enrichment.
- Freshness/age helpers are duplicated across strict-quality and selection.
- Topic-specific query packs and keyword maps still live in multiple files.

Create a canonical shared surface before doing the next wave of splits. That keeps the follow-on work smaller and reduces drift.

Recommended extraction targets:

- `src/domains/digest/candidate-quality-runtime.js` or equivalent:
  - `normalizeSourceTier`
  - `isTrustedSourceTier`
  - `countTrustedSourceTier`
  - `computeItemAgeHours`
  - freshness tier helpers
- `src/platform/config/mvp-topic-metadata.js` or equivalent:
  - canonical topic list
  - focused-topic sets
  - query-pack overrides
  - topic keyword maps used for matching/scoring

### 3. Finish the web/runtime cleanup that is only half done

The web layer is structurally better than it was in March, but there is still incomplete migration scaffolding:

| Target | Current state | Action |
|---|---|---|
| `web/server-runtime.js` | 756 LOC, still the real web hot spot | split bootstrap, route wiring, admin ops wiring, and scheduler-control helpers |
| `web/routes/admin/admin-api-funnel-runtime.js` | 854 LOC | split audit file IO/date expansion, summary aggregation, and source-registry joining |
| `web/services/admin/`, `shared/`, `user/` | empty directories with README guidance but no group indexes | either finish the grouping with real entrypoints or delete the empty scaffolding |

### 4. Finish topic-catalog centralization

The tag list is centralized, but the broader topic catalog is still fragmented across runtime, UI, and validation code.

Current non-test files still carrying literal MVP topic tags include:

- `src/entrypoints/digest-orchestrator-fetch-runtime.js`
- `src/entrypoints/digest-orchestrator-selection-runtime.js`
- `src/runtime/standard-topic-broker-runtime.js`
- `src/runtime/user-contract-runtime.js`
- `web/server-runtime-topic-config-runtime.js`
- `web/preferences-shared.js`
- `web/preferences-runtime.js`
- supporting eval/config files

The next step is not another `Set([...])` cleanup. It is a richer shared topic-catalog surface that gives runtime, UI, and validation code one place to get:

- canonical tags
- display labels
- focus sets
- query packs
- matching aliases

### 5. Keep import/facade cleanup narrow and opportunistic

This is still worth doing, but it is no longer a top-level day of work.

Keep it scoped to:

- removing the remaining direct `../digest/runtime/*` imports from orchestrator entrypoints where a domain/platform surface exists
- deciding whether tiny facades such as `src/digest/application/digest-service-runtime.js` still buy anything
- updating imports only when a split already touches the module boundary

Do not run another broad "barrel cleanup" sweep before the large runtime files are decomposed.

## Two-Pass Execution Plan

### Pass 1 - Production shape and shared utilities

### Step 1 - Split the core orchestrator path

Execution order:

1. `src/entrypoints/digest-orchestrator-core-runtime.js`
2. `src/entrypoints/digest-orchestrator-fetch-runtime.js`
3. shared candidate/topic utility extraction
4. `src/entrypoints/digest-orchestrator-selection-runtime.js`
5. `src/entrypoints/digest-orchestrator-enrichment-runtime.js`
6. `src/entrypoints/digest-orchestrator-delivery-runtime.js`

Rules for each split:

- Keep the original file as the composition layer.
- Move pure helpers first; move orchestration last.
- Preserve existing exports and sidecar tests before changing behavior.
- Update contract tests only when module boundaries move.

### Step 2 - Finish the web/admin hot spots

- Split `web/server-runtime.js`.
- Split `web/routes/admin/admin-api-funnel-runtime.js`.
- Resolve the empty `web/services/{admin,shared,user}` grouping dirs one way or the other.

### Step 3 - Re-baseline after pass 1

- Recount large files.
- Update this doc with the new metrics.
- Only then decide whether pass 2 is still necessary in full.

### Pass 2 - Remaining large modules and low-risk cleanup

Pass 2 starts after the shared utility layer from pass 1 exists.

Priority order:

1. `src/digest/domain/storyline-domain-runtime.js` (2,119 LOC)
2. `src/runtime/standard-topic-broker-runtime.js` (1,390 LOC)
3. `src/digest/domain/strict-quality-domain-runtime.js` (753 LOC)
4. `src/digest/runtime/digest-data-enrich-runtime.js` (744 LOC)
5. `src/eval/retrieval/runner-runtime.js` (1,874 LOC, eval-only)
6. narrow import/facade cleanup

Rationale:

- `storyline-domain-runtime.js` and `standard-topic-broker-runtime.js` are still the biggest underlying domain/runtime modules, but both become easier to split after the shared helper extraction above.
- `strict-quality-domain-runtime.js` and `digest-data-enrich-runtime.js` are smaller, but they currently duplicate logic that should move into shared utilities first.
- `src/eval/retrieval/runner-runtime.js` is still large, but it is eval-only and should not block production cleanup.

## Success Criteria

### Hard outcomes

- Production files over 1,000 LOC reduced to 0.
- Files over 800 LOC reduced from 9 to at most 2, with any exception clearly justified.
- Repeated helper families (`normalizeSourceTier`, trusted-tier checks, freshness-tier helpers) consolidated to one canonical implementation each.
- Non-test source/web files hardcoding full MVP topic lists reduced from 17 to at most 5.
- Direct `../digest/runtime/*` imports in orchestrator entrypoints reduced from 5 to 0, or left only where there is a deliberate boundary reason.
- Empty `web/services/admin`, `shared`, and `user` directories resolved.

### Process outcomes

- No standalone redo of already-complete March tasks.
- Every large split lands with its tests still green.
- The plan is updated after each pass so the metrics stay current instead of drifting again.

## Verification Expectations

Run verification incrementally, not only at the very end:

- `npm test` after each major file split
- `npm run smoke:worker` after orchestrator/scheduler changes
- `npm run smoke:admin-scheduler` after web/admin/server changes
- `npm run qa:harness` after pass 1 and again at final closeout

## Risks And Constraints

- The highest-risk work is still the orchestrator cluster. Avoid batching multiple large splits before tests run.
- `src/domains/digest/index.js` remains a load-bearing aggregation surface because it lazy-loads topic-domain exports to avoid circularity.
- `src/runtime/standard-topic-broker-runtime.js` mixes feed parsing, source policy, and topic scoring. Splitting it without the shared topic metadata layer will cause more duplication, not less.
- `web/services/README.md` describes service grouping that is not actually wired yet. Treat that as migration scaffolding, not current reality.
- Avoid turning this effort into a repo-wide import-style or documentation sweep. The remaining value is in runtime decomposition and shared utility extraction.

## Out Of Scope

- Feature work or product behavior changes unrelated to the split targets
- Database or store migration work
- CI/CD pipeline changes
- Broad documentation passes on files that are already adequately documented
- Repeating cleanup tasks that are already complete in the current codebase
