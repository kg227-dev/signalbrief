# Strategic Relevance Classifier — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Classifier Version:** 1.0

---

## 1. Objective

Introduce a Claude Haiku-based strategic relevance classifier to improve content quality by distinguishing strategic vs non-strategic articles before scoring and selection.

Today, selection is driven by source authority + heuristic scoring, not true decision-relevant signal. The classifier adds a semantic layer that:

- Removes low-signal content (deal pages, listicles, index pages)
- Elevates high-impact stories (M&A, regulation, earnings)
- Improves editorial quality, especially in thin candidate pools

### Scope

**In scope:**

- Classify each candidate as HIGH / MEDIUM / LOW strategic value
- Feed classification into scoring + selection via filter and boost
- Replace the role of `isNonNewsHeadline()` for nuanced cases (regex stays as cheap pre-filter)

**Out of scope:**

- Source coverage gaps, broken feeds, weekend publishing thinness
- Replacing the 4-component scoring formula
- Backtesting against historical data (future optimization)

---

## 2. Definition of "Strategic"

An article is strategic if it meets most of the following:

1. Impacts companies, markets, regulation, or capital flows
2. Has forward-looking implications
3. Is relevant to decision-making or competitive positioning

### Explicit exclusions (always LOW)

- Deal pages / coupons / promo codes
- "Best X" or product roundups
- Pure consumer product reviews
- Index/listing pages (e.g., "What's new for 2026")
- Event listings / conference agendas

### Explicit inclusions (bias HIGH)

- M&A / partnerships / joint ventures
- Regulatory changes / enforcement actions
- Earnings / financial signals / guidance
- Policy changes with industry impact
- Industry-shaping product launches or platform shifts

### Classification labels

| Label  | Meaning                                          |
|--------|--------------------------------------------------|
| HIGH   | Strong strategic relevance — decision-grade signal |
| MEDIUM | Some relevance, but less impactful or more tactical |
| LOW    | Non-strategic noise                              |

---

## 3. Architecture

### Pipeline placement

```
Fetch → Parse → [existing broker filters + isNonNewsHeadline]
    → Dedup → Freshness gate → History filter → Story relationship
    → [NEW] classifyCandidates()        ← annotate all survivors
    → [NEW] filterLowRelevance()        ← drop LOW per topic (pre-score)
    → scoreCandidates()                 ← existing 4-component formula
    → [NEW] boostHighRelevance()        ← +0.12 for HIGH (post-score)
    → Per-topic selection with fallback
```

**Rationale:** Runs after dedup/freshness/history so we never waste API calls on items that would be dropped anyway. Runs before scoring so LOW items are removed from the scoring pool entirely.

### Module structure

```
src/domains/classification/
├── strategic-relevance-classifier.js   # Orchestration + model calls
├── strategic-relevance-cache.js        # File-backed cache with atomic writes
└── strategic-relevance-scoring.js      # Per-topic filter + boost (two functions)
```

---

## 4. Module: `strategic-relevance-classifier.js`

### Exports

- `CLASSIFIER_VERSION` — String constant (e.g., `"1.0"`). Bump to invalidate all cached classifications.
- `classifyCandidates(candidates, { cache, config, log, concurrency })` — Orchestration entry point.
- `classifySingle(candidate, { apiKey, model, timeout })` — Single Haiku call for one candidate.
- `buildClassificationPrompt(candidate)` — Isolated prompt builder (testable, iterable).
- `normalizeClassificationResult(raw)` — Validates and sanitizes model output.

### `classifyCandidates()` flow

1. For each candidate, call `lookupCache()` with URL + `CLASSIFIER_VERSION`.
2. Collect cache misses.
3. Run misses through `classifySingle()` using a concurrency pool (default: 8 concurrent, configurable).
4. Write each new result to cache via `writeEntry()`.
5. Annotate every candidate with:
   - `strategic_relevance`: "HIGH" | "MEDIUM" | "LOW"
   - `strategic_relevance_reason`: string, max 15 words
   - `strategic_relevance_source`: "cache" | "model" | "fallback"
   - `strategic_relevance_version`: current `CLASSIFIER_VERSION`
   - `strategic_relevance_applied`: boolean (true once annotation is set)
6. Return annotated candidates + orchestration diagnostics.

### `classifySingle()` flow

1. Call `buildClassificationPrompt(candidate)` using title, snippet (if available), source, topic.
2. HTTPS POST to Anthropic Messages API via `httpsPostWithRetry`.
3. Parse JSON from response.
4. Call `normalizeClassificationResult(raw)` to validate.
5. On any failure (network, parse, malformed): return `{ classification: "MEDIUM", reason: "Classifier fallback" }`.

**Missing snippet handling:** If snippet is absent, classify using title + source + topic only. Never drop a candidate for missing snippet.

### `buildClassificationPrompt()` — draft

System prompt:

```
You are a strategic relevance classifier for business intelligence.

Classify whether this article is strategically important for a senior business professional.

HIGH = Impacts markets, companies, regulation, capital flows, or future competitive positioning. Examples: M&A, regulatory changes, earnings, major partnerships, industry-shaping launches.

MEDIUM = Somewhat relevant but not decision-critical. Tactical updates, incremental product news, routine personnel changes.

LOW = Not strategic. Consumer content, deal/coupon pages, product reviews, "best of" lists, event listings, index pages.

Focus on content, not source reputation. A prestigious source can publish non-strategic content.

Return JSON only:
{"classification": "HIGH | MEDIUM | LOW", "reason": "max 15 words explaining why"}
```

User message:

```
Title: {headline}
Summary: {snippet or "Not available"}
Source: {source_domain}
Topic: {topic tag}
```

### `normalizeClassificationResult(raw)`

- Force `classification` to one of `["HIGH", "MEDIUM", "LOW"]`. If unrecognized, default to `"MEDIUM"`.
- Truncate `reason` to 15 words. If missing, set to `"No reason provided"`.
- If input is not valid JSON or missing required fields, return `{ classification: "MEDIUM", reason: "Classifier fallback" }`.
- Never throw.

### Concurrency

- Default: 8 concurrent Haiku calls for cache misses.
- Configurable via `CONFIG.digest.classification.concurrency`.
- Uses the existing `runWithConcurrency` pattern from the fetch runtime.

---

## 5. Module: `strategic-relevance-cache.js`

### Exports

- `hashUrl(url)` — SHA-256 hex of canonicalized URL (lowercase hostname, strip trailing slash, remove `utm_*` query params, sort remaining params).
- `buildCacheKey(url, classifierVersion)` — Returns `"${hashUrl(url)}:${classifierVersion}"`.
- `loadCache(filePath)` — Read + parse `data/strategic-classification-cache.json`. Prune expired entries. Return Map keyed by cache_key.
- `lookupCache(cache, url, classifierVersion, { ttlDays })` — Returns entry if key matches and within TTL. Otherwise `null`.
- `writeEntry(cache, url, classifierVersion, result, meta)` — Add to Map, write through to disk atomically.
- `pruneExpired(cache, ttlDays)` — Remove entries older than TTL. Called on load.
- `flushCache(cache, filePath)` — Atomic write of full cache to disk.

### Cache entry schema

```json
{
  "cache_key": "a1b2c3d4:1.0",
  "classification": "HIGH",
  "reason": "Major acquisition reshapes competitive landscape",
  "classifier_version": "1.0",
  "classified_at": "2026-03-29T14:00:00.000Z",
  "source": "reuters.com",
  "topic": "FINANCIAL SERVICES"
}
```

### Cache file location

`data/strategic-classification-cache.json`

### TTL

Default: 14 days. Configurable via `CONFIG.digest.classification.cache_ttl_days`.

### Invalidation

- Expired entry (older than TTL): reclassify.
- Version mismatch (entry version !== current `CLASSIFIER_VERSION`): reclassify.
- Bumping `CLASSIFIER_VERSION` effectively invalidates all entries.

### Atomic writes

Write to `data/strategic-classification-cache.json.tmp`, then rename to `data/strategic-classification-cache.json`. Prevents corruption on partial write.

### Write strategy

Write-through per entry for MVP. The `flushCache` export supports switching to buffered end-of-run writes if per-entry writes become noisy at scale.

### Malformed cache file

If the cache file cannot be parsed, log a warning and start with an empty cache. Never crash.

---

## 6. Module: `strategic-relevance-scoring.js`

### Exports

- `filterLowRelevance(candidates, opts)` — Pre-score: drop LOW items per topic.
- `boostHighRelevance(candidates, opts)` — Post-score: boost HIGH items per topic.

Both operate **per topic bucket**, not on the global pool. This prevents a deep topic from masking a thin one.

### `filterLowRelevance(candidates, { log })`

Groups candidates by `tag`, then for each topic:

| Topic candidate count | Behavior                                          |
|-----------------------|---------------------------------------------------|
| >= 20                 | Drop all LOW                                      |
| 15 - 19              | Drop LOW unless it would leave < 5 for that topic |
| < 15                  | Keep all LOW (thin-pool mode)                     |

Returns `{ filtered, dropped, diagnostics }`.

### `boostHighRelevance(candidates, { boostAmount, log })`

For each candidate with `strategic_relevance === "HIGH"`:

- `_score_before_strategic` = current `_score`
- `_score += boostAmount` (default: 0.12), capped at 1.0
- `_strategic_boost_applied` = boost amount applied

For non-HIGH candidates:

- `_score_before_strategic` = current `_score`
- `_strategic_boost_applied` = 0

For all candidates:

- `_score_final` = final `_score` after boost

Returns `{ boosted, diagnostics }`.

### Thin-pool behavior (locked)

When a topic is in thin-pool mode (< 15 candidates):

- LOW items are **kept** (not dropped).
- HIGH boost **is still applied** (default behavior).
- This is configurable via `CONFIG.digest.classification.boost_in_thin_pool` (default: `true`).

Rationale: in thin pools, we still want the best items to float to the top. Disabling boost removes our only quality lever in exactly the situation where quality matters most.

### Boost configuration

- `boostAmount` default: `0.12`
- Configurable via `CONFIG.digest.classification.boost_amount`
- Logged on every boosted candidate for debugging

### Diagnostics (per topic)

```json
{
  "topic": "TECHNOLOGY",
  "total_candidates": 24,
  "count_high": 8,
  "count_medium": 12,
  "count_low": 4,
  "low_dropped": 4,
  "high_boosted": 8,
  "fallback_classified": 1,
  "cache_hits": 18,
  "cache_misses": 6,
  "thin_pool_mode": false,
  "boost_applied": true
}
```

---

## 7. Pipeline Integration

### Integration point

Inside `selectForEnrichment()` in `src/entrypoints/digest-orchestrator-selection-runtime.js`.

### Sequence (annotated)

```
[existing] Editorial overrides (pins, excludes, suppressions)
[existing] Candidate preparation (storyline collapse, tag canonicalization)
[existing] Cross-day dedup (3-day lookback)
[existing] Freshness gate (48h max age)
[existing] Longitudinal history filter (7-day lookback)
[existing] Story relationship classification (drop continuations)

[NEW]      classifyCandidates()           — annotate strategic_relevance on all survivors
[NEW]      filterLowRelevance()           — drop LOW per topic (adaptive thresholds)

[existing] scoreCandidates()              — 4-component formula on filtered pool

[NEW]      boostHighRelevance()           — +0.12 for HIGH, preserve _score_before_strategic

[existing] Per-topic selection with fallback (5 items per topic, source cap, discovery cap)
```

### Candidate fields after full pipeline

Each candidate carries:

```
strategic_relevance:          "HIGH" | "MEDIUM" | "LOW"
strategic_relevance_reason:   string (max 15 words)
strategic_relevance_source:   "cache" | "model" | "fallback"
strategic_relevance_version:  "1.0"
strategic_relevance_applied:  true

_score:                       number [0, 1]  (final, after boost)
_score_before_strategic:      number [0, 1]  (before boost)
_strategic_boost_applied:     number          (0 or boost amount)
_score_final:                 number [0, 1]  (same as _score, explicit alias)
_score_components:            { freshness, source_tier, lane_bonus, novelty }
_score_reasons:               string[]
```

### Feature gate

- `CONFIG.digest.classification.enabled` — default `false`. Set to `true` to activate.
- When disabled, the pipeline skips classification entirely — no API calls, no filtering, no boost. Candidates pass through unchanged.

### Existing `isNonNewsHeadline()` relationship

The regex filter in `standard-topic-broker-runtime.js` **stays in place** as a cheap pre-filter during fetch. It catches obvious junk (coupon codes, buying guides) before candidates even enter the pipeline. The classifier handles the nuanced cases regex cannot distinguish (strategic vs tactical, real analysis vs fluff).

---

## 8. Admin & Observability

### Approach

Extend the existing audit route (`web/routes/admin-api-digest-audit-runtime.js`) rather than building a new standalone page. Classification data flows through the existing `selectionDiagnostics` structure.

### New data in `selectionDiagnostics`

**`classification_summary`** — per-topic breakdown:

```json
{
  "TECHNOLOGY": {
    "total_candidates": 24,
    "count_high": 8,
    "count_medium": 12,
    "count_low": 4,
    "low_dropped": 4,
    "high_boosted": 8,
    "fallback_classified": 1,
    "cache_hits": 18,
    "cache_misses": 6,
    "thin_pool_mode": false
  }
}
```

**`classification_run`** — run-level stats:

```json
{
  "total_classified": 87,
  "cache_hits": 62,
  "model_calls": 23,
  "fallbacks": 2,
  "errors": 2,
  "high": 31,
  "medium": 44,
  "low": 12,
  "elapsed_ms": 2800,
  "classifier_version": "1.0"
}
```

### Per-candidate data

Every candidate in the scored candidate list carries `strategic_relevance`, `strategic_relevance_reason`, `strategic_relevance_source`, `_score_before_strategic`, `_strategic_boost_applied`, and `_score_final`.

### Admin page additions

- Filter candidates by classification (HIGH / MEDIUM / LOW)
- Show cache hit vs model vs fallback per item
- Show "selected vs rejected" with classification visible
- Classification summary table per topic in readiness view

---

## 9. Logging

### Per-classification log entry

```json
{
  "event": "strategic_classification",
  "url": "https://example.com/article",
  "classification": "HIGH",
  "reason": "Major acquisition reshapes market",
  "source": "model",
  "classifier_version": "1.0",
  "topic": "FINANCIAL SERVICES",
  "latency_ms": 142
}
```

### Run-level summary log

```json
{
  "event": "strategic_classification_run",
  "total": 87,
  "cache_hits": 62,
  "model_calls": 23,
  "fallbacks": 2,
  "errors": 2,
  "high": 31,
  "medium": 44,
  "low": 12,
  "elapsed_ms": 2800,
  "classifier_version": "1.0"
}
```

The `errors` field tracks count of Haiku calls that failed and fell back to MEDIUM. Logged at warn level individually, counted in the run summary.

---

## 10. Performance Constraints

- Latency target: < 100ms per item (Haiku typical: 50–80ms)
- Concurrency: 8 parallel calls → ~150 items classified in ~2 seconds
- Cost: ~$0.01 per run at current candidate volumes (Haiku pricing)
- Cache hit rate expected > 50% on Day 2+ (same URLs reappear across days)
- Must not delay the scheduled pipeline by more than 5 seconds total

---

## 11. Configuration

All configuration under `CONFIG.digest.classification`:

| Key                  | Type    | Default | Description                                  |
|----------------------|---------|---------|----------------------------------------------|
| `enabled`            | boolean | `false` | Feature gate — flip to activate              |
| `concurrency`        | number  | `8`     | Max parallel Haiku calls for cache misses    |
| `boost_amount`       | number  | `0.12`  | Score boost for HIGH items (capped at 1.0)   |
| `cache_ttl_days`     | number  | `14`    | Days before cache entries expire             |
| `boost_in_thin_pool` | boolean | `true`  | Whether HIGH boost applies in thin-pool mode |
| `model`              | string  | `"claude-haiku-4-20250514"` | Haiku model ID        |

API key: `CONFIG.keys.anthropic` (already loaded via `SIGNALBRIEF_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`).

---

## 12. Rollout

### Phase 1 — Canary only

- Set `CONFIG.digest.classification.enabled = true` for canary cohort
- Monitor fill rate, trusted share, junk reduction
- No broader exposure

### Phase 2 — Evaluation

- Compare canary vs control on:
  - Fill rate (must not increase underfill)
  - Trusted Tier 1/2 share (target: +10-20%)
  - Obvious junk articles (target: near zero)
  - Candidate depth usage (stable or improved)
- Qualitative: output should feel like "exactly what I would have picked"

---

## 13. Success Metrics

### Quantitative

- +10-20% increase in trusted Tier 1/2 share
- No increase in underfill rate
- Stable or improved candidate depth usage

### Qualitative

- Fewer obvious junk articles in delivered digests
- Higher editorial quality in thin-pool topics

---

## 14. Risks and Mitigations

| Risk                       | Mitigation                                                    |
|----------------------------|---------------------------------------------------------------|
| Over-filtering (underfill) | Per-topic adaptive thresholds; thin-pool mode keeps LOW items |
| Inconsistent classification | `normalizeClassificationResult`; MEDIUM fallback on failure   |
| Model variability          | Caching by URL+version; prompt isolation for iteration        |
| API failure                | MEDIUM fallback; pipeline continues without blocking          |
| Cache corruption           | Atomic writes (tmp+rename); graceful recovery from malformed  |
| Misplaced priority         | Does NOT replace need for feed fixes and source coverage      |

---

## 15. Test Plan

### Classification accuracy (prompt / normalization)

- Deal page headline → LOW
- "Best X of 2026" listicle → LOW
- FDA index page ("Novel Drug Approvals for 2026") → LOW
- Event listing → LOW
- M&A announcement → HIGH
- Regulatory change → HIGH
- Earnings report → HIGH
- Industry partnership → HIGH
- Tactical product update → MEDIUM
- Missing snippet → classifies using title + source + topic only

### Cache behavior

- Cache hit returns stored result, no API call made
- Expired entry (> 14 days) triggers reclassification
- Version mismatch triggers reclassification
- Malformed cache file loads gracefully, starts fresh
- Atomic write does not corrupt on partial failure
- URL canonicalization (trailing slash, utm params) produces same cache key

### Scoring integration

- LOW dropped when topic pool >= 20
- LOW kept when topic pool < 15 (thin-pool mode)
- LOW dropped in 15-19 range unless would leave < 5 for topic
- HIGH boost applied post-score, capped at 1.0
- `_score_before_strategic` preserved correctly
- `_score_final` matches `_score` after boost
- Boost applies in thin-pool mode (default behavior)
- Per-topic operation: deep topic drops LOW while thin topic keeps LOW in same run

### Failure modes

- Malformed Haiku JSON → MEDIUM fallback
- Network timeout → MEDIUM fallback
- API key missing → all MEDIUM fallback, warning logged
- Empty candidate list → no-op, empty diagnostics

### Admin payload

- Classification data flows through `selectionDiagnostics`
- `classification_summary` present per topic
- `classification_run` present at run level
- Candidate-level fields (`strategic_relevance`, `_score_before_strategic`, etc.) populated

---

## 16. Relationship to Existing Systems

| System                    | Relationship                                                |
|---------------------------|-------------------------------------------------------------|
| `isNonNewsHeadline()`     | Stays as cheap regex pre-filter during fetch. Classifier handles nuanced cases. |
| `scoreCandidates()`       | Unchanged. Classifier filters before, boosts after.         |
| `selectForEnrichment()`   | Integration point. Three new calls inserted into existing flow. |
| `selectionDiagnostics`    | Extended with classification data. No new audit routes.     |
| Source registry / feeds   | Classifier does NOT fix source gaps. Complementary system.  |
| Archive dedup             | Runs before classifier. No interaction.                     |

---

**End of Spec**
