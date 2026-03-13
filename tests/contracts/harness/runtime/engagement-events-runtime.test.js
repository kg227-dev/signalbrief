"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/engagement/engagement-events-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const tmpFile = path.join(
  os.tmpdir(),
  `sb-engagement-contract-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`
);
try {
  fs.writeFileSync(
    tmpFile,
    `${JSON.stringify({ event_key: "ok-1", ts_utc: new Date().toISOString() })}\n{"bad-json"\n`
  );
  const events = runtime.loadEngagementEvents({
    events_file: tmpFile,
    max_age_days: 30,
    dedupe: false,
  });
  assert.ok(Array.isArray(events), "default loadEngagementEvents should return an array");
  assert.strictEqual(events.length, 1, "only valid JSON lines should be retained");
  assert.strictEqual(events.parse_errors, 1, "array return should expose parse error count");
  assert.ok(Array.isArray(events.parse_error_lines), "array return should expose parse error lines");
  assert.ok(events.parse_error_lines.includes(2), "parse error metadata should include malformed line number");

  const withMeta = runtime.loadEngagementEvents({
    events_file: tmpFile,
    max_age_days: 30,
    dedupe: false,
    return_meta: true,
  });
  assert.ok(withMeta && typeof withMeta === "object", "return_meta should return metadata object");
  assert.ok(Array.isArray(withMeta.events), "return_meta should include events list");
  assert.strictEqual(withMeta.parse_errors, 1, "return_meta should include parse error count");

  // Incremental load should parse only appended bytes and avoid full-file reads.
  fs.appendFileSync(
    tmpFile,
    `${JSON.stringify({ event_key: "ok-2", ts_utc: new Date().toISOString() })}\n`
  );
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function guardedRead(filePath, ...args) {
    if (path.resolve(String(filePath || "")) === path.resolve(tmpFile)) {
      throw new Error("unexpected full events-file read during incremental load");
    }
    return originalReadFileSync.call(fs, filePath, ...args);
  };
  try {
    const incremental = runtime.loadEngagementEvents({
      events_file: tmpFile,
      max_age_days: 30,
      dedupe: false,
    });
    assert.strictEqual(incremental.length, 2, "incremental load should include appended event");
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
} finally {
  try {
    fs.unlinkSync(tmpFile);
  } catch (cleanupError) {
    process.stderr.write(
      `[engagement-events-runtime.test] cleanup failed for ${tmpFile}: ${cleanupError.message}\n`
    );
  }
}
