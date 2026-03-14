"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-users-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const source = fs.readFileSync(TARGET_PATH, "utf8");
if (!source.includes('message: "Subscriber already deleted"')) {
  throw new Error("delete-user handler should return an idempotent already-deleted message");
}
if (!source.includes('json(res, { error: "user not found" }, 404);')) {
  throw new Error("non-delete user operations should still return user not found");
}
if (!source.includes("latest_digest_record: latestDigestRecord")) {
  throw new Error("user-by-email handler should expose the latest digest record for admin debug");
}
if (!source.includes("archive_digest_count: archiveDigestCount")) {
  throw new Error("user-by-email handler should expose the canonical archive digest count");
}
