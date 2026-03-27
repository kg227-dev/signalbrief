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
const {
  createDigestOrchestratorIncidentRuntime,
  INCIDENT_STATUS_OPEN,
  INCIDENT_STATUS_ESCALATED,
  INCIDENT_STATUS_RESOLVED,
  INCIDENT_SEVERITY_WARNING,
  INCIDENT_SEVERITY_CRITICAL,
  INCIDENT_SEVERITY_FATAL,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

// Verify exported constants
assert.strictEqual(INCIDENT_STATUS_OPEN, "OPEN");
assert.strictEqual(INCIDENT_STATUS_ESCALATED, "ESCALATED");
assert.strictEqual(INCIDENT_STATUS_RESOLVED, "RESOLVED");
assert.strictEqual(INCIDENT_SEVERITY_WARNING, "WARNING");
assert.strictEqual(INCIDENT_SEVERITY_CRITICAL, "CRITICAL");
assert.strictEqual(INCIDENT_SEVERITY_FATAL, "FATAL");

function makeRuntime(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-incident-rt-"));
  const incidentLogPath = opts.noLog ? null : path.join(tmpDir, "digest-incident-log.jsonl");
  const incidentStorePath = opts.noStore ? null : path.join(tmpDir, "incident-store.json");
  const sent = [];
  const fixedNow = opts.now || new Date("2026-03-23T07:00:00.000Z");
  const dateEtStr = opts.dateEt || "2026-03-23";
  const incidentRuntime = createDigestOrchestratorIncidentRuntime({
    fs,
    path,
    incidentLogPath,
    incidentStorePath,
    log: () => {},
    formatEtDateKey: () => dateEtStr,
    resolveOpsAlertTarget: opts.noChat ? () => null : () => "ops@example.com",
    sendOpsAlert: async (text, target) => {
      sent.push({ text, target });
    },
    nowProvider: () => fixedNow,
  });
  return { incidentRuntime, sent, incidentLogPath, incidentStorePath, tmpDir, dateEtStr };
}

async function testIncidentLifecycle() {
  const { incidentRuntime, sent, incidentStorePath, dateEtStr } = makeRuntime();
  const type = "circuit_breaker_opened";
  const fingerprint = `scheduled:${type}:${dateEtStr}`;

  // 1. First emit → OPEN, WARNING, 1 ops alert
  const r1 = await incidentRuntime.emitDigestIncident(type, "Circuit breaker opened: consecutive_zero_serve", {
    mode: "scheduled",
  });
  assert.strictEqual(r1, true, "first emit should return true");
  assert.strictEqual(sent.length, 1, "first emit should send 1 ops alert");
  assert.ok(sent[0].text.includes("⚠️ INCIDENT OPEN"), "first message should be OPEN prefix");
  // Verify store
  const store1 = JSON.parse(fs.readFileSync(incidentStorePath, "utf8"));
  const inc1 = store1.incidents[fingerprint];
  assert.ok(inc1, "store should have incident keyed by fingerprint");
  assert.strictEqual(inc1.status, INCIDENT_STATUS_OPEN);
  assert.strictEqual(inc1.severity, INCIDENT_SEVERITY_WARNING);
  assert.strictEqual(inc1.occurrence_count, 1);
  assert.ok(inc1.notified_statuses.includes("OPEN"));

  // 2. Second emit → occurrence_count=2 → CRITICAL → ESCALATED → 2nd ops alert
  const r2 = await incidentRuntime.emitDigestIncident(type, "Circuit breaker opened again", {
    mode: "scheduled",
  });
  assert.strictEqual(r2, true, "second emit (severity increase) should return true");
  assert.strictEqual(sent.length, 2, "second emit should send 2nd ops alert (ESCALATED)");
  assert.ok(sent[1].text.includes("🔴 INCIDENT ESCALATED"), "second message should be ESCALATED prefix");
  assert.ok(sent[1].text.includes("CRITICAL"), "escalated message should mention CRITICAL");
  assert.ok(sent[1].text.includes("was WARNING"), "escalated message should mention previous severity");
  const store2 = JSON.parse(fs.readFileSync(incidentStorePath, "utf8"));
  const inc2 = store2.incidents[fingerprint];
  assert.strictEqual(inc2.status, INCIDENT_STATUS_ESCALATED);
  assert.strictEqual(inc2.severity, INCIDENT_SEVERITY_CRITICAL);
  assert.strictEqual(inc2.occurrence_count, 2);

  // 3. Third emit → occurrence_count=3 → FATAL → ESCALATED again → 3rd ops alert
  const r3 = await incidentRuntime.emitDigestIncident(type, "Circuit breaker still open", {
    mode: "scheduled",
  });
  assert.strictEqual(r3, true, "third emit (severity increase to FATAL) should return true");
  assert.strictEqual(sent.length, 3, "third emit should send 3rd ops alert (ESCALATED/FATAL)");
  assert.ok(sent[2].text.includes("🔴 INCIDENT ESCALATED"), "third message should be ESCALATED prefix");
  assert.ok(sent[2].text.includes("FATAL"), "third escalated message should mention FATAL");
  assert.ok(sent[2].text.includes("was CRITICAL"), "third escalated message should mention previous CRITICAL");
  const store3 = JSON.parse(fs.readFileSync(incidentStorePath, "utf8"));
  const inc3 = store3.incidents[fingerprint];
  assert.strictEqual(inc3.severity, INCIDENT_SEVERITY_FATAL);
  assert.strictEqual(inc3.occurrence_count, 3);

  // 4. Fourth emit → occurrence_count=4 → still FATAL → no severity increase → returns false, no new ops alert
  const r4 = await incidentRuntime.emitDigestIncident(type, "Still broken", {
    mode: "scheduled",
  });
  assert.strictEqual(r4, false, "fourth emit (same severity) should return false (deduplicated)");
  assert.strictEqual(sent.length, 3, "fourth emit should not send additional ops alert");
  const store4 = JSON.parse(fs.readFileSync(incidentStorePath, "utf8"));
  const inc4 = store4.incidents[fingerprint];
  assert.strictEqual(inc4.occurrence_count, 4);
  assert.strictEqual(inc4.severity, INCIDENT_SEVERITY_FATAL);

  // 5. resolveIncident → returns true, 4th ops alert (RESOLVED)
  const resolved = await incidentRuntime.resolveIncident(fingerprint);
  assert.strictEqual(resolved, true, "resolveIncident should return true");
  assert.strictEqual(sent.length, 4, "resolveIncident should send RESOLVED ops alert");
  assert.ok(sent[3].text.includes("✅ INCIDENT RESOLVED"), "resolved message should be RESOLVED prefix");
  const store5 = JSON.parse(fs.readFileSync(incidentStorePath, "utf8"));
  const inc5 = store5.incidents[fingerprint];
  assert.strictEqual(inc5.status, INCIDENT_STATUS_RESOLVED);
  assert.ok(inc5.notified_statuses.includes("RESOLVED"));

  // 6. getActiveIncidents after resolve → empty
  const active6 = incidentRuntime.getActiveIncidents(dateEtStr);
  assert.strictEqual(active6.length, 0, "no active incidents after resolve");

  // 7. emit same after RESOLVED → re-opens → new OPEN notification (5th ops alert)
  const r7 = await incidentRuntime.emitDigestIncident(type, "Circuit breaker opened again after resolve", {
    mode: "scheduled",
  });
  assert.strictEqual(r7, true, "re-emit after RESOLVED should return true (re-opened)");
  assert.strictEqual(sent.length, 5, "re-open after resolve should send 5th ops alert");
  assert.ok(sent[4].text.includes("⚠️ INCIDENT OPEN"), "re-opened message should be OPEN prefix");
  // The re-opened incident should be fresh (occurrence_count=1, WARNING, OPEN)
  const store7 = JSON.parse(fs.readFileSync(incidentStorePath, "utf8"));
  const inc7 = store7.incidents[fingerprint];
  assert.strictEqual(inc7.status, INCIDENT_STATUS_OPEN);
  assert.strictEqual(inc7.severity, INCIDENT_SEVERITY_WARNING);
  assert.strictEqual(inc7.occurrence_count, 1);

  // 8. getActiveIncidents after re-open → [1 incident]
  const active8 = incidentRuntime.getActiveIncidents(dateEtStr);
  assert.strictEqual(active8.length, 1, "one active incident after re-open");
  assert.strictEqual(active8[0].status, INCIDENT_STATUS_OPEN);

  console.log("PASS testIncidentLifecycle");
}

async function testNoOpsChatId() {
  const { incidentRuntime, sent, incidentStorePath, dateEtStr } = makeRuntime({ noChat: true });

  const r = await incidentRuntime.emitDigestIncident("provider_timeout", "Provider timed out", {
    mode: "scheduled",
  });
  assert.strictEqual(r, true, "emitDigestIncident should return true even without ops alert target");
  assert.strictEqual(sent.length, 0, "no ops alert should be sent without an alert target");

  const store = JSON.parse(fs.readFileSync(incidentStorePath, "utf8"));
  const fingerprint = `scheduled:provider_timeout:${dateEtStr}`;
  const inc = store.incidents[fingerprint];
  assert.ok(inc, "incident should be stored even without an ops alert target");
  assert.strictEqual(inc.status, INCIDENT_STATUS_OPEN);

  console.log("PASS testNoOpsChatId");
}

async function testJSONLAuditLog() {
  const { incidentRuntime, incidentLogPath, dateEtStr } = makeRuntime();

  // emit 2 different incident types
  await incidentRuntime.emitDigestIncident("type_a", "Summary A", { mode: "scheduled" });
  await incidentRuntime.emitDigestIncident("type_b", "Summary B", { mode: "scheduled" });

  let lines = fs.readFileSync(incidentLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 2, "JSONL should have 2 entries after 2 distinct emits");

  const row0 = JSON.parse(lines[0]);
  assert.strictEqual(row0.type, "type_a");
  assert.ok(row0.ts_utc, "JSONL row should have ts_utc");
  assert.ok(row0.event_key, "JSONL row should have event_key");

  // emit same fingerprint twice → JSONL gets 2 more entries (both emits log)
  await incidentRuntime.emitDigestIncident("type_a", "Summary A again", { mode: "scheduled" });
  await incidentRuntime.emitDigestIncident("type_a", "Summary A yet again", { mode: "scheduled" });

  lines = fs.readFileSync(incidentLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 4, "JSONL should have 4 entries total (each emit appends)");

  // resolveIncident does NOT add to JSONL
  const fingerprint = `scheduled:type_a:${dateEtStr}`;
  await incidentRuntime.resolveIncident(fingerprint);
  lines = fs.readFileSync(incidentLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 4, "JSONL should still have 4 entries after resolve (resolve doesn't log to JSONL)");

  console.log("PASS testJSONLAuditLog");
}

async function testInMemoryFallback() {
  // noStore=true → uses in-memory store
  const { incidentRuntime, sent, dateEtStr } = makeRuntime({ noStore: true });

  const r = await incidentRuntime.emitDigestIncident("memory_test", "In memory", { mode: "scheduled" });
  assert.strictEqual(r, true, "in-memory fallback should return true");
  assert.strictEqual(sent.length, 1, "in-memory fallback should still send an ops alert");

  const active = incidentRuntime.getActiveIncidents(dateEtStr);
  assert.strictEqual(active.length, 1, "in-memory fallback should have 1 active incident");
  assert.strictEqual(active[0].type, "memory_test");

  console.log("PASS testInMemoryFallback");
}

async function testResolveAlreadyResolved() {
  const { incidentRuntime, sent, dateEtStr } = makeRuntime();
  const fingerprint = `scheduled:already_resolved:${dateEtStr}`;

  await incidentRuntime.emitDigestIncident("already_resolved", "Test resolve idempotence", { mode: "scheduled" });
  const r1 = await incidentRuntime.resolveIncident(fingerprint);
  assert.strictEqual(r1, true);
  const sentAfterFirst = sent.length;

  // Resolve again → should return false, no extra ops alert
  const r2 = await incidentRuntime.resolveIncident(fingerprint);
  assert.strictEqual(r2, false, "resolving already-resolved incident should return false");
  assert.strictEqual(sent.length, sentAfterFirst, "no additional ops alert for already-resolved incident");

  console.log("PASS testResolveAlreadyResolved");
}

async function main() {
  await testIncidentLifecycle();
  await testNoOpsChatId();
  await testJSONLAuditLog();
  await testInMemoryFallback();
  await testResolveAlreadyResolved();
  console.log("ALL TESTS PASSED");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
