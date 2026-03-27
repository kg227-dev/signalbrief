"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/eval/retrieval/personas-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildScenarioMatrix,
  buildVirtualUser,
} = runtime;

const [standard, standardCore, standardPhase1, standardPhase1Focus, standardTopics] = buildScenarioMatrix([
  "standard_full",
  "standard_core",
  "standard_phase1",
  "standard_phase1_focus",
  "standard_topics",
]);

assert.strictEqual(standard.personaCount, 11);
assert.ok(standard.dueUsers.some((user) => user.eval_group === "industry"));
assert.ok(standard.dueUsers.some((user) => user.eval_group === "mixed_realistic"));

assert.strictEqual(standardCore.personaCount, 5);
assert.ok(standardCore.dueUsers.every((user) => user.eval_group === "standard_core"));
assert.deepStrictEqual(
  standardCore.dueUsers.map((user) => user.eval_label),
  ["HEALTHCARE", "LIFE SCIENCES", "TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES"]
);

assert.strictEqual(standardPhase1.personaCount, 7);
assert.ok(standardPhase1.dueUsers.every((user) => user.eval_group === "standard_phase1"));
assert.deepStrictEqual(
  standardPhase1.dueUsers.map((user) => user.eval_label),
  ["HEALTHCARE", "LIFE SCIENCES", "TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES", "CONSUMER & RETAIL", "INDUSTRIALS"]
);

assert.strictEqual(standardPhase1Focus.personaCount, 3);
assert.ok(standardPhase1Focus.dueUsers.every((user) => user.eval_group === "standard_phase1_focus"));
assert.deepStrictEqual(
  standardPhase1Focus.dueUsers.map((user) => user.eval_label),
  ["TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES"]
);

assert.strictEqual(standardTopics.personaCount, 7);
assert.ok(standardTopics.dueUsers.every((user) => user.eval_group === "standard_topics"));

const virtualUser = buildVirtualUser({
  id: "demo",
  label: "Demo User",
  group: "industry",
  topics: ["HEALTHCARE", "TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES"],
});
assert.strictEqual(virtualUser.chatId, "eval-demo");
assert.deepStrictEqual(virtualUser.topics, ["HEALTHCARE", "TECHNOLOGY", "ENERGY"]);
assert.strictEqual(Object.prototype.hasOwnProperty.call(virtualUser.preferences, "items_per_digest"), false);

process.stdout.write("[retrieval-personas-runtime] all assertions passed\n");
