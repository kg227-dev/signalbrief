"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/repeat-freshness-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  buildSemanticRepeatIndex,
  isSemanticRepeatItem,
  excludeSemanticRepeats,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(() => {
  const recentItems = [
    {
      tag: "SUSTAINABILITY",
      headline: "California Sets August 2026 Deadline for First Corporate Climate Reports",
      url: "https://www.esgtoday.com/california-sets-august-2026-deadline-for-first-corporate-climate-reports/",
    },
    {
      tag: "STRATEGY",
      entity_keys: ["target"],
      headline: "Target Outlines Strategic Plan for a New Chapter of Growth in 2026",
      url: "https://corporate.target.com/news-features/article/2026/03/target-growth-strategy-2026",
    },
  ];
  const repeatIndex = buildSemanticRepeatIndex(recentItems);

  assert.strictEqual(
    isSemanticRepeatItem({
      tag: "SUSTAINABILITY",
      headline: "California Sets August 2026 Deadline for Corporate Climate Reports Under SB 253 and SB 261",
      url: "https://www.esgtoday.com/california-sets-august-2026-deadline-for-corporate-climate-reports-under-sb-253-and-sb-261/",
    }, repeatIndex),
    true,
    "headline variants of the same climate-reporting story should be treated as repeats"
  );

  assert.strictEqual(
    isSemanticRepeatItem({
      tag: "STRATEGY",
      entity_keys: ["target"],
      headline: "Target Outlines $2 Billion Strategic Growth Plan for 2026 with AI and New Store Expansion",
      url: "https://corporate.target.com/news-features/article/2026/03/target-growth-strategy-2026?ref=alt",
    }, repeatIndex),
    true,
    "same-company strategic-plan variants should be treated as repeats"
  );

  const filtered = excludeSemanticRepeats([
    {
      tag: "SUSTAINABILITY",
      headline: "California Sets August 2026 Deadline for Corporate Climate Reports Under SB 253 and SB 261",
      url: "https://www.esgtoday.com/california-sets-august-2026-deadline-for-corporate-climate-reports-under-sb-253-and-sb-261/",
    },
    {
      tag: "ENERGY",
      headline: "PJM Approves New Transmission Buildout for Grid Reliability",
      url: "https://example.com/pjm-grid-reliability",
    },
  ], repeatIndex);

  assert.strictEqual(filtered.items.length, 1);
  assert.strictEqual(filtered.removed.length, 1);
  assert.strictEqual(filtered.items[0].headline, "PJM Approves New Transmission Buildout for Grid Reliability");
})();
