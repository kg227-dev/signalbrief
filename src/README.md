# src/

`src/` contains the core application logic, organized into canonical domain facades (`domains/`), platform adapters (`platform/`), entrypoints, and runtime implementations. All runtime modules are Node.js stdlib-only; no npm dependencies are used inside this directory.

---

## 1. Entrypoints (`entrypoints/`)

Top-level process entry and the digest orchestrator broken into focused sub-modules.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `entrypoints/digest.js` | CLI entrypoint for the digest pipeline; delegates immediately to `digest-orchestrator-runtime` | Re-exports `digest-service-runtime` surface plus `main`/`runCli` | `./digest-orchestrator-runtime`, `../digest/application/digest-service-runtime` |
| `entrypoints/digest-runtime.js` | Thin re-export shim keeping the legacy `digest-runtime` import path alive | Re-exports `digest-orchestrator-runtime` | `./digest-orchestrator-runtime` |
| `entrypoints/scheduler-worker.js` | Cron-style daemon that fires `digest-runner-runtime` on a configurable interval; writes a heartbeat file; handles restart requests via a control file | Heartbeat JSON at `schedulerHeartbeatPath`; exits `0` on restart request | `node:fs`, `node:path`, `../runtime/runtime-state-paths-runtime`, `../jobs/digest-runner-runtime`, `DIGEST_POLL_MS`, `DIGEST_RUN_ON_STARTUP`, `DIGEST_RUN_TIMEOUT_MS`, `DIGEST_WORKER_ARGS`, `DIGEST_STARTUP_DELAY_MS`, `DIGEST_LOCK_UNHEALTHY_BLOCK_THRESHOLD` |
| `entrypoints/digest-orchestrator-runtime.js` | Root orchestrator facade; loads config and email template, asserts the pipeline seam, then delegates to `digest-orchestrator-core-runtime` | Re-exports all `core-runtime` symbols | `node:fs`, `node:path`, `../runtime/config-provider`, `../digest/application/digest-pipeline-seam-runtime`, `./digest-orchestrator-core-runtime`, `BASE_URL` |
| `entrypoints/digest-orchestrator-core-runtime.js` | Wires all orchestrator sub-runtimes together; implements `main()` and `runCli()`; drives the full per-run pipeline (lock, bootstrap, schedule, fetch, select, enrich, delivery, archive, cost) | Digest emails sent, archive written, optional ops incidents emitted; exit code | All orchestrator sub-modules below; `../domains/*`, `../platform/*`, `../runtime/*` |
| `entrypoints/digest-orchestrator-archive-runtime.js` | Persists the shared enriched item list to the archive after a run | `quickScan` string; calls `saveToArchive` | Injected `saveToArchive` dep |
| `entrypoints/digest-orchestrator-bootstrap-runtime.js` | One-time process setup: calls `initStore` and registers `exit`/signal handlers to release the digest lock | Side-effects only | Injected `initStore`, `releaseDigestLock` |
| `entrypoints/digest-orchestrator-cost-runtime.js` | Calculates per-run API spend (Perplexity calls + Claude token usage) | `{ perplexityCalls, perplexityCost, claudeCost, totalCost }` | No external deps; constants `DEFAULT_PERPLEXITY_COST_PER_CALL`, `DEFAULT_CLAUDE_HAIKU_*` |
| `entrypoints/digest-orchestrator-delivery-ranking-runtime.js` | Retrieval-eval support runtime for ranked candidate analysis; not part of the scheduled delivery path | Ranked candidate array for eval scenarios | `../digest/runtime/repeat-freshness-runtime`, `../digest/domain/storyline-domain-runtime` |
| `entrypoints/digest-orchestrator-delivery-runtime.js` | Scheduled email delivery loop: delivers deterministic per-topic buckets, records engagement, and updates delivery records | Email sent per user | `../runtime/digest-delivery-policy-runtime`, injected transport and formatting deps |
| `entrypoints/digest-orchestrator-enrichment-runtime.js` | Calls `enrichItems` on selected candidates; emits a degradation incident if the AI provider downgrades | Enriched item array + `claudeUsage` token counts | Injected `enrichItems`, `emitDigestIncident` |
| `entrypoints/digest-orchestrator-fetch-runtime.js` | Orchestrates standard-topic retrieval with broker/direct-feed-first behavior, preferred-domain shortlists, and fetch diagnostics | `{ selectionTarget, tagPriority, allItems, fetchDiagnostics, … }` | Injected `fetchTopicNews`, `buildPreferredDomainShortlist`, `emitDigestIncident` |
| `entrypoints/digest-orchestrator-incident-runtime.js` | Appends JSONL incident log entries and optionally fires an ops alert to the configured incident transport | Side-effects: file append + optional ops alert | `node:fs`, `node:path`, injected `sendOpsAlert`, `formatEtDateKey` |
| `entrypoints/digest-orchestrator-lock-runtime.js` | Acquires and releases the run-level digest lock file; guards against concurrent digest processes | Lock file at `lockFilePath`; `lockOwned` flag | `node:fs`, `node:path`, `../runtime/digest-lock-runtime` (injected) |
| `entrypoints/digest-orchestrator-pipeline-runtime.js` | Item selection and storyline pool helpers used inside the orchestrator core | `selectItems()` result; filtered storyline pool | `../domains/digest` |
| `entrypoints/digest-orchestrator-schedule-runtime.js` | Resolves which users are due for a digest right now based on their delivery-time preferences and ET clock | Array of due user records | Injected `getEtNow`, `getEtNowParts`, `allUsers`, `USER_STATUS`, `CONFIG` |
| `entrypoints/digest-orchestrator-selection-runtime.js` | Deduplicates raw items against recent archives, applies age filter, and selects candidates for enrichment | Filtered and selected item array | Injected `createDigestPolicies`, `dedupAgainstRecentArchives`, `buildRecentRepeatIndex`, `articleAgeTooOld`, `emitDigestIncident` |
| `entrypoints/digest-orchestrator-time-runtime.js` | ET timezone helpers: `getEtNow()`, `getEtNowParts()`, `toEtDateString()`, weekday lookup | Date/time values in Eastern Time | `node:Intl` (stdlib) |
| `entrypoints/digest-orchestrator-transport-runtime.js` | HTTP retry wrapper (`httpsPostWithRetry`) shared by Perplexity and Anthropic callers | Resolves `{ status, body }` with configurable retries | `node:https` |

---

## 2. Jobs (`jobs/`)

Long-running and spawned background work.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `jobs/digest-runner-runtime.js` | Public facade for the digest job runtime | Re-exports all core symbols | `./digest-runner-core-runtime` |
| `jobs/digest-runner-core-runtime.js` | Core digest-trigger logic: checks/clears stale locks, starts or runs `digest.js`, and normalizes runner health outcomes for the scheduler/admin surfaces | `{ ok, exitCode, signal, busy, lockUnhealthy, … }` | `node:path`, `../runtime/digest-lock-runtime`, `./digest-runner-utils-runtime`, `./digest-runner-spawn-runtime`, `../runtime/runtime-state-paths-runtime` |
| `jobs/digest-runner-spawn-runtime.js` | Spawns `digest.js` with sanitized args and trigger env vars; streams stdout/stderr to the caller; resolves when the child exits | Resolves `{ code, signal }` | `node:child_process` (`spawn`) |
| `jobs/digest-runner-utils-runtime.js` | Tiny shared helpers: `toPositiveIntOrDefault`, `sleep` | Scalar values / Promise | None |

---

## 3. Digest — Domain (`digest/domain/`)

Pure business-logic modules with no I/O.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/domain/digest-policy-domain-runtime.js` | Creates `SelectionPolicy` and `RankingPolicy` value objects from raw config; enforces per-tag and per-source caps plus tag priority | Policy objects | None |
| `digest/domain/repeat-dedup-domain-runtime.js` | Builds a cross-day repeat index (URL keys, headline fingerprints, storyline keys, freshness keys); tests items against it | `RepeatIndex`; boolean `isRepeatedItem`; deduped array | `./topic-domain-runtime`, `../../runtime/url-normalization-runtime` |
| `digest/domain/selection-domain-runtime.js` | Selects up to N items from a pool while enforcing per-tag and per-source caps; deduplicates candidates using pluggable adapters | Ordered selected item array | `./digest-policy-domain-runtime`, `../../runtime/url-normalization-runtime` |
| `digest/domain/source-domain-runtime.js` | Parses and normalizes source domains from item URLs or `.source` fields; resolves source identity for storyline building | Normalized domain string | `../../runtime/source-policy-registry-runtime` |
| `digest/domain/storyline-domain-runtime.js` | Builds storyline candidates from enriched items; scores strategic vs. routine value; applies quality gate; identifies weak-source items | Storyline candidate array; quality scores | `node:crypto`, `./topic-domain-runtime`, `./source-domain-runtime`, `../runtime/repeat-freshness-runtime`, `../../runtime/source-policy-registry-runtime`, `../../runtime/preferred-source-registry-runtime` |
| `digest/domain/topic-domain-runtime.js` | Normalizes topic tokens and match text; scores topic relevance and related-topic proximity | Normalized strings; relevance scores | None |

---

## 4. Digest — Application (`digest/application/`)

Application-layer seam between the orchestrator and domain logic.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/application/digest-pipeline-seam-runtime.js` | Wraps `selectItemsByPolicy` into a `selectDigestItems` function with named options; re-exports `createDigestPolicies` | Selected item array | `../domain/selection-domain-runtime`, `../domain/digest-policy-domain-runtime` |
| `digest/application/digest-service-runtime.js` | Backward-compat shim: re-exports everything from `digest-orchestrator-runtime` so that legacy import paths continue to resolve | All orchestrator exports | `../../entrypoints/digest-orchestrator-runtime` |

---

## 5. Digest — Runtime (`digest/runtime/`)

Concrete I/O implementations for data fetching, enrichment, formatting, and archiving.

### Data Fetching

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/runtime/digest-data-fetch-runtime.js` | Fetches news items from Perplexity Sonar with retry and preferred-domain plan; tracks API call counts and degradation | `{ items, apiCalls, diagnostics }` | `../../runtime/source-policy-registry-runtime`, `./digest-data-fetch-request-runtime`, `./digest-data-fetch-items-runtime` |
| `digest/runtime/digest-data-fetch-request-runtime.js` | Builds Perplexity search request payloads; extracts topic queries from config | Perplexity request body | None |
| `digest/runtime/digest-data-fetch-items-runtime.js` | Parses raw Perplexity JSON into item structs; enriches with citation URLs; filters stale articles (>72 h); deduplicates within a topic batch | Normalized item array | `../../runtime/url-normalization-runtime` |
| `digest/runtime/digest-data-enrich-runtime.js` | Calls Anthropic Claude to add `why_it_matters`, strategic scores, and editorial signals to selected items; retries on transient errors | Enriched item array + `claudeUsage` | `./digest-data-enrich-prompt-runtime`, `./digest-data-enrich-result-runtime` |
| `digest/runtime/digest-data-enrich-prompt-runtime.js` | Builds the prompt sent to Claude for item enrichment; sanitizes field values to prevent injection | Prompt string | None |
| `digest/runtime/digest-data-enrich-result-runtime.js` | Parses Claude's JSON response leniently (strips markdown fences); normalizes enriched fields | Enriched item array | None |
| `digest/runtime/digest-data-runtime.js` | Composes fetch and enrich runtimes into a single `createDigestDataRuntime` factory | `{ fetchTopicNews, enrichItems }` | `./digest-data-fetch-runtime`, `./digest-data-enrich-runtime` |

### Email Formatting

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/runtime/digest-formatting-email-runtime.js` | Assembles all email sub-runtimes; exports `buildEmail()` | HTML email string | `./digest-formatting-email-style-runtime`, `./digest-formatting-email-sections-runtime`, `./digest-formatting-email-items-runtime`, `./digest-formatting-email-template-runtime` |
| `digest/runtime/digest-formatting-email-template-runtime.js` | Applies named slots (`{{DATE}}`, `{{QUICK_SCAN}}`, etc.) into the HTML template string | Filled HTML string | None |
| `digest/runtime/digest-formatting-email-style-runtime.js` | Maps relevance scores to color tokens (dot, text, bg, glow) used in item cards; provides `escapeHtml` | Color objects; safe HTML strings | None |
| `digest/runtime/digest-formatting-email-sections-runtime.js` | Builds welcome banner, delivery context note, editorial note, and settings footer HTML blocks | HTML fragment strings | `BASE_URL` |
| `digest/runtime/digest-formatting-email-items-runtime.js` | Renders individual digest item cards as HTML with score badges, source labels, and engagement links | HTML item card strings | `BASE_URL` |

### AI Generation

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/runtime/digest-formatting-ai-runtime.js` | Wraps the Anthropic haiku caller; provides `generateLeadSubjectLine`, `generateEditorialNote`, and HTML sanitizer utilities | Subject line string; editorial note string | `./digest-formatting-ai-generation-runtime` |
| `digest/runtime/digest-formatting-ai-generation-runtime.js` | Implements the actual `generateLeadSubjectLine` and `generateEditorialNote` prompts sent to Claude Haiku with fallback values | String outputs | Injected `callHaikuOneLine`, `stripInlineHtml` |

### Topic Formatting

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/runtime/digest-formatting-topic-runtime.js` | Composes visual and learning sub-runtimes into a single topic formatting factory | `{ topicVisual, formatTopicDisplay, buildLearningSummary }` | `./digest-formatting-topic-visual-runtime`, `./digest-formatting-topic-learning-runtime` |
| `digest/runtime/digest-formatting-topic-display-runtime.js` | Converts a raw topic slug into a title-cased display label | Display label string | None |
| `digest/runtime/digest-formatting-topic-learning-runtime.js` | Formats per-topic weight adjustments into a human-readable learning summary for digest headers | Summary string | `./digest-formatting-topic-display-runtime` |
| `digest/runtime/digest-formatting-topic-visual-runtime.js` | Maps topic tokens to emoji/color visual identifiers; formats topics for display | `{ topicVisual, formatTopicDisplay }` | `./digest-formatting-topic-display-runtime` |

### General

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/runtime/digest-formatting-runtime.js` | Top-level formatting factory; wires AI, email, and topic formatting helpers together | `{ generateLeadSubjectLine, generateEditorialNote, buildEmail, topicVisual, formatTopicDisplay, buildLearningSummary, stripInlineHtml, escapeHtml }` | AI, email, and topic formatting runtimes |

### Archive / Delivery

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `digest/runtime/digest-archive-runtime.js` | Top-level archive factory; composes history, persistence, and suppression sub-runtimes | `{ saveToArchive, loadRecentArchiveItems, dedupAgainstRecentArchives, buildRecentRepeatIndex, suppressRecentlySentForUser, isRecentRepeatItem, loadRecentSentDigests }` | `./archive-history-runtime`, `./archive-user-suppression-runtime`, `./archive-persistence-runtime`, `./repeat-freshness-runtime` |
| `digest/runtime/archive-history-runtime.js` | Loads recent archive JSON files and builds a cross-day semantic repeat index for dedup | Recent item array; `SemanticRepeatIndex` | `node:fs`, `node:path`, `./repeat-freshness-runtime` |
| `digest/runtime/archive-persistence-runtime.js` | Writes today's enriched item list to `archive/<date>.json` and updates `archive/index.json` | JSON files on disk | `node:fs`, `node:path` |
| `digest/runtime/archive-user-suppression-runtime.js` | Suppresses items a specific user has recently received by cross-referencing their `recent_digest_url_history` | Filtered item array | `./repeat-freshness-runtime`, injected `normalizeUrlForDedup` |
| `digest/runtime/digest-delivery-record-runtime.js` | Creates, updates, and queries per-user per-date delivery records stored under `data/digest-records/` | JSON record files; `hasSentDigestRecord` boolean | `node:fs`, `node:path` |
| `digest/runtime/digest-item-ordering-runtime.js` | Sorts items by `relevanceScore` (descending) with stable fallback on original index | Sorted item array | None |
| `digest/runtime/repeat-freshness-runtime.js` | Builds a semantic repeat index using stemmed title tokens; checks whether an item is a semantic duplicate of recently seen items | `SemanticRepeatIndex`; boolean `isSemanticRepeatItem` | `../../runtime/url-normalization-runtime`, `../domain/topic-domain-runtime` |

---

## 6. Platform (`platform/`)

Thin adapter facades — each re-exports its backing runtime and exposes a stable import surface for entrypoints and jobs.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `platform/config/index.js` | Config facade; re-exports `loadConfig` from the runtime | Config object | `../../runtime/config-provider` |
| `platform/store/index.js` | Store facade; merges `store-core-runtime`, `user-contract-runtime`, `url-normalization-runtime`, and `runtime-types` | `createStore`, `USER_STATUS`, user-contract helpers, URL normalizer | `../../runtime/store-core-runtime`, `../../runtime/user-contract-runtime`, `../../runtime/url-normalization-runtime`, `../../runtime/runtime-types` |
| `platform/mailer/index.js` | Mailer facade; merges `mailer-runtime` and `mailer-lifecycle-runtime` | `sendEmail`, `buildOpenTrackingPixel`, lifecycle email functions | `../../runtime/mailer/mailer-runtime`, `../../runtime/mailer-lifecycle-runtime` |
| `platform/scheduler/index.js` | Scheduler facade; re-exports `digest-lock-runtime` (lock states and file operations) | `LOCK_STATES`, `readDigestLockState`, `clearDigestLockFile`, `getDigestLockOwnerStatus` | `../../runtime/digest-lock-runtime` |
| `platform/types/index.js` | Types facade; re-exports `runtime-types` JSDoc typedefs | Type module | `../../runtime/runtime-types` |

---

## 7. Runtime (`runtime/`)

Concrete implementations backing the platform facades. Do not import these directly from entrypoints — prefer `platform/` or `domains/`.

### Config

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `runtime/config-provider.js` | Loads and validates `config.json`; applies env-var overrides for all secret keys; caches the result | Config object | `node:fs`, `node:path`, `./config-schema-runtime`, `SIGNALBRIEF_*` env vars |
| `runtime/config-schema-runtime.js` | Validates the config object shape (required fields, delivery-time format, positive integers) | Throws `Error` with field paths on invalid config | None |
| `runtime/runtime-state-paths-runtime.js` | Resolves all runtime file paths (heartbeat, lock, archive, engagement events, etc.) from `appRoot` and env overrides | Path strings | `node:path`, `SIGNALBRIEF_DATA_DIR` |
| `runtime/runtime-types.js` | JSDoc `@typedef` declarations for `UserRecord`, `ReplyState`, `PendingVerification`, `TransportResponse` | Type annotations only | None |

### Store

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `runtime/store.js` | Facade shim; re-exports `store-core-runtime` | `createStore`, `USER_STATUS` | `./store-core-runtime` |
| `runtime/store-core-runtime.js` | Creates a user store instance backed by either the file adapter or SQLite adapter; selects backend from `SIGNALBRIEF_STORE_BACKEND` env var | `{ initStore, readUser, writeUser, allUsers, findUserByToken, … }` | `node:fs`, `node:path`, `node:crypto`, `./user-contract-runtime`, `./store-adapter-file-runtime`, `./store-adapter-contract-runtime`, `./runtime-state-paths-runtime`, `SIGNALBRIEF_STORE_BACKEND` |
| `runtime/store-adapter-contract-runtime.js` | Asserts that a store adapter object implements all required methods (`readUser`, `writeUser`, `deleteUser`, `allUsers`, `rebuildTokenIndex`, `findUserByToken`) | Validated adapter object (throws on missing methods) | None |
| `runtime/store-adapter-file-runtime.js` | File-backed store adapter; delegates to `store-record-runtime` and validates the contract | Adapter object | `./store-record-runtime`, `./store-adapter-contract-runtime` |
| `runtime/store-adapter-sqlite-runtime.js` | SQLite-backed store adapter; uses the built-in `node:sqlite` module (Node 23+); falls back to file store if unavailable | Adapter object | `node:fs`, `node:path`, `./store-adapter-contract-runtime` |
| `runtime/store-record-runtime.js` | Reads and writes individual user JSON files atomically (write-to-tmp then rename); manages the in-memory token index | User record JSON files in `data/` | `node:fs`, `node:path` |
| `runtime/user-contract-runtime.js` | Defines `USER_STATUS` constants; `createDefaultUser`; `normalizeUserRecord` (coerces all fields to expected types and defaults) | Normalized `UserRecord` | None |
| `runtime/url-normalization-runtime.js` | Strips URL fragments, trailing slashes, and lowercases for stable dedup keys | Canonical URL string | None (`URL` from Node globals) |

### Mailer

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `runtime/mailer.js` | Shim; re-exports `mailer/mailer-runtime` | Mailer surface | `./mailer/mailer-runtime` |
| `runtime/mailer/mailer-runtime.js` | Sends email via Resend API (preferred) or Gmail OAuth fallback; builds open-tracking pixel URLs; provides `sendEmail` and `buildOpenTrackingPixel` | Email delivery result; pixel URL | `node:https`, `node:fs`, `node:path`, `node:crypto`, `../config-provider`, `../mailer-lifecycle-runtime`, `SIGNALBRIEF_RESEND_API_KEY`, `SIGNALBRIEF_FROM_EMAIL`, `BASE_URL` |
| `runtime/mailer-runtime.js` | Shim; re-exports `mailer/mailer-runtime` | Mailer surface | `./mailer/mailer-runtime` |
| `runtime/mailer-lifecycle-runtime.js` | Factory that assembles the lifecycle mailer from shared deps; exposes `createLifecycleMailer` | `{ sendReferralThankYou, sendWelcomeEmail }` | `./mailer/lifecycle/lifecycle-senders`, `./mailer/lifecycle/welcome-sender` |
| `runtime/mailer/lifecycle/common.js` | Shared utilities for lifecycle emails: `firstName`, `topicListForUser`, `deliveryTimeLabelEt`, `lifecycleEmailShell`, `profileLinks` | Helper functions | None |
| `runtime/mailer/lifecycle/lifecycle-senders.js` | Sends referral thank-you emails via injected `sendEmail` | Email sent via injected `sendEmail` | `./common` |
| `runtime/mailer/lifecycle/welcome-content.js` | Builds welcome-email content blocks: delivery time label, days label, depth label, topics HTML | HTML fragments; label strings | None |
| `runtime/mailer/lifecycle/welcome-sender.js` | Renders and sends the onboarding welcome email using the welcome HTML template | Email sent; `{ ok, … }` result | `./welcome-content`, injected `sendEmail`, `loadWelcomeTemplate`, `BASE_URL` |

### Engagement

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `runtime/engagement-events.js` | Shim; re-exports `engagement/engagement-events-runtime` | Engagement surface | `./engagement/engagement-events-runtime` |
| `runtime/engagement-events-runtime.js` | Shim; re-exports `engagement/engagement-events-runtime` | Engagement surface | `./engagement/engagement-events-runtime` |
| `runtime/engagement/engagement-events-runtime.js` | Appends JSONL engagement events (opens, saves, topic adjustments) to the events file; builds `digestId`; loads events for analysis | Events file at `engagementEventsPath`; `{ ok }` append result | `node:fs`, `node:path`, `node:crypto`, `../url-normalization-runtime`, `../runtime-state-paths-runtime` |

### Personalization

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|

### Quality

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `runtime/quality-score.js` | Computes an aggregate digest quality score (0–10) from individual item relevance and strategic scores; reports per-score statistics | `{ score, mean, stddev, itemScores }` | `../digest/domain/topic-domain-runtime` |
| `runtime/preferred-source-registry-runtime.js` | Loads the preferred-sources registry from `data/`; builds per-topic shortlists with domain scores; detects official-query hints | `{ domains, topic_keys, official_friendly }` shortlist | `node:path`, `./runtime-state-paths-runtime`, `./source-policy-registry-runtime`, `../digest/domain/topic-domain-runtime` |
| `runtime/source-policy-registry-runtime.js` | Loads the source policy registry; normalizes domain names; exposes source type constants, policy values, and tier-override score tables | Normalized domain string; policy lookup; score constants | `./runtime-state-paths-runtime` |
| `runtime/digest-lock-runtime.js` | File-based run lock: writes a PID + timestamp lock file; reads and classifies lock state (`valid`, `stale`, `corrupt`, `io_error`); checks whether the owning PID is still alive | Lock state enum; boolean lock-owner status | `node:fs` |

### Infrastructure

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `runtime/structured-logger-runtime.js` | Writes structured JSONL log lines with `ts_utc`, `service`, `event`, `level`, and arbitrary scalar fields; enforces reserved-field protection | JSONL to a writable stream or `node:fs` file | `node:fs` |

---

## 8. Domains — Canonical Facades (`domains/`)

Each `index.js` is the single authoritative import surface for a domain. Entrypoints and jobs should only import from these paths.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `domains/digest/index.js` | Merges all digest sub-modules: pipeline seam, domain logic, formatting, data, archive, delivery-record, and quality score | Full digest API surface | `../../digest/application/digest-pipeline-seam-runtime`, all `digest/domain/*` and `digest/runtime/*` modules, `../../runtime/quality-score` |
| `domains/engagement/index.js` | Canonical engagement facade | `{ appendEngagementEventChecked, buildDigestId, loadEngagementEvents, … }` | `../../runtime/engagement/engagement-events-runtime` |

---

## 9. Analysis and Coverage (top-level `src/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `dependency-links.mjs` | Static ESM import graph that anchors the active email-first MVP modules plus core scripts for import-graph tooling | Side-effects only (module loading) | Active `src/` modules and `scripts/` files |
| `dependency-links-entry.mjs` | Bridge shim that imports `dependency-links.mjs`; used to anchor the graph from a single entry | Re-imports `./dependency-links.mjs` | `./dependency-links.mjs` |
| `module-coverage-runtime.js` | Requires every key active-path module in-process and runs assertion-based smoke tests to confirm they export expected symbols; used in CI | Test pass/fail assertions via `node:assert` | `node:assert`, `node:child_process`, `node:fs`, `node:path`, key active-path `src/` modules |
| `module-coverage.test.js` | Thin test-runner shim that delegates to `module-coverage-runtime` | Calls `runModuleCoverageTests()` | `./module-coverage-runtime` |
