"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/preferences-shared.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ["bootstrapPreferences","SignalBriefPrefs"]);

