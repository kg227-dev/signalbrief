"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/structured-logger-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createStructuredLogger,
  normalizeLevel,
  normalizeEvent,
  normalizeService,
} = runtime;

assert.strictEqual(typeof createStructuredLogger, "function");
assert.strictEqual(normalizeLevel("WARN"), "warn");
assert.strictEqual(normalizeEvent(""), "log");
assert.strictEqual(normalizeService(""), "signalbrief");

const lines = [];
const logger = createStructuredLogger({
  service: "test-service",
  sink: (line) => lines.push(line),
  now: () => new Date("2026-03-13T12:00:00.000Z"),
});

logger.info("startup", { message: "booting" });
assert.strictEqual(lines.length, 1);
const first = JSON.parse(lines[0]);
assert.strictEqual(first.ts_utc, "2026-03-13T12:00:00.000Z");
assert.strictEqual(first.service, "test-service");
assert.strictEqual(first.event, "startup");
assert.strictEqual(first.level, "info");
assert.strictEqual(first.run_id, null);
assert.strictEqual(first.user_id, null);
assert.strictEqual(first.provider, null);
assert.strictEqual(first.outcome, null);
assert.strictEqual(first.message, "booting");

const child = logger.withContext({ run_id: "run-123", provider: "telegram" });
child.warn("delivery", { user_id: "chat-1", outcome: "failed", detail: "network" });
assert.strictEqual(lines.length, 2);
const second = JSON.parse(lines[1]);
assert.strictEqual(second.level, "warn");
assert.strictEqual(second.run_id, "run-123");
assert.strictEqual(second.user_id, "chat-1");
assert.strictEqual(second.provider, "telegram");
assert.strictEqual(second.outcome, "failed");
assert.strictEqual(second.detail, "network");
