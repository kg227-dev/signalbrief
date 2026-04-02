# Pipeline Quality Partials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining spec gaps — fuzzy headline dedup (§2.3), per-topic selection guarantee with freshness-tier fallback (§2.5), and 7-day source health admin endpoint (§2.7) — plus clean up a stale constant that still references pre-MVP topics.

**Architecture:** Fuzzy dedup lives in a new pure-function module `fuzzy-dedup-runtime.js` with no side effects; `selection-domain-runtime.js` imports it to replace its exact-prefix fingerprint. The freshness-tier guarantee is a targeted addition to the per-topic selection loop in `digest-orchestrator-selection-runtime.js`. The source-health endpoint is a new admin route that reads existing audit files from `data/digest-audit/` and aggregates 7-day rolling lane stats — zero new data collection required.

**Tech Stack:** Node.js stdlib only (`fs`, `path`). All functions are pure and unit-testable in isolation. Tests use the project harness in `scripts/test-critical-paths.js` and per-file `*.test.js` files.

---

## File Map

| Action   | File | Responsibility |
|----------|------|----------------|
| Modify   | `src/entrypoints/digest-orchestrator-fetch-runtime.js` | Remove stale pre-MVP topics from `ALL_STANDARD_TOPIC_TAGS` |
| Create   | `src/digest/domain/fuzzy-dedup-runtime.js` | Token-set Jaccard similarity helpers |
| Modify   | `src/digest/domain/selection-domain-runtime.js` | Swap exact-prefix dedup for fuzzy similarity dedup |
| Create   | `src/digest/domain/fuzzy-dedup-runtime.test.js` | Unit tests for fuzzy helpers |
| Modify   | `src/entrypoints/digest-orchestrator-selection-runtime.js` | Add freshness-tier fallback loop per topic |
| Create   | `src/entrypoints/digest-orchestrator-selection-runtime.test.js` | Unit tests for tier-fallback guarantee |
| Create   | `web/routes/admin-api-source-health-runtime.js` | `GET /api/admin/source-health` — 7-day rolling lane stats |
| Modify   | `web/routes/admin-api.js` | Wire source-health handler |
| Create   | `web/routes/admin-api-source-health-runtime.test.js` | Unit tests for source-health aggregation |

---

## Task 1: Clean Up ALL_STANDARD_TOPIC_TAGS

**Context:** `src/entrypoints/digest-orchestrator-fetch-runtime.js` has two sets:
- `ALL_STANDARD_TOPIC_TAGS` (lines ~30–48): still contains pre-MVP topics like `PE×M&A`, `AI×TECH`, `CONSUMER`, `TECHNOLOGY`, `TALENT`, etc.
- `PHASE1_STANDARD_TOPIC_TAGS` (lines ~51–60): correct 7 MVP sectors.

`ALL_STANDARD_TOPIC_TAGS` is used by `buildFocusedTopicTagsFromDueUsers()` to filter which user-selected topics qualify for focused runs. If a user has `CONSUMER & RETAIL` in their profile but that key isn't in `ALL_STANDARD_TOPIC_TAGS`, focused runs silently drop their topics.

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-fetch-runtime.js:30-48`

- [ ] **Step 1: Verify the stale set**

Run:
```bash
node -e "
const src = require('fs').readFileSync('src/entrypoints/digest-orchestrator-fetch-runtime.js','utf8');
const m = src.match(/ALL_STANDARD_TOPIC_TAGS = new Set\(\[[\s\S]*?\]\)/);
console.log(m?.[0]);
"
```
Expected: output shows `PE×M&A`, `TALENT`, `AI×TECH`, etc.

- [ ] **Step 2: Replace the set**

In `src/entrypoints/digest-orchestrator-fetch-runtime.js`, find the block:
```js
const ALL_STANDARD_TOPIC_TAGS = new Set([
  "HEALTHCARE",
  "FINANCIAL SERVICES",
  "PE×M&A",
  "ENERGY",
  "CONSUMER",
```
(the full old block through the closing `]);`)

Replace it with:
```js
// MVP topic set — must mirror PHASE1_STANDARD_TOPIC_TAGS exactly.
const ALL_STANDARD_TOPIC_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
  "CONSUMER & RETAIL",
  "INDUSTRIALS",
]);
```

- [ ] **Step 3: Verify no other references to removed topics remain in this file**

```bash
node -e "
const src = require('fs').readFileSync('src/entrypoints/digest-orchestrator-fetch-runtime.js','utf8');
const stale = ['PE×M&A','AI×TECH','M&A ADVISORY','TALENT','POLICY×REGULATORY'];
stale.forEach(t => { if (src.includes(t)) console.log('STALE FOUND:', t); });
console.log('done');
"
```
Expected: only "done", no STALE FOUND lines. (If stale topics appear in comments, that's acceptable — check context.)

- [ ] **Step 4: Run tests**

```bash
node scripts/test-critical-paths.js 2>&1 | tail -20
```
Expected: all existing tests pass (no regression from renaming the set content).

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/digest-orchestrator-fetch-runtime.js
git commit -m "fix: align ALL_STANDARD_TOPIC_TAGS to MVP 7-sector set"
```

---

## Task 2: Fuzzy Headline Dedup (Spec §2.3)

**Context:** `src/digest/domain/selection-domain-runtime.js` deduplicates candidates within a single run using `defaultHeadlineFingerprint`, which returns the first 40 chars of the lowercased headline. Two headlines like `"Apple Reports Record Q1 Revenue"` and `"Apple Reports Record First Quarter Revenue"` have different 40-char prefixes and both pass — creating near-duplicate items in the same digest.

The fix: replace the exact-prefix check with a token-set Jaccard similarity check. Two headlines are duplicates if `J(tokens_A, tokens_B) >= 0.7`. This logic belongs in a new pure module so it can be tested in isolation.

**Files:**
- Create: `src/digest/domain/fuzzy-dedup-runtime.js`
- Create: `src/digest/domain/fuzzy-dedup-runtime.test.js`
- Modify: `src/digest/domain/selection-domain-runtime.js:30-43` (dedupeCandidates) and `:45-82` (dedupeCandidatesDetailed)

### Step 2a: Create the fuzzy-dedup module

- [ ] **Step 1: Create `src/digest/domain/fuzzy-dedup-runtime.js` with failing placeholder**

```bash
cat > src/digest/domain/fuzzy-dedup-runtime.js << 'EOF'
"use strict";
// Placeholder — implementation added in next step
module.exports = {};
EOF
```

- [ ] **Step 2: Write the failing test**

Create `src/digest/domain/fuzzy-dedup-runtime.test.js`:

```js
"use strict";
const assert = require("assert");

// Will fail until fuzzy-dedup-runtime.js is implemented.
const {
  tokenizeHeadline,
  jaccardSimilarity,
  isFuzzyDuplicateHeadline,
} = require("./fuzzy-dedup-runtime");

// tokenizeHeadline
{
  const tokens = tokenizeHeadline("Apple Reports Record Q1 Revenue");
  assert(tokens instanceof Set, "tokenizeHeadline returns a Set");
  assert(tokens.has("apple"), "lowercased");
  assert(tokens.has("reports"), "word included");
  assert(!tokens.has("q1"), "short tokens (< 3 chars) excluded");
  console.log("tokenizeHeadline basic ✓");
}

// jaccardSimilarity
{
  const a = new Set(["apple", "reports", "record", "revenue"]);
  const b = new Set(["apple", "reports", "record", "first", "quarter", "revenue"]);
  const j = jaccardSimilarity(a, b);
  // intersection=4 (apple,reports,record,revenue), union=6 → 4/6 ≈ 0.667
  assert(j > 0.6 && j < 0.7, `jaccard expected ~0.667, got ${j}`);

  const identical = new Set(["foo", "bar"]);
  assert(jaccardSimilarity(identical, identical) === 1, "identical sets → 1");

  const disjoint = new Set(["foo"]);
  assert(jaccardSimilarity(disjoint, new Set(["bar"])) === 0, "disjoint → 0");

  const emptyA = new Set();
  assert(jaccardSimilarity(emptyA, new Set(["bar"])) === 0, "empty vs non-empty → 0");
  console.log("jaccardSimilarity ✓");
}

// isFuzzyDuplicateHeadline
{
  const seen = [new Set(["apple", "reports", "record", "quarter", "revenue"])];
  // Very similar: should be dup
  const dup = new Set(["apple", "reports", "record", "first", "quarter", "revenue"]);
  assert(isFuzzyDuplicateHeadline(dup, seen, 0.7), "similar headline is dup at 0.7");
  // Completely different: not a dup
  const diff = new Set(["fed", "raises", "interest", "rates", "again"]);
  assert(!isFuzzyDuplicateHeadline(diff, seen, 0.7), "different headline is not dup");
  // Empty seen list: never a dup
  assert(!isFuzzyDuplicateHeadline(dup, [], 0.7), "empty seen → not dup");
  console.log("isFuzzyDuplicateHeadline ✓");
}

console.log("All fuzzy-dedup-runtime tests passed ✓");
```

- [ ] **Step 3: Run the test — confirm it fails**

```bash
node src/digest/domain/fuzzy-dedup-runtime.test.js 2>&1
```
Expected: `TypeError: tokenizeHeadline is not a function` or similar.

- [ ] **Step 4: Implement `src/digest/domain/fuzzy-dedup-runtime.js`**

```js
"use strict";

/**
 * Tokenize a headline for fuzzy similarity comparison.
 * Returns a Set of lowercase words with >= 3 characters.
 * Strips punctuation and normalizes whitespace before splitting.
 */
function tokenizeHeadline(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

/**
 * Jaccard similarity between two token Sets.
 * Returns a value in [0, 1]. Two empty sets → 1. One empty → 0.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Returns true if `tokenSet` is a fuzzy duplicate of any set in `seenTokenSets`.
 * Default threshold: 0.7 (70% token overlap = same story).
 */
function isFuzzyDuplicateHeadline(tokenSet, seenTokenSets, threshold = 0.7) {
  for (const seen of seenTokenSets) {
    if (jaccardSimilarity(tokenSet, seen) >= threshold) return true;
  }
  return false;
}

module.exports = {
  tokenizeHeadline,
  jaccardSimilarity,
  isFuzzyDuplicateHeadline,
};
```

- [ ] **Step 5: Run the test — confirm it passes**

```bash
node src/digest/domain/fuzzy-dedup-runtime.test.js 2>&1
```
Expected: `All fuzzy-dedup-runtime tests passed ✓`

- [ ] **Step 6: Commit the new module**

```bash
git add src/digest/domain/fuzzy-dedup-runtime.js src/digest/domain/fuzzy-dedup-runtime.test.js
git commit -m "feat: add fuzzy headline dedup helpers (Jaccard similarity)"
```

### Step 2b: Wire fuzzy dedup into selection-domain-runtime.js

- [ ] **Step 7: Write the failing test for dedupeCandidates fuzzy behavior**

Add a new test file `src/digest/domain/selection-domain-fuzzy-dedup.test.js`:

```js
"use strict";
const assert = require("assert");
const { selectItemsByPolicy } = require("./selection-domain-runtime");

function makeItem(headline, url, tag = "TECHNOLOGY") {
  return { headline, url, tag, source_domain: "example.com" };
}

// Two near-duplicate headlines (Jaccard ~0.8) should deduplicate — only first survives.
{
  const items = [
    makeItem("Apple Reports Record Q1 Revenue This Year", "https://a.com/1"),
    makeItem("Apple Reports Record First Quarter Revenue This Year", "https://b.com/2"),
    makeItem("Fed Raises Interest Rates By Half Point", "https://c.com/3"),
  ];
  const selected = selectItemsByPolicy(items, {
    maxItems: 10,
    maxItemsPerTag: 10,
    customTags: [],
    maxCustomItems: 0,
    tagPriority: {},
    maxItemsPerSourceDomain: 5,
  });
  // The two Apple headlines are near-duplicates; only one should survive
  const appleItems = selected.filter((i) => i.headline.includes("Apple"));
  assert.strictEqual(appleItems.length, 1, `Expected 1 Apple item, got ${appleItems.length}`);
  // The Fed item should always survive
  const fedItems = selected.filter((i) => i.headline.includes("Fed"));
  assert.strictEqual(fedItems.length, 1, "Fed item should survive");
  console.log("dedupeCandidates fuzzy dedup ✓");
}

// Items with completely different headlines should NOT deduplicate.
{
  const items = [
    makeItem("Apple Reports Record Q1 Revenue", "https://a.com/1"),
    makeItem("Microsoft Azure Cloud Revenue Surges", "https://b.com/2"),
    makeItem("Google Search Advertising Revenue Grows", "https://c.com/3"),
  ];
  const selected = selectItemsByPolicy(items, {
    maxItems: 10,
    maxItemsPerTag: 10,
    customTags: [],
    maxCustomItems: 0,
    tagPriority: {},
    maxItemsPerSourceDomain: 5,
  });
  assert.strictEqual(selected.length, 3, `All 3 distinct headlines should survive, got ${selected.length}`);
  console.log("dedupeCandidates distinct headlines all survive ✓");
}

console.log("All selection-domain fuzzy dedup tests passed ✓");
```

- [ ] **Step 8: Run the test — confirm it fails**

```bash
node src/digest/domain/selection-domain-fuzzy-dedup.test.js 2>&1
```
Expected: the Apple dedup assertion fails — both Apple items currently survive (exact-prefix dedup doesn't catch them).

- [ ] **Step 9: Update `selection-domain-runtime.js` to use fuzzy dedup**

Open `src/digest/domain/selection-domain-runtime.js`. Make these changes:

**a) Add import at the top (after the existing requires):**
```js
const { tokenizeHeadline, isFuzzyDuplicateHeadline } = require("./fuzzy-dedup-runtime");
```

**b) Replace `dedupeCandidates` function (lines 30–43) with:**
```js
function dedupeCandidates(items, adapterFns) {
  const seenHeadlineTokenSets = []; // fuzzy: array of token Sets
  const seenUrl = new Set();
  return items.filter((item) => {
    const headlineText = String(adapterFns.headlineFingerprint(item) || "");
    const urlKey = String(adapterFns.normalizeUrl(item?.url || "") || "");
    if (!adapterFns.isCandidate(item, { headlineKey: headlineText, urlKey })) return false;
    if (urlKey && seenUrl.has(urlKey)) return false;
    const tokenSet = tokenizeHeadline(headlineText);
    if (tokenSet.size > 0 && isFuzzyDuplicateHeadline(tokenSet, seenHeadlineTokenSets)) return false;
    if (urlKey) seenUrl.add(urlKey);
    if (tokenSet.size > 0) seenHeadlineTokenSets.push(tokenSet);
    return true;
  });
}
```

**c) Replace `dedupeCandidatesDetailed` function (lines 45–82) with:**
```js
function dedupeCandidatesDetailed(items, adapterFns) {
  const seenHeadlineTokenSets = []; // fuzzy: array of token Sets
  const seenUrl = new Set();
  const deduped = [];
  const rejected = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const headlineText = String(adapterFns.headlineFingerprint(item) || "");
    const urlKey = String(adapterFns.normalizeUrl(item?.url || "") || "");
    if (!adapterFns.isCandidate(item, { headlineKey: headlineText, urlKey })) {
      rejected.push({ item, reason: "selection_invalid_candidate" });
      continue;
    }
    if (urlKey && seenUrl.has(urlKey)) {
      rejected.push({ item, reason: "selection_duplicate_url" });
      continue;
    }
    const tokenSet = tokenizeHeadline(headlineText);
    if (tokenSet.size > 0 && isFuzzyDuplicateHeadline(tokenSet, seenHeadlineTokenSets)) {
      rejected.push({ item, reason: "selection_duplicate_headline" });
      continue;
    }
    if (urlKey) seenUrl.add(urlKey);
    if (tokenSet.size > 0) seenHeadlineTokenSets.push(tokenSet);
    deduped.push(item);
  }
  return { deduped, rejected };
}
```

- [ ] **Step 10: Run the fuzzy dedup test — confirm it passes**

```bash
node src/digest/domain/selection-domain-fuzzy-dedup.test.js 2>&1
```
Expected: `All selection-domain fuzzy dedup tests passed ✓`

- [ ] **Step 11: Run full harness — confirm no regressions**

```bash
node scripts/test-critical-paths.js 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/digest/domain/selection-domain-runtime.js src/digest/domain/selection-domain-fuzzy-dedup.test.js
git commit -m "feat: replace exact-prefix headline dedup with Jaccard fuzzy similarity (spec §2.3)"
```

---

## Task 3: Per-Topic Selection Guarantee with Freshness-Tier Fallback (Spec §2.5)

**Context:** `src/entrypoints/digest-orchestrator-selection-runtime.js` groups scored candidates by topic and calls `selectItems` to pick up to `itemsPerTopic` (default: 5) per topic. But it makes no distinction between fresh (0–24h) and stale (24–48h) items within each topic pool — so a topic with 4 articles from yesterday and 1 from today will use all 5 regardless of age distribution.

Spec §2.5 requires:
1. Prefer 0–24h items first per topic.
2. If fewer than `itemsPerTopic` qualify, backfill from 24–48h items.
3. If still short, backfill from 48h+ items (analysis/commentary tier).
4. Log a warning if a topic can't reach `itemsPerTopic` after all tiers.

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-selection-runtime.js:119-152` (the per-topic selection loop)
- Create: `src/entrypoints/digest-orchestrator-selection-runtime.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/entrypoints/digest-orchestrator-selection-runtime.test.js`:

```js
"use strict";
const assert = require("assert");

// Pure unit test of the freshness-tier splitting helpers that will be exported.
// We import the helpers directly once they exist.
let splitByFreshnessTiers;
try {
  ({ splitByFreshnessTiers } = require("./digest-orchestrator-selection-runtime"));
} catch (_) {
  // will fail at export assertion below
}

assert(typeof splitByFreshnessTiers === "function",
  "splitByFreshnessTiers must be exported from digest-orchestrator-selection-runtime");

const NOW = Date.now();
const h = (hours) => NOW - hours * 60 * 60 * 1000;

function makeItem(tag, headline, ageHours) {
  return { tag, headline, url: `https://x.com/${headline}`, published_at: h(ageHours) };
}

// Tier splitting: items at 0h, 20h, 30h, 50h
{
  const items = [
    makeItem("TECHNOLOGY", "headline-0h", 0),
    makeItem("TECHNOLOGY", "headline-20h", 20),
    makeItem("TECHNOLOGY", "headline-30h", 30),
    makeItem("TECHNOLOGY", "headline-50h", 50),
  ];
  const { tier1, tier2, tier3 } = splitByFreshnessTiers(items, NOW);
  assert.strictEqual(tier1.length, 2, "tier1 (0-24h): 2 items");
  assert.strictEqual(tier2.length, 1, "tier2 (24-48h): 1 item");
  assert.strictEqual(tier3.length, 1, "tier3 (48h+): 1 item");
  console.log("splitByFreshnessTiers ✓");
}

// Items with no timestamp go to tier3
{
  const items = [makeItem("TECHNOLOGY", "no-ts", 0)];
  items[0].published_at = undefined;
  const { tier1, tier2, tier3 } = splitByFreshnessTiers(items, NOW);
  assert.strictEqual(tier1.length, 0);
  assert.strictEqual(tier2.length, 0);
  assert.strictEqual(tier3.length, 1, "missing timestamp → tier3");
  console.log("missing timestamp → tier3 ✓");
}

console.log("All selection guarantee tests passed ✓");
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
node src/entrypoints/digest-orchestrator-selection-runtime.test.js 2>&1
```
Expected: `AssertionError: splitByFreshnessTiers must be exported...`

- [ ] **Step 3: Add helpers to `digest-orchestrator-selection-runtime.js`**

Open `src/entrypoints/digest-orchestrator-selection-runtime.js`.

**a) Add `computeItemAgeHours` and `splitByFreshnessTiers` after the imports, before `computeMaxCustomItems`:**

```js
function computeItemAgeHours(item, nowMs) {
  const ts = item?.published_at || item?.date || item?.timestamp;
  if (!ts) return Infinity;
  const ms = typeof ts === "number" ? ts : new Date(ts).getTime();
  if (!Number.isFinite(ms)) return Infinity;
  return Math.max(0, (nowMs - ms) / (1000 * 60 * 60));
}

function splitByFreshnessTiers(items, nowMs) {
  const tier1 = []; // 0–24h: breaking / today
  const tier2 = []; // 24–48h: yesterday
  const tier3 = []; // 48h+: analysis / commentary
  for (const item of (Array.isArray(items) ? items : [])) {
    const age = computeItemAgeHours(item, nowMs);
    if (age <= 24) tier1.push(item);
    else if (age <= 48) tier2.push(item);
    else tier3.push(item);
  }
  return { tier1, tier2, tier3 };
}
```

**b) Replace the per-topic selection loop (lines ~127–152) with a tiered version:**

Find this block:
```js
    // Select per topic, then apply discovery cap within each topic.
    const perTopicSelected = [];
    let totalDiscoveryCapped = 0;
    for (const topicItems of byTag.values()) {
      const topicPool = selectItems(topicItems, {
```

Replace the entire `for` loop (through `perTopicSelected.push(item)`) with:

```js
    // Select per topic with freshness-tier fallback, then apply discovery cap.
    const perTopicSelected = [];
    let totalDiscoveryCapped = 0;
    for (const [topicTag, topicItems] of byTag.entries()) {
      // Build tiered pool: prefer 0-24h, backfill 24-48h, then 48h+ as last resort.
      const { tier1, tier2, tier3 } = splitByFreshnessTiers(topicItems, nowMs);
      const tieredPool = [];
      for (const tier of [tier1, tier2, tier3]) {
        for (const item of tier) {
          if (tieredPool.length >= itemsPerTopic) break;
          tieredPool.push(item);
        }
        if (tieredPool.length >= itemsPerTopic) break;
      }
      if (tieredPool.length < itemsPerTopic) {
        log(`⚠️ Topic ${topicTag}: only ${tieredPool.length}/${itemsPerTopic} items available after freshness-tier fallback (t1=${tier1.length}, t2=${tier2.length}, t3=${tier3.length})`);
      }

      const topicPool = selectItems(tieredPool, {
        maxItems: itemsPerTopic,
        maxItemsPerTag: itemsPerTopic,
        customTags: [],
        maxCustomItems: 0,
        tagPriority,
        maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
      });
      let discoveryCount = 0;
      for (const item of topicPool) {
        const origin = String(item?.retrieval_origin || item?.retrieval_lane || "").toLowerCase();
        const isDiscovery = origin.includes("discovery") || origin.includes("perplexity");
        if (isDiscovery) {
          discoveryCount += 1;
          if (discoveryCount > maxDiscoveryPerTopic) {
            totalDiscoveryCapped += 1;
            continue;
          }
        }
        perTopicSelected.push(item);
      }
    }
```

Note: The loop signature changed from `for (const topicItems of byTag.values())` to `for (const [topicTag, topicItems] of byTag.entries())` — `byTag` is a `Map` so `.entries()` works correctly.

**c) Export the new helpers at the bottom:**

Find:
```js
module.exports = {
  createDigestOrchestratorSelectionRuntime,
  computeMaxCustomItems,
};
```

Replace with:
```js
module.exports = {
  createDigestOrchestratorSelectionRuntime,
  computeMaxCustomItems,
  computeItemAgeHours,
  splitByFreshnessTiers,
};
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
node src/entrypoints/digest-orchestrator-selection-runtime.test.js 2>&1
```
Expected: `All selection guarantee tests passed ✓`

- [ ] **Step 5: Run full harness — no regressions**

```bash
node scripts/test-critical-paths.js 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/digest-orchestrator-selection-runtime.js src/entrypoints/digest-orchestrator-selection-runtime.test.js
git commit -m "feat: add per-topic freshness-tier fallback guarantee (spec §2.5)"
```

---

## Task 4: 7-Day Source Health Admin Endpoint (Spec §2.7)

**Context:** The digest run already writes a per-day audit file to `data/digest-audit/{YYYY-MM-DD}.json`. Each audit file has:
- `summary.global_lane_breakdown`: object mapping lane → item count for that run
- `topics[TAG].candidates[]`: array of `{ headline, url, source, source_tier, lane, _score, selected }`

We need `GET /api/admin/source-health` to aggregate the last 7 days of those files and return:
- Per-topic: how many items came from each lane (rss/official/discovery), how many days had zero items, which source domains appeared
- Global: 7-day rolling lane split percentages
- Warnings: any topic with zero rss+official items on ≥ 3 of the last 7 days

**Files:**
- Create: `web/routes/admin-api-source-health-runtime.js`
- Create: `web/routes/admin-api-source-health-runtime.test.js`
- Modify: `web/routes/admin-api.js` (wire the handler)

### Step 4a: Build the route handler

- [ ] **Step 1: Write the failing test**

Create `web/routes/admin-api-source-health-runtime.test.js`:

```js
"use strict";
const assert = require("assert");
const {
  aggregateSourceHealth,
  classifyLane,
} = require("./admin-api-source-health-runtime");

// classifyLane
{
  assert.strictEqual(classifyLane("rss"), "rss");
  assert.strictEqual(classifyLane("publisher_feed"), "rss");
  assert.strictEqual(classifyLane("official"), "official");
  assert.strictEqual(classifyLane("regulatory"), "official");
  assert.strictEqual(classifyLane("perplexity_discovery"), "discovery");
  assert.strictEqual(classifyLane("discovery"), "discovery");
  assert.strictEqual(classifyLane(""), "unknown");
  assert.strictEqual(classifyLane(null), "unknown");
  console.log("classifyLane ✓");
}

// aggregateSourceHealth: basic 2-day scenario
{
  const auditDocs = [
    {
      date_et: "2026-03-23",
      topics: {
        TECHNOLOGY: {
          candidates: [
            { lane: "rss", source: "techcrunch.com", selected: true },
            { lane: "rss", source: "wired.com", selected: true },
            { lane: "perplexity_discovery", source: "openai.com", selected: false },
          ],
        },
        HEALTHCARE: {
          candidates: [
            { lane: "official", source: "fda.gov", selected: true },
          ],
        },
      },
    },
    {
      date_et: "2026-03-24",
      topics: {
        TECHNOLOGY: {
          candidates: [
            { lane: "rss", source: "techcrunch.com", selected: true },
          ],
        },
        HEALTHCARE: {
          candidates: [], // zero items — should trigger miss
        },
      },
    },
  ];

  const result = aggregateSourceHealth(auditDocs);

  // TECHNOLOGY: 3 rss total, 0 official, 1 discovery, 0 miss days
  const tech = result.topics["TECHNOLOGY"];
  assert(tech, "TECHNOLOGY topic exists");
  assert.strictEqual(tech.lane_totals.rss, 3, `rss total: expected 3, got ${tech.lane_totals.rss}`);
  assert.strictEqual(tech.lane_totals.discovery, 1, "discovery total");
  assert.strictEqual(tech.miss_days, 0, "TECHNOLOGY: 0 miss days");
  assert(tech.source_domains.includes("techcrunch.com"), "techcrunch in domains");

  // HEALTHCARE: 1 official total, 1 miss day (empty candidates on day 2)
  const health = result.topics["HEALTHCARE"];
  assert.strictEqual(health.lane_totals.official, 1, "HEALTHCARE official total");
  assert.strictEqual(health.miss_days, 1, `HEALTHCARE: 1 miss day, got ${health.miss_days}`);

  // Warnings: HEALTHCARE had 1/2 miss days but threshold is 3 of 7 — no warning yet
  assert.strictEqual(result.warnings.length, 0, "no warnings below threshold");

  console.log("aggregateSourceHealth basic ✓");
}

// aggregateSourceHealth: warning when topic misses >= 3 of 7 days
{
  const missDays = Array.from({ length: 4 }, (_, i) => ({
    date_et: `2026-03-${20 + i}`,
    topics: { ENERGY: { candidates: [] } },
  }));
  const result = aggregateSourceHealth(missDays);
  const warn = result.warnings.find((w) => w.topic === "ENERGY");
  assert(warn, "ENERGY should have a warning");
  assert(warn.message.includes("miss"), `warning message: ${warn.message}`);
  console.log("aggregateSourceHealth warning ✓");
}

console.log("All source-health tests passed ✓");
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
node web/routes/admin-api-source-health-runtime.test.js 2>&1
```
Expected: `Error: Cannot find module './admin-api-source-health-runtime'`

- [ ] **Step 3: Implement `web/routes/admin-api-source-health-runtime.js`**

```js
"use strict";

const fs = require("fs");
const path = require("path");

const LANE_CLASSIFICATIONS = {
  rss: "rss",
  publisher_feed: "rss",
  official: "official",
  regulatory: "official",
  sec: "official",
  fda: "official",
  discovery: "discovery",
  perplexity: "discovery",
  perplexity_discovery: "discovery",
};

/**
 * Classify a raw lane string into one of: "rss", "official", "discovery", "unknown".
 */
function classifyLane(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (!key) return "unknown";
  if (LANE_CLASSIFICATIONS[key]) return LANE_CLASSIFICATIONS[key];
  if (key.includes("rss") || key.includes("feed")) return "rss";
  if (key.includes("official") || key.includes("regulatory")) return "official";
  if (key.includes("discovery") || key.includes("perplexity")) return "discovery";
  return "unknown";
}

/**
 * Aggregate source health metrics across an array of audit documents.
 * Each auditDoc has the shape written by writeDigestAuditLog:
 *   { date_et, topics: { [TAG]: { candidates: [{ lane, source, selected }] } } }
 *
 * Returns:
 *   {
 *     days_covered: number,
 *     topics: {
 *       [TAG]: {
 *         lane_totals: { rss, official, discovery, unknown },
 *         miss_days: number,  // days with zero candidates
 *         source_domains: string[],
 *       }
 *     },
 *     global_lane_totals: { rss, official, discovery, unknown },
 *     warnings: [{ topic, message }],
 *   }
 */
function aggregateSourceHealth(auditDocs) {
  const docs = Array.isArray(auditDocs) ? auditDocs : [];
  const topicStats = Object.create(null);
  const globalTotals = { rss: 0, official: 0, discovery: 0, unknown: 0 };

  for (const doc of docs) {
    const topics = (doc && typeof doc.topics === "object" && doc.topics) ? doc.topics : {};
    for (const [tag, topicData] of Object.entries(topics)) {
      if (!topicStats[tag]) {
        topicStats[tag] = {
          lane_totals: { rss: 0, official: 0, discovery: 0, unknown: 0 },
          miss_days: 0,
          source_domain_set: new Set(),
        };
      }
      const candidates = Array.isArray(topicData?.candidates) ? topicData.candidates : [];
      if (candidates.length === 0) {
        topicStats[tag].miss_days += 1;
        continue;
      }
      for (const c of candidates) {
        const lane = classifyLane(c?.lane);
        topicStats[tag].lane_totals[lane] = (topicStats[tag].lane_totals[lane] || 0) + 1;
        globalTotals[lane] = (globalTotals[lane] || 0) + 1;
        if (c?.source) topicStats[tag].source_domain_set.add(String(c.source));
      }
    }
  }

  // Build warnings: topic missed >= 3 of the covered days with no rss+official items.
  const MISS_WARNING_THRESHOLD = 3;
  const warnings = [];
  for (const [tag, stats] of Object.entries(topicStats)) {
    if (stats.miss_days >= MISS_WARNING_THRESHOLD) {
      warnings.push({
        topic: tag,
        miss_days: stats.miss_days,
        days_covered: docs.length,
        message: `Topic ${tag} had zero items on ${stats.miss_days}/${docs.length} days — possible source miss`,
      });
    }
  }

  // Serialize (convert Sets to arrays for JSON output).
  const topics = Object.create(null);
  for (const [tag, stats] of Object.entries(topicStats)) {
    topics[tag] = {
      lane_totals: { ...stats.lane_totals },
      miss_days: stats.miss_days,
      source_domains: Array.from(stats.source_domain_set).sort(),
    };
  }

  return {
    days_covered: docs.length,
    topics,
    global_lane_totals: globalTotals,
    warnings,
  };
}

/**
 * Read up to `maxDays` audit files from `auditDir` (most recent first).
 * Silently skips unreadable / unparseable files.
 */
function loadRecentAuditDocs(auditDir, maxDays = 7) {
  try {
    const files = fs.readdirSync(auditDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, maxDays);
    const docs = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(auditDir, f), "utf8");
        docs.push(JSON.parse(raw));
      } catch (_) { /* skip malformed file */ }
    }
    return docs;
  } catch (_) {
    return [];
  }
}

/**
 * GET /api/admin/source-health?days=7
 *
 * Query params:
 *   days — how many recent audit days to include (default: 7, max: 30)
 */
async function handleAdminSourceHealthRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const { json, isAdminAuthed, digestAuditDir } = deps;

  if (!pathname.startsWith("/api/admin/source-health")) return false;
  if (req.method !== "GET") return false;
  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const rawDays = Number(url.searchParams.get("days") || "7");
  const maxDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 30) : 7;

  const auditDir = String(digestAuditDir || "");
  if (!auditDir) {
    json(res, { ok: false, error: "audit_dir_not_configured" }, 500);
    return true;
  }

  const auditDocs = loadRecentAuditDocs(auditDir, maxDays);
  const health = aggregateSourceHealth(auditDocs);

  json(res, { ok: true, ...health });
  return true;
}

module.exports = {
  handleAdminSourceHealthRoutes,
  aggregateSourceHealth,
  classifyLane,
  loadRecentAuditDocs,
};
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
node web/routes/admin-api-source-health-runtime.test.js 2>&1
```
Expected: `All source-health tests passed ✓`

- [ ] **Step 5: Wire the handler into `admin-api.js`**

Open `web/routes/admin-api.js`. Find the other admin handler imports at the top of the file (e.g., the line that requires `admin-api-digest-audit-runtime`). Add alongside it:

```js
const { handleAdminSourceHealthRoutes } = require("./admin-api-source-health-runtime");
```

Then find where `handleAdminDigestAuditRoutes` is called (typically in `createAdminApiRouteHandler` or the main dispatch function), and add a parallel call for source health:

```js
if (await handleAdminSourceHealthRoutes(ctx, adminDeps)) return;
```

Place it immediately after the `handleAdminDigestAuditRoutes` call to keep admin audit routes grouped.

> **Tip:** Search for `handleAdminDigestAuditRoutes` in `admin-api.js` to find the exact insertion point.

- [ ] **Step 6: Run full harness — no regressions**

```bash
node scripts/test-critical-paths.js 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 7: Smoke-test the new endpoint (optional, if server is running)**

```bash
curl -s "http://localhost:3003/api/admin/source-health" -H "Cookie: admin_token=..." | jq '.days_covered'
```
Expected: `7` (or however many audit files exist in `data/digest-audit/`).

- [ ] **Step 8: Commit**

```bash
git add web/routes/admin-api-source-health-runtime.js \
        web/routes/admin-api-source-health-runtime.test.js \
        web/routes/admin-api.js
git commit -m "feat: add GET /api/admin/source-health 7-day rolling lane stats (spec §2.7)"
```

---

## Task 5: Push and Verify

- [ ] **Step 1: Run full test suite one final time**

```bash
node scripts/test-critical-paths.js 2>&1
```
Expected: all tests pass. Note the pre-existing `testStandardTopicsRescueTrustedSearchEvidenceWhenProviderReturnsNothing` failure — this is a known harness bug on `main` unrelated to this plan.

- [ ] **Step 2: Run all new unit test files**

```bash
node src/digest/domain/fuzzy-dedup-runtime.test.js && \
node src/digest/domain/selection-domain-fuzzy-dedup.test.js && \
node src/entrypoints/digest-orchestrator-selection-runtime.test.js && \
node web/routes/admin-api-source-health-runtime.test.js
```
Expected: each prints `All * tests passed ✓`

- [ ] **Step 3: Push**

```bash
git push
```

---

## What Is NOT In This Plan

- **§2.2 Official lane (direct fetch):** The MVP currently surfaces official/regulatory items via Perplexity domain-bias queries. A dedicated official-source fetch worker would require a new fetch pathway and is out of scope for this sprint. Track it as `P2` in `docs/features.md`.
- **§2.7 No-code tuning controls:** Admin UI sliders for source weights are a separate front-end task.
- **Admin UI for source health:** The endpoint returns JSON; visualizing it in the admin panel is a follow-on task.
