"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-archive-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorArchiveRuntime, buildQuickScan } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function testBuildQuickScan() {
  const quickScan = buildQuickScan([
    { headline: "Deal Desk: Mega merger announced" },
    { headline: "AI shakeup — board update" },
  ]);
  assert.ok(quickScan.includes("Deal Desk: Mega merger announced"), "quick scan should preserve the full headline");
  assert.ok(quickScan.includes("AI shakeup — board update"), "quick scan should preserve em dash headlines");
  assert.ok(quickScan.includes(" · "), "quick scan should use readable separators");
  assert.ok(!quickScan.includes("&nbsp;"), "quick scan should not include HTML entities");
  assert.ok(!quickScan.includes("&middot;"), "quick scan should not include HTML entities");
}

function testArchivePersistOverwriteBehavior() {
  const calls = [];
  const runtimeInstance = createDigestOrchestratorArchiveRuntime({
    saveToArchive: (...args) => calls.push(args),
  });
  const now = new Date("2026-03-13T15:00:00.000Z");
  const enriched = [{ headline: "One: Two" }];
  runtimeInstance.persistSharedArchive({
    now,
    enriched,
    dateStr: "Friday, March 13, 2026",
  });
  runtimeInstance.persistSharedArchive({
    now,
    enriched,
    dateStr: "Friday, March 13, 2026",
  });

  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[0][4], { overwrite: true });
  assert.deepStrictEqual(calls[1][4], { overwrite: true });
}

testBuildQuickScan();
testArchivePersistOverwriteBehavior();
