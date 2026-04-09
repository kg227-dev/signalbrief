# Codebase Cleanup & Refactoring Plan

*Originally created: March 28, 2026*  
*Refreshed against current codebase: April 8, 2026*  
*Status: Ready for execution*  
*Planning horizon: 6-8 focused working days across 2 passes*

## Current Snapshot

| Metric | Current |
|---|---|
| Total JS files | 637 |
| Source files (`src/` + `web/`) | 303 |
| Total LOC (`src/` + `web/`) | 56,064 |
| Average source file size | 185 LOC |
| Largest file | 2,118 LOC (`src/digest/domain/storyline-domain-runtime.js`) |
| Files >800 LOC | 4 |
| Files >600 LOC | 16 |
| Small JS shims/facades <=15 LOC | 12 |
| Contract tests | 235 |
| Sidecar tests | 42 |
| Direct `process.env` references in production source (`src/` + `web/`) | 19, mostly child-process/env passthrough plumbing |
| Remaining `process.env` references in source tree | 4, both in sidecar tests |
| Non-test source/web files hardcoding MVP topic tags | 17 |
| Direct `../digest/runtime/*` imports inside orchestrator entrypoints | 0 |
| Empty service-grouping directories | 0 |

## What Changed Since The March Draft

The March 28 plan is directionally useful, but several of its assumptions are now stale:

- `src/platform/config/mvp-topics.js` already exists and is now the canonical tag list.
- `web/routes/` is already split into `admin/`, `core/`, and `public-static.js`.
- `tests/README.md` already documents the sidecar-vs-contract test convention.
- Direct `process.env` config reads have already been pushed out of production source code; the remaining references are env passthrough/wiring plus a few test-only setup reads.
- Several barrel/facade docs already landed: `src/domains/digest/index.js`, `src/domains/engagement/index.js`, `src/platform/config/index.js`, `src/platform/mailer/index.js`, `src/platform/store/index.js`, `src/runtime/store.js`, and `web/server.js`.
- `web/routes/admin/admin-api-users-actions-runtime.js` is already a thin facade (27 LOC), with user work split into query/lifecycle/digest action modules.
- Source-registry work is already partly separated into `web/services/admin-source-registry-runtime.js`, `admin-source-registry-summary-runtime.js`, and `admin-source-registry-metrics-runtime.js`.
- `src/digest/runtime/digest-data-enrich-runtime.js` has already been split into prompt/result/policy helpers.
- `web/server-runtime.js` has already been split via `web/server-runtime-web-bootstrap-runtime.js`.
- `web/routes/admin/admin-api-funnel-runtime.js` has already been split via `web/routes/admin/admin-api-funnel-data-runtime.js`.
- `web/services/{admin,shared,user}` now have live grouped entrypoints and the README matches reality.
- `src/entrypoints/digest-orchestrator-fetch-runtime.js` has already been split again via `src/entrypoints/digest-orchestrator-fetch-policy-runtime.js`.

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

This is still the highest-leverage source/runtime work, but the shape changed after the pass-1 extractions. The remaining large modules are now split across orchestrator composition, the standalone eval runner, and the larger domain/runtime files.

| File | LOC | Why it matters | First split seams |
|---|---:|---|---|
| `src/digest/domain/storyline-domain-runtime.js` | 2,118 | Largest pure domain module; still mixes storyline shaping, candidate comparison, and downstream render decisions | narrative assembly, topic/candidate grouping, render evaluation helpers |
| `src/eval/retrieval/runner-runtime.js` | 1,873 | Large eval-only harness; still bundles retrieval generation, judging, reporting, and artifact wiring | result assembly, judge/report helpers, candidate generation wiring |
| `src/runtime/standard-topic-broker-topic-fit-runtime.js` | 203 | Pure canonical-topic scoring now lives outside the broker runtime and is shared by broker + selection | canonical-topic normalization, scoring heuristics, topic-fit tests |
| `src/entrypoints/digest-orchestrator-core-runtime.js` | 981 | Still above the large-file threshold after the first round of extractions | cache/bootstrap wiring, audit/incident helpers, run assembly helpers |

Completed: `src/runtime/standard-topic-broker-runtime.js` is now 627 LOC after the topic-fit split, so it has moved out of the over-800 queue.

### 2. Extract shared candidate/topic utilities before touching the next hot spots

Several large files now duplicate the same helper families:

- `normalizeSourceTier` appears in 6 source files.
- Trusted-tier counting helpers are duplicated across selection and enrichment.
- Freshness/age helpers are duplicated across strict-quality and selection.
- Topic-specific query packs and keyword maps still live in multiple files.
- `src/runtime/standard-topic-broker-topic-fit-runtime.js` now owns canonical topic scoring for broker and selection code.

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

The web layer is now mostly structural cleanup-complete. The remaining work is limited to a few source/web hotspots and topic-catalog consistency:

| Target | Current state | Action |
|---|---|---|
| `web/server-runtime.js` | 744 LOC | already split; keep imports aligned with the grouped service entrypoints and avoid re-bundling route policy back into the main file |
| `web/routes/admin/admin-api-funnel-runtime.js` | 557 LOC | already split; keep the data/runtime seam thin and stable |
| `web/services/admin/`, `shared/`, `user/` | live grouped entrypoints now exist | keep the grouped entrypoints as the stable import surface and avoid reintroducing flat imports in new code |

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

- Completed: `web/server-runtime.js` split.
- Completed: `web/routes/admin/admin-api-funnel-runtime.js` split.
- Completed: `web/services/{admin,shared,user}` grouping entrypoints added.
- Next, keep the remaining web work opportunistic and focused on topic-catalog consistency or new large-file hotspots.

### Step 3 - Re-baseline after pass 1

- Recount large files. Done.
- Update this doc with the new metrics. Done.
- Use the updated snapshot to drive the remaining pass 2 order.

### Pass 2 - Remaining large modules and low-risk cleanup

Pass 2 starts after the shared utility layer from pass 1 exists.

Priority order:

1. `src/digest/domain/storyline-domain-runtime.js` (2,118 LOC)
2. `src/eval/retrieval/runner-runtime.js` (1,873 LOC, eval-only)
3. `src/entrypoints/digest-orchestrator-core-runtime.js` (981 LOC)
4. `src/digest/domain/strict-quality-domain-runtime.js` (732 LOC)
5. narrow import/facade cleanup

Rationale:

- `storyline-domain-runtime.js` remains the biggest underlying domain/runtime module, and the broker scoring logic now has its own shared helper surface.
- `runner-runtime.js` is eval-only but remains large enough to justify cleanup once the higher-fan-in runtime modules settle.
- `digest-orchestrator-core-runtime.js` is still above the large-file threshold and still has enough orchestration logic left to justify one more pass.
- `digest-orchestrator-fetch-runtime.js` is now below 800 LOC after the policy extraction, so it has moved out of the main over-800 queue.
- `standard-topic-broker-runtime.js` is now below 800 LOC after the topic-fit extraction, so it has moved out of the main over-800 queue too.
- `strict-quality-domain-runtime.js` is smaller, but it still duplicates logic that should move into shared utilities first.
- `digest-data-enrich-runtime.js` is now below 500 LOC after the policy split, so it has moved out of the main over-800 queue entirely.
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
- `web/services/README.md` now mirrors live grouped entrypoints, so keep it aligned with that import surface.
- Avoid turning this effort into a repo-wide import-style or documentation sweep. The remaining value is in runtime decomposition and shared utility extraction.

## Out Of Scope

- Feature work or product behavior changes unrelated to the split targets
- Database or store migration work
- CI/CD pipeline changes
- Broad documentation passes on files that are already adequately documented
- Repeating cleanup tasks that are already complete in the current codebase
