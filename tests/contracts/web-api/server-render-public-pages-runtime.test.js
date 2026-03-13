"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-render-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { renderPublicDigestPage } = require(TARGET_PATH);

const html = renderPublicDigestPage({
  dateKey: "2026-03-13",
  dateLabel: "Friday, March 13, 2026",
  quickScan: "One&nbsp;&middot;&nbsp;Two &amp;middot; &amp;nbsp;Three",
  items: [],
});

assert.ok(html.includes("Quick scan:"), "expected quick scan block to render");
assert.ok(html.includes("One · Two · Three"), "expected legacy HTML entities to normalize to readable separators");
assert.ok(!html.includes("&amp;nbsp;"), "expected normalized quick scan not to include escaped nbsp entity");
assert.ok(!html.includes("&amp;middot;"), "expected normalized quick scan not to include escaped middot entity");
