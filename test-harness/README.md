# test-harness

The test harness is a QA framework for evaluating reduced-scope SignalBrief digest quality across a defined set of personas, running scored test suites that cover topic matching, relevance ranking, analysis quality, diversity, depth control, item count, cross-day freshness, end-to-end composite scoring, and module-level smoke checks. It supports both live API runs (Perplexity + Claude) and fully cached/offline execution, with a persistent budget ledger to cap spending across runs.

---

## Entry Points

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `run-tests.js` | CLI entry point for a single harness run; delegates to `runtime/harness-runtime.js` | Exit code; console report printed by `stages/reporting.js` | `runtime/harness-runtime` |
| `run-matrix.js` | CLI entry point for a multi-window matrix run; delegates to `runtime/matrix-runtime.js` | `test-results/matrix-<runId>.json`; console summary | `runtime/matrix-runtime` |
| `replay-eval.js` | CLI entry point for replaying archived digest snapshots through editorial signal checks | `test-results/replay/<runId>.json` | `runtime/replay-runtime` |

---

## Config (`config/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `config/index.js` | Barrel that re-exports all constants, I/O helpers, and `parseArgs` as a single surface | — | `config-constants`, `config-io`, `config-args` |
| `config/config-constants.js` | Central constants: directory paths, `BUDGET_CAP_USD` ($20), per-call cost rates, judge model names, confidence gate thresholds, matrix defaults, suite IDs, composite weights, and utility functions `toEtDateKey` / `sanitizeCacheKey` | — | `node:path` |
| `config/config-io.js` | File-system helpers: `ensureHarnessPaths` creates `test-results/` subdirs; `readJson` / `writeJson` for safe JSON I/O; `loadAppConfig` reads repo-root `config.json` | Created directories; parsed JSON objects | `node:fs`, `node:path`, `config-constants` |
| `config/config-args.js` | Parses `process.argv` into a structured args object with defaults; enforces flag compatibility rules (e.g. `--refresh-cache` requires `--live`, `--deterministic` forbids `--live`) | `args` object | `config-constants`, `config-args-rules` |
| `config/config-args-rules.js` | Low-level flag parsers: builds exact-flag handlers (booleans like `--live`, `--no-judge`) and prefix-value handlers (`--suite=`, `--judge-model=`, `--max-analysis-samples=`, `--date-key=`, etc.) | Handler maps consumed by `config-args` | `config-constants` |

---

## Caching (`cache/`)

All cache modules read from and write to `test-results/cache/` (Perplexity under `perplexity/`, Claude under `claude/`). Live API calls are only made when `allowLiveApi` is true and no valid cache file exists.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `cache/index.js` | Barrel re-exporting the public cache surface | — | `cache-common`, `cache-budget`, `cache-perplexity`, `cache-claude`, `cache-archive` |
| `cache/cache-common.js` | Shared low-level utilities: `stableHash` (SHA-256 truncated to 16 hex chars), `sendHttpPostRequest` / `httpsPostWithRetry` (HTTPS POST with retry and timeout), `parseJsonArrayLenient` / `parseJsonObjectLenient` (strip markdown fences then parse, with bracket-balanced fallback), `qaDebug` (gated on `QA_DEBUG=1`) | — | `node:https`, `node:crypto` |
| `cache/cache-budget.js` | Budget ledger: `loadBudget` / `saveBudget` read and write `test-results/budget.json`; `ensureBudget` throws if remaining < estimate; `recordBudgetCall` appends a call entry and deducts cost; `estimateClaudeCost` computes token-based cost from model rate card | `test-results/budget.json` (mutated) | `config`, `config-io` |
| `cache/cache-perplexity.js` | `fetchTopicNewsCached`: checks cache file for a topic+date key, falls back to a stale file, or calls Perplexity's `/chat/completions` (model: sonar) when live API is allowed; writes result JSON and records budget entry | `test-results/cache/perplexity/<topic>_<date>.json` | `config`, `cache-common`, `cache-budget`, `cache-perplexity-parser`, `cache-perplexity-io`, Perplexity API |
| `cache/cache-perplexity-parser.js` | `parsePerplexityItems`: extracts item array from Perplexity response body, normalizes fields, and upgrades homepage URLs to article URLs using the citations list; `buildPerplexityPayload`: constructs the sonar chat payload with editorial system prompt | — | `cache-common` (`qaDebug`) |
| `cache/cache-perplexity-io.js` | `findLatestTopicCacheFile`: scans `CACHE_PERPLEXITY_DIR` for the newest file matching a topic prefix; `tryPerplexityCacheFallback`: reads a cache file and returns a normalized result object | — | `node:fs`, `node:path`, `config` |
| `cache/cache-claude.js` | Thin facade combining `enrichItemsCached` and `judgeWithClaudeCached` in one export | — | `cache-claude-enrich`, `cache-claude-judge` |
| `cache/cache-claude-judge.js` | Public facade for `judgeWithClaudeCached`; delegates to `cache-claude-judge-core` | — | `cache-claude-judge-core` |
| `cache/cache-claude-judge-core.js` | Core implementation of `judgeWithClaudeCached`: builds a SHA-256 cache key from `{kind, payload, prompt, maxTokens, model}`, checks `test-results/cache/claude/judge_<kind>_<hash>.json`, calls Anthropic's `/v1/messages` when live, writes result, and records budget entry | `test-results/cache/claude/judge_<kind>_<hash>.json` | `config`, `cache-common`, `cache-budget`, `cache-claude-judge-io`, Anthropic API |
| `cache/cache-claude-judge-io.js` | `buildJudgeCacheFile` (key construction), `readJudgeCache` (read + normalize hit), `writeJudgeCache` (persist full response + parsed result) | — | `node:fs`, `node:path`, `config`, `cache-common` |
| `cache/cache-claude-enrich.js` | Public facade for `enrichItemsCached`; delegates to `cache-claude-enrich-core` | — | `cache-claude-enrich-core` |
| `cache/cache-claude-enrich-core.js` | Core implementation of `enrichItemsCached`: hashes `{type, model, prompt_version, prompt, items}` to build cache key, checks `test-results/cache/claude/enrichment_<hash>.json`, calls Anthropic when live, parses enriched item array, records budget entry | `test-results/cache/claude/enrichment_<hash>.json` | `config`, `cache-common`, `cache-budget`, `cache-claude-enrichment`, `cache-claude-enrich-io`, Anthropic API |
| `cache/cache-claude-enrich-io.js` | `buildEnrichmentCacheFile` (key + path), `readEnrichmentCache` (read + normalize), `writeEnrichmentCache` (persist) | — | `node:fs`, `node:path`, `config`, `cache-common`, `cache-claude-enrichment` |
| `cache/cache-claude-enrichment.js` | Editorial enrichment prompt template (`ENRICH_PROMPT_VERSION`) and `buildEnrichmentPrompt` / `mapEnrichedItems`; defines the `wim_brief`, `wim`, `baseScore`, `implications`, and `watch_next` field contract | — | — |
| `cache/cache-archive.js` | `loadArchiveDigests`: reads all `YYYY-MM-DD.json` files from a directory (sorted), returns parsed array; used to load the `archive/` folder for offline fallback and cross-day dedup | — | `node:fs`, `node:path`, `cache-common` (`qaDebug`) |

---

## Core Runtime (`runtime/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `runtime/pipeline.js` | Wraps `src/domains/digest` functions as the harness-side digest pipeline: `buildDigestForPersona`, `selectItems`, `applyRelevanceScores`, `filterItemsForPersona`, `applyDepth`, `reserveCustomKeywordSlot`, `countAdjacencyViolations`, `tagDistribution`, `jaccardSimilarity`, `statusFromScore`, plus re-exports of all policy factories | Digest result objects consumed by suite runners | `src/domains/digest` |
| `runtime/evaluator.js` | Statistical primitives and LLM judge dispatcher: `mean`, `percentile`, `bootstrapMeanCI`, `spearmanCorrelation`, `wordCount`, `sentenceCount`, `readingGradeLevel`, `heuristicAnalysisScore`, `judgeAnalysisSample`, `judgeDepthPair`, `judgePairwiseComparison`, `buildEvaluator` (binds all judges to a deps object) | Evaluator object; score/judgement objects | `cache` (`judgeWithClaudeCached`), Anthropic API (when `--live` and `!--no-judge`) |
| `runtime/harness-runtime.js` | Orchestrates a full single harness run: parse args, load config + budget + personas, run dataset stage, run suite runner stage, run analytics stage, run reporting stage | Run result object with `report`, `dataset`, `rolling`, `budget`; files written by downstream stages | `config`, `cache`, `stages/*`, `runtime/personas`, `runtime/evaluator` |
| `runtime/matrix-runtime.js` | Orchestrates a multi-window matrix run: parse CLI, load matrix config, build window plan, loop `runHarness` per window, track stall/hard-fail/pass-streak guardrails, write `test-results/matrix-<runId>.json` | `test-results/matrix-<runId>.json` | `config`, `matrix/*`, `run-tests` |
| `runtime/replay-runtime.js` | Replays archived digest snapshots through editorial signal checks (duplicate detection, weak item rate, storyline clustering, entity saturation); writes per-run report to `test-results/replay/` | `test-results/replay/<runId>.json` | `config`, `src/domains/digest`, `src/runtime/engagement-events`, `src/runtime/url-normalization-runtime`, `stages/dataset/shared` |
| `runtime/personas.js` | `buildPersonas(topicUniverse, opts)`: composes canonical + stress persona arrays; re-exports topic constants | Persona array | `personas/persona-topics`, `personas/personas-canonical`, `personas/personas-stress` |

---

## Matrix Execution (`matrix/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `matrix/config.js` | CLI parser (`parseCli`), `loadMatrixConfig` (reads JSON file or returns defaults), `buildWindowPlan` (generates day/daypart window array), `buildWindowArgs` (assembles per-window argv from plan + passthrough), numeric helpers | Window plan array; per-window argv arrays | `config`, `node:path` |
| `matrix/guardrails.js` | Suite-pass checks, signature fingerprinting (`buildOpenSignature`), improvement log I/O (`readImprovementLogEntries` / `writeImprovementLogEntries`), `appendSignatureAck`, `hasAcknowledgedSignature`, `isCertificationPathRecoverable` | `test-results/improvement-log.json` (mutated) | `config` |
| `matrix/window-execution-runtime.js` | Public facade for `executeMatrixWindows` and `buildMatrixSummary`; delegates to `window-execution-core-runtime` | — | `matrix/window-execution-core-runtime` |
| `matrix/window-execution-core-runtime.js` | Core matrix loop: iterates the window plan calling `runHarness` per window, tracks stall count / hard-fail streak / pass-tail streak, applies guardrail assertions, accumulates `runRows` | `runRows` array; `passTailStreak` count | `run-tests`, `matrix/config`, `matrix/guardrails`, `matrix/window-execution-steps-runtime` |
| `matrix/window-execution-steps-runtime.js` | `buildRunRow` (shapes a single window result into a summary row), `assertGuardrails` (throws on stall/hard-fail/unrecoverable path violations with actionable error messages) | Row object | `matrix/guardrails` |

---

## Personas (`personas/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `personas/personas-canonical.js` | `buildCanonicalPersonas(allTopics)`: maps canonical specs through `basePersona` factory | Canonical persona array | `personas/persona-factory`, `personas/personas-canonical-defs` |
| `personas/persona-factory.js` | `basePersona(id, name, purpose, overrides)`: constructs a full persona object with QA token (`sha256("qa-persona:<id}")`), default preferences, and merged overrides | Persona object | `node:crypto`, `personas/persona-topics` |
| `personas/persona-topics.js` | Defines `INDUSTRY_TOPICS` (10 tags), `CAPABILITY_TOPICS` (7 tags), and `DEFAULT_TOPICS` (combined 17-tag array) | Topic arrays | — |
| `personas/personas-canonical-defs.js` | `buildCanonicalPersonaSpecs`: combines core canonical + depth specs | Spec array | `canonical/personas-core-defs`, `canonical/personas-depth-defs` |
| `personas/personas-stress-defs.js` | `buildStressPersonaSpecs`: combines focus + custom + distribution stress specs | Spec array | `stress/personas-stress-focus-defs`, `stress/personas-stress-custom-defs`, `stress/personas-stress-distribution-defs` |
| `personas/canonical/personas-core-defs.js` | Thin wrapper delegating to `personas-core-defs-core` | — | `canonical/personas-core-defs-core` |
| `personas/canonical/personas-core-defs-core.js` | `buildCoreCanonicalPersonaSpecs(allTopics)`: generalist, fresh_subscriber (dynamic from allTopics), plus all static core specs | Core canonical spec array | `canonical/personas-core-static-defs` |
| `personas/canonical/personas-core-static-defs.js` | Six static persona specs: specialist (HEALTHCARE-only), pe_deal_hunter, custom_keyword (GLP-1 / DOGE / quantum), minimalist (brief depth), conflicting (negative weights), weight_tweaker (wide weight spread) | Static spec array | — |
| `personas/canonical/personas-depth-defs.js` | Two depth-pair personas: depth_a (`headline_plus_oneliner`) and depth_b (`headline_plus_why`) across reduced-scope MVP topics | Depth spec array | — |
| `personas/stress/personas-stress-custom-defs.js` | Three stress personas with heavy custom-topic loads: stress_custom_biopharma (GLP-1 / obesity / medtech), stress_custom_macro (rate cuts / SEC / DOGE), stress_custom_quantum (quantum / agentic AI / semicap) | Stress spec array | — |
| `personas/stress/personas-stress-distribution-defs.js` | Seven distribution stress personas: two low-item-count brief users, two high-item-count generalists (forward and reverse topic order), negative-weights mix, positive-spike mix, sparse three-topic deep reader | Stress spec array | — |
| `personas/stress/personas-stress-focus-defs.js` | Five single-focus or contradictory-weight stress personas: ultra_healthcare, ultra_ai, ultra_policy (all single-topic max weight), stress_conflict_ai_vs_tech, stress_conflict_pe_vs_fs | Stress spec array | — |

---

## Test Suites (`suites/`)

### Suite Entry Points

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `suites/01-topic-matching.js` | Checks that every delivered item matches at least one of the persona's topics; computes per-persona match rate and global leak rate; fails if leak rate exceeds `CONFIDENCE_GATES.topic_leak_rate_max` | Suite result object | `runtime/pipeline`, `runtime/evaluator` |
| `suites/02-relevance-scoring.js` | Delegates to `relevance-scoring-runtime`; validates that topic-weight signals correlate with relevance rank order (Spearman >= `CONFIDENCE_GATES.tweaker_spearman_min`) and checks for relevance anomalies | Suite result object | `suites/relevance-scoring-runtime` |
| `suites/03-analysis-quality.js` | Delegates to `analysis-quality-runtime`; samples `wim` fields and judges them via Claude (or heuristic fallback); checks mean >= `analysis_mean_min` and p25 >= `analysis_p25_min` | Suite result object | `suites/analysis-quality-runtime` |
| `suites/04-diversity.js` | Checks tag diversity and adjacency violations per persona; scores based on unique-tag ratio and absence of same-tag adjacent pairs | Suite result object | `runtime/pipeline`, `runtime/evaluator` |
| `suites/06-depth-control.js` | Delegates to `depth-control-runtime`; judges brief vs deep depth-pair personas via Claude; checks `insight_gain` >= `depth_insight_min` and padding rate <= `depth_padding_max` | Suite result object | `suites/depth-control-runtime` |
| `suites/07-item-count.js` | Verifies each persona's delivered count matches requested count (capped by available items); flags under-delivery | Suite result object | `runtime/pipeline`, `runtime/evaluator` |
| `suites/08-cross-day-freshness.js` | Delegates to `cross-day-freshness-runtime`; computes Jaccard similarity between current and archived digest snapshots; fails if overlap exceeds `freshness_overlap_max` | Suite result object | `suites/cross-day-freshness-runtime` |
| `suites/09-end-to-end.js` | Delegates to `end-to-end-runtime`; computes weighted composite score across topic-matching, relevance-scoring, analysis-quality, diversity, and custom-topics suites using `COMPOSITE_WEIGHTS` | Suite result object | `suites/end-to-end-runtime` |
| `suites/10-module-coverage.js` | Delegates to `module-coverage/suite`; runs synchronous smoke checks against topic utilities and runtime safety functions | Suite result object | `suites/module-coverage/suite` |

### Suite Runtime Variants

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `suites/relevance-scoring-runtime.js` | `runRelevanceScoringSuite`: builds relevance rows per persona, computes Spearman correlation between weights and scores for weight_tweaker persona, checks anomaly rate across all personas | Suite result object | `runtime/pipeline`, `runtime/evaluator` |
| `suites/analysis-quality-runtime.js` | `runAnalysisQualitySuite`: collects `wim` candidates from pre-depth items, samples up to `max_analysis_samples`, calls `evaluator.judgeAnalysisSample` per sample, aggregates mean/p25 scores | Suite result object | `runtime/pipeline`, `runtime/evaluator` |
| `suites/depth-control-runtime.js` | `runDepthControlSuite`: pairs depth_a and depth_b persona digests, calls `evaluator.judgeDepthPair` for matched items, checks insight_gain and padding rate | Suite result object | `runtime/pipeline`, `runtime/evaluator` |
| `suites/cross-day-freshness-runtime.js` | `runCrossDayFreshnessSuite`: compares current digest URL sets against archive snapshots using Jaccard similarity; tracks freshness snapshots up to `freshness_max_snapshots` | Suite result object | `node:fs`, `node:path`, `runtime/pipeline` |
| `suites/end-to-end-runtime.js` | `runEndToEndSuite`: reads per-persona scores from the other four weighted suites, computes composite per persona and overall average using `COMPOSITE_WEIGHTS` | Suite result object | `runtime/evaluator`, `config` |

### Module Coverage (`suites/module-coverage/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `suites/module-coverage/suite.js` | `runModuleCoverageSuite`: runs all topic/pipeline checks and runtime safety checks, passes results to `buildModuleCoverageResult` | Suite result object | `module-coverage/common`, `module-coverage/checks-topic`, `module-coverage/checks-runtime` |
| `suites/module-coverage/common.js` | `check(name, fn)` wrapper (catches errors); `buildModuleCoverageResult` shapes check results into a scored suite object | Suite result object | — |
| `suites/module-coverage/checks-runtime.js` | Thin facade delegating to `checks-core-runtime` | — | `module-coverage/checks-core-runtime` |
| `suites/module-coverage/checks-core-runtime.js` | `buildRuntimeSafetyChecks`: composes four runtime checks from `checks-runtime-cases` | Check array | `module-coverage/checks-runtime-cases` |
| `suites/module-coverage/checks-runtime-cases.js` | Runtime smoke checks: reduced-scope default user shape, engagement-event timestamp filtering, and legacy-field stripping in user normalization | Check results | `node:fs`, `node:os`, `node:path`, `src/runtime/engagement/engagement-events-runtime`, `src/runtime/user-contract-runtime` |
| `suites/module-coverage/checks-topic.js` | `buildTopicAndPipelineChecks`: exercises `normalizeTopicToken`, `normalizeCustomKeyword`, `CUSTOM_TOPIC_ALIASES`, pipeline relevance wrapper vs topic-domain scorer, and marketing weekly report script | Check results | `utils/topic-utils`, `runtime/pipeline`, `src/digest/domain/topic-domain-runtime`, `scripts/marketing-weekly-report` |

---

## Stages (`stages/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `stages/dataset.js` | `runDatasetStage`: orchestrates dataset assembly — loads archives, attempts live/cached build, falls back to offline on error if `--offline`; builds `recentRepeatIndex` from archives | `{dataset, archives, recentRepeatIndex}` | `config`, `cache`, `stages/dataset/shared`, `stages/dataset/offline`, `stages/dataset/live` |
| `stages/dataset/live.js` | Public facade delegating to `live-core` | — | `stages/dataset/live-core` |
| `stages/dataset/live-core.js` | `buildLiveOrCachedDataset`: orchestrates fetch → selection → enrichment → summary; computes `dateKey` (ET date); runs standard-topic retrieval, selects and deduplicates items, and enriches via Claude | Dataset result object | `config`, `stages/dataset/live-fetch`, `stages/dataset/live-selection`, `stages/dataset/live-enrichment`, `stages/dataset/live-summary`, `stages/dataset/shared` |
| `stages/dataset/live-fetch.js` | `fetchStandardTopicItems`: loops config topics calling `fetchTopicNewsCached`; reduced-scope harness runs are standard-topic only | Per-topic item arrays | `config`, `cache`, `utils/topic-utils`, `stages/dataset/shared`, Perplexity API |
| `stages/dataset/live-selection.js` | `selectLiveDatasetItems`: merges standard + custom items, deduplicates against recent archives, applies selection policy (custom cap, per-source cap, max items) | Selection result with `selectedItems`, `selectionPolicy`, dedup stats | `runtime/pipeline`, `utils/topic-utils`, `stages/dataset/shared` |
| `stages/dataset/live-enrichment.js` | `enrichLiveDatasetItems`: calls `enrichItemsCached` on selected items; on cache-miss without live API, returns items with null enrichment fields rather than throwing | Enrichment result | `config`, `cache`, `stages/dataset/shared`, Anthropic API |
| `stages/dataset/live-summary.js` | `buildLiveDatasetMetadata` and `buildLiveDatasetResult`: shape the fetch/selection/enrichment results into the final dataset object with metadata | Dataset result object | — |
| `stages/dataset/offline.js` | `buildOfflineDatasetFromArchives`: merges items from the N most recent archive files (URL-deduped, newest wins), throws if no archives exist | Offline dataset object | `config`, `stages/dataset/shared` |
| `stages/dataset/shared.js` | Shared helpers: `syncBudget`, `standardTopicUniverse`, `collectCustomTopics`, `maxRequestedItems`, `buildRecentRepeatIndexFromArchives`, `dedupAgainstRecentArchivesForDataset`, `mapArchiveItem` | Various helpers | `utils/topic-utils`, `src/digest/domain/repeat-dedup-domain-runtime` |
| `stages/suite-runner.js` | `runSuiteRunnerStage`: selects suites per `--suite=` filter, builds runtime context (digest policies + evaluator), runs each suite in sequence, computes composite summary | `{suiteResults, compositeSummary, compositeScoresByPersona}` | `config`, `runtime/pipeline`, all `suites/` modules |
| `stages/analytics.js` | `runAnalyticsStage`: extracts evidence file references from suite results, computes per-suite sample sizes and bootstrap confidence intervals, identifies improvement priorities, checks regression against baseline run | `{sampleSizes, confidence, improvementPriorities, regressionAgainstBaseline}` | `node:fs`, `node:path`, `config` |
| `stages/reporting.js` | `runReportingStage`: writes dataset snapshots, calls console reporter, writes run report JSON and rolling summary JSON | `test-results/run-<runId>.json`, `test-results/rolling.json`, `test-results/dataset-latest.json`, `test-results/datasets/dataset-<runId>.json` | `node:fs`, `node:path`, `config`, `reporters/console`, `reporters/json` |

---

## Reporters (`reporters/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `reporters/console.js` | `printConsoleReport`: prints a fixed-width ASCII table of suite scores and statuses, budget spent/remaining, composite average, and rolling trend to stdout | Console output | — |
| `reporters/json.js` | `writeRunReport`: serializes all suite results, budget, confidence, regression, and persona scores to a timestamped JSON file; `writeRollingSummary`: appends the run to a rolling history array | `test-results/run-<runId>.json`, `test-results/rolling.json` | `node:fs`, `node:path`, `config` |

---

## Utilities

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `chaos-user.js` | Standalone script that spins up the web server on a configurable port (default 3996), simulates a sequence of user API actions (register, configure topics, request digest, adjust preferences) against the live stack, then tears down and optionally removes temp data | Console log of each chaos step; exit code | `node:fs`, `node:os`, `node:path`, `node:child_process`, `web/server.js` |
| `evaluator.js` | Root-level shim re-exporting `runtime/evaluator` | — | `runtime/evaluator` |
| `topic-utils.js` | Root-level shim re-exporting `utils/topic-utils` | — | `utils/topic-utils` |
| `utils/topic-utils.js` | Re-exports `normalizeMatchText`, `normalizeTopicToken`, `normalizeCustomKeyword`, `CUSTOM_TOPIC_ALIASES`, and `buildCustomTopicQueries` from the canonical topic domain module | — | `src/digest/domain/topic-domain-runtime` |
