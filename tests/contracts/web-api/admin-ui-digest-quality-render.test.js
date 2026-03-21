"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

const renderMatch = source.match(/function renderRunDigestQuality\(run\) \{[\s\S]*?\n\}/);
if (!renderMatch) {
  throw new Error(`could not find renderRunDigestQuality() in ${TARGET_REL}`);
}

function esc(value) {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const context = {
  Number,
  String,
  esc,
};

vm.runInNewContext(`${renderMatch[0]}\nthis.renderRunDigestQuality = renderRunDigestQuality;`, context, {
  filename: TARGET_REL,
});

const { renderRunDigestQuality } = context;

const decentHtml = renderRunDigestQuality({ digest_quality_score: 70.3 });
assert.ok(decentHtml.includes("70.3"), "decent score should render numeric score");
assert.ok(decentHtml.includes(">Decent<"), "70.3 should render the decent label");
assert.ok(decentHtml.includes("color:#D97706;"), "70.3 decent score should render with yellow tone");

const weakHtml = renderRunDigestQuality({ digest_quality_score: 69.9 });
assert.ok(weakHtml.includes(">Weak<"), "69.9 should render the weak label");
assert.ok(weakHtml.includes("color:#DC2626;"), "69.9 weak score should render with red tone");

const strongHtml = renderRunDigestQuality({ digest_quality_score: 85 });
assert.ok(strongHtml.includes(">Strong<"), "85 should render the strong label");
assert.ok(strongHtml.includes("color:#059669;"), "85 strong score should render with green tone");
