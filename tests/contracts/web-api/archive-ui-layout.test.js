"use strict";

const path = require("path");
const fs = require("fs");

const TARGET_REL = "web/archive.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

for (const snippet of [
  ".container { max-width: 1240px;",
  "white-space: normal;",
  "overflow: visible;",
  "text-overflow: initial;",
]) {
  if (!source.includes(snippet)) {
    throw new Error(`archive layout is missing required snippet: ${snippet}`);
  }
}
