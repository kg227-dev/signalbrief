"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.resolve(__dirname, "digest-orchestrator-audit-runtime.js"),
  "utf8"
);

// Scheduled audit writes must still fail closed after extraction.
assert.ok(
  src.includes('if (runMode === "scheduled") throw'),
  "catch block must re-throw for scheduled runs"
);
console.log("digest-orchestrator-audit-runtime re-throws for scheduled runs ✓");
