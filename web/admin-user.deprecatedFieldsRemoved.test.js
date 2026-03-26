"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "admin-user.html"), "utf8");

assert.ok(!src.includes('id="telegram"'), "admin user page must not render a deprecated telegram preferences field");
assert.ok(!src.includes("itemsPerDigest"), "admin user page must not render deprecated items-per-digest controls");
assert.ok(!src.includes("weightsCard"), "admin user page must not render deprecated topic-weight panels");
assert.ok(!src.includes("user.bookmarks"), "admin user meta bar must not show deprecated bookmark counts");
assert.ok(!src.includes("telegram_enabled"), "admin user save flow must not send deprecated telegram toggles");
assert.ok(!src.includes("items_per_digest"), "admin user save flow must not send deprecated item-count overrides");

console.log("admin user page removed deprecated MVP fields ✓");
