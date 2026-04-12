"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const targetPath = path.join(process.cwd(), "web/server-runtime.js");
const source = fs.readFileSync(targetPath, "utf8");

assert.ok(
  source.includes('require("../src/entrypoints/digest-orchestrator-delivery-helpers-runtime")'),
  "server-runtime.js should import digest resend helpers"
);

assert.ok(
  source.includes("const quickScanRows = buildUserQuickScanRows(items, {"),
  "resendDigestSnapshot should rebuild quick-scan rows from stored items"
);

assert.ok(
  source.includes("quickScanRows,"),
  "resendDigestSnapshot should pass rebuilt quick-scan rows into buildEmail"
);

console.log("server runtime resend digest source contract passed");
