"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.resolve(__dirname, "settings-ui-topic-actions-runtime.js"),
  "utf8"
);

// After fix: the Math.max(1, ...) floor must be gone.
assert.ok(
  !src.includes("Math.max(1,"),
  "Math.max(1, ...) floor must be removed from maxCustomKeywords"
);
// After fix: the expression uses 0 as the fallback, not 3.
assert.ok(
  src.includes("Number(Prefs.MAX_CUSTOM_KEYWORDS || 0)"),
  "maxCustomKeywords must use 0 fallback"
);
console.log("MAX_CUSTOM_KEYWORDS floor removed ✓");
