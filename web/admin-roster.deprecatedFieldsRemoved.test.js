"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const adminHtml = fs.readFileSync(path.join(__dirname, "admin.html"), "utf8");
const rosterService = fs.readFileSync(path.join(__dirname, "services", "admin-stats-roster.js"), "utf8");

assert.ok(!adminHtml.includes("weightsSummary("), "admin dashboard must not compute deprecated topic-weight summaries");
assert.ok(!adminHtml.includes("weights-pill"), "admin dashboard must not render deprecated topic-weight pills");
assert.ok(!adminHtml.includes("Items / digest"), "admin dashboard must not display deprecated items-per-digest fields");
assert.ok(!adminHtml.includes('"items_per_digest"'), "admin dashboard exports must not include deprecated item-count columns");

assert.ok(!rosterService.includes("bookmarks:"), "admin roster service must not surface deprecated bookmark counts");
assert.ok(!rosterService.includes("adjustments:"), "admin roster service must not surface deprecated topic-weight adjustment counts");
assert.ok(!rosterService.includes("topic_weights:"), "admin roster service must not surface deprecated topic-weight maps");
assert.ok(!rosterService.includes("items_per_digest:"), "admin roster service must not surface deprecated item-count overrides");

console.log("admin roster removed deprecated MVP fields ✓");
