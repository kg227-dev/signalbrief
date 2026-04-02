"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TARGET_RELS = [
  "web/routes/core-api-bookmarks-actions-runtime.js",
  "web/routes/core/core-api-bookmarks-actions-runtime.js",
  "web/routes/core/core-api-bookmarks-runtime.js",
];

assert.ok(
  TARGET_RELS.every((targetRel) => !fs.existsSync(path.join(process.cwd(), targetRel))),
  "bookmark actions route should remain removed from the active web API path in the email-only MVP"
);

process.stdout.write("[bookmarks-actions-runtime] removal contract passed\n");
