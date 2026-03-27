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
// The reduced-scope MVP should not keep free-form topic controls in the active settings UI.
assert.ok(
  !src.includes("MAX_CUSTOM_KEYWORDS"),
  "settings topic actions should not keep active free-form topic controls"
);
console.log("MAX_CUSTOM_KEYWORDS floor removed ✓");
