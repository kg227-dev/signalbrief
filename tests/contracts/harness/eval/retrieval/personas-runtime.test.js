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

const [standard, customRealistic, customAdversarial, standardCore, standardPhase1, standardPhase1Focus, standardTopics] = buildScenarioMatrix([
  "standard_full",
  "custom_realistic",
  "custom_adversarial",
  "standard_core",
  "standard_phase1",
  "standard_phase1_focus",
  "standard_topics",
]);

assert.strictEqual(standard.personaCount, 21);
assert.ok(standard.dueUsers.some((user) => user.eval_group === "industry"));
assert.ok(standard.dueUsers.some((user) => user.eval_group === "capability"));
assert.ok(standard.dueUsers.some((user) => user.eval_group === "mixed_realistic"));

assert.strictEqual(customRealistic.personaCount, 8);
assert.ok(customRealistic.dueUsers.every((user) => user.topics.some((topic) => topic.startsWith("custom_"))));

assert.strictEqual(customAdversarial.personaCount, 4);
assert.ok(customAdversarial.dueUsers.every((user) => user.preferences.email_enabled === false));
assert.ok(customAdversarial.dueUsers.every((user) => user.preferences.telegram_enabled === false));

assert.strictEqual(standardCore.personaCount, 5);
assert.ok(standardCore.dueUsers.every((user) => user.eval_group === "standard_core"));
assert.deepStrictEqual(
  standardCore.dueUsers.map((user) => user.eval_label),
  ["HEALTHCARE", "LIFE SCIENCES", "TECHNOLOGY", "STRATEGY", "POLICY×REGULATORY"]
);

assert.strictEqual(standardPhase1.personaCount, 6);
assert.ok(standardPhase1.dueUsers.every((user) => user.eval_group === "standard_phase1"));
assert.deepStrictEqual(
  standardPhase1.dueUsers.map((user) => user.eval_label),
  ["HEALTHCARE", "LIFE SCIENCES", "TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES", "POLICY×REGULATORY"]
);

assert.strictEqual(standardPhase1Focus.personaCount, 3);
assert.ok(standardPhase1Focus.dueUsers.every((user) => user.eval_group === "standard_phase1_focus"));
assert.deepStrictEqual(
  standardPhase1Focus.dueUsers.map((user) => user.eval_label),
  ["TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES"]
);

assert.strictEqual(standardTopics.personaCount, 17);
assert.ok(standardTopics.dueUsers.every((user) => user.eval_group === "standard_topics"));

const virtualUser = buildVirtualUser({
  id: "demo",
  label: "Demo User",
  group: "industry",
  topics: ["HEALTHCARE", "STRATEGY"],
});
assert.strictEqual(virtualUser.chatId, "eval-demo");
assert.deepStrictEqual(virtualUser.topics, ["HEALTHCARE", "STRATEGY"]);
assert.strictEqual(virtualUser.preferences.items_per_digest, 5);

process.stdout.write("[retrieval-personas-runtime] all assertions passed\n");
