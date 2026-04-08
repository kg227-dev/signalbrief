"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-run-args-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const parsed = runtime.parseDigestRunArgs([
  "--auditOnly",
  "--auditTopic=technology",
  "--auditDate=2026-04-08",
  "--suppressWelcome",
], {
  formatEtDateKey: () => "2026-04-08",
});

assert.strictEqual(parsed.auditTopicRerun, true);
assert.strictEqual(parsed.runMode, "admin_topic_audit_rerun");
assert.strictEqual(parsed.auditTopicTag, "TECHNOLOGY");
assert.strictEqual(parsed.auditDateKey, "2026-04-08");
assert.strictEqual(parsed.suppressWelcome, true);
assert.strictEqual(parsed.todayEt, "2026-04-08");

process.stdout.write("[digest-orchestrator-run-args-runtime] all assertions passed\n");
