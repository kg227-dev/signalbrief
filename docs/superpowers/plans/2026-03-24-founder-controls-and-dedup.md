# Founder Controls and Advanced Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add founder no-code tuning controls (scoring weights, freshness, source caps via admin API) and editorial overrides (pin/exclude/suppress) without requiring code changes or process restarts; add cross-day follow-up angle classification (§2.3/§2.7).

**Architecture:** Digest tuning overrides stored in `data/digest-tuning.json`, read fresh each run; editorial overrides in `data/editorial-overrides.json`, checked during selection; story relationship classification added to fuzzy-dedup module and applied to cross-day dedup annotation.

**Tech Stack:** Node.js stdlib only (`fs`, `path`). All functions are pure and unit-testable. Tests use `/opt/homebrew/bin/node` directly.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/runtime/digest-tuning-runtime.js` | Load/merge `digest-tuning.json`; validate allowed fields |
| Create | `src/runtime/digest-tuning-runtime.test.js` | Unit tests |
| Create | `web/routes/admin-api-digest-tuning-runtime.js` | `GET/PUT /api/admin/digest-tuning` |
| Create | `web/routes/admin-api-digest-tuning-runtime.test.js` | Unit tests |
| Modify | `src/entrypoints/digest-orchestrator-core-runtime.js` | Load tuning overrides at run start, pass to selection |
| Create | `src/digest/domain/editorial-overrides-runtime.js` | Load/save/check overrides (pin/exclude/suppress) |
| Create | `src/digest/domain/editorial-overrides-runtime.test.js` | Unit tests |
| Create | `web/routes/admin-api-editorial-overrides-runtime.js` | `GET/POST /api/admin/editorial-overrides` |
| Create | `web/routes/admin-api-editorial-overrides-runtime.test.js` | Unit tests |
| Modify | `src/entrypoints/digest-orchestrator-selection-runtime.js` | Apply editorial overrides before selection |
| Modify | `src/digest/domain/fuzzy-dedup-runtime.js` | Add `classifyStoryRelationship` |
| Modify | `web/routes/admin-api.js` | Wire new handlers |
| Modify | `web/server-runtime-admin-registry-runtime.js` | Pass new deps (`digestTuningPath`, `editorialOverridesPath`) |
| Modify | `web/server-runtime.js` | Resolve new paths and pass to registry |
| Modify | `src/runtime/runtime-state-paths-runtime.js` | Register `digestTuningPath`, `editorialOverridesPath` |

---

## Task 1: `classifyStoryRelationship` in `fuzzy-dedup-runtime.js` (§2.3)

**Context:** `src/digest/domain/fuzzy-dedup-runtime.js` already has `tokenizeHeadline`, `jaccardSimilarity`, and `isFuzzyDuplicateHeadline`. The next step is a classification function that maps an item against an array of past items and returns `'new'`, `'follow_up'`, or `'continuation'`. The thresholds are:
- Jaccard >= 0.85 with any past item → `'continuation'` (suppress)
- Jaccard >= 0.70 with any past item → `'follow_up'` (allow, flag)
- Jaccard < 0.70 → `'new'`

`pastItems` are plain objects with a `headline` field.

**Files:**
- Modify: `src/digest/domain/fuzzy-dedup-runtime.js`
- Modify: `src/digest/domain/fuzzy-dedup-runtime.test.js`

### Step 1a: Write the failing test first

- [ ] **Step 1: Confirm existing tests pass**

```bash
/opt/homebrew/bin/node src/digest/domain/fuzzy-dedup-runtime.test.js
```
Expected: `All fuzzy-dedup-runtime tests passed ✓`

- [ ] **Step 2: Append failing tests for `classifyStoryRelationship` to `src/digest/domain/fuzzy-dedup-runtime.test.js`**

Append the following block at the bottom of `src/digest/domain/fuzzy-dedup-runtime.test.js`, before the final `console.log("All fuzzy-dedup-runtime tests passed ✓")`:

```js
// classifyStoryRelationship
{
  const { classifyStoryRelationship } = require("./fuzzy-dedup-runtime");
  assert(typeof classifyStoryRelationship === "function", "classifyStoryRelationship must be exported");

  const item = { headline: "Apple Reports Record First Quarter Revenue" };

  // No past items → 'new'
  assert.strictEqual(classifyStoryRelationship(item, []), "new", "empty past → new");

  // High overlap (>= 0.85) → 'continuation'
  const nearIdenticalPast = [{ headline: "Apple Reports Record First Quarter Revenue Results" }];
  const contResult = classifyStoryRelationship(item, nearIdenticalPast);
  assert.strictEqual(contResult, "continuation", `>= 0.85 overlap → continuation, got ${contResult}`);

  // Mid overlap (>= 0.70, < 0.85) → 'follow_up'
  // "Apple Reports Revenue Beats Expectations" shares: apple, reports, revenue = 3
  // item tokens: apple, reports, record, first, quarter, revenue = 6
  // union = 6+1 = 7, intersection = 3, jaccard = 3/7 ≈ 0.429 — too low
  // Use a closer headline: "Apple Reports Record Revenue Quarterly Results"
  // tokens: apple, reports, record, revenue, quarterly, results = 6
  // shared with item: apple, reports, record, revenue = 4
  // union = 6+6-4 = 8, jaccard = 4/8 = 0.5 — still < 0.70
  // Use: "Apple Reports Record First Revenue Quarter"
  // tokens: apple, reports, record, first, revenue, quarter = 6 (same as item!)
  // jaccard = 1.0 — that's continuation
  // Use a 0.75 case: "Apple Reports Record Q1 Revenue Results"
  // item tokens(>=3): apple, reports, record, first, quarter, revenue = 6
  // past tokens(>=3): apple, reports, record, revenue, results = 5
  // intersection: apple, reports, record, revenue = 4
  // union = 6+5-4 = 7, jaccard = 4/7 ≈ 0.571 — < 0.70
  // Actual 0.75 case: add "first" too: "Apple Reports Record First Revenue"
  // tokens: apple, reports, record, first, revenue = 5
  // intersection with item: apple, reports, record, first, revenue = 5
  // union = 6+5-5 = 6, jaccard = 5/6 ≈ 0.833 → continuation (>= 0.85? no, 0.833 < 0.85)
  // 0.833 >= 0.70 and < 0.85 → follow_up
  const followUpPast = [{ headline: "Apple Reports Record First Revenue" }];
  const fuResult = classifyStoryRelationship(item, followUpPast, 0.7, 0.85);
  assert.strictEqual(fuResult, "follow_up", `0.833 jaccard → follow_up, got ${fuResult}`);

  // Custom thresholds work
  assert.strictEqual(
    classifyStoryRelationship(item, followUpPast, 0.9, 0.95),
    "new",
    "custom thresholds: 0.833 < 0.9 → new"
  );

  // Item with no headline → 'new' (safe fallback)
  assert.strictEqual(classifyStoryRelationship({}, nearIdenticalPast), "new", "missing headline → new");

  console.log("classifyStoryRelationship ✓");
}
```

- [ ] **Step 3: Confirm tests fail**

```bash
/opt/homebrew/bin/node src/digest/domain/fuzzy-dedup-runtime.test.js 2>&1 | tail -5
```
Expected: error about `classifyStoryRelationship` not being a function.

### Step 1b: Implement `classifyStoryRelationship`

- [ ] **Step 4: Add `classifyStoryRelationship` to `src/digest/domain/fuzzy-dedup-runtime.js`**

Add the following function before `module.exports`, and add `classifyStoryRelationship` to the exports:

```js
/**
 * Classify an item's story relationship against a pool of past items.
 *
 * Returns:
 *   'continuation' — Jaccard >= continuationThreshold with any past item.
 *                    Same story, no meaningful update — should be suppressed.
 *   'follow_up'    — Jaccard >= followUpThreshold with any past item (but < continuationThreshold).
 *                    Same event, distinct new development — allow through but flag.
 *   'new'          — Jaccard < followUpThreshold. Genuinely new story.
 *
 * @param {{ headline?: string }} item
 * @param {Array<{ headline?: string }>} pastItems
 * @param {number} followUpThreshold   default 0.70
 * @param {number} continuationThreshold default 0.85
 * @returns {'new' | 'follow_up' | 'continuation'}
 */
function classifyStoryRelationship(item, pastItems, followUpThreshold = 0.7, continuationThreshold = 0.85) {
  const headline = String(item?.headline || "").trim();
  if (!headline) return "new";
  if (!Array.isArray(pastItems) || pastItems.length === 0) return "new";

  const itemTokens = tokenizeHeadline(headline);
  if (itemTokens.size === 0) return "new";

  let maxSimilarity = 0;
  for (const pastItem of pastItems) {
    const pastHeadline = String(pastItem?.headline || "").trim();
    if (!pastHeadline) continue;
    const pastTokens = tokenizeHeadline(pastHeadline);
    if (pastTokens.size === 0) continue;
    const similarity = jaccardSimilarity(itemTokens, pastTokens);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
    // Short-circuit: once we exceed the highest threshold, no need to scan further
    if (maxSimilarity >= continuationThreshold) break;
  }

  if (maxSimilarity >= continuationThreshold) return "continuation";
  if (maxSimilarity >= followUpThreshold) return "follow_up";
  return "new";
}
```

Updated `module.exports`:
```js
module.exports = {
  tokenizeHeadline,
  jaccardSimilarity,
  isFuzzyDuplicateHeadline,
  classifyStoryRelationship,
};
```

- [ ] **Step 5: Confirm tests pass**

```bash
/opt/homebrew/bin/node src/digest/domain/fuzzy-dedup-runtime.test.js
```
Expected: all assertions pass including `classifyStoryRelationship ✓`.

- [ ] **Step 6: Run harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```
Expected: all existing tests pass (pre-existing failure about `testStandardTopicsRescueTrustedSearchEvidenceWhenProviderReturnsNothing` is acceptable).

- [ ] **Step 7: Commit**

```bash
git add src/digest/domain/fuzzy-dedup-runtime.js src/digest/domain/fuzzy-dedup-runtime.test.js
git commit -m "feat: add classifyStoryRelationship to fuzzy-dedup (§2.3 cross-day annotation)"
```

---

## Task 2: Digest Tuning Runtime (`src/runtime/digest-tuning-runtime.js`)

**Context:** The digest worker reads `CONFIG.digest.scoring` at run time via the `CONFIG` Proxy (which lazy-loads `config.json`). We need a separate, mutable store in `data/digest-tuning.json` that the orchestrator reads fresh at the start of each digest run and merges over the base scoring config. The web admin API allows GET and PUT of this file without restarting any process.

`resolveScoringConfig` in `src/domains/scoring/score-candidate.js` already accepts a full config object with `weights`, `maxAgeHours`, `tierScores`, `laneBonuses`. Merging the tuning overrides on top of `CONFIG.digest.scoring` before passing to `scoreCandidates` is the entire integration.

**Allowed tunable keys** (strict allowlist to prevent footguns):
- `weights` (object: `freshness`, `source_tier`, `lane_bonus`, `novelty`)
- `maxAgeHours` (number)
- `maxItemsPerSourceDomain` (number)
- `crossDayDedupDays` (number)
- `historyLookbackDays` (number)
- `laneBonuses` (object)
- `tierScores` (object)

**Files:**
- Create: `src/runtime/digest-tuning-runtime.js`
- Create: `src/runtime/digest-tuning-runtime.test.js`

### Step 2a: Write failing tests

- [ ] **Step 1: Write `src/runtime/digest-tuning-runtime.test.js`**

```js
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  loadDigestTuning,
  mergeDigestTuning,
  validateDigestTuning,
  ALLOWED_TUNING_KEYS,
} = require("./digest-tuning-runtime");

// --- loadDigestTuning ---
{
  // Returns {} when file is missing
  const missing = loadDigestTuning("/nonexistent/path/digest-tuning.json", fs);
  assert.deepStrictEqual(missing, {}, "missing file → empty object");

  // Returns {} when file contains invalid JSON
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-tune-test-"));
  const badPath = path.join(tmpDir, "bad.json");
  fs.writeFileSync(badPath, "not-json");
  const bad = loadDigestTuning(badPath, fs);
  assert.deepStrictEqual(bad, {}, "invalid JSON → empty object");

  // Returns parsed object for valid JSON
  const goodPath = path.join(tmpDir, "good.json");
  const tuning = { maxAgeHours: 36, weights: { freshness: 0.4, source_tier: 0.3, lane_bonus: 0.15, novelty: 0.15 } };
  fs.writeFileSync(goodPath, JSON.stringify(tuning));
  const result = loadDigestTuning(goodPath, fs);
  assert.strictEqual(result.maxAgeHours, 36, "maxAgeHours parsed correctly");
  assert.strictEqual(result.weights.freshness, 0.4, "weights.freshness parsed correctly");

  // Returns {} when file contains a non-object root
  const arrPath = path.join(tmpDir, "arr.json");
  fs.writeFileSync(arrPath, JSON.stringify([1, 2, 3]));
  const arr = loadDigestTuning(arrPath, fs);
  assert.deepStrictEqual(arr, {}, "array root → empty object");

  console.log("loadDigestTuning ✓");
}

// --- validateDigestTuning ---
{
  const { ok, errors } = validateDigestTuning({
    maxAgeHours: 36,
    maxItemsPerSourceDomain: 2,
    crossDayDedupDays: 3,
    historyLookbackDays: 7,
    weights: { freshness: 0.4, source_tier: 0.3, lane_bonus: 0.15, novelty: 0.15 },
    laneBonuses: { rss: 0.8 },
    tierScores: { "1": 1.0 },
  });
  assert.strictEqual(ok, true, "valid tuning passes validation");
  assert.strictEqual(errors.length, 0, "no errors for valid input");

  // Unknown key is rejected
  const { ok: badOk, errors: badErrors } = validateDigestTuning({ unknownKey: 123 });
  assert.strictEqual(badOk, false, "unknown key fails validation");
  assert.ok(badErrors.some((e) => e.includes("unknownKey")), "error mentions unknown key");

  // Non-numeric maxAgeHours is rejected
  const { ok: numOk, errors: numErrors } = validateDigestTuning({ maxAgeHours: "48h" });
  assert.strictEqual(numOk, false, "string maxAgeHours fails");
  assert.ok(numErrors.some((e) => e.includes("maxAgeHours")), "error mentions maxAgeHours");

  // Weights with out-of-range value is rejected
  const { ok: wOk, errors: wErrors } = validateDigestTuning({ weights: { freshness: 2.0, source_tier: 0.35, lane_bonus: 0.15, novelty: 0.15 } });
  assert.strictEqual(wOk, false, "out-of-range weight fails");
  assert.ok(wErrors.some((e) => e.includes("freshness")), "error mentions freshness");

  // Empty object is valid (no overrides)
  const { ok: emptyOk } = validateDigestTuning({});
  assert.strictEqual(emptyOk, true, "empty object is valid");

  console.log("validateDigestTuning ✓");
}

// --- mergeDigestTuning ---
{
  const base = {
    weights: { freshness: 0.35, source_tier: 0.35, lane_bonus: 0.15, novelty: 0.15 },
    maxAgeHours: 48,
    maxItemsPerSourceDomain: 2,
    crossDayDedupDays: 3,
    historyLookbackDays: 7,
  };

  // Tuning overrides only the specified keys
  const merged = mergeDigestTuning(base, { maxAgeHours: 36, weights: { freshness: 0.5, source_tier: 0.3, lane_bonus: 0.1, novelty: 0.1 } });
  assert.strictEqual(merged.maxAgeHours, 36, "maxAgeHours overridden");
  assert.strictEqual(merged.weights.freshness, 0.5, "weights overridden");
  assert.strictEqual(merged.maxItemsPerSourceDomain, 2, "unset key preserved from base");

  // Empty tuning returns base unchanged (shallow equal)
  const unmodified = mergeDigestTuning(base, {});
  assert.deepStrictEqual(unmodified, base, "empty tuning → base unchanged");

  // Null/undefined tuning returns base
  const fromNull = mergeDigestTuning(base, null);
  assert.deepStrictEqual(fromNull, base, "null tuning → base unchanged");

  console.log("mergeDigestTuning ✓");
}

// --- ALLOWED_TUNING_KEYS ---
{
  assert.ok(Array.isArray(ALLOWED_TUNING_KEYS), "ALLOWED_TUNING_KEYS is an array");
  assert.ok(ALLOWED_TUNING_KEYS.includes("maxAgeHours"), "maxAgeHours is allowed");
  assert.ok(ALLOWED_TUNING_KEYS.includes("weights"), "weights is allowed");
  assert.ok(!ALLOWED_TUNING_KEYS.includes("keys"), "keys is not allowed (security)");
  console.log("ALLOWED_TUNING_KEYS ✓");
}

console.log("All digest-tuning-runtime tests passed ✓");
```

- [ ] **Step 2: Confirm tests fail**

```bash
/opt/homebrew/bin/node src/runtime/digest-tuning-runtime.test.js 2>&1 | head -10
```
Expected: `Cannot find module './digest-tuning-runtime'`

### Step 2b: Implement `src/runtime/digest-tuning-runtime.js`

- [ ] **Step 3: Create `src/runtime/digest-tuning-runtime.js`**

```js
"use strict";

/**
 * Digest tuning runtime — loads per-run scoring overrides from
 * data/digest-tuning.json without touching config.json.
 *
 * Design: read fresh from disk on every digest run so operator changes
 * take effect on the next run automatically without restarting anything.
 */

const ALLOWED_TUNING_KEYS = [
  "weights",
  "maxAgeHours",
  "maxItemsPerSourceDomain",
  "crossDayDedupDays",
  "historyLookbackDays",
  "laneBonuses",
  "tierScores",
];

const NUMERIC_KEYS = new Set([
  "maxAgeHours",
  "maxItemsPerSourceDomain",
  "crossDayDedupDays",
  "historyLookbackDays",
]);

const OBJECT_KEYS = new Set(["weights", "laneBonuses", "tierScores"]);

const WEIGHT_COMPONENT_KEYS = ["freshness", "source_tier", "lane_bonus", "novelty"];

/**
 * Load digest-tuning.json from disk.
 * Returns {} if the file is missing, unreadable, or has invalid JSON.
 * Returns {} if the parsed value is not a plain object.
 *
 * @param {string} tuningPath  absolute path to digest-tuning.json
 * @param {typeof import('fs')} fs
 * @returns {object}
 */
function loadDigestTuning(tuningPath, fs) {
  let raw;
  try {
    raw = fs.readFileSync(String(tuningPath || ""), "utf8");
  } catch (_) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

/**
 * Validate a tuning object against the allowed key set and type constraints.
 *
 * @param {object} tuning
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateDigestTuning(tuning) {
  if (!tuning || typeof tuning !== "object" || Array.isArray(tuning)) {
    return { ok: false, errors: ["tuning must be a plain object"] };
  }

  const errors = [];
  const allowedSet = new Set(ALLOWED_TUNING_KEYS);

  for (const key of Object.keys(tuning)) {
    if (!allowedSet.has(key)) {
      errors.push(`unknown tuning key: "${key}" — allowed keys: ${ALLOWED_TUNING_KEYS.join(", ")}`);
      continue;
    }
    const value = tuning[key];

    if (NUMERIC_KEYS.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`"${key}" must be a non-negative finite number, got: ${JSON.stringify(value)}`);
      }
      continue;
    }

    if (OBJECT_KEYS.has(key)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`"${key}" must be a plain object, got: ${JSON.stringify(value)}`);
        continue;
      }
      // Validate weights sub-keys if present
      if (key === "weights") {
        for (const wKey of WEIGHT_COMPONENT_KEYS) {
          if (!(wKey in value)) continue;
          const w = Number(value[wKey]);
          if (!Number.isFinite(w) || w < 0 || w > 1) {
            errors.push(`"weights.${wKey}" must be a number in [0,1], got: ${JSON.stringify(value[wKey])}`);
          }
        }
        for (const wKey of Object.keys(value)) {
          if (!WEIGHT_COMPONENT_KEYS.includes(wKey)) {
            errors.push(`"weights.${wKey}" is not a recognized weight component`);
          }
        }
      }
      continue;
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Merge tuning overrides on top of a base scoring config object.
 * Only ALLOWED_TUNING_KEYS are merged; all other base keys are preserved.
 *
 * @param {object} base   — CONFIG.digest.scoring or similar
 * @param {object|null} tuning — result of loadDigestTuning (may be {} or null)
 * @returns {object}
 */
function mergeDigestTuning(base, tuning) {
  const safeBase = (base && typeof base === "object" && !Array.isArray(base)) ? base : {};
  const safeTuning = (tuning && typeof tuning === "object" && !Array.isArray(tuning)) ? tuning : {};
  if (Object.keys(safeTuning).length === 0) return safeBase;

  const merged = { ...safeBase };
  for (const key of ALLOWED_TUNING_KEYS) {
    if (!(key in safeTuning)) continue;
    const val = safeTuning[key];
    if (OBJECT_KEYS.has(key)) {
      // Shallow merge object values so callers can partially override e.g. laneBonuses
      merged[key] = { ...(safeBase[key] || {}), ...val };
    } else {
      merged[key] = val;
    }
  }
  return merged;
}

module.exports = {
  loadDigestTuning,
  validateDigestTuning,
  mergeDigestTuning,
  ALLOWED_TUNING_KEYS,
};
```

- [ ] **Step 4: Confirm tests pass**

```bash
/opt/homebrew/bin/node src/runtime/digest-tuning-runtime.test.js
```
Expected: `All digest-tuning-runtime tests passed ✓`

- [ ] **Step 5: Run harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/runtime/digest-tuning-runtime.js src/runtime/digest-tuning-runtime.test.js
git commit -m "feat: add digest-tuning-runtime (load/validate/merge digest-tuning.json)"
```

---

## Task 3: Wire Digest Tuning into Orchestrator Core

**Context:** `digest-orchestrator-core-runtime.js` creates the selection runtime at line ~948 and passes `CONFIG` into it. The selection runtime reads `CONFIG.digest?.scoring` at line 126 when calling `scoreCandidates`. We need to read `data/digest-tuning.json` at the top of each `main()` run and pass the merged scoring config through to the selection runtime.

The cleanest approach: load tuning before creating the selection runtime, merge it into a local `tuningOverrides` object, and pass `tuningOverrides` into `createDigestOrchestratorSelectionRuntime` as a new optional `scoringOverrides` dep. The selection runtime merges overrides into `scoringConfig` at call time.

The second approach (simpler, fewer changes): load tuning in `main()` before calling `selectionRuntime.selectForEnrichment`, then pass `scoringConfig` explicitly to `selectForEnrichment` as an extra param that overrides `CONFIG.digest?.scoring`. The selection runtime already reads `CONFIG.digest?.scoring` — so instead, we make `selectForEnrichment` accept an optional `scoringConfig` override param.

We use the second approach since it changes fewer files.

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-core-runtime.js`
- Modify: `src/entrypoints/digest-orchestrator-selection-runtime.js`

- [ ] **Step 1: Modify `selectForEnrichment` to accept `scoringConfig` override param**

In `src/entrypoints/digest-orchestrator-selection-runtime.js`, the function signature at line 52 is:
```js
async function selectForEnrichment(params) {
  const { allItems, selectionTarget, customTags, tagPriority, runMode,
          digestDateKey, dueUsersCount, standardFetchCallsPlanned } = params;
```

Add `scoringConfig: paramScoringConfig` to the destructuring. Then at line 126 change:
```js
const scoringConfig = CONFIG.digest?.scoring || {};
```
to:
```js
const scoringConfig = paramScoringConfig && typeof paramScoringConfig === "object"
  ? paramScoringConfig
  : (CONFIG.digest?.scoring || {});
```

Also add `crossDayDedupDays` and `historyLookbackDays` override support. At line 64:
```js
const crossDayDedupDays = Math.max(1, Number(CONFIG.digest.crossDayDedupDays || 3));
```
Change to:
```js
const crossDayDedupDays = Math.max(1, Number(
  (paramScoringConfig && paramScoringConfig.crossDayDedupDays != null)
    ? paramScoringConfig.crossDayDedupDays
    : (CONFIG.digest.crossDayDedupDays || 3)
));
```

At line 93:
```js
const historyLookbackDays = Math.max(4, Number(CONFIG.digest?.historyLookbackDays || 7));
```
Change to:
```js
const historyLookbackDays = Math.max(4, Number(
  (paramScoringConfig && paramScoringConfig.historyLookbackDays != null)
    ? paramScoringConfig.historyLookbackDays
    : (CONFIG.digest?.historyLookbackDays || 7)
));
```

At line 165 (inside `selectItems` call):
```js
maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
```
Change to:
```js
maxItemsPerSourceDomain: (paramScoringConfig && paramScoringConfig.maxItemsPerSourceDomain != null)
  ? paramScoringConfig.maxItemsPerSourceDomain
  : CONFIG.digest.maxItemsPerSourceDomain,
```

- [ ] **Step 2: Load tuning overrides in `main()` in `digest-orchestrator-core-runtime.js`**

Add the require near the top of the file (after existing requires around line 100):
```js
const { loadDigestTuning, mergeDigestTuning } = require("../runtime/digest-tuning-runtime");
```

Add a constant for the tuning path after `RUNTIME_PATHS` is established (around line 120):
```js
const DIGEST_TUNING_PATH = path.join(RUNTIME_PATHS.dataDir || path.join(APP_ROOT, "data"), "digest-tuning.json");
```

In `main()`, after the source registry is loaded (around line 892, after `setAdminSourceRegistry`), add:
```js
const rawTuning = loadDigestTuning(DIGEST_TUNING_PATH, fs);
const mergedScoringConfig = mergeDigestTuning(CONFIG.digest?.scoring || {}, rawTuning);
if (Object.keys(rawTuning).length > 0) {
  log(`[digest-tuning] overrides active: ${Object.keys(rawTuning).join(", ")}`);
}
```

Then in the `selectForEnrichment` call (around line 971), add `scoringConfig: mergedScoringConfig` to the params object:
```js
const { selected, ... } = await selectionRuntime.selectForEnrichment({
  allItems,
  selectionTarget,
  customTags,
  tagPriority,
  runMode,
  digestDateKey,
  dueUsersCount: dueUsers.length,
  standardFetchCallsPlanned,
  scoringConfig: mergedScoringConfig,   // ← add this
});
```

- [ ] **Step 3: Verify the harness still passes**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/entrypoints/digest-orchestrator-core-runtime.js \
        src/entrypoints/digest-orchestrator-selection-runtime.js
git commit -m "feat: load digest-tuning.json overrides fresh each run and pass to scoring"
```

---

## Task 4: Admin API — Digest Tuning (`web/routes/admin-api-digest-tuning-runtime.js`)

**Context:** The admin API handler pattern is `async function handleAdminXxxRoutes(ctx, deps)` returning `true` if handled. `deps` contains `{ json, isAdminAuthed, requireJsonBody, fs, path, ... }`. We need to add `digestTuningPath` to `deps`.

Routes:
- `GET /api/admin/digest-tuning` — returns current `digest-tuning.json` content (or `{}` if missing)
- `PUT /api/admin/digest-tuning` — validates and writes new content; rejects unknown keys

**Files:**
- Create: `web/routes/admin-api-digest-tuning-runtime.js`
- Create: `web/routes/admin-api-digest-tuning-runtime.test.js`
- Modify: `web/routes/admin-api.js`
- Modify: `web/server-runtime-admin-registry-runtime.js`
- Modify: `web/server-runtime.js`

### Step 4a: Write failing tests

- [ ] **Step 1: Write `web/routes/admin-api-digest-tuning-runtime.test.js`**

```js
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { handleAdminDigestTuningRoutes } = require("./admin-api-digest-tuning-runtime");

function buildCtx(method, pathname, body = null) {
  const url = new URL(`http://localhost${pathname}`);
  const req = {
    method,
    _body: body,
  };
  return { req, res: buildRes(), pathname, url };
}

function buildRes() {
  const res = {
    statusCode: 200,
    _headers: {},
    _body: "",
    writeHead(code, headers = {}) { this.statusCode = code; this._headers = { ...this._headers, ...headers }; },
    end(body) { this._body = body; },
  };
  return res;
}

function buildDeps(tuningPath, overrides = {}) {
  return {
    json(res, data, status = 200) { res.writeHead(status); res.end(JSON.stringify(data)); },
    isAdminAuthed: () => true,
    requireJsonBody: async (req) => req._body || {},
    digestTuningPath: tuningPath,
    fs,
    path,
    ...overrides,
  };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-tuning-api-test-"));
const tuningPath = path.join(tmpDir, "digest-tuning.json");

// GET — missing file returns {}
{
  const ctx = buildCtx("GET", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true, "GET handled");
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true, "ok: true");
    assert.deepStrictEqual(body.tuning, {}, "empty tuning when missing");
    console.log("GET missing file → {} ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// GET — existing file returns content
{
  const content = { maxAgeHours: 36 };
  fs.writeFileSync(tuningPath, JSON.stringify(content));
  const ctx = buildCtx("GET", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.tuning.maxAgeHours, 36, "content returned");
    console.log("GET existing file ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// PUT — valid update writes file
{
  const newTuning = { maxAgeHours: 48, crossDayDedupDays: 5 };
  const ctx = buildCtx("PUT", "/api/admin/digest-tuning", newTuning);
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true, "PUT handled");
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true, "PUT ok: true");
    const onDisk = JSON.parse(fs.readFileSync(tuningPath, "utf8"));
    assert.strictEqual(onDisk.maxAgeHours, 48, "file written");
    assert.strictEqual(onDisk.crossDayDedupDays, 5, "crossDayDedupDays written");
    console.log("PUT valid → writes file ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// PUT — unknown key rejected
{
  const badTuning = { unknownKey: 123 };
  const ctx = buildCtx("PUT", "/api/admin/digest-tuning", badTuning);
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 400, "invalid tuning → 400");
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, false, "ok: false");
    console.log("PUT invalid key → 400 ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Unauthorized request → 401
{
  const ctx = buildCtx("GET", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath, { isAdminAuthed: () => false });
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 401, "unauthed → 401");
    console.log("Unauthed → 401 ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Non-matching path → not handled
{
  const ctx = buildCtx("GET", "/api/admin/other");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, false, "non-matching path → false");
    console.log("Non-matching path → false ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// DELETE → 405
{
  const ctx = buildCtx("DELETE", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 405, "unsupported method → 405");
    console.log("DELETE → 405 ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

console.log("All digest-tuning API tests queued ✓");
```

- [ ] **Step 2: Confirm tests fail**

```bash
/opt/homebrew/bin/node web/routes/admin-api-digest-tuning-runtime.test.js 2>&1 | head -5
```
Expected: `Cannot find module`

### Step 4b: Implement the handler

- [ ] **Step 3: Create `web/routes/admin-api-digest-tuning-runtime.js`**

```js
"use strict";

const {
  loadDigestTuning,
  validateDigestTuning,
  ALLOWED_TUNING_KEYS,
} = require("../../src/runtime/digest-tuning-runtime");

/**
 * GET  /api/admin/digest-tuning  — read current overrides
 * PUT  /api/admin/digest-tuning  — replace overrides (validated)
 * DELETE not supported (use PUT with {})
 */
async function handleAdminDigestTuningRoutes(ctx, deps) {
  const { req, res, pathname } = ctx;
  const { json, isAdminAuthed, requireJsonBody, digestTuningPath, fs, path } = deps;

  if (pathname !== "/api/admin/digest-tuning") return false;

  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  if (req.method === "GET") {
    const tuning = loadDigestTuning(String(digestTuningPath || ""), fs);
    json(res, { ok: true, tuning, allowed_keys: ALLOWED_TUNING_KEYS });
    return true;
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await requireJsonBody(req);
    } catch (_) {
      json(res, { ok: false, error: "invalid_json" }, 400);
      return true;
    }

    const { ok, errors } = validateDigestTuning(body || {});
    if (!ok) {
      json(res, { ok: false, error: "validation_failed", errors }, 400);
      return true;
    }

    const tuningPath = String(digestTuningPath || "");
    if (!tuningPath) {
      json(res, { ok: false, error: "tuning_path_not_configured" }, 500);
      return true;
    }

    try {
      const dir = path.dirname(tuningPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tuningPath, JSON.stringify(body, null, 2), "utf8");
    } catch (err) {
      json(res, { ok: false, error: "write_failed", detail: String(err?.message || err).slice(0, 120) }, 500);
      return true;
    }

    json(res, { ok: true, tuning: body, message: "Tuning saved. Changes take effect on the next digest run." });
    return true;
  }

  json(res, { ok: false, error: "method_not_allowed", allowed: ["GET", "PUT"] }, 405);
  return true;
}

module.exports = { handleAdminDigestTuningRoutes };
```

- [ ] **Step 4: Confirm tests pass**

```bash
/opt/homebrew/bin/node web/routes/admin-api-digest-tuning-runtime.test.js
```

- [ ] **Step 5: Wire handler into `web/routes/admin-api.js`**

Add to the top of `web/routes/admin-api.js`:
```js
const { handleAdminDigestTuningRoutes } = require("./admin-api-digest-tuning-runtime");
```

Add the dispatch call inside `createAdminApiRouteHandler`, after the existing `handleAdminSourceHealthRoutes` call:
```js
if (await handleAdminDigestTuningRoutes(ctx, deps)) return true;
```

- [ ] **Step 6: Add `digestTuningPath` to the admin deps registry**

In `web/server-runtime-admin-registry-runtime.js`, add `digestTuningPath` to the destructuring (line ~73) and include it in the return object.

In `web/server-runtime.js`, add to the `createServerRouteDependencies` call:
```js
digestTuningPath: path.join(runtimePaths.dataDir, "digest-tuning.json"),
```

- [ ] **Step 7: Run harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add web/routes/admin-api-digest-tuning-runtime.js \
        web/routes/admin-api-digest-tuning-runtime.test.js \
        web/routes/admin-api.js \
        web/server-runtime-admin-registry-runtime.js \
        web/server-runtime.js
git commit -m "feat: admin API GET/PUT /api/admin/digest-tuning (§2.7)"
```

---

## Task 5: Editorial Overrides Runtime (`src/digest/domain/editorial-overrides-runtime.js`)

**Context:** This module manages three types of editorial overrides stored in `data/editorial-overrides.json`:
1. `pins` — force a URL into the final selection for a topic on a given date
2. `excludes` — remove a URL from consideration
3. `source_suppressions` — ignore all items from a domain on a given date

The `date` field in each entry is the active-through date. Entries with a date on or before today are active. Entries older than 7 days from today are auto-pruned on write.

Key functions:
- `loadEditorialOverrides(overridesPath, fs)` — reads and parses the file, returns `{ pins: [], excludes: [], source_suppressions: [] }`
- `saveEditorialOverrides(overridesPath, overrides, todayStr, fs, path)` — prunes stale entries (>7 days old), writes to disk
- `isUrlExcluded(url, excludes, todayStr)` — returns boolean
- `isDomainSuppressed(domain, source_suppressions, todayStr)` — returns boolean
- `getPinsForDate(pins, todayStr)` — returns pins active on today

**Files:**
- Create: `src/digest/domain/editorial-overrides-runtime.js`
- Create: `src/digest/domain/editorial-overrides-runtime.test.js`

### Step 5a: Write failing tests

- [ ] **Step 1: Write `src/digest/domain/editorial-overrides-runtime.test.js`**

```js
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  loadEditorialOverrides,
  saveEditorialOverrides,
  isUrlExcluded,
  isDomainSuppressed,
  getPinsForDate,
  pruneStaleEntries,
} = require("./editorial-overrides-runtime");

const TODAY = "2026-03-24";
const YESTERDAY = "2026-03-23";
const EIGHT_DAYS_AGO = "2026-03-16";
const TOMORROW = "2026-03-25";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-editorial-test-"));
const overridesPath = path.join(tmpDir, "editorial-overrides.json");

// --- loadEditorialOverrides ---
{
  // Missing file → empty structure
  const result = loadEditorialOverrides("/nonexistent/path.json", fs);
  assert.deepStrictEqual(result.pins, [], "missing file → empty pins");
  assert.deepStrictEqual(result.excludes, [], "missing file → empty excludes");
  assert.deepStrictEqual(result.source_suppressions, [], "missing file → empty suppressions");
  console.log("loadEditorialOverrides missing ✓");
}

{
  // Valid file → correct shape
  const overrides = {
    pins: [{ url: "https://example.com/article", topic: "TECHNOLOGY", date: TODAY, note: "" }],
    excludes: [{ url: "https://bad.com/article", date: TODAY, note: "" }],
    source_suppressions: [{ domain: "spam.com", date: TODAY, note: "" }],
  };
  fs.writeFileSync(overridesPath, JSON.stringify(overrides));
  const loaded = loadEditorialOverrides(overridesPath, fs);
  assert.strictEqual(loaded.pins.length, 1, "pins loaded");
  assert.strictEqual(loaded.excludes.length, 1, "excludes loaded");
  assert.strictEqual(loaded.source_suppressions.length, 1, "suppressions loaded");
  console.log("loadEditorialOverrides valid ✓");
}

// --- pruneStaleEntries ---
{
  const entries = [
    { url: "a", date: TODAY },          // active: today
    { url: "b", date: YESTERDAY },      // active: yesterday (within 7 days)
    { url: "c", date: EIGHT_DAYS_AGO }, // stale: 8 days ago
    { url: "d", date: TOMORROW },       // active: tomorrow (future pin)
  ];
  const pruned = pruneStaleEntries(entries, TODAY);
  assert.strictEqual(pruned.length, 3, "stale entry pruned");
  assert.ok(!pruned.some((e) => e.url === "c"), "8-day-old entry removed");
  assert.ok(pruned.some((e) => e.url === "d"), "future entry kept");
  console.log("pruneStaleEntries ✓");
}

// --- isUrlExcluded ---
{
  const excludes = [
    { url: "https://bad.com/article", date: TODAY },
    { url: "https://old.com/article", date: EIGHT_DAYS_AGO }, // stale, should not match
  ];
  assert.strictEqual(isUrlExcluded("https://bad.com/article", excludes, TODAY), true, "active exclude matches");
  assert.strictEqual(isUrlExcluded("https://good.com/article", excludes, TODAY), false, "non-excluded URL");
  assert.strictEqual(isUrlExcluded("https://old.com/article", excludes, TODAY), false, "stale exclude does not apply");
  assert.strictEqual(isUrlExcluded("", excludes, TODAY), false, "empty URL → false");
  console.log("isUrlExcluded ✓");
}

// --- isDomainSuppressed ---
{
  const suppressions = [
    { domain: "spam.com", date: TODAY },
    { domain: "expired.com", date: EIGHT_DAYS_AGO },
  ];
  assert.strictEqual(isDomainSuppressed("spam.com", suppressions, TODAY), true, "active suppression");
  assert.strictEqual(isDomainSuppressed("ok.com", suppressions, TODAY), false, "not suppressed");
  assert.strictEqual(isDomainSuppressed("expired.com", suppressions, TODAY), false, "expired suppression inactive");
  assert.strictEqual(isDomainSuppressed("", suppressions, TODAY), false, "empty domain → false");
  console.log("isDomainSuppressed ✓");
}

// --- getPinsForDate ---
{
  const pins = [
    { url: "https://pinned.com/a", topic: "TECHNOLOGY", date: TODAY, note: "" },
    { url: "https://pinned.com/b", topic: "HEALTHCARE", date: YESTERDAY, note: "" },
    { url: "https://future.com/c", topic: "ENERGY", date: TOMORROW, note: "" },
    { url: "https://stale.com/d", topic: "INDUSTRIALS", date: EIGHT_DAYS_AGO, note: "" },
  ];
  const active = getPinsForDate(pins, TODAY);
  assert.strictEqual(active.length, 2, "2 active pins for today");
  assert.ok(active.some((p) => p.url === "https://pinned.com/a"), "today pin included");
  assert.ok(active.some((p) => p.url === "https://pinned.com/b"), "yesterday pin included (within window)");
  assert.ok(!active.some((p) => p.url === "https://future.com/c"), "future pin excluded");
  assert.ok(!active.some((p) => p.url === "https://stale.com/d"), "stale pin excluded");
  console.log("getPinsForDate ✓");
}

// --- saveEditorialOverrides ---
{
  const overrides = {
    pins: [],
    excludes: [
      { url: "https://bad.com/a", date: TODAY },
      { url: "https://stale.com/b", date: EIGHT_DAYS_AGO }, // should be pruned
    ],
    source_suppressions: [],
  };
  const savePath = path.join(tmpDir, "saved-overrides.json");
  saveEditorialOverrides(savePath, overrides, TODAY, fs, path);
  const onDisk = JSON.parse(fs.readFileSync(savePath, "utf8"));
  assert.strictEqual(onDisk.excludes.length, 1, "stale entry pruned on save");
  assert.strictEqual(onDisk.excludes[0].url, "https://bad.com/a", "active entry kept");
  console.log("saveEditorialOverrides ✓");
}

console.log("All editorial-overrides-runtime tests passed ✓");
```

- [ ] **Step 2: Confirm tests fail**

```bash
/opt/homebrew/bin/node src/digest/domain/editorial-overrides-runtime.test.js 2>&1 | head -5
```

### Step 5b: Implement the module

- [ ] **Step 3: Create `src/digest/domain/editorial-overrides-runtime.js`**

```js
"use strict";

/**
 * Editorial overrides runtime — loads, saves, and queries operator overrides
 * stored in data/editorial-overrides.json.
 *
 * Overrides:
 *   pins              — force a URL into selection for a topic
 *   excludes          — remove a URL from candidate pool
 *   source_suppressions — suppress all items from a domain
 *
 * "date" field is the last active date (inclusive). Entries older than
 * PRUNE_DAYS_OLD days are auto-pruned on write.
 */

const PRUNE_DAYS_OLD = 7;

function emptyOverrides() {
  return { pins: [], excludes: [], source_suppressions: [] };
}

/**
 * Load editorial-overrides.json. Returns empty structure if missing or invalid.
 */
function loadEditorialOverrides(overridesPath, fs) {
  let raw;
  try {
    raw = fs.readFileSync(String(overridesPath || ""), "utf8");
  } catch (_) {
    return emptyOverrides();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return emptyOverrides();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyOverrides();
  return {
    pins: Array.isArray(parsed.pins) ? parsed.pins : [],
    excludes: Array.isArray(parsed.excludes) ? parsed.excludes : [],
    source_suppressions: Array.isArray(parsed.source_suppressions) ? parsed.source_suppressions : [],
  };
}

/**
 * Compute the cutoff date string for pruning (PRUNE_DAYS_OLD days before today).
 * Entries with a date strictly before this cutoff are stale.
 *
 * @param {string} todayStr  YYYY-MM-DD
 * @returns {string} cutoff YYYY-MM-DD
 */
function computePruneCutoff(todayStr) {
  const d = new Date(todayStr);
  if (isNaN(d.getTime())) return "1970-01-01";
  d.setDate(d.getDate() - PRUNE_DAYS_OLD);
  return d.toISOString().slice(0, 10);
}

/**
 * Remove entries whose date is more than PRUNE_DAYS_OLD days before today.
 * Future entries (date > today) are kept so pre-planned overrides survive.
 *
 * @param {Array<{ date: string }>} entries
 * @param {string} todayStr  YYYY-MM-DD
 * @returns {Array}
 */
function pruneStaleEntries(entries, todayStr) {
  const cutoff = computePruneCutoff(todayStr);
  return (Array.isArray(entries) ? entries : []).filter((e) => {
    const d = String(e?.date || "").trim();
    if (!d) return false; // malformed → prune
    return d >= cutoff; // keep if within the window (or future)
  });
}

/**
 * Save overrides to disk, pruning stale entries first.
 *
 * @param {string} overridesPath
 * @param {{ pins, excludes, source_suppressions }} overrides
 * @param {string} todayStr  YYYY-MM-DD
 * @param {typeof import('fs')} fs
 * @param {typeof import('path')} path
 */
function saveEditorialOverrides(overridesPath, overrides, todayStr, fs, path) {
  const safe = {
    pins: pruneStaleEntries(overrides.pins, todayStr),
    excludes: pruneStaleEntries(overrides.excludes, todayStr),
    source_suppressions: pruneStaleEntries(overrides.source_suppressions, todayStr),
  };
  const dir = path.dirname(String(overridesPath || ""));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(String(overridesPath), JSON.stringify(safe, null, 2), "utf8");
}

/**
 * Returns true if the URL is actively excluded on todayStr.
 * An entry is active if its date >= today's prune cutoff and <= today.
 */
function isUrlExcluded(url, excludes, todayStr) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return false;
  const cutoff = computePruneCutoff(todayStr);
  return (Array.isArray(excludes) ? excludes : []).some((e) => {
    const d = String(e?.date || "").trim();
    if (!d || d < cutoff || d > todayStr) return false;
    return String(e?.url || "").trim() === normalizedUrl;
  });
}

/**
 * Returns true if the domain is actively suppressed on todayStr.
 */
function isDomainSuppressed(domain, source_suppressions, todayStr) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedDomain) return false;
  const cutoff = computePruneCutoff(todayStr);
  return (Array.isArray(source_suppressions) ? source_suppressions : []).some((e) => {
    const d = String(e?.date || "").trim();
    if (!d || d < cutoff || d > todayStr) return false;
    return String(e?.domain || "").trim().toLowerCase() === normalizedDomain;
  });
}

/**
 * Returns pins whose date is within [cutoff, today] — i.e., active now.
 * Future pins (date > today) are excluded from this result.
 */
function getPinsForDate(pins, todayStr) {
  if (!Array.isArray(pins)) return [];
  const cutoff = computePruneCutoff(todayStr);
  return pins.filter((p) => {
    const d = String(p?.date || "").trim();
    return d && d >= cutoff && d <= todayStr;
  });
}

module.exports = {
  loadEditorialOverrides,
  saveEditorialOverrides,
  isUrlExcluded,
  isDomainSuppressed,
  getPinsForDate,
  pruneStaleEntries,
  emptyOverrides,
};
```

- [ ] **Step 4: Confirm tests pass**

```bash
/opt/homebrew/bin/node src/digest/domain/editorial-overrides-runtime.test.js
```
Expected: `All editorial-overrides-runtime tests passed ✓`

- [ ] **Step 5: Run harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/digest/domain/editorial-overrides-runtime.js \
        src/digest/domain/editorial-overrides-runtime.test.js
git commit -m "feat: add editorial-overrides-runtime (pin/exclude/suppress)"
```

---

## Task 6: Apply Editorial Overrides in Selection

**Context:** In `digest-orchestrator-selection-runtime.js`, `selectForEnrichment` receives `allItems` — the full post-fetch candidate pool — before any dedup or scoring. We apply editorial overrides at the very start of `selectForEnrichment`:

1. Filter out excluded URLs
2. Filter out suppressed source domains  
3. Inject pinned items (skipping any already present)

The overrides module and the path to `editorial-overrides.json` need to be added to the `deps` passed to `createDigestOrchestratorSelectionRuntime`, and the path needs to be resolved in `digest-orchestrator-core-runtime.js`.

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-selection-runtime.js`
- Modify: `src/entrypoints/digest-orchestrator-core-runtime.js`

- [ ] **Step 1: Add editorial overrides application to `selectForEnrichment`**

Add to the `deps` destructuring in `createDigestOrchestratorSelectionRuntime`:
```js
loadEditorialOverrides,
editorialOverridesPath,
isUrlExcluded,
isDomainSuppressed,
getPinsForDate,
```

At the very start of `selectForEnrichment`, after destructuring `params` but before cross-day dedup, add:

```js
const todayStr = String(digestDateKey || "").slice(0, 10);

// Apply editorial overrides: excludes, domain suppressions, and pins.
let editorialOverrides = { pins: [], excludes: [], source_suppressions: [] };
if (typeof loadEditorialOverrides === "function" && editorialOverridesPath) {
  editorialOverrides = loadEditorialOverrides(editorialOverridesPath);
}

// Remove excluded URLs
const excludedCount = allItems.filter((item) =>
  isUrlExcluded(String(item?.url || ""), editorialOverrides.excludes, todayStr)
).length;
if (excludedCount > 0) {
  log(`Editorial overrides: excluded ${excludedCount} item(s) by URL`);
}
allItems = allItems.filter((item) =>
  !isUrlExcluded(String(item?.url || ""), editorialOverrides.excludes, todayStr)
);

// Remove domain-suppressed items
const suppressedCount = allItems.filter((item) => {
  const domain = String(item?.source_domain || item?.source || "").toLowerCase();
  return isDomainSuppressed(domain, editorialOverrides.source_suppressions, todayStr);
}).length;
if (suppressedCount > 0) {
  log(`Editorial overrides: suppressed ${suppressedCount} item(s) by source domain`);
}
allItems = allItems.filter((item) => {
  const domain = String(item?.source_domain || item?.source || "").toLowerCase();
  return !isDomainSuppressed(domain, editorialOverrides.source_suppressions, todayStr);
});

// Inject pinned items (mark them so selection policy keeps them)
const activePins = typeof getPinsForDate === "function"
  ? getPinsForDate(editorialOverrides.pins, todayStr)
  : [];
if (activePins.length > 0) {
  const existingUrls = new Set(allItems.map((item) => String(item?.url || "").trim()));
  let injectedCount = 0;
  for (const pin of activePins) {
    const pinUrl = String(pin?.url || "").trim();
    if (!pinUrl || existingUrls.has(pinUrl)) continue;
    // Inject as a high-priority synthetic item so it survives scoring
    allItems.push({
      url: pinUrl,
      headline: pin.note || `Pinned: ${pinUrl}`,
      tag: String(pin.topic || "").trim().toUpperCase() || "__pinned__",
      _editorial_pin: true,
      _score: 1.0, // ensures it is not filtered by score
      source: "editorial-pin",
      source_domain: "editorial-pin",
      source_tier: 1,
    });
    existingUrls.add(pinUrl);
    injectedCount += 1;
  }
  if (injectedCount > 0) {
    log(`Editorial overrides: injected ${injectedCount} pinned item(s)`);
  }
}
```

- [ ] **Step 1b: Convert `allItems` from `const` destructuring to `let`**

In `src/entrypoints/digest-orchestrator-selection-runtime.js`, find where `allItems` is destructured from `params` (near the top of the main exported function). Change it from:
```js
const { allItems, ... } = params;
```
to:
```js
const { ... } = params;
let allItems = params.allItems;  // must be let — editorial override block reassigns it below
```
This step must be done before the override block or the reassignment will throw `TypeError: Assignment to constant variable`.

- [ ] **Step 2: Pass editorial override deps from `digest-orchestrator-core-runtime.js`**

Add require:
```js
const {
  loadEditorialOverrides,
  isUrlExcluded,
  isDomainSuppressed,
  getPinsForDate,
} = require("../digest/domain/editorial-overrides-runtime");
```

Add path constant:
```js
const EDITORIAL_OVERRIDES_PATH = path.join(RUNTIME_PATHS.dataDir || path.join(APP_ROOT, "data"), "editorial-overrides.json");
```

Pass to `createDigestOrchestratorSelectionRuntime` call:
```js
const selectionRuntime = createDigestOrchestratorSelectionRuntime({
  CONFIG,
  log,
  createDigestPolicies,
  dedupAgainstRecentArchives,
  buildRecentRepeatIndex,
  selectItems,
  loadRecentArchiveItems,
  loadRecentArchiveByDate,
  buildRepeatHistory,
  filterItemsAgainstHistory,
  buildRepetitionNote,
  emitDigestIncident,
  articleAgeTooOld,
  // editorial overrides
  loadEditorialOverrides: (p) => loadEditorialOverrides(p, fs),
  editorialOverridesPath: EDITORIAL_OVERRIDES_PATH,
  isUrlExcluded,
  isDomainSuppressed,
  getPinsForDate,
});
```

- [ ] **Step 3: Run harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/entrypoints/digest-orchestrator-selection-runtime.js \
        src/entrypoints/digest-orchestrator-core-runtime.js
git commit -m "feat: apply editorial overrides (pin/exclude/suppress) before selection"
```

---

## Task 7: Admin API — Editorial Overrides (`web/routes/admin-api-editorial-overrides-runtime.js`)

**Context:** Routes:
- `GET /api/admin/editorial-overrides` — returns current overrides
- `POST /api/admin/editorial-overrides/pins` — add a pin entry
- `POST /api/admin/editorial-overrides/excludes` — add an exclude entry
- `POST /api/admin/editorial-overrides/suppressions` — add a source suppression entry
- `DELETE /api/admin/editorial-overrides/pins?url=...` — remove a pin by URL
- `DELETE /api/admin/editorial-overrides/excludes?url=...` — remove an exclude by URL
- `DELETE /api/admin/editorial-overrides/suppressions?domain=...` — remove a suppression by domain

**Files:**
- Create: `web/routes/admin-api-editorial-overrides-runtime.js`
- Create: `web/routes/admin-api-editorial-overrides-runtime.test.js`
- Modify: `web/routes/admin-api.js`
- Modify: `web/server-runtime-admin-registry-runtime.js`
- Modify: `web/server-runtime.js`

### Step 7a: Write failing tests

- [ ] **Step 1: Write `web/routes/admin-api-editorial-overrides-runtime.test.js`**

```js
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { handleAdminEditorialOverridesRoutes } = require("./admin-api-editorial-overrides-runtime");

const TODAY = "2026-03-24";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-editorial-api-test-"));
const overridesPath = path.join(tmpDir, "editorial-overrides.json");

function buildCtx(method, pathname, body = null, search = "") {
  const url = new URL(`http://localhost${pathname}${search}`);
  return { req: { method, _body: body }, res: buildRes(), pathname, url };
}

function buildRes() {
  const res = { statusCode: 200, _body: "" };
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (body) => { res._body = body; };
  return res;
}

function buildDeps(overrides = {}) {
  return {
    json(res, data, status = 200) { res.writeHead(status); res.end(JSON.stringify(data)); },
    isAdminAuthed: () => true,
    requireJsonBody: async (req) => req._body || {},
    editorialOverridesPath: overridesPath,
    todayStr: TODAY,
    fs,
    path,
    ...overrides,
  };
}

// GET — empty
(async () => {
  const ctx = buildCtx("GET", "/api/admin/editorial-overrides");
  await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
  const body = JSON.parse(ctx.res._body);
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.overrides.pins, []);
  console.log("GET empty ✓");
})().catch((e) => { console.error(e); process.exit(1); });

// POST /pins
(async () => {
  const ctx = buildCtx("POST", "/api/admin/editorial-overrides/pins", {
    url: "https://example.com/a", topic: "TECHNOLOGY", date: TODAY, note: "test pin"
  });
  await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
  const body = JSON.parse(ctx.res._body);
  assert.strictEqual(body.ok, true);
  const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  assert.strictEqual(on.pins.length, 1);
  console.log("POST /pins ✓");
})().catch((e) => { console.error(e); process.exit(1); });

// POST /excludes
(async () => {
  const ctx = buildCtx("POST", "/api/admin/editorial-overrides/excludes", {
    url: "https://bad.com/b", date: TODAY, note: ""
  });
  await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
  const body = JSON.parse(ctx.res._body);
  assert.strictEqual(body.ok, true);
  const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  assert.strictEqual(on.excludes.length, 1);
  console.log("POST /excludes ✓");
})().catch((e) => { console.error(e); process.exit(1); });

// POST /suppressions
(async () => {
  const ctx = buildCtx("POST", "/api/admin/editorial-overrides/suppressions", {
    domain: "spam.com", date: TODAY, note: ""
  });
  await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
  const body = JSON.parse(ctx.res._body);
  assert.strictEqual(body.ok, true);
  const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  assert.strictEqual(on.source_suppressions.length, 1);
  console.log("POST /suppressions ✓");
})().catch((e) => { console.error(e); process.exit(1); });

// DELETE /pins
(async () => {
  const ctx = buildCtx("DELETE", "/api/admin/editorial-overrides/pins", null, "?url=https://example.com/a");
  await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
  const body = JSON.parse(ctx.res._body);
  assert.strictEqual(body.ok, true);
  const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  assert.strictEqual(on.pins.length, 0, "pin removed");
  console.log("DELETE /pins ✓");
})().catch((e) => { console.error(e); process.exit(1); });

// Unauthed → 401
(async () => {
  const ctx = buildCtx("GET", "/api/admin/editorial-overrides");
  await handleAdminEditorialOverridesRoutes(ctx, buildDeps({ isAdminAuthed: () => false }));
  assert.strictEqual(ctx.res.statusCode, 401);
  console.log("Unauthed → 401 ✓");
})().catch((e) => { console.error(e); process.exit(1); });

// Non-matching path → false
(async () => {
  const ctx = buildCtx("GET", "/api/admin/other");
  const handled = await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
  assert.strictEqual(handled, false);
  console.log("Non-matching → false ✓");
})().catch((e) => { console.error(e); process.exit(1); });

// Missing required field for pin → 400
(async () => {
  const ctx = buildCtx("POST", "/api/admin/editorial-overrides/pins", { topic: "TECHNOLOGY" });
  await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
  assert.strictEqual(ctx.res.statusCode, 400);
  console.log("Missing pin url → 400 ✓");
})().catch((e) => { console.error(e); process.exit(1); });

console.log("Editorial overrides API tests queued ✓");
```

- [ ] **Step 2: Confirm tests fail**

```bash
/opt/homebrew/bin/node web/routes/admin-api-editorial-overrides-runtime.test.js 2>&1 | head -5
```

### Step 7b: Implement the handler

- [ ] **Step 3: Create `web/routes/admin-api-editorial-overrides-runtime.js`**

```js
"use strict";

const {
  loadEditorialOverrides,
  saveEditorialOverrides,
} = require("../../src/digest/domain/editorial-overrides-runtime");

const PREFIX = "/api/admin/editorial-overrides";

function sanitizeDate(val) {
  const s = String(val || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function sanitizeUrl(val) {
  const s = String(val || "").trim();
  return s.startsWith("http") ? s : "";
}

function sanitizeDomain(val) {
  return String(val || "").trim().toLowerCase();
}

async function handleAdminEditorialOverridesRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    editorialOverridesPath,
    todayStr,
    fs,
    path,
  } = deps;

  if (!pathname.startsWith(PREFIX)) return false;

  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const today = todayStr || new Date().toISOString().slice(0, 10);
  const overrides = loadEditorialOverrides(String(editorialOverridesPath || ""), fs);

  // GET /api/admin/editorial-overrides
  if (pathname === PREFIX && req.method === "GET") {
    json(res, { ok: true, overrides });
    return true;
  }

  // POST /api/admin/editorial-overrides/pins
  if (pathname === `${PREFIX}/pins` && req.method === "POST") {
    const body = await requireJsonBody(req);
    const pinUrl = sanitizeUrl(body?.url);
    const date = sanitizeDate(body?.date) || today;
    if (!pinUrl) {
      json(res, { ok: false, error: "validation_failed", errors: ["url is required"] }, 400);
      return true;
    }
    const topic = String(body?.topic || "").trim().toUpperCase();
    const note = String(body?.note || "").trim();
    overrides.pins = overrides.pins.filter((p) => String(p?.url || "") !== pinUrl);
    overrides.pins.push({ url: pinUrl, topic, date, note });
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, overrides });
    return true;
  }

  // POST /api/admin/editorial-overrides/excludes
  if (pathname === `${PREFIX}/excludes` && req.method === "POST") {
    const body = await requireJsonBody(req);
    const exUrl = sanitizeUrl(body?.url);
    const date = sanitizeDate(body?.date) || today;
    if (!exUrl) {
      json(res, { ok: false, error: "validation_failed", errors: ["url is required"] }, 400);
      return true;
    }
    const note = String(body?.note || "").trim();
    overrides.excludes = overrides.excludes.filter((e) => String(e?.url || "") !== exUrl);
    overrides.excludes.push({ url: exUrl, date, note });
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, overrides });
    return true;
  }

  // POST /api/admin/editorial-overrides/suppressions
  if (pathname === `${PREFIX}/suppressions` && req.method === "POST") {
    const body = await requireJsonBody(req);
    const domain = sanitizeDomain(body?.domain);
    const date = sanitizeDate(body?.date) || today;
    if (!domain) {
      json(res, { ok: false, error: "validation_failed", errors: ["domain is required"] }, 400);
      return true;
    }
    const note = String(body?.note || "").trim();
    overrides.source_suppressions = overrides.source_suppressions.filter(
      (s) => String(s?.domain || "").toLowerCase() !== domain
    );
    overrides.source_suppressions.push({ domain, date, note });
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, overrides });
    return true;
  }

  // DELETE /api/admin/editorial-overrides/pins?url=...
  if (pathname === `${PREFIX}/pins` && req.method === "DELETE") {
    const targetUrl = sanitizeUrl(url.searchParams.get("url"));
    if (!targetUrl) {
      json(res, { ok: false, error: "url query param required" }, 400);
      return true;
    }
    const before = overrides.pins.length;
    overrides.pins = overrides.pins.filter((p) => String(p?.url || "") !== targetUrl);
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, removed: before - overrides.pins.length, overrides });
    return true;
  }

  // DELETE /api/admin/editorial-overrides/excludes?url=...
  if (pathname === `${PREFIX}/excludes` && req.method === "DELETE") {
    const targetUrl = sanitizeUrl(url.searchParams.get("url"));
    if (!targetUrl) {
      json(res, { ok: false, error: "url query param required" }, 400);
      return true;
    }
    const before = overrides.excludes.length;
    overrides.excludes = overrides.excludes.filter((e) => String(e?.url || "") !== targetUrl);
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, removed: before - overrides.excludes.length, overrides });
    return true;
  }

  // DELETE /api/admin/editorial-overrides/suppressions?domain=...
  if (pathname === `${PREFIX}/suppressions` && req.method === "DELETE") {
    const targetDomain = sanitizeDomain(url.searchParams.get("domain"));
    if (!targetDomain) {
      json(res, { ok: false, error: "domain query param required" }, 400);
      return true;
    }
    const before = overrides.source_suppressions.length;
    overrides.source_suppressions = overrides.source_suppressions.filter(
      (s) => String(s?.domain || "").toLowerCase() !== targetDomain
    );
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, removed: before - overrides.source_suppressions.length, overrides });
    return true;
  }

  json(res, { ok: false, error: "method_not_allowed" }, 405);
  return true;
}

module.exports = { handleAdminEditorialOverridesRoutes };
```

- [ ] **Step 4: Confirm tests pass**

```bash
/opt/homebrew/bin/node web/routes/admin-api-editorial-overrides-runtime.test.js
```

- [ ] **Step 5: Wire into `web/routes/admin-api.js`**

Add require:
```js
const { handleAdminEditorialOverridesRoutes } = require("./admin-api-editorial-overrides-runtime");
```

Add dispatch after the digest-tuning handler line:
```js
if (await handleAdminEditorialOverridesRoutes(ctx, deps)) return true;
```

- [ ] **Step 6: Add `editorialOverridesPath` and `todayStr` to admin deps**

In `web/server-runtime-admin-registry-runtime.js`, add `editorialOverridesPath` and `todayStr` to the destructuring and return.

In `web/server-runtime.js`, add to the `createServerRouteDependencies` call:
```js
editorialOverridesPath: path.join(runtimePaths.dataDir, "editorial-overrides.json"),
todayStr: new Date().toISOString().slice(0, 10),
```

(Note: `todayStr` is recalculated per-request since the handler is synchronous at the route level. For per-request freshness, compute it in the handler from `deps.todayStr` falling back to `new Date().toISOString().slice(0, 10)`. The value passed at startup is a reasonable default since editorial ops happen during business hours.)

- [ ] **Step 7: Run harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add web/routes/admin-api-editorial-overrides-runtime.js \
        web/routes/admin-api-editorial-overrides-runtime.test.js \
        web/routes/admin-api.js \
        web/server-runtime-admin-registry-runtime.js \
        web/server-runtime.js
git commit -m "feat: admin API for editorial overrides (pin/exclude/suppress) (§2.7)"
```

---

## Task 8: Cross-Day Annotation — `_story_relationship` in Selection

**Context:** `selectForEnrichment` in `digest-orchestrator-selection-runtime.js` already calls `dedupAgainstRecentArchives` to remove exact-URL cross-day repeats and `filterItemsAgainstHistory` to suppress recurring storylines. We now add a `classifyStoryRelationship` annotation pass using the headline-based Jaccard classifier from Task 1.

The annotation runs after dedup but before scoring. Items annotated as `'continuation'` are removed from the pool. Items annotated as `'follow_up'` pass through but carry `_story_relationship: 'follow_up'` for the audit log. Items `'new'` carry `_story_relationship: 'new'`.

Past headlines come from the archive items loaded by `loadRecentArchiveByDate`.

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-selection-runtime.js`
- Modify: `src/entrypoints/digest-orchestrator-core-runtime.js`

- [ ] **Step 1: Add `classifyStoryRelationship` to selection deps and apply it**

In `createDigestOrchestratorSelectionRuntime`, add to the `deps` destructuring:
```js
classifyStoryRelationship,
```

After the `filterItemsAgainstHistory` call and before scoring (around line 110, after `dedupedItems` is established), add:

```js
// Cross-day story relationship annotation (§2.3)
// Uses the same archive window as history suppression.
// Continuation items are removed; follow_up items are annotated and kept.
let annotatedItems = dedupedItems;
let continuationRemovedCount = 0;
let followUpCount = 0;

if (typeof classifyStoryRelationship === "function") {
  // Build a flat list of past headlines from the archive-by-date result.
  const pastItems = [];
  for (const dateEntry of (Array.isArray(archiveByDate) ? archiveByDate : [])) {
    if (Array.isArray(dateEntry?.items)) {
      for (const archiveItem of dateEntry.items) {
        if (archiveItem?.headline) pastItems.push(archiveItem);
      }
    }
  }

  const classified = [];
  for (const item of dedupedItems) {
    const relationship = classifyStoryRelationship(item, pastItems);
    if (relationship === "continuation") {
      continuationRemovedCount += 1;
      // Skip: same story, no meaningful update
      continue;
    }
    classified.push({ ...item, _story_relationship: relationship });
    if (relationship === "follow_up") followUpCount += 1;
  }
  annotatedItems = classified;

  if (continuationRemovedCount > 0) {
    log(`Story classification: removed ${continuationRemovedCount} continuation item(s), ${followUpCount} follow_up item(s) passed through`);
  }
}

const scoringInput = annotatedItems;
```

Then change the `scoreCandidates` call to use `scoringInput` instead of `dedupedItems`:
```js
const scoredItems = scoreCandidates(scoringInput, { scoringConfig, nowMs });
```

Also update `selectionDiagnostics` to include the new counts:
```js
selectionDiagnostics: {
  // ... existing fields ...
  story_relationship_continuation_removed: continuationRemovedCount || 0,
  story_relationship_follow_up_count: followUpCount || 0,
  // ...
},
```

- [ ] **Step 2: Pass `classifyStoryRelationship` from core runtime**

Add require in `digest-orchestrator-core-runtime.js`:
```js
const { classifyStoryRelationship } = require("../digest/domain/fuzzy-dedup-runtime");
```

Pass to `createDigestOrchestratorSelectionRuntime`:
```js
classifyStoryRelationship,
```

- [ ] **Step 3: Update `writeDigestAuditLog` to include story_relationship**

In `writeDigestAuditLog` (around line 552 in core), the candidate map currently records `headline`, `url`, `source`, etc. Add `_story_relationship` to the scored_candidates shape in `selectionDiagnostics`:

In `digest-orchestrator-selection-runtime.js`, the `scored_candidates` array inside `selectionDiagnostics` (around line 251) currently maps items without `_story_relationship`. Add it:
```js
scored_candidates: scoredItems.map((item) => ({
  tag: ...,
  headline: ...,
  url: ...,
  source: ...,
  source_tier: ...,
  lane: ...,
  _score: ...,
  _score_components: ...,
  _story_relationship: item?._story_relationship ?? "new",  // ← add this
})),
```

- [ ] **Step 4: Run harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/digest-orchestrator-selection-runtime.js \
        src/entrypoints/digest-orchestrator-core-runtime.js
git commit -m "feat: annotate cross-day story relationship (new/follow_up/continuation) in audit log (§2.3)"
```

---

## Task 9: Final Integration Verification

- [ ] **Step 1: Run the full harness**

```bash
/opt/homebrew/bin/node scripts/test-critical-paths.js 2>&1
```

Expected: all sidecar `.test.js` files pass (count >= 40 + 4 new ones = >= 44). The pre-existing `testStandardTopicsRescueTrustedSearchEvidenceWhenProviderReturnsNothing` failure is acceptable.

- [ ] **Step 2: Run all new test files in sequence**

```bash
/opt/homebrew/bin/node src/digest/domain/fuzzy-dedup-runtime.test.js && \
/opt/homebrew/bin/node src/runtime/digest-tuning-runtime.test.js && \
/opt/homebrew/bin/node src/digest/domain/editorial-overrides-runtime.test.js && \
/opt/homebrew/bin/node web/routes/admin-api-digest-tuning-runtime.test.js && \
/opt/homebrew/bin/node web/routes/admin-api-editorial-overrides-runtime.test.js
```

Expected: all pass.

- [ ] **Step 3: Verify data file paths resolve correctly**

```bash
/opt/homebrew/bin/node -e "
const { resolveSignalBriefRuntimePaths } = require('./src/runtime/runtime-state-paths-runtime');
const path = require('path');
const p = resolveSignalBriefRuntimePaths({ appRoot: process.cwd() });
console.log('dataDir:', p.dataDir);
console.log('digestTuning:', path.join(p.dataDir, 'digest-tuning.json'));
console.log('editorialOverrides:', path.join(p.dataDir, 'editorial-overrides.json'));
"
```

Expected: paths under `data/` in the project root.

- [ ] **Step 4: Confirm admin API route table is correct (no collisions)**

Grep the wired handlers to verify no path prefix shadows another:
```bash
/opt/homebrew/bin/node -e "
const src = require('fs').readFileSync('web/routes/admin-api.js', 'utf8');
const lines = src.split('\n').filter(l => l.includes('handleAdmin'));
lines.forEach(l => console.log(l.trim()));
"
```

Expected output includes `handleAdminDigestTuningRoutes` and `handleAdminEditorialOverridesRoutes`.

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -p   # review any remaining changes
git commit -m "chore: final integration cleanup for §2.3/§2.7 founder controls"
```

---

## API Quick Reference

### Digest Tuning

```
GET  /api/admin/digest-tuning
→ { ok: true, tuning: { maxAgeHours, weights, ... }, allowed_keys: [...] }

PUT  /api/admin/digest-tuning
body: { "maxAgeHours": 36, "weights": { "freshness": 0.4, "source_tier": 0.3, "lane_bonus": 0.15, "novelty": 0.15 } }
→ { ok: true, tuning: {...}, message: "Changes take effect on the next digest run." }
```

### Editorial Overrides

```
GET  /api/admin/editorial-overrides
→ { ok: true, overrides: { pins: [...], excludes: [...], source_suppressions: [...] } }

POST /api/admin/editorial-overrides/pins
body: { "url": "https://...", "topic": "HEALTHCARE", "date": "2026-03-24", "note": "..." }

POST /api/admin/editorial-overrides/excludes
body: { "url": "https://...", "date": "2026-03-24", "note": "..." }

POST /api/admin/editorial-overrides/suppressions
body: { "domain": "example.com", "date": "2026-03-24", "note": "..." }

DELETE /api/admin/editorial-overrides/pins?url=https://...
DELETE /api/admin/editorial-overrides/excludes?url=https://...
DELETE /api/admin/editorial-overrides/suppressions?domain=example.com
```

### Story Relationship in Audit Log

After implementation, each candidate in `GET /api/admin/digest-audit` will have:
```json
{ "headline": "...", "_story_relationship": "new" | "follow_up" | "continuation" }
```
Continuation items are removed before scoring; only new and follow_up items appear in the scored candidates list.

---

### Critical Files for Implementation

- `/Users/kushgulati/Desktop/signalbrief/.claude/worktrees/objective-wilbur/src/digest/domain/fuzzy-dedup-runtime.js` - Add `classifyStoryRelationship`; this is the only new export needed for cross-day classification
- `/Users/kushgulati/Desktop/signalbrief/.claude/worktrees/objective-wilbur/src/entrypoints/digest-orchestrator-selection-runtime.js` - Central selection pipeline; receives editorial overrides application, story relationship annotation, and scoring config override parameter
- `/Users/kushgulati/Desktop/signalbrief/.claude/worktrees/objective-wilbur/src/entrypoints/digest-orchestrator-core-runtime.js` - Wires all new modules at run start; where `loadDigestTuning`, `EDITORIAL_OVERRIDES_PATH`, and `classifyStoryRelationship` are imported and passed down
- `/Users/kushgulati/Desktop/signalbrief/.claude/worktrees/objective-wilbur/web/routes/admin-api.js` - Dispatch table; add two new handler requires and dispatch calls
- `/Users/kushgulati/Desktop/signalbrief/.claude/worktrees/objective-wilbur/web/server-runtime-admin-registry-runtime.js` - Admin deps registry; add `digestTuningPath`, `editorialOverridesPath`, `todayStr` to the passthrough