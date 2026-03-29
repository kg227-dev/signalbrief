# Codebase Cleanup & Refactoring Plan

*Created: March 28, 2026*
*Schedule: 5 working days, post-validation week*
*Status: Draft*

## Where We Are

| Metric | SignalBrief | Healthy Benchmark |
|---|---|---|
| Total JS files | 480 | — |
| Source files (src + web) | 244 | — |
| Total LOC (src + web) | 45,595 | — |
| Average file size | 187 LOC | 150–250 is healthy |
| Largest file | 2,107 LOC (`storyline-domain-runtime.js`) | <500 preferred, <1000 tolerable |
| Files >800 LOC | 8 | 0–3 |
| Files ≤15 LOC (shims/barrels) | 11 remaining | 0–5 |
| Contract test files | 208 | — |
| Sidecar test files (co-located) | 36 | Pick one convention, not both |
| Circular dependencies | 0 | 0 |
| TODO/FIXME markers | 0 | <10 |
| process.env reads outside config | 67 | <10 (centralize) |
| Duplicated topic constant sets | 2 | 1 (single source of truth) |
| Hardcoded topic names in source | 12 files | 1–2 (config + normalization) |
| Silent catch blocks | 8 files | 0 |
| Dead shim files | 0 (cleaned today) | 0 |

### What's Already Good

- **Zero circular dependencies.** Module graph is a clean DAG.
- **Zero TODO/FIXME debt.** No markers rotting in the codebase.
- **Clean domain separation.** `src/domains/`, `src/digest/`, `src/platform/`, `src/entrypoints/` are distinct layers with clear responsibilities.
- **Strong test coverage.** 244 test files covering all entrypoints and most runtime modules.
- **Consistent naming.** 92% of source files use the `-runtime.js` suffix.
- **Config-driven behavior.** Digest tuning, editorial overrides, and source registry are all file-backed and hot-reloadable.

### What Needs Work

1. **8 oversized files** (>800 LOC) — the top 5 are 1,300–2,100 lines.
2. **67 scattered `process.env` reads** — no single env config surface.
3. **36 sidecar tests mixed with 208 contract tests** — two conventions, neither enforced.
4. **12 files hardcode topic names** — should flow from one constant.
5. **11 remaining shim/barrel files** — some are load-bearing, some are decorative.
6. **Import path inconsistency** — same module reachable via barrel, shim, or direct path.
7. **No centralized date/time utility** — ad-hoc `new Date()` / `.toISOString()` in 60+ files.
8. **Silent catch blocks** — 8 files swallow errors without logging.

---

## 5-Day Plan

### Day 1 — Constants, Config & Single Source of Truth

**Goal:** Every magic value lives in exactly one place. No file reads `process.env` directly except the config gateway.

#### Task 1.1 — Extract `MVP_TOPIC_TAGS` constant *(~1h)*

`PHASE1_TOPIC_TAGS` is defined in both `standard-topic-broker-runtime.js:14` and `digest-orchestrator-fetch-runtime.js:29`. Twelve other files hardcode individual topic strings.

- [ ] Create `src/platform/config/mvp-topics.js` exporting the canonical `MVP_TOPIC_TAGS` Set and a `isMvpTopic(tag)` predicate.
- [ ] Replace both `PHASE1_TOPIC_TAGS` / `PHASE1_STANDARD_TOPIC_TAGS` definitions with imports from the new module.
- [ ] Grep every file in the "12 files" list above; replace bare `"HEALTHCARE"` etc. with references to the constant or the predicate, wherever the string is used for logic (not display).
- [ ] Update `topic-normalization-runtime.js` to import from the same source.
- [ ] Run `npm test`, `npm run smoke:worker`, `npm run smoke:admin-scheduler`.

#### Task 1.2 — Centralize `process.env` reads *(~2h)*

67 `process.env` reads are scattered across 33 files. Two files already act as gateways: `src/runtime/config-provider.js` (app config) and `web/server-runtime-env-runtime.js` (web env). Everything else should flow through them.

- [ ] Audit the 67 reads. Classify each as: (a) already in a gateway, (b) should move to `config-provider.js`, (c) should move to `server-runtime-env-runtime.js`, (d) is in a script/test and is fine.
- [ ] For each (b)/(c), add the env var to the appropriate gateway and export a named accessor.
- [ ] Replace every direct `process.env.X` in source files with the accessor import.
- [ ] Update `.env.example` with any newly-documented variables.
- [ ] Run full test suite.

#### Task 1.3 — Consolidate timeout/threshold constants *(~30m)*

Five timeout constants are defined inline in five different files:

| Constant | Value | File |
|---|---|---|
| `DEFAULT_PERPLEXITY_TIMEOUT_MS` | 25,000 | `digest-data-fetch-runtime.js` |
| `DEFAULT_ANTHROPIC_TIMEOUT_MS` | 30,000 | `digest-data-enrich-runtime.js` |
| `DEFAULT_TIMEOUT_MS` | 12,000 | `digest-search-evidence-resolver-runtime.js` |
| `DEFAULT_RATE_LIMIT_COOLDOWN_MS` | 1,250 | `digest-orchestrator-fetch-runtime.js` |
| `DEFAULT_RATE_LIMIT_MAX_COOLDOWN_MS` | 20,000 | `digest-orchestrator-fetch-runtime.js` |

- [ ] Create `src/platform/config/provider-defaults.js` with all provider timeout/retry defaults.
- [ ] Import from each consumer file. Keep the env-var override logic in each consumer (it's already clean).
- [ ] Run tests.

---

### Day 2 — Break Up the Big Files

**Goal:** No file exceeds 600 LOC. The 8 files above 800 LOC get split along natural seam lines.

#### Files to split (in priority order):

| File | LOC | Split Strategy |
|---|---|---|
| `storyline-domain-runtime.js` | 2,107 | Extract storyline classification, relationship scoring, and dedup logic into 3 focused modules. The file already has clear section comments. |
| `eval/retrieval/runner-runtime.js` | 1,873 | Extract scenario runner, scoring harness, and report builder. This file is eval-only — no production risk. |
| `digest-orchestrator-core-runtime.js` | 1,780 | Extract audit logging, digest assembly, and email composition into sub-modules. The 47-import count drops naturally. |
| `digest-orchestrator-fetch-runtime.js` | 1,722 | Extract query-pack builder, rate-limit state machine, and broker orchestration. |
| `standard-topic-broker-runtime.js` | 1,324 | Extract best-fit topic assignment, source-family resolution, and feed parsing. |
| `digest-orchestrator-delivery-runtime.js` | 875 | Extract email rendering pipeline from delivery orchestration. |
| `admin-api-users-actions-runtime.js` | 798 | Split user CRUD actions from bulk operations. |
| `admin-source-registry-runtime.js` | 798 | Split source CRUD from source health/scoring. |

#### Approach for each:

- [ ] Read the file. Identify 2–4 natural sections (usually marked by comments or blank-line clusters).
- [ ] Extract each section into a new `-runtime.js` file in the same directory.
- [ ] The original file becomes a thin composition layer that requires and delegates.
- [ ] Move corresponding test assertions to match the new file boundaries.
- [ ] Run `npm test` after each file split (not at the end).

**Day 2 target:** Top 4 files split. Remaining 4 carry to Day 3 morning if needed.

---

### Day 3 — Import Hygiene & Shim Consolidation

**Goal:** One canonical import path per module. No shim that isn't load-bearing.

#### Task 3.1 — Remove remaining dead barrels *(~1h)*

| File | Lines | Consumers | Action |
|---|---|---|---|
| `web/services/shared/index.js` | 13 | 0 | Delete |
| `web/services/user/index.js` | 13 | 0 | Delete |
| `src/digest/application/digest-service-runtime.js` | 7 | 1 (digest.js) | Inline into `digest.js` |
| `web/server/index.js` | 8 | 1 | Rewire consumer, delete |

- [ ] Delete zero-consumer barrels.
- [ ] For 1-consumer barrels, rewire the single consumer to import the real module.
- [ ] Run tests after each deletion.

#### Task 3.2 — Standardize import paths in entrypoints *(~2h)*

`src/entrypoints/digest-orchestrator-core-runtime.js` has 47 imports using 4 different path conventions:
- `../domains/digest` (barrel) — correct
- `../digest/runtime/...` (direct, bypassing barrel) — should use barrel
- `../runtime/...` (compat layer) — some are necessary, some should migrate
- `./digest-orchestrator-*` (siblings) — correct

- [ ] Audit all imports in every `src/entrypoints/digest-orchestrator-*` file.
- [ ] Ensure digest domain functionality is imported via `../domains/digest` barrel, not directly from `../digest/runtime/` or `../digest/domain/`.
- [ ] Where `src/runtime/` files are just re-exporting `src/digest/` or `src/domains/` modules, update imports to use the canonical path and mark the shim for future removal.
- [ ] Run tests.

#### Task 3.3 — Consolidate duplicate shim pairs *(~1h)*

Three live shim pairs remain where the `-runtime.js` and non-`-runtime.js` variant both exist and re-export the same target:

| Shim A | Shim B | Target | Live consumers |
|---|---|---|---|
| `src/runtime/store.js` (6L) | — | `store-core-runtime` | 27+ (keep this one) |
| `src/jobs/digest-runner-runtime.js` (3L) | — | `digest-runner-core-runtime` | 4 (scheduler-worker, server-runtime, test-critical-paths, module-coverage) |

These are load-bearing — keep them but document their role in a comment header.

- [ ] Add a one-line comment to each surviving shim: `// Facade — canonical module is ./target-name`.
- [ ] Run tests.

---

### Day 4 — Test Organization & Error Handling

**Goal:** One test convention, no silent failures.

#### Task 4.1 — Unify test location *(~3h)*

The codebase has 36 sidecar `.test.js` files next to source and 208 in `tests/contracts/`. Both are valid conventions — but running both is confusing and some overlap.

Decision: **Keep sidecar tests for feature-variant regression; move pure module-contract tests to `tests/contracts/`.**

Concretely:
- [ ] Sidecar tests with names like `.deprecatedFieldsRemoved.test.js`, `.emailOnlyMvp.test.js`, `.maxCustomKeywords.test.js` stay in place — they're feature-variant assertions tightly coupled to the source.
- [ ] Sidecar tests that are plain module-shape tests (e.g., `digest-orchestrator-selection-runtime.test.js` in `src/entrypoints/`) should move to `tests/contracts/entrypoints/` if an equivalent doesn't already exist there.
- [ ] Check for duplicated assertions between sidecar and contract tests. Deduplicate.
- [ ] Update `tests/README.md` with the convention rule so future contributors know.
- [ ] Run `npm test`.

#### Task 4.2 — Fix silent catch blocks *(~1h)*

8 files have empty `catch` blocks that swallow errors:

- `src/digest/domain/editorial-overrides-runtime.js`
- `src/runtime/url-normalization-runtime.js`
- `src/runtime/structured-logger-runtime.js`
- `src/digest/runtime/archive-persistence-runtime.js`
- `src/digest/runtime/digest-formatting-ai-generation-runtime.js`
- `src/runtime/digest-tuning-runtime.js`
- (2 more identified in audit)

For each:
- [ ] Read the catch block. Determine if the silence is intentional (e.g., URL parse fallback) or accidental.
- [ ] If intentional, add a comment: `// Intentionally silent: <reason>`.
- [ ] If accidental, add structured logging: `log.warn({ event: "...", error: err.message })`.
- [ ] Run tests.

#### Task 4.3 — Add JSDoc to barrel/platform modules *(~1h)*

11 key modules lack module-level documentation:

- [ ] `src/domains/digest/index.js` — document the aggregation surface and lazy-load pattern.
- [ ] `src/domains/engagement/index.js`
- [ ] `src/domains/scoring/score-candidate.js`
- [ ] `src/platform/config/index.js`
- [ ] `src/platform/scheduler/index.js`
- [ ] `src/platform/mailer/index.js`
- [ ] `src/platform/store/index.js`
- [ ] `src/entrypoints/digest.js` — document as the CLI/script entry point.
- [ ] `src/entrypoints/scheduler-worker.js` — document as the long-running worker entry point.
- [ ] `web/server.js` — document as the web server entry point.
- [ ] `src/runtime/store.js` — document the facade contract.

Each gets a `/** @module ... */` block explaining: what it exports, who should import it, and what the canonical import path is.

---

### Day 5 — Web Layer Cleanup & Polish

**Goal:** Clean web layer organization. Final pass on naming, orphaned files, and documentation.

#### Task 5.1 — Reorganize web/routes into subdirectories *(~2h)*

`web/routes/` has 34 files in a flat directory. Split by API domain:

```
web/routes/
├── admin/          (24 files — admin-api-*.js)
├── core/           (7 files — core-api-*.js)
└── public-static.js (1 file)
```

- [ ] Create `web/routes/admin/` and `web/routes/core/`.
- [ ] Move files. Update all `require()` paths in consumers.
- [ ] Keep `public-static.js` at root (only 1 file, not worth a subdirectory).
- [ ] Update `web/server-runtime-deps-runtime.js` and any other import sites.
- [ ] Run `npm test`, `npm run smoke:worker`, `npm run smoke:admin-scheduler`.

#### Task 5.2 — Clean up orphaned scripts and barrels *(~30m)*

- [ ] Delete `web/services/admin/index.js` — barrel with 5 consumers but only re-exports; rewire consumers to import the real modules.
- [ ] Verify `scripts/dependency-links.mjs` and `scripts/module-linkage.mjs` — either add to `package.json` or delete.
- [ ] Remove any remaining empty directories.

#### Task 5.3 — Formatting fragment consolidation *(~1h)*

Four tiny formatting files in `src/digest/runtime/` compose trivially:

| File | LOC |
|---|---|
| `digest-formatting-topic-display-runtime.js` | 15 |
| `digest-formatting-topic-learning-runtime.js` | 30 |
| `digest-formatting-topic-visual-runtime.js` | ~40 |
| `digest-formatting-topic-runtime.js` | 24 |

- [ ] Merge the first three into `digest-formatting-topic-runtime.js` (the existing compositor).
- [ ] Update all imports.
- [ ] Run tests.

Similarly for the data aggregator:

| File | LOC |
|---|---|
| `digest-data-runtime.js` | 18 |

- [ ] Inline `digest-data-runtime.js` into its single consumer or merge with `digest-data-fetch-runtime.js`.
- [ ] Run tests.

#### Task 5.4 — Final verification pass *(~1h)*

- [ ] Run full `npm test`.
- [ ] Run `npm run smoke:worker`.
- [ ] Run `npm run smoke:admin-scheduler`.
- [ ] Run `npm run qa:harness`.
- [ ] `git grep 'process\.env\.'` — confirm all reads are in config gateways or scripts.
- [ ] `git grep 'PHASE1_TOPIC_TAGS\|PHASE1_STANDARD_TOPIC_TAGS'` — confirm single definition.
- [ ] `git grep 'catch\s*(\s*)\s*{}'` — confirm no empty catches remain.
- [ ] Confirm no file exceeds 600 LOC (except `eval/retrieval/runner-runtime.js` which is eval-only and acceptable at ~600 post-split).
- [ ] Update this document with final metrics vs the table at the top.

---

## Success Criteria

| Metric | Before | After Target |
|---|---|---|
| Files >800 LOC | 8 | 0 |
| Files >600 LOC | 12 | 0–2 (eval-only exceptions) |
| `process.env` reads outside config gateways | 67 | 0 (in src/web source; scripts exempt) |
| Duplicated topic constant definitions | 2 | 1 |
| Files hardcoding topic names | 12 | 2 (config + normalization) |
| Silent catch blocks | 8 | 0 (all documented or replaced with logging) |
| Dead shim/barrel files | 0 | 0 |
| Shim/barrel files ≤15 LOC | 11 | ≤5 (load-bearing only) |
| Test conventions (mixed sidecar + contract) | 2 | 1 clear rule documented |
| Barrel modules without JSDoc | 11 | 0 |
| `web/routes/` flat file count | 34 | 0 (organized into admin/, core/) |
| Formatting fragment files ≤30 LOC | 4 | 1 (merged) |

## Risks and Constraints

- **Import path changes propagate.** Every `require()` rewrite touches the module cache. Run tests after every individual file move, not in batch.
- **Day 2 (big file splits) is the riskiest day.** Splitting a 2,000-line file means touching the test harness, import coverage map, and sidecar tests. Budget extra time.
- **The `domains/digest/index.js` barrel is a load-bearing abstraction.** It lazy-loads `topic-domain-runtime` to avoid a circular dependency. Don't refactor the barrel without understanding the lazy-load pattern first.
- **`standard-topic-broker-runtime.js` is tightly coupled to config JSON structure.** Splitting it requires understanding how `standard-topic-broker-sources.json` is parsed and used.
- **Sidecar tests are discovered by `test-critical-paths.js` via filesystem walk.** Moving them requires updating the discovery logic or the `assert.ok(sidecarTests.length >= 40)` threshold.

## Not In Scope

- Feature work, new functionality, or behavioral changes.
- Database migration (SQLite schema is stable).
- Dependency additions (zero-dep policy remains).
- CI/CD pipeline changes.
- Production deployment or Docker changes.
- Performance optimization (separate concern).
