"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/backup-state.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ["backup-manifest.json", "state-backup-", "pruneBackups", "canonical_state_assets", "sqlite_primary"]);
