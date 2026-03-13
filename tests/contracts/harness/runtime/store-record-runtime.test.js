"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/store-record-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createStoreRecordRuntime } = runtime;
assert.strictEqual(typeof createStoreRecordRuntime, "function");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-record-"));
const tokenIndex = new Map();

try {
  const recordRuntime = createStoreRecordRuntime({
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
      token: String(raw?.token || "").trim() || null,
      status: raw?.status || "active",
      preferences: raw?.preferences || { delivery_time: "07:00" },
    }),
    generateToken: () => "x".repeat(64),
    warnStoreRecovery: () => {},
  });

  recordRuntime.writeUser("chat-1", {
    chatId: "chat-1",
    token: "tok-1",
    email: "chat1@example.com",
    status: "active",
    preferences: { delivery_time: "07:00" },
  });

  const tokenIndexSnapshot = path.join(tmpDir, "token-index.json");
  assert.ok(fs.existsSync(tokenIndexSnapshot), "writeUser should persist token index snapshot");

  // Simulate an in-memory token index miss after process restart.
  tokenIndex.clear();

  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = () => {
    throw new Error("unexpected full directory scan during token lookup");
  };
  try {
    const tokenHit = recordRuntime.findUserByToken("tok-1");
    assert.ok(tokenHit, "token lookup should resolve via token-index snapshot");
    assert.strictEqual(tokenHit.chatId, "chat-1");
    assert.strictEqual(recordRuntime.findUserByToken("missing-token"), null);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
