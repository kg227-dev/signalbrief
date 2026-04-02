# MVP Pipeline Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three biggest gaps between the reduced-scope MVP spec and the live codebase: (1) deliver 5 items per subscribed topic instead of 5 total, (2) make the pipeline email-only by removing Telegram/on-demand paths, and (3) enforce hard 48h freshness everywhere with no archive rescue on scheduled runs, canonical single-topic assignment, and deterministic score-based ranking (no topic_weights) — while also expanding the broker source inventory from 4–5 to 8–9 sources per topic.

**Architecture:** Delivery currently collapses a per-topic-selected pool into a confidence-gated 5-item flat list per user. The fix adds `selectTopicBuckets` (a simple score-rank top-5-per-topic selector) and wires it into the delivery orchestrator instead of `selectDeliveryItems`. The confidence-tier gate is bypassed; `applyTopicRelevanceScores` is kept for score computation but called with empty weights (`{}`) to neutralize `weightBonus` and `specialistBonus`. The Telegram delivery block is deleted from the orchestrator and the bot is removed from docker-compose. Canonical topic assignment is added in the broker normalizer. The 72h targeted-mode freshness path becomes 48h universally.

**Tech Stack:** Node.js stdlib only. No new npm dependencies. All files in `src/`, `config/`, `docker-compose.yml`. Tests are `.test.js` files run directly with `node`.

---

## Pre-work audit (research only, no code changes)

### Task 0: Document current production state

- [ ] **Step 0.1: Count current broker sources per topic and lane**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('config/standard-topic-broker-sources.json', 'utf8'));
const enabled = (data.sources||[]).filter(s => s.enabled !== false);
const byTopic = {};
enabled.forEach(s => { (s.topic_tags||[]).forEach(t => { byTopic[t]=(byTopic[t]||{publisher_feed:0,official:0}); byTopic[t][s.lane]=(byTopic[t][s.lane]||0)+1; }); });
console.log(JSON.stringify(byTopic, null, 2));
console.log('Total enabled:', enabled.length);
"
```

Expected: ~26 enabled total, 4–5 per topic. Record this as the baseline for comparison after Task 8.

- [ ] **Step 0.2: Verify retrieval_lane is not persisted in production digest records**

```bash
node -e "
const fs = require('fs'), path = require('path');
const dir = 'data/digest-records';
const users = fs.readdirSync(dir);
let found = 0, total = 0;
users.forEach(u => {
  fs.readdirSync(path.join(dir, u)).forEach(f => {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, u, f), 'utf8'));
    const items = (rec.current || rec).items || [];
    items.forEach(i => { total++; if (i.retrieval_lane) found++; });
  });
});
console.log('Items with retrieval_lane:', found, '/', total);
"
```

Expected: `0 / N` — confirmed production gap.

- [ ] **Step 0.3: Confirm laneBonuses wiring in score-candidate.js (no code change)**

Read `src/domains/scoring/score-candidate.js` lines 35–145. Confirm: `official: 1.0` in `DEFAULT_LANE_BONUSES` and `computeLaneBonusScore` reads `retrieval_origin || retrieval_lane`. This is already correct — no changes needed.

---

## Phase 1: Hard 48h freshness everywhere + no archive rescue on scheduled runs

### Task 1: Fix selection runtime — universal 48h, scheduled runs abort when no live items

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-selection-runtime.js`
  - Line 50: `const scheduledDefaultMaxAgeHours = runMode === "scheduled" ? 48 : 72;`
  - Lines 108–131: archive fallback block

- [ ] **Step 1.1: Write the failing tests**

Create `src/entrypoints/digest-orchestrator-selection-runtime.test.js`:

```js
"use strict";
const assert = require("assert");
const { createDigestOrchestratorSelectionRuntime } = require("./digest-orchestrator-selection-runtime");
const { articleAgeTooOld } = require("../digest/runtime/digest-data-fetch-items-runtime");

function makeDeps(overrides = {}) {
  return {
    CONFIG: { digest: { crossDayDedupDays: 3, maxItemsPerTag: 5, maxItemsPerSourceDomain: 2 } },
    log: () => {},
    createDigestPolicies: () => ({ rankingPolicy: { repeatPenalty: 0 }, depthPolicy: { defaultItemCount: 5 } }),
    dedupAgainstRecentArchives: (items) => ({ items, removed: 0, backfilled: 0, archive_days_used: 3 }),
    buildRecentRepeatIndex: () => ({ urlKeys: new Set(), headlineKeys: new Set(), days: 3 }),
    selectItems: (items, opts) => items.slice(0, opts.maxItems),
    loadRecentArchiveItems: () => [],
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({ items, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] }),
    buildRepetitionNote: () => "",
    emitDigestIncident: async () => {},
    articleAgeTooOld,  // use the real implementation — it reads item.published_date
    ...overrides,
  };
}

// Helpers: create items with published_date set to a specific age
function itemAgedHours(ageHours, tag, url) {
  const ts = new Date(Date.now() - ageHours * 3600 * 1000).toISOString();
  return { tag, url, headline: `Item from ${url}`, published_date: ts };
}

// Test 1: targeted run should use 48h gate (not 72h)
// A 60h-old item passes the old 72h gate but must fail the new 48h gate
{
  const runtime = createDigestOrchestratorSelectionRuntime(makeDeps());
  const stale = itemAgedHours(60, "TECHNOLOGY", "https://a.com/1");
  const fresh = itemAgedHours(10, "TECHNOLOGY", "https://a.com/2");
  runtime.selectForEnrichment({
    allItems: [stale, fresh],
    selectionTarget: 5,
    customTags: [],
    tagPriority: {},
    runMode: "targeted",
    digestDateKey: "2026-03-25",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 2,
  }).then(result => {
    assert.ok(!result.selected.some(i => i.url === stale.url), "60h item rejected in targeted mode");
    assert.ok(result.selected.some(i => i.url === fresh.url), "10h item kept in targeted mode");
    console.log("Task 1 — targeted 48h gate ✓");
  }).catch(err => console.error("FAIL Task 1 targeted:", err.message));
}

// Test 2: scheduled run with no live items and empty archive → throws
{
  const incidents = [];
  const deps = makeDeps({
    emitDigestIncident: async (type) => { incidents.push(type); },
    selectItems: () => [],
    loadRecentArchiveItems: () => [],
  });
  createDigestOrchestratorSelectionRuntime(deps).selectForEnrichment({
    allItems: [],
    selectionTarget: 5,
    customTags: [],
    tagPriority: {},
    runMode: "scheduled",
    digestDateKey: "2026-03-25",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 2,
  }).then(() => {
    console.error("FAIL Task 1 — should have thrown on empty scheduled run");
  }).catch(err => {
    assert.ok(err.message.includes("aborted"), `Expected 'aborted' in error, got: ${err.message}`);
    console.log("Task 1 — empty scheduled run throws ✓");
  });
}

// Test 3: scheduled run with archive available → still throws (no rescue)
{
  const incidents = [];
  const archiveItems = [itemAgedHours(10, "TECHNOLOGY", "https://archive.com/1")];
  const deps = makeDeps({
    emitDigestIncident: async (type) => { incidents.push(type); },
    selectItems: (pool) => {
      // Return empty for the first call (live candidates), non-empty for archive
      return pool === archiveItems ? archiveItems : [];
    },
    loadRecentArchiveItems: () => archiveItems,
  });
  createDigestOrchestratorSelectionRuntime(deps).selectForEnrichment({
    allItems: [],
    selectionTarget: 5,
    customTags: [],
    tagPriority: {},
    runMode: "scheduled",
    digestDateKey: "2026-03-25",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 2,
  }).then(() => {
    console.error("FAIL Task 1 — scheduled run with archive should have thrown");
  }).catch(err => {
    assert.ok(err.message.includes("aborted"), `Expected 'aborted', got: ${err.message}`);
    assert.ok(incidents.includes("no-live-items-scheduled"), `Expected incident 'no-live-items-scheduled', got: ${JSON.stringify(incidents)}`);
    console.log("Task 1 — scheduled run refuses archive rescue ✓");
  });
}
```

- [ ] **Step 1.2: Run — verify tests 1 and 3 fail (test 2 may pass already)**

```bash
/opt/homebrew/opt/node@22/bin/node src/entrypoints/digest-orchestrator-selection-runtime.test.js 2>&1
```

Expected: Test 1 fails (60h item passes with 72h targeted path). Test 3 fails (archive rescue currently succeeds).

- [ ] **Step 1.3: Apply the two changes in digest-orchestrator-selection-runtime.js**

**Change A** — find and replace line 50 (the only `scheduledDefaultMaxAgeHours` assignment):

Find:
```js
const scheduledDefaultMaxAgeHours = runMode === "scheduled" ? 48 : 72;
```
Replace with:
```js
const scheduledDefaultMaxAgeHours = 48; // email-only MVP: universal 48h max age
```

**Change B** — find and replace the archive fallback block (lines 108–131).

Find (unique anchor):
```js
    if (selected.length === 0) {
      const fallbackPool = loadRecentArchiveItems(5);
      if (fallbackPool.length > 0) {
        selected = selectItems(fallbackPool, {
          maxItems: selectionTarget,
          maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
          customTags: [],
          maxCustomItems: 0,
          tagPriority,
          maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
        });
        log(`⚠️ Live fetch produced no selectable items; using archive fallback pool (${fallbackPool.length} items, selected=${selected.length})`);
        await emitDigestIncident(
          "archive-fallback-engaged",
          `Live fetch produced zero selectable items; archive fallback selected ${selected.length}`,
          {
            mode: runMode,
            due_users: dueUsersCount,
            standard_topics: standardFetchCallsPlanned,
            selected_items: selected.length,
          }
        );
      }
    }
```

Replace with:
```js
    if (selected.length === 0) {
      if (runMode === "scheduled") {
        await emitDigestIncident(
          "no-live-items-scheduled",
          "Scheduled run produced zero live selectable items; aborting (no archive rescue on scheduled runs)",
          { mode: runMode, due_users: dueUsersCount, standard_topics: standardFetchCallsPlanned }
        );
        throw new Error("No live items on scheduled run; digest aborted (no archive rescue)");
      }
      // Non-scheduled (manual/on-demand) runs may still use archive fallback.
      const fallbackPool = loadRecentArchiveItems(5);
      if (fallbackPool.length > 0) {
        selected = selectItems(fallbackPool, {
          maxItems: selectionTarget,
          maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
          customTags: [],
          maxCustomItems: 0,
          tagPriority,
          maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
        });
        log(`⚠️ Live fetch produced no selectable items; using archive fallback pool (${fallbackPool.length} items, selected=${selected.length})`);
        await emitDigestIncident(
          "archive-fallback-engaged",
          `Live fetch produced zero selectable items; archive fallback selected ${selected.length}`,
          { mode: runMode, due_users: dueUsersCount, standard_topics: standardFetchCallsPlanned, selected_items: selected.length }
        );
      }
    }
```

- [ ] **Step 1.4: Run tests — verify all pass**

```bash
/opt/homebrew/opt/node@22/bin/node src/entrypoints/digest-orchestrator-selection-runtime.test.js 2>&1
```

Expected: All 3 tests pass with `✓`.

- [ ] **Step 1.5: Commit**

```bash
git add src/entrypoints/digest-orchestrator-selection-runtime.js src/entrypoints/digest-orchestrator-selection-runtime.test.js
git commit -m "fix: universal 48h freshness; scheduled runs abort instead of using archive rescue"
```

---

## Phase 2: Canonical single-topic assignment in broker

**Goal:** Each fetched article is assigned exactly one canonical topic (the first entry in `source.topic_tags`, which callers list in priority order). Eliminates duplicate items across topic buckets.

### Task 2: Add assignCanonicalTopic to broker and replace fan-out loop

**Files:**
- Modify: `src/runtime/standard-topic-broker-runtime.js`
  - Find and replace the `for (const tag of ...)` fan-out loop (~line 620)
  - Export `assignCanonicalTopic`
- Create: `src/runtime/standard-topic-broker-runtime.bestfit.test.js`

- [ ] **Step 2.1: Write failing test**

Create `src/runtime/standard-topic-broker-runtime.bestfit.test.js`:

```js
"use strict";
const assert = require("assert");
const { assignCanonicalTopic } = require("./standard-topic-broker-runtime");

{
  assert.strictEqual(assignCanonicalTopic(["TECHNOLOGY"]), "TECHNOLOGY", "single tag");
  console.log("assignCanonicalTopic single ✓");
}
{
  assert.strictEqual(assignCanonicalTopic(["HEALTHCARE", "LIFE SCIENCES"]), "HEALTHCARE", "multi → first");
  console.log("assignCanonicalTopic multi ✓");
}
{
  assert.strictEqual(assignCanonicalTopic([]), null, "empty → null");
  console.log("assignCanonicalTopic empty ✓");
}
{
  assert.strictEqual(assignCanonicalTopic(null), null, "null → null");
  console.log("assignCanonicalTopic null ✓");
}
console.log("All assignCanonicalTopic tests passed ✓");
```

- [ ] **Step 2.2: Run — verify fails**

```bash
/opt/homebrew/opt/node@22/bin/node src/runtime/standard-topic-broker-runtime.bestfit.test.js 2>&1
```

Expected: `TypeError: assignCanonicalTopic is not a function`

- [ ] **Step 2.3: Add assignCanonicalTopic function near top of standard-topic-broker-runtime.js**

Find the `"use strict";` line at the top. After any existing `const` declarations (before the first function definition), add:

```js
/**
 * Pick one canonical topic for an article.
 * Uses topic_tags[0] — callers should list tags in priority order.
 * @param {string[]} topicTags
 * @returns {string|null}
 */
function assignCanonicalTopic(topicTags) {
  if (!Array.isArray(topicTags) || topicTags.length === 0) return null;
  return topicTags[0];
}
```

- [ ] **Step 2.4: Replace the fan-out loop in the broker**

Find this exact block (the only `for...of` loop over `topic_tags`):

```js
for (const tag of (Array.isArray(source?.topic_tags) ? source.topic_tags : [])) {
  items.push({
    ...itemBase,
    tag,
  });
  diagnostics.retained_count += 1;
}
```

Replace with:

```js
const canonicalTag = assignCanonicalTopic(Array.isArray(source?.topic_tags) ? source.topic_tags : []);
if (canonicalTag) {
  items.push({ ...itemBase, tag: canonicalTag });
  diagnostics.retained_count += 1;
}
```

- [ ] **Step 2.5: Add assignCanonicalTopic to module.exports**

Find the `module.exports = {` block and add `assignCanonicalTopic` to it.

- [ ] **Step 2.6: Run test — verify passes**

```bash
/opt/homebrew/opt/node@22/bin/node src/runtime/standard-topic-broker-runtime.bestfit.test.js 2>&1
```

Expected: All 4 assertions pass.

- [ ] **Step 2.7: Commit**

```bash
git add src/runtime/standard-topic-broker-runtime.js src/runtime/standard-topic-broker-runtime.bestfit.test.js
git commit -m "feat: canonical single-topic assignment in broker (one article → one topic)"
```

---

## Phase 3: 5 items per subscribed topic

### Task 3: Add selectTopicBuckets to delivery policy module

**Files:**
- Modify: `src/runtime/digest-delivery-policy-runtime.js` — add `selectTopicBuckets`; add to `module.exports`
- Create: `src/runtime/digest-delivery-policy-runtime.selectTopicBuckets.test.js`

- [ ] **Step 3.1: Write failing test**

Create `src/runtime/digest-delivery-policy-runtime.selectTopicBuckets.test.js`:

```js
"use strict";
const assert = require("assert");
const { selectTopicBuckets } = require("./digest-delivery-policy-runtime");

function item(tag, score, url) {
  return { tag, relevanceScore: score, url };
}

// 2 topics × 5 items each, pool has 8 per topic
{
  const items = [
    ...Array.from({length: 8}, (_, i) => item("TECHNOLOGY", 9 - i, `https://tech.com/${i}`)),
    ...Array.from({length: 8}, (_, i) => item("HEALTHCARE", 9 - i, `https://health.com/${i}`)),
  ];
  const result = selectTopicBuckets(items, ["TECHNOLOGY", "HEALTHCARE"], 5);
  assert.deepStrictEqual(Object.keys(result).sort(), ["HEALTHCARE", "TECHNOLOGY"]);
  assert.strictEqual(result.TECHNOLOGY.length, 5, "5 tech items");
  assert.strictEqual(result.HEALTHCARE.length, 5, "5 health items");
  const techScores = result.TECHNOLOGY.map(i => i.relevanceScore);
  assert.deepStrictEqual(techScores, [...techScores].sort((a,b) => b-a), "sorted descending by score");
  console.log("selectTopicBuckets 2 topics ✓");
}

// Sparse topic with only 2 items — returns all 2
{
  const result = selectTopicBuckets([item("ENERGY", 8, "e1"), item("ENERGY", 7, "e2")], ["ENERGY"], 5);
  assert.strictEqual(result.ENERGY.length, 2, "sparse: 2 items returned");
  console.log("selectTopicBuckets sparse topic ✓");
}

// Item with tag not in subscribed topics is excluded
{
  const result = selectTopicBuckets([item("TECHNOLOGY", 9, "t1"), item("INDUSTRIALS", 9, "i1")], ["TECHNOLOGY"], 5);
  assert.ok(!result.INDUSTRIALS, "non-subscribed topic excluded");
  console.log("selectTopicBuckets excludes non-subscribed ✓");
}

// Items with no relevanceScore sort as 0 (not crash)
{
  const result = selectTopicBuckets([{ tag: "ENERGY", url: "e1" }, { tag: "ENERGY", url: "e2" }], ["ENERGY"], 5);
  assert.strictEqual(result.ENERGY.length, 2, "missing relevanceScore does not crash");
  console.log("selectTopicBuckets missing relevanceScore ✓");
}

console.log("All selectTopicBuckets tests passed ✓");
```

- [ ] **Step 3.2: Run — verify fails**

```bash
/opt/homebrew/opt/node@22/bin/node src/runtime/digest-delivery-policy-runtime.selectTopicBuckets.test.js 2>&1
```

Expected: `TypeError: selectTopicBuckets is not a function`

- [ ] **Step 3.3: Implement selectTopicBuckets in digest-delivery-policy-runtime.js**

Find the final `module.exports` line. Add `selectTopicBuckets` above it:

```js
/**
 * Group items into per-topic buckets, each capped at `itemsPerTopic`,
 * sorted descending by relevanceScore within each bucket.
 * Only topics in `subscribedTopics` are included.
 *
 * @param {Array} items
 * @param {string[]} subscribedTopics
 * @param {number} itemsPerTopic — default 5
 * @returns {{ [topic: string]: Array }}
 */
function selectTopicBuckets(items, subscribedTopics, itemsPerTopic = 5) {
  const topicSet = new Set(Array.isArray(subscribedTopics) ? subscribedTopics : []);
  const buckets = {};
  for (const topic of topicSet) {
    buckets[topic] = [];
  }
  for (const item of (Array.isArray(items) ? items : [])) {
    const tag = String(item?.tag || "").trim();
    if (!topicSet.has(tag)) continue;
    buckets[tag].push(item);
  }
  for (const topic of Object.keys(buckets)) {
    buckets[topic] = buckets[topic]
      .sort((a, b) => Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0))
      .slice(0, itemsPerTopic);
  }
  return buckets;
}
```

Add `selectTopicBuckets` to the existing `module.exports` object.

- [ ] **Step 3.4: Run test — verify passes**

```bash
/opt/homebrew/opt/node@22/bin/node src/runtime/digest-delivery-policy-runtime.selectTopicBuckets.test.js 2>&1
```

Expected: All 4 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/runtime/digest-delivery-policy-runtime.js src/runtime/digest-delivery-policy-runtime.selectTopicBuckets.test.js
git commit -m "feat: selectTopicBuckets — 5-items-per-subscribed-topic delivery helper"
```

---

### Task 4: Wire selectTopicBuckets into the delivery orchestrator

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-delivery-runtime.js`

**Context:** The delivery loop calls `selectDeliveryItems(userItems, opts)` at line ~418. We replace this call with `selectTopicBuckets`, synthesize a compatible `deliverySelection` shape, and remove the `lowerConfidenceAssist7dCount` load call (keeping the variable as a hardcoded `0` so all existing record-write sites work without changes). The auto-learning block (lines ~377–392) is also removed.

- [ ] **Step 4.1: Replace the selectDeliveryItems call and lowerConfidenceAssist setup**

Find this block (unique anchor — the only place `loadRecentLowerConfidenceAssistCount` is called):

```js
        lowerConfidenceAssist7dCount = loadRecentLowerConfidenceAssistCount(userId, now.toISOString());
        const trustedOnlyCustomKeywords = selectTrustedOnlyKeywords(userCustomKeywords);
        deliverySelection = selectDeliveryItems(userItems, {
          attemptCount,
          nowIso: now.toISOString(),
          customKeywords: userCustomKeywords,
          lowerConfidenceAssistCount: lowerConfidenceAssist7dCount,
        });
```

Replace with:

```js
        lowerConfidenceAssist7dCount = 0; // email-only MVP: confidence-tier tracking removed
        const subscribedStandardTopics = (Array.isArray(user.topics) ? user.topics : [])
          .filter((t) => !String(t || "").startsWith("custom_"));
        const topicBuckets = selectTopicBuckets(userItems, subscribedStandardTopics, 5);
        const bucketItems = Object.values(topicBuckets).flat();
        deliverySelection = {
          items: bucketItems,
          delivery_eligible: bucketItems.length > 0,
          high_confidence_available_count: bucketItems.length,
          lower_confidence_available_count: 0,
          high_confidence_count: bucketItems.length,
          lower_confidence_count: 0,
          lower_confidence_used: false,
          lower_confidence_cap_reached: false,
          annotations: [],
          topic_buckets: topicBuckets,
        };
```

- [ ] **Step 4.2: Remove the auto-learning block**

Find the auto-learning block (unique anchor — the only place `autoLearning.changed` is checked):

```js
        if (autoLearning.changed) {
          writeUser(user.chatId, user);
          const changes = autoLearning.adjustments
            .map((adjustment) => `${adjustment.topic}:${adjustment.prev}->${adjustment.next}`)
            .join(", ");
          log(`  [auto-learning] ${user.email || user.chatId}: ${changes} (events=${autoLearning.processed_events})`);
        }
        const baseLearning = autoLearning.changed
          ? buildLearningSummary(autoLearning.adjustments, 2)
          : "";
        const learningSummary = [baseLearning, String(repetitionNote || "").trim()]
          .filter(Boolean)
          .join(" · ");
```

Replace with:

```js
        const learningSummary = String(repetitionNote || "").trim();
```

- [ ] **Step 4.3: Add selectTopicBuckets to the require block**

Find the `require` block at the top of the file. Add:

```js
const { selectTopicBuckets } = require("../runtime/digest-delivery-policy-runtime");
```

Do NOT remove `selectDeliveryItems` from the requires yet — it may still be imported. Check with:

```bash
grep -n "selectDeliveryItems" src/entrypoints/digest-orchestrator-delivery-runtime.js
```

If it appears only in the old `deliverySelection = selectDeliveryItems(...)` call (which you just replaced) and in the `require` block, remove it from the `require` block too.

- [ ] **Step 4.4: Verify the orchestrator loads without errors**

```bash
/opt/homebrew/opt/node@22/bin/node -e "require('./src/entrypoints/digest-orchestrator-delivery-runtime.js'); console.log('OK')" 2>&1
```

Expected: `OK`

- [ ] **Step 4.5: Commit**

```bash
git add src/entrypoints/digest-orchestrator-delivery-runtime.js
git commit -m "feat: wire 5-per-topic delivery via selectTopicBuckets; remove confidence-gate and auto-learning"
```

---

## Phase 4: Neutralize topic_weights in ranking — keep relevanceScore intact

**Goal:** Items are ranked by score, not by per-user topic_weights. The `applyTopicRelevanceScores` function still runs (it sets the `relevanceScore` field that `selectTopicBuckets` sorts on), but receives empty weights `{}` so the `weightBonus` and `specialistBonus` terms are zero. This preserves correct `relevanceScore` values while making delivery deterministic.

### Task 5: Pass empty weights to both applyTopicRelevanceScores calls in ranking runtime

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js`
  - Primary call: line ~370
  - Emergency fallback call: line ~523

- [ ] **Step 5.1: Find both applyTopicRelevanceScores calls**

```bash
grep -n "applyTopicRelevanceScores" src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js
```

Expected: Two hits — one at the main ranking path, one inside the emergency fallback.

- [ ] **Step 5.2: Replace both calls to pass empty weights**

**Primary call** — find (anchor: the only line with `applyTopicRelevanceScores(userItems,`):

```js
    userItems = applyTopicRelevanceScores(userItems, user.topics || [], weights, {
```

Replace with:

```js
    userItems = applyTopicRelevanceScores(userItems, user.topics || [], {}, {
```

**Emergency fallback call** — find (anchor: the only line with `applyTopicRelevanceScores(enriched,`):

```js
        emergencyPool = applyTopicRelevanceScores(enriched, user.topics || [], weights, {
```

Replace with:

```js
        emergencyPool = applyTopicRelevanceScores(enriched, user.topics || [], {}, {
```

- [ ] **Step 5.3: Verify ranking runtime loads cleanly**

```bash
/opt/homebrew/opt/node@22/bin/node -e "require('./src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js'); console.log('OK')" 2>&1
```

Expected: `OK`

- [ ] **Step 5.4: Commit**

```bash
git add src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js
git commit -m "fix: neutralize topic_weights in ranking — pass empty weights to applyTopicRelevanceScores"
```

---

## Phase 5: Email-only MVP — remove Telegram delivery and disable bot

### Task 6: Delete Telegram delivery block from orchestrator + disable bot in docker-compose

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-delivery-runtime.js` — remove lines ~702–739
- Modify: `docker-compose.yml` — comment out bot service

- [ ] **Step 6.1: Remove Telegram delivery block**

Find the Telegram block (unique anchor — the only `formatTelegram` call):

```js
        if (user.chatId && !user.chatId.startsWith("email-") && prefs.telegram_enabled !== false) {
          attemptedChannelCount += 1;
          const userTelegram = formatTelegram(deliveryItems, shortDate, user, {
```

Delete the entire `if (user.chatId && ...)` block including its closing `}` (everything up to and including the `}` that closes this block, before the `if (user.email && ...)` email block begins).

- [ ] **Step 6.2: Check for now-unused Telegram imports and remove them**

```bash
grep -n "formatTelegram\|sendTelegram\|buildDigestInlineKeyboard" src/entrypoints/digest-orchestrator-delivery-runtime.js
```

If these identifiers only appeared in the deleted block, remove their `require` lines from the top of the file.

- [ ] **Step 6.3: Disable bot service in docker-compose.yml**

Find the `bot:` service block (the service that runs `src/entrypoints/bot-server.js`). Comment out the entire block:

```yaml
# Bot service disabled — email-only MVP (2026-03-25)
# bot:
#   build: .
#   command: ["node", "src/entrypoints/bot-server.js"]
#   ... (all lines until the next top-level service key)
```

- [ ] **Step 6.4: Verify orchestrator loads cleanly**

```bash
/opt/homebrew/opt/node@22/bin/node -e "require('./src/entrypoints/digest-orchestrator-delivery-runtime.js'); console.log('OK')" 2>&1
```

Expected: `OK`

- [ ] **Step 6.5: Commit**

```bash
git add src/entrypoints/digest-orchestrator-delivery-runtime.js docker-compose.yml
git commit -m "fix: email-only MVP — remove Telegram delivery; disable bot in docker-compose"
```

---

### Task 7: Gate off targeted/on-demand digest mode in core orchestrator

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-core-runtime.js`

**Context:** Line 644 sets `runMode = targetChatId ? "targeted" : "scheduled"`. Targeted runs come from the `--chatId` CLI argument (used by the bot's `/digest` command). With the bot disabled, this path is unreachable in production, but add an explicit guard so any accidental call returns cleanly.

- [ ] **Step 7.1: Add guard after runMode assignment**

Find this exact line (unique — only one `runMode` assignment):

```js
  const runMode = targetChatId ? "targeted" : "scheduled";
```

Immediately after it, add:

```js
  if (runMode === "targeted") {
    log("Targeted/on-demand digest mode is disabled in email-only MVP");
    logEvent("info", "digest.run.skipped", { provider: "orchestrator", outcome: "targeted_mode_disabled", mode: runMode });
    process.exit(0);
  }
```

- [ ] **Step 7.2: Verify core orchestrator loads cleanly**

```bash
/opt/homebrew/opt/node@22/bin/node -e "require('./src/entrypoints/digest-orchestrator-core-runtime.js'); console.log('OK')" 2>&1
```

Expected: `OK` (the guard only runs when the process is invoked with `--chatId`)

- [ ] **Step 7.3: Commit**

```bash
git add src/entrypoints/digest-orchestrator-core-runtime.js
git commit -m "fix: gate off targeted/on-demand digest mode (email-only MVP)"
```

---

## Phase 6: Expand broker source inventory

**Goal:** Reach 8–9 publisher_feed sources per topic. Current: 4–5 per topic, 26 total enabled.

### Task 8: Add publisher_feed sources to config/standard-topic-broker-sources.json

**Note on feed verification:** Before adding any source as `enabled: true`, verify the RSS endpoint actually responds. Run a quick check for each:

```bash
curl -sI "<endpoint_url>" | head -5  # should return HTTP 200 or 301/302
```

If an endpoint returns non-200 or times out, set `"enabled": false` and add a `"note": "verify feed URL"` field.

- [ ] **Step 8.1: Verify each feed URL before adding**

Run curl checks for each of the following endpoints. Mark ones that fail as `enabled: false`:

| Source | URL to check |
|---|---|
| MIT Technology Review | `https://www.technologyreview.com/feed/` |
| Wired | `https://www.wired.com/feed/rss` |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` |
| STAT News | `https://www.statnews.com/feed/` |
| Fierce Healthcare | `https://www.fiercehealthcare.com/rss/xml` |
| Modern Healthcare | `https://www.modernhealthcare.com/section/rss` |
| BioPharma Dive | `https://www.biopharmadive.com/feeds/news/` |
| Endpoints News | `https://endpts.com/feed/` |
| Fierce Biotech | `https://www.fiercebiotech.com/rss/xml` |
| S&P Global (energy) | `https://www.spglobal.com/commodityinsights/en/rss-feed/energy-news.xml` |
| OilPrice (feedburner) | `https://feeds.feedburner.com/oilprice/mvCu` |
| CleanTechnica | `https://cleantechnica.com/feed/` |
| Green Tech Media | `https://www.greentechmedia.com/rss.xml` |
| Reuters business | `https://feeds.reuters.com/reuters/businessNews` |
| Manufacturing Dive | `https://www.manufacturingdive.com/feeds/news/` |
| Supply Chain Dive | `https://www.supplychaindive.com/feeds/news/` |
| Industry Week | `https://www.industryweek.com/rss/` |

- [ ] **Step 8.2: Add verified sources to config/standard-topic-broker-sources.json**

For each source that verified in Step 8.1, add an entry to the `sources` array. Use this template:

```json
{
  "id": "<topic_prefix>_<name>",
  "enabled": true,
  "lane": "publisher_feed",
  "topic_tags": ["<TOPIC NAME>"],
  "family": "<topic>_media",
  "source_kind": "trade_specialist",
  "source_family": "reported",
  "domains": ["<domain.com>"],
  "endpoint": "<verified_rss_url>",
  "parser": "rss",
  "content_kind": "article"
}
```

Topic → tag mapping:
- Technology: `"TECHNOLOGY"`
- Healthcare: `"HEALTHCARE"`
- Life Sciences: `"LIFE SCIENCES"`
- Energy: `"ENERGY"`
- Financial: `"FINANCIAL SERVICES"`
- Industrials: `"INDUSTRIALS"` (currently zero sources — add at least 3)

- [ ] **Step 8.3: Verify source count after additions**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('config/standard-topic-broker-sources.json', 'utf8'));
const enabled = (data.sources||[]).filter(s => s.enabled !== false);
const byTopic = {};
enabled.forEach(s => { (s.topic_tags||[]).forEach(t => { byTopic[t]=(byTopic[t]||0)+1; }); });
console.log('Total enabled:', enabled.length);
console.log(JSON.stringify(byTopic, null, 2));
"
```

Expected: 35–45 total enabled sources, 7–9 per topic for most topics.

- [ ] **Step 8.4: Commit**

```bash
git add config/standard-topic-broker-sources.json
git commit -m "feat: expand broker source inventory to 7-9 per topic (40+ enabled)"
```

---

## Phase 7: Final integration check + push

### Task 9: Run all tests + verify entrypoints + push

- [ ] **Step 9.1: Run all tests**

```bash
/opt/homebrew/opt/node@22/bin/node src/entrypoints/digest-orchestrator-selection-runtime.test.js
/opt/homebrew/opt/node@22/bin/node src/runtime/standard-topic-broker-runtime.bestfit.test.js
/opt/homebrew/opt/node@22/bin/node src/runtime/digest-delivery-policy-runtime.selectTopicBuckets.test.js
/opt/homebrew/opt/node@22/bin/node src/digest/domain/editorial-overrides-runtime.test.js
```

Expected: All pass.

- [ ] **Step 9.2: Verify all entry points load cleanly**

```bash
/opt/homebrew/opt/node@22/bin/node -e "require('./src/entrypoints/digest-orchestrator-delivery-runtime.js'); console.log('delivery OK')"
/opt/homebrew/opt/node@22/bin/node -e "require('./src/entrypoints/digest-orchestrator-core-runtime.js'); console.log('core OK')"
/opt/homebrew/opt/node@22/bin/node -e "require('./src/entrypoints/digest-orchestrator-selection-runtime.js'); console.log('selection OK')"
```

Expected: All print `OK`.

- [ ] **Step 9.3: Push**

```bash
git push
```

---

## Spec gap coverage summary

| Spec requirement | Before | After |
|---|---|---|
| 5 items per subscribed topic | 5 total/user | `selectTopicBuckets` + orchestrator wire |
| Hard 48h max age everywhere | 72h in targeted mode | Universal 48h |
| No archive rescue on scheduled runs | Silent archive rescue | Incident + throw |
| One article → one canonical topic | Fan-out to all `topic_tags` | `assignCanonicalTopic` in broker |
| Deterministic score ranking (no topic_weights) | topic_weights modify delivery set | Empty weights passed; topicMatch scoring preserved |
| Auto-learning off active path | Ran per-user per delivery | Removed |
| Email-only delivery | Telegram + email both active | Telegram block deleted |
| Bot not deployed | Bot in docker-compose | Commented out |
| On-demand `/digest` gated off | Active via CLI arg | Guard added in core orchestrator |
| RSS backbone 8-15 sources/topic | 4-5 per topic | 7-9 per topic after expansion |

## Not covered in this plan (next session)

- Single source-of-truth registry (consolidating broker config + policy registry + preferred sources)
- `retrieval_lane` persistence to audit log items
- Bookmarks removal from user-facing API
- `items_per_digest` and `custom_topics` cleanup from user contract
- Persist `topic_buckets` field to delivery record for admin audit visibility
