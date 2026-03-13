"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-incident-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorIncidentRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

async function testIncidentEmitAndDedupe() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-incident-runtime-"));
  const incidentLogPath = path.join(tmpDir, "digest-incident-log.jsonl");
  const sent = [];
  const fixedNow = new Date("2026-03-13T16:15:00.000Z");
  const incidentRuntime = createDigestOrchestratorIncidentRuntime({
    fs,
    path,
    incidentLogPath,
    log: () => {},
    formatEtDateKey: () => "2026-03-13",
    resolveOpsChatId: () => "ops-chat-id",
    sendTelegram: async (text, chatId) => {
      sent.push({ text, chatId });
    },
    nowProvider: () => fixedNow,
  });

  const emitted = await incidentRuntime.emitDigestIncident("zero-standard-results", "No standard items", {
    mode: "scheduled",
    due_users: 2,
  });
  const emittedDuplicate = await incidentRuntime.emitDigestIncident("zero-standard-results", "No standard items", {
    mode: "scheduled",
    due_users: 2,
  });

  assert.strictEqual(emitted, true);
  assert.strictEqual(emittedDuplicate, false);
  assert.strictEqual(sent.length, 1, "dedupe should suppress duplicate alert sends");
  assert.strictEqual(sent[0].chatId, "ops-chat-id");

  const lines = fs.readFileSync(incidentLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 1, "dedupe should write one incident row in same hour bucket");
}

testIncidentEmitAndDedupe().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
