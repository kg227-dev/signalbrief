"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-funnel-test-"));

// Write sample audit files
const auditA = { digestDateKey: "2026-04-05", summary: {}, topics: {}, fetch: {} };
const auditB = { digestDateKey: "2026-04-03", summary: {}, topics: {}, fetch: {} };
fs.writeFileSync(path.join(tmpDir, "2026-04-05.json"), JSON.stringify(auditA));
fs.writeFileSync(path.join(tmpDir, "2026-04-03.json"), JSON.stringify(auditB));
fs.writeFileSync(path.join(tmpDir, "not-a-date.json"), "{}"); // should be ignored

const { buildDatesResponse } = require("./admin-api-funnel-runtime");

const result = buildDatesResponse(tmpDir);
assert.deepStrictEqual(result.available_dates, ["2026-04-05", "2026-04-03"]);
assert.strictEqual(result.oldest, "2026-04-03");
assert.strictEqual(result.newest, "2026-04-05");
assert.strictEqual(result.total_run_days, 2);

// Empty dir
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-funnel-empty-"));
const emptyResult = buildDatesResponse(emptyDir);
assert.deepStrictEqual(emptyResult.available_dates, []);
assert.strictEqual(emptyResult.oldest, null);
assert.strictEqual(emptyResult.newest, null);
assert.strictEqual(emptyResult.total_run_days, 0);

console.log("buildDatesResponse tests pass ✓");
