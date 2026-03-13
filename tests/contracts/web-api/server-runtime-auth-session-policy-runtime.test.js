"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");
const adminAuthRuntime = require(path.join(process.cwd(), "web/admin-auth.js"));

const TARGET_REL = "web/server-runtime-auth-session-policy-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createAdminAuthSessionPolicy } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const policy = createAdminAuthSessionPolicy();
assert.ok(policy && typeof policy === "object");
assert.strictEqual(policy.verifyAdminPassword, adminAuthRuntime.verifyAdminPassword);
assert.strictEqual(policy.createAdminSession, adminAuthRuntime.createAdminSession);
assert.strictEqual(policy.clearAdminSessionByRequest, adminAuthRuntime.clearAdminSessionByRequest);
assert.strictEqual(policy.getAdminActor, adminAuthRuntime.getAdminActor);
assert.strictEqual(policy.isAdminAuthed, adminAuthRuntime.isAdminAuthed);
assert.strictEqual(policy.checkLoginRate, adminAuthRuntime.checkLoginRate);
