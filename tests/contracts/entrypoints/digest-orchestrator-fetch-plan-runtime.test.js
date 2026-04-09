"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-fetch-plan-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  applyRunModeSearchBudgetOverrides,
  buildAllStandardTagSet,
  buildFocusedStandardTagSet,
  resolveSearchBudget,
  resolveSelectionTarget,
  resolveTopicsToFetch,
} = runtime;

assert.strictEqual(resolveSelectionTarget([], 7), 5);
assert.strictEqual(resolveSelectionTarget([], 5), 5);

const focusedTopics = resolveTopicsToFetch({
  configTopics: [
    { tag: "HEALTHCARE", queries: ["a", "b"] },
    { tag: "LIFE SCIENCES", queries: ["c", "d"] },
    { tag: "TECHNOLOGY", queries: ["e", "f"] },
    { tag: "FINANCIAL SERVICES", queries: ["g", "h"] },
    { tag: "ENERGY", queries: ["i", "j"] },
    { tag: "CONSUMER & RETAIL", queries: ["k", "l"] },
    { tag: "INDUSTRIALS", queries: ["m", "n"] },
  ],
  dueUsers: [
    { topics: ["HEALTHCARE", "FINANCIAL SERVICES"] },
    { topics: ["LIFE SCIENCES", "HEALTHCARE"] },
    { topics: ["TECHNOLOGY", "INDUSTRIALS"] },
    { topics: ["ENERGY", "CONSUMER & RETAIL"] },
  ],
  runMode: "standard_core",
  log: () => {},
});
assert.deepStrictEqual(
  focusedTopics.map((topic) => topic.tag),
  ["HEALTHCARE", "LIFE SCIENCES", "TECHNOLOGY", "FINANCIAL SERVICES", "ENERGY"]
);

const scheduledTopics = resolveTopicsToFetch({
  configTopics: [
    { tag: "HEALTHCARE", queries: ["a", "b"] },
    { tag: "CONSUMER", queries: ["c", "d"] },
    { tag: "REAL ESTATE", queries: ["e", "f"] },
  ],
  dueUsers: [
    { topics: ["CONSUMER & RETAIL"] },
  ],
  runMode: "scheduled",
  log: () => {},
});
assert.deepStrictEqual(
  scheduledTopics.map((topic) => topic.tag),
  ["HEALTHCARE", "CONSUMER & RETAIL"]
);

const dueUsers = [
  { topics: ["HEALTHCARE", "INDUSTRIALS", "REAL ESTATE"] },
  { topics: ["ENERGY", "CONSUMER & RETAIL", "FINANCIAL SERVICES"] },
];
assert.deepStrictEqual(
  Array.from(buildFocusedStandardTagSet(dueUsers)).sort(),
  ["ENERGY", "FINANCIAL SERVICES", "HEALTHCARE"]
);
assert.deepStrictEqual(
  Array.from(buildAllStandardTagSet(dueUsers)).sort(),
  ["CONSUMER & RETAIL", "ENERGY", "FINANCIAL SERVICES", "HEALTHCARE", "INDUSTRIALS"]
);

assert.deepStrictEqual(resolveSearchBudget({}), {
  mode: "scheduled",
  soft_calls: 24,
  hard_calls: 36,
});
assert.deepStrictEqual(applyRunModeSearchBudgetOverrides(
  { mode: "scheduled", soft_calls: 24, hard_calls: 36 },
  { runMode: "standard_phase1", standardTopicCount: 20 }
), {
  mode: "scheduled",
  soft_calls: 68,
  hard_calls: 92,
});

process.stdout.write("[digest-orchestrator-fetch-plan-runtime] all assertions passed\n");
