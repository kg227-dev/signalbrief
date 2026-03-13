"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/store-adapter-sqlite-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createSqliteStoreAdapter } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-sqlite-adapter-"));
const sqlitePath = path.join(tmpDir, "state.sqlite");
const tokenIndex = new Map();

const adapter = createSqliteStoreAdapter({
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
  generateToken: () => "b".repeat(64),
  warnStoreRecovery: () => {},
}, {
  sqlitePath,
});

const defaultUser = adapter.readUser("sqlite-user");
assert.strictEqual(defaultUser.chatId, "sqlite-user");
assert.strictEqual(defaultUser.status, "active");

adapter.writeUser("sqlite-user", {
  ...defaultUser,
  email: "sqlite@example.com",
  token: "c".repeat(64),
});

const persisted = adapter.readUser("sqlite-user");
assert.strictEqual(persisted.email, "sqlite@example.com");
assert.strictEqual(persisted.token, "c".repeat(64));

const byToken = adapter.findUserByToken("c".repeat(64));
assert.ok(byToken);
assert.strictEqual(byToken.chatId, "sqlite-user");

adapter.writeUser("legacy-user", {
  chatId: "legacy-user",
  email: "legacy@example.com",
  token: null,
  status: "active",
  preferences: { delivery_time: "07:00" },
});
adapter.rebuildTokenIndex();
const rebuilt = adapter.readUser("legacy-user");
assert.ok(typeof rebuilt.token === "string" && rebuilt.token.length === 64);
assert.ok(adapter.findUserByToken(rebuilt.token));

const deleted = adapter.deleteUser("legacy-user");
assert.strictEqual(deleted.ok, true);
assert.strictEqual(deleted.existed, true);
