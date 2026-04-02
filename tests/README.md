# tests/

All tests use the Node.js built-in test runner (`node --test`) with no external test framework dependencies. The dominant pattern is the **contract test**: each file verifies that a production module parses without syntax errors, exports a non-null object or function, and (for more complex modules) exposes the specific named exports and runtime behaviors that the rest of the system depends on. The shared test utility is `test-support/module-contract-helper.js`, which provides three helpers — `assertNodeSyntaxFile`, `assertModuleExports`, and `assertSourceIncludesFile` — used by nearly every file in this directory. Tests that go beyond surface checks exercise behavior directly against a real (but isolated) runtime, using temp directories and in-process stubs rather than mocks.

Sidecar test convention:
- Keep sidecar tests next to source only when they capture tightly-coupled feature variants or regression invariants such as `.deprecatedFieldsRemoved.test.js`, `.emailOnlyMvp.test.js`, `.fixedCountMvp.test.js`, or route-specific behavior toggles.
- Keep module-shape and import-surface assertions in `tests/contracts/`, even when the production module also has sidecar behavior tests.
- When a file is split, move any pure export/syntax assertions with the new module boundary instead of duplicating them in both places.

---

## 1. Entrypoint Contracts

`tests/contracts/entrypoints/` — 21 files

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `entrypoints/` | 2 | Digest entrypoint and scheduler worker startup contracts; checks exported function surfaces and guards against import-time side effects | `src/entrypoints/digest.js`, `src/entrypoints/scheduler-worker.js` |
| `entrypoints/` (runtime) | 2 | Digest data runtime and digest orchestrator runtime module shapes | `src/digest/runtime/digest-data-runtime.js`, `src/entrypoints/digest-orchestrator-runtime.js` |
| `entrypoints/` (orchestrator) | 16 | One file per orchestrator stage: archive, bootstrap, cost, delivery, delivery-ranking, enrichment, fetch, incident, lock, logging, parity-shape, prefilter, schedule, seams, selection, transport | `src/entrypoints/digest-orchestrator-*-runtime.js` |

---

## 2. Harness Contracts

### Cache tests — `tests/contracts/harness/cache/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/cache/` | 6 | Export surface of test-harness cache modules: budget, Claude enrichment, Claude judge, Claude (generic), Perplexity parser, Perplexity IO | `test-harness/cache/cache-budget.js`, `cache-claude*.js`, `cache-perplexity*.js` |

### Config tests — `tests/contracts/harness/config/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/config/` | 1 | Export surface and symbol presence of the test-harness config constants module | `test-harness/config/index.js` |

### Digest domain tests — `tests/contracts/harness/digest/domain/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/digest/domain/` | 2 | Source domain and storyline domain runtime module shapes | `src/digest/domain/source-domain-runtime.js`, `storyline-domain-runtime.js` |

### Digest runtime tests — `tests/contracts/harness/digest/runtime/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/digest/runtime/` | 7 | Export surfaces for data enrichment, fetch, fetch-request, delivery record, item ordering, repeat freshness, and email formatting runtimes | `src/digest/runtime/digest-data-enrich-runtime.js`, `digest-data-fetch-*.js`, `digest-delivery-record-runtime.js`, `digest-formatting-*.js`, `digest-item-ordering-runtime.js`, `repeat-freshness-runtime.js` |

### Digest application tests — `tests/contracts/harness/digest/application/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/digest/application/` | 2 | Digest pipeline seam runtime and digest service runtime export surfaces | `src/digest/application/digest-pipeline-seam-runtime.js`, `digest-service-runtime.js` |

### Domain tests — `tests/contracts/harness/domains/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/domains/` | 3 | Selection domain (export surface + runtime scoring behavior) and topic domain (relevance score calculation with preferred source, policy, and originality signals) | `src/digest/domain/selection-domain-runtime.js`, `topic-domain-runtime.js` |

### Runtime tests — `tests/contracts/harness/runtime/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/runtime/` | 16 | Core platform runtime module surfaces: config provider, digest lock, engagement events, mailer lifecycle, mailer, quality score, runtime types, store adapters (file, SQLite, canary), store record, store (full behavioral contract), structured logger, user contract | `src/runtime/store.js`, `src/runtime/mailer/*.js`, `src/runtime/engagement/*.js`, `src/runtime/structured-logger-runtime.js` |

### Suite tests — `tests/contracts/harness/suites/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/suites/` | 11 | Test harness suite module exports: analysis quality, cross-day freshness, depth control, end-to-end, module coverage (checks-runtime, checks-topic, common, suite), relevance scoring runtimes, and legacy coverage shims pending archive cleanup | `test-harness/suites/*.js`, `test-harness/suites/module-coverage/*.js` |

### Stage tests — `tests/contracts/harness/stages/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/stages/` | 6 | Analytics, dataset (live, offline, shared, and aggregate facade), and suite-runner module export surfaces | `test-harness/stages/dataset.js`, `dataset/live.js`, `dataset/offline.js`, `dataset/shared.js`, `analytics.js`, `suite-runner.js` |

### Script tests — `tests/contracts/harness/scripts/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/scripts/` | 23 | Export surfaces and source-level invariants for deployment, operations, and store migration scripts: backup/restore, CI deploy workflow, production deploy (flag completeness), staging deploy, promotion gate, rollback by SHA, release window guard, Docker/Dockerfile hardening, store canary operations, store dual-read compare, store migration, smoke tests, marketing report, critical path runner, watchdog scheduler, runtime verifier | `scripts/deploy-production.js`, `scripts/deploy-staging-runtime.js`, `scripts/deploy-rollback-by-sha-runtime.js`, `scripts/*.js` |

### Matrix tests — `tests/contracts/harness/matrix/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/matrix/` | 2 | Matrix config and guardrails module export surfaces | `test-harness/matrix/config.js`, `test-harness/matrix/guardrails.js` |

### Persona tests — `tests/contracts/harness/personas/`

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `harness/personas/` | 3 | Canonical persona defs (including core-defs), stress persona defs module export surfaces | `test-harness/personas/personas-canonical*.js`, `personas-stress-defs.js` |

### Harness top-level tests — `tests/contracts/harness/`

| File | What It Tests |
|---|---|
| `coverage-importers.test.js` | Bulk import map that registers all production and test-harness modules for coverage tracking; the `import()` calls inside dead branches seed the coverage mapper without executing |
| `import-coverage-map.test.js` | Expanded version of the same pattern covering legacy worktrees and all current canonical runtime paths |
| `evaluator.test.js` | Evaluator module export surface (`test-harness/runtime/evaluator.js`) |
| `harness-runtime.test.js` | Harness runtime module export surface |
| `matrix-runtime.test.js` | Matrix runtime module export surface |
| `module-coverage-runtime.test.js` | Module coverage runtime export surface |
| `module-coverage.test.contract.test.js` | Module coverage contract test helper export surface |
| `pipeline.test.js` | Pipeline module export surface |
| `replay-eval.test.js` | Replay eval module export surface |
| `replay-runtime.test.js` | Replay runtime module export surface |
| `run-matrix.test.js` | Run-matrix script export surface |

---

## 3. Web API Contracts

`tests/contracts/web-api/` — 59 files total across three levels

### Top-level web-api tests (34 files)

| Group | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| Admin UI surfaces | 9 | Admin stats (delivery, roster, runs), admin UI panels (CEO status, cost outlook, source registry, status actions, digest quality render, runs table, user debug) | `web/index.js`, `web/preferences-*.js`, `web/settings-*.js` |
| Preferences | 5 | Preferences runtime, shared, state runtime, topic runtime, settings runtime — export surfaces and (for some) basic state transitions | `web/preferences-runtime.js`, `web/preferences-state-runtime.js`, `web/preferences-topic-runtime.js`, `web/settings-runtime.js` |
| Archive | 2 | Archive digest stats runtime and archive UI custom tags rendering | `web/routes/core/core-api-archive-runtime.js` |
| Server runtime | 9 | Auth session policy, boundary contracts, dependency registries, deps, logging, request policy, route bootstrap, scheduler control, server utils | `web/server-runtime.js`, `web/server-*.js` |
| Server entrypoint | 1 | Full behavioral contract for `web/server.js`: bootstrap sequence, request delegation, listen port, startup log event | `web/server.js`, `web/server-runtime.js` |
| Admin API payload / actions | 3 | Admin API stats payload shape and users actions runtime | `web/routes/admin/admin-api.js`, `web/services/admin-ops.js` |
| Settings UI | 2 | Settings UI runtime and settings UI topic actions runtime | `web/settings-ui-runtime.js`, `web/settings-ui-topic-actions-runtime.js` |
| Web index | 1 | Web index export surface | `web/index.js` |

### Route handler tests — `tests/contracts/web-api/routes/` (11 files)

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `web-api/routes/` | 11 | Export surfaces for core and admin route modules; behavioral contracts for archive, availability, engagement, health, unsubscribe, source registry, admin email messaging, and legacy bookmark-removal routes | `web/routes/core/core-api.js`, `web/routes/admin/admin-api.js`, `web/routes/public-static.js`, `web/routes/core/core-api-*-runtime.js`, `web/routes/admin/admin-api-source-registry-runtime.js`, `web/routes/admin/admin-api-message-actions-runtime.js` |

### Service tests — `tests/contracts/web-api/services/` (15 files)

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `web-api/services/` | 14 | Behavioral and export contracts for web services: admin-ops (cost log, heartbeat, action log), admin-ops analytics/scheduler/utils, admin digest insights, admin recent digests export, admin source registry, admin stats costs forecast, archive scoring, delivery schedule, request metadata, topic normalization, rate limiter, user handlers | `web/services/admin-ops*.js`, `web/services/archive-scoring.js`, `web/services/delivery-schedule.js`, `web/services/request-metadata.js`, `web/services/web-rate-limit.js`, `web/services/web-user-handlers.js` |

---

## 4. Job Contracts

`tests/contracts/jobs/` — 3 files

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `jobs/` | 3 | Digest runner (export surface), digest runner runtime, and digest runner core runtime export surfaces | `src/jobs/digest-runner-runtime.js`, `src/jobs/digest-runner-core-runtime.js` |

---

## 5. Runtime Contracts

`tests/contracts/runtime/` — 3 files

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `runtime/` | 3 | Preferred source registry runtime (full behavioral contract: domain shortlisting, subdomain matching, publisher identity matching, bundled fallback), runtime state paths, and source policy registry | `src/runtime/preferred-source-registry-runtime.js`, `src/runtime/runtime-state-paths-runtime.js`, `src/runtime/source-policy-registry-runtime.js` |

---

## 6. Template Contracts

`tests/contracts/templates/` — 1 file

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `templates/` | 1 | Structural invariants of `templates/email.html`: card width (720px), wrapper padding, and inline style consistency | `templates/email.html` |

---

## 7. Script Contracts

`tests/contracts/scripts/` — 1 file

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `scripts/` | 1 | Export surface of the `scripts/migrate-runtime-state-root.js` migration script | `scripts/migrate-runtime-state-root.js` |

---

## 8. Web Services Contracts

`tests/contracts/web-services/` — 1 file

| Directory | File Count | What It Tests | Key Dependencies |
|---|---|---|---|
| `web-services/` | 1 | Runtime state module export surface (separate from the main web-api group) | `web/services/runtime-state-runtime.js` |

---

## 9. Fixtures

`tests/fixtures/` — not test files

| Path | Contents |
|---|---|
| `fixtures/replay/` | One JSON file (`kushgulati29-march-10-13.json`) containing a recorded digest run used by the replay harness |
| `fixtures/store-dual-read/data/` | Three JSON user records (`user-alpha.json`, `user-bravo.json`, `user-charlie.json`) used by store dual-read comparison tests |

---

## 10. Top-level Contracts

`tests/contracts/` — 1 file

| File | What It Tests |
|---|---|
| `start-script-logging.test.js` | Verifies that `start.sh` contains the required structured logging primitives (`log_event`, `run_id`, `provider`, `outcome` fields) |
