"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-cost-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  createDigestOrchestratorCostRuntime,
  calculateRunCosts,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function testCalculateRunCosts() {
  const out = calculateRunCosts({
    standardFetchCalls: 17,
    claudeUsage: { input_tokens: 100_000, output_tokens: 20_000 },
  });
  assert.strictEqual(out.perplexityCalls, 17);
  assert.ok(out.perplexityCost > 0);
  assert.ok(out.claudeCost > 0);
  assert.strictEqual(Number(out.totalCost.toFixed(6)), Number((out.perplexityCost + out.claudeCost).toFixed(6)));
}

function testRecordRunCostWritesLogLine() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cost-runtime-"));
  const costLogPath = path.join(tmpDir, "cost-log.json");
  const logs = [];
  const runtimeInstance = createDigestOrchestratorCostRuntime({
    fs,
    path,
    costLogPath,
    log: (line) => logs.push(line),
    formatEtDateKey: () => "2026-03-13",
  });

  const now = new Date("2026-03-13T15:30:00.000Z");
  runtimeInstance.recordRunCost({
    now,
    runId: "scheduled:2026-03-13T15-30-00-000Z",
    targetChatId: null,
    standardFetchCalls: 17,
    claudeUsage: { input_tokens: 1000, output_tokens: 2000 },
    dueUsers: [{ chatId: "1" }, { chatId: "2" }],
    deliveredUsers: [{ id: "1" }],
    failedUsers: [{ id: "2", error: "x" }],
    publicDigestUrl: "https://getsignalbrief.com/digest/2026-03-13",
  });

  const lines = fs.readFileSync(costLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.strictEqual(row.run_id, "scheduled:2026-03-13T15-30-00-000Z");
  assert.strictEqual(row.perplexity_calls, 17);
  assert.strictEqual(row.users_due, 2);
  assert.strictEqual(row.users_served, 1);
  assert.ok(logs.some((line) => line.includes("Run cost: $")), "cost logger should emit summary");
}

testCalculateRunCosts();
testRecordRunCostWritesLogLine();
