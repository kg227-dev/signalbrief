"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TARGET_REL = "start.sh";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

assert.ok(source.includes("log_event"), "start.sh should define structured log_event helper");
assert.ok(source.includes("\"run_id\""), "start.sh structured logs should include run_id");
assert.ok(source.includes("\"provider\""), "start.sh structured logs should include provider");
assert.ok(source.includes("\"outcome\""), "start.sh structured logs should include outcome");
