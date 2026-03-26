"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/routes/core-api-bookmarks-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assert.ok(
  !fs.existsSync(TARGET_PATH),
  "bookmark actions route should remain removed from the active web API path in the email-only MVP"
);

process.stdout.write("[bookmarks-actions-runtime] removal contract passed\n");
