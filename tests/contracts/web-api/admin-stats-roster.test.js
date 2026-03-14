"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-stats-roster.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ["buildSettingsPath", "admin_return", "/settings?email=", "archive_digest_count", "countArchiveDigestsForUser"]);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
