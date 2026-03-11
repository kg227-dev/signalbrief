"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/restore-state-drill.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ["backup-manifest.json", "restore drill OK", "verifyManifest"]);
