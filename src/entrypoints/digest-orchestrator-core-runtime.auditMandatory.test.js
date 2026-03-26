"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.resolve(__dirname, "digest-orchestrator-core-runtime.js"),
  "utf8"
);

// After fix: the catch block must contain a conditional re-throw for scheduled runs.
assert.ok(
  src.includes('if (runMode === "scheduled") throw'),
  "catch block must re-throw for scheduled runs"
);
console.log("writeDigestAuditLog re-throws for scheduled runs ✓");
