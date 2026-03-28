"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const FILES = [
  "settings-runtime.js",
  "index-form-submit-runtime.js",
];

const settingsSrc = fs.readFileSync(path.resolve(__dirname, "settings-runtime.js"), "utf8");
assert.ok(
  !settingsSrc.includes("Math.max(1, Number(Prefs.MAX_CUSTOM_KEYWORDS || 3))"),
  "settings-runtime.js must not reintroduce a hidden 1-keyword floor"
);
assert.ok(
  settingsSrc.includes("Number(Prefs.MAX_CUSTOM_KEYWORDS || 0)"),
  "settings-runtime.js must honor the MVP zero-custom-keyword cap"
);

const submitSrc = fs.readFileSync(path.resolve(__dirname, "index-form-submit-runtime.js"), "utf8");
assert.ok(
  !submitSrc.includes("Math.max(1, Number(Prefs.MAX_CUSTOM_KEYWORDS || 3))"),
  "index-form-submit-runtime.js must not reintroduce a hidden 1-keyword floor"
);
assert.ok(
  !submitSrc.includes("MAX_CUSTOM_KEYWORDS"),
  "index-form-submit-runtime.js should not carry custom-keyword cap logic in the reduced-scope MVP"
);

const indexSrc = fs.readFileSync(path.resolve(__dirname, "index.js"), "utf8");
assert.ok(!indexSrc.includes("Math.max(1, Number(Prefs.MAX_CUSTOM_KEYWORDS || 3))"), "index.js must not reintroduce a hidden 1-keyword floor");
assert.ok(!indexSrc.includes("customTopic"), "index.js should not carry active custom-topic UI hooks in the reduced-scope MVP");

console.log("reduced-scope keyword caps honor MAX_CUSTOM_KEYWORDS=0 ✓");
