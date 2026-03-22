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

const [standard, customRealistic, customAdversarial] = buildScenarioMatrix([
  "standard_full",
  "custom_realistic",
  "custom_adversarial",
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
