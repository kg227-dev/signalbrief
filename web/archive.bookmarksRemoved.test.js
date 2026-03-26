"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.resolve(__dirname, "archive.html"), "utf8");

assert.ok(!src.includes("/api/bookmarks"), "archive page must not call removed bookmark APIs");
assert.ok(!src.includes("bookmark-btn"), "archive page must not render bookmark controls");
assert.ok(!src.includes('data-mode="bookmarks"'), "archive page must not expose bookmark mode");
assert.ok(!src.includes("state.bookmarks"), "archive page must not maintain bookmark state");

console.log("archive bookmark UI removed ✓");
