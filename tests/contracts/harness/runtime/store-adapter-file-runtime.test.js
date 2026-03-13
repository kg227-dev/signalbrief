"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/store-adapter-file-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createFileStoreAdapter } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-file-adapter-"));
const tokenIndex = new Map();

const adapter = createFileStoreAdapter({
  currentDataDir: () => tmpDir,
  currentTokenIndex: () => tokenIndex,
  ensureStoreInitialized: () => {},
  defaultUser: (chatId) => ({
    chatId: String(chatId),
    token: null,
    status: "active",
    preferences: { delivery_time: "07:00" },
  }),
  normalizeUserRecord: (raw, { chatId }) => ({
    ...raw,
    chatId: String(chatId),
    token: raw?.token || null,
    status: raw?.status || "active",
    preferences: raw?.preferences || { delivery_time: "07:00" },
  }),
  generateToken: () => "a".repeat(64),
  warnStoreRecovery: () => {},
});

assert.strictEqual(typeof adapter.readUser, "function");
assert.strictEqual(typeof adapter.writeUser, "function");
assert.strictEqual(typeof adapter.deleteUser, "function");
assert.strictEqual(typeof adapter.allUsers, "function");
assert.strictEqual(typeof adapter.rebuildTokenIndex, "function");
assert.strictEqual(typeof adapter.findUserByToken, "function");
