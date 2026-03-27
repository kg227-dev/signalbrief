"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const FILES = [
  "settings-runtime.js",
  "index-form-submit-runtime.js",
];

for (const file of FILES) {
  const src = fs.readFileSync(path.resolve(__dirname, file), "utf8");
  assert.ok(
    !src.includes("Math.max(1, Number(Prefs.MAX_CUSTOM_KEYWORDS || 3))"),
    `${file} must not reintroduce a hidden 1-keyword floor`
  );
  assert.ok(
    src.includes("Number(Prefs.MAX_CUSTOM_KEYWORDS || 0)"),
    `${file} must honor the MVP zero-custom-keyword cap`
  );
}

const indexSrc = fs.readFileSync(path.resolve(__dirname, "index.js"), "utf8");
assert.ok(!indexSrc.includes("Math.max(1, Number(Prefs.MAX_CUSTOM_KEYWORDS || 3))"), "index.js must not reintroduce a hidden 1-keyword floor");
assert.ok(!indexSrc.includes("customTopic"), "index.js should not carry active custom-topic UI hooks in the reduced-scope MVP");

console.log("active custom keyword caps honor MAX_CUSTOM_KEYWORDS=0 ✓");
