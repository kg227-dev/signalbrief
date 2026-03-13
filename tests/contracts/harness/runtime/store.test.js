"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/store.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (source.includes("const singletonStore = createStore()")) {
  throw new Error("store should avoid eager singleton initialization at import time");
}
const store = require(TARGET_PATH);
assertModuleExports(() => store, TARGET_REL);

const {
  createStore,
  createFileStoreAdapter,
  createSqliteStoreAdapter,
  createStoreRuntime,
  parseCanaryChatIds,
  resolveCanaryChatIds,
  resolveCanaryMirrorWrites,
  normalizeStoreBackend,
  resolveStoreBackend,
  initStore,
  resetStoreState,
  readUser,
  writeUser,
  allUsers,
  findUserByToken,
  generateToken,
} = store;
assert.strictEqual(typeof createStoreRuntime, "function", "store should export explicit runtime factory");
assert.strictEqual(typeof createFileStoreAdapter, "function", "store should expose default file adapter factory");
assert.strictEqual(typeof createSqliteStoreAdapter, "function", "store should expose sqlite adapter factory");
assert.strictEqual(typeof parseCanaryChatIds, "function", "store should expose canary chat-id parser");
assert.strictEqual(typeof resolveCanaryChatIds, "function", "store should expose canary chat-id resolver");
assert.strictEqual(typeof resolveCanaryMirrorWrites, "function", "store should expose canary mirror-write resolver");
assert.strictEqual(normalizeStoreBackend("sqlite"), "sqlite");
assert.strictEqual(normalizeStoreBackend("canary"), "canary");
assert.strictEqual(normalizeStoreBackend("unexpected"), "file");
assert.strictEqual(resolveStoreBackend({ backend: "sqlite" }), "sqlite");
assert.strictEqual(resolveStoreBackend({ backend: "canary" }), "canary");
assert.strictEqual(resolveStoreBackend({ nodeEnv: "production" }), "sqlite");
assert.strictEqual(resolveStoreBackend({ nodeEnv: "development" }), "file");
const originalStoreBackendEnv = process.env.SIGNALBRIEF_STORE_BACKEND;
try {
  process.env.SIGNALBRIEF_STORE_BACKEND = "canary";
  assert.strictEqual(resolveStoreBackend({ nodeEnv: "production" }), "canary");
} finally {
  if (originalStoreBackendEnv == null) {
    delete process.env.SIGNALBRIEF_STORE_BACKEND;
  } else {
    process.env.SIGNALBRIEF_STORE_BACKEND = originalStoreBackendEnv;
  }
}
assert.deepStrictEqual(parseCanaryChatIds("a,b c"), ["a", "b", "c"]);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-test-"));
const tempDirIsolated = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-test-iso-"));
const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-sqlite-test-"));
const canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-canary-test-"));
try {
  resetStoreState({ dataDir: tempDir });
  initStore({ dataDir: tempDir, rebuildIndex: true });

  const defaultUser = readUser("chat-a");
  assert.strictEqual(defaultUser.chatId, "chat-a");
  assert.strictEqual(defaultUser.status, "active");
  assert.strictEqual(defaultUser.preferences.delivery_time, "07:00");

  const token = generateToken();
  writeUser("chat-a", {
    ...defaultUser,
    email: "a@example.com",
    token,
    status: "paused",
  });
  const persisted = readUser("chat-a");
  assert.strictEqual(persisted.email, "a@example.com");
  assert.strictEqual(persisted.status, "paused");
  assert.strictEqual(persisted.token, token);

  const users = allUsers();
  assert.strictEqual(users.length, 1);
  assert.strictEqual(users[0].chatId, "chat-a");

  const byToken = findUserByToken(token);
  assert.ok(byToken, "findUserByToken should resolve indexed token");
  assert.strictEqual(byToken.chatId, "chat-a");

  const legacyPath = path.join(tempDir, "user-legacy.json");
  fs.writeFileSync(legacyPath, JSON.stringify({ chatId: "legacy", email: "legacy@example.com" }, null, 2));

  initStore({ dataDir: tempDir, rebuildIndex: true });
  const legacyRaw = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  assert.ok(typeof legacyRaw.token === "string" && legacyRaw.token.length === 64, "legacy user token should be backfilled");
  const legacyByToken = findUserByToken(legacyRaw.token);
  assert.ok(legacyByToken, "backfilled token should be indexed");
  assert.strictEqual(legacyByToken.chatId, "legacy");

  const isolatedA = createStore({ dataDir: tempDir });
  const isolatedB = createStore({ dataDir: tempDirIsolated });
  isolatedA.initStore({ rebuildIndex: true });
  isolatedB.initStore({ rebuildIndex: true });
  isolatedA.writeUser("chat-isolated", {
    ...isolatedA.readUser("chat-isolated"),
    email: "iso@example.com",
    token: generateToken(),
  });
  assert.strictEqual(isolatedA.allUsers().length, 3, "isolatedA should observe users in its configured data dir");
  assert.strictEqual(isolatedB.allUsers().length, 0, "isolatedB should not share singleton/global store index");

  const warnings = [];
  const warnedStore = createStore({
    dataDir: tempDir,
    warningThrottleMs: 0,
    onWarning: (message) => warnings.push(String(message || "")),
  });
  warnedStore.initStore({ rebuildIndex: true });
  fs.writeFileSync(path.join(tempDir, "user-corrupt.json"), "{bad-json");
  const recovered = warnedStore.readUser("corrupt");
  assert.strictEqual(recovered.chatId, "corrupt", "corrupt read should still return default user shape");
  assert.ok(
    warnings.some((message) => message.includes("[parse_failed]") || message.includes("parse_failed")),
    "corrupt user file should emit parse-failure recovery warning"
  );

  const adapterReads = [];
  const injectedAdapterStore = createStore({
    dataDir: tempDir,
    createStoreAdapter: ({ defaultUser }) => ({
      readUser(chatId) {
        adapterReads.push(String(chatId));
        return defaultUser(chatId);
      },
      writeUser() {},
      deleteUser() { return { ok: true, existed: false }; },
      allUsers() { return []; },
      rebuildTokenIndex() {},
      findUserByToken() { return null; },
    }),
  });
  injectedAdapterStore.initStore({ rebuildIndex: true });
  const adapterUser = injectedAdapterStore.readUser("adapter-chat");
  assert.strictEqual(adapterUser.chatId, "adapter-chat");
  assert.deepStrictEqual(adapterReads, ["adapter-chat"], "injected adapter should own readUser behavior");

  assert.throws(
    () => createStore({
      createStoreAdapter: () => ({ readUser() {} }),
    }),
    /store adapter missing required method/,
    "invalid adapters should fail fast at store construction"
  );

  const sqliteStore = createStore({
    backend: "sqlite",
    dataDir: sqliteDir,
    sqlitePath: path.join(sqliteDir, "signalbrief.sqlite"),
  });
  sqliteStore.initStore({ rebuildIndex: true });
  const sqliteDefault = sqliteStore.readUser("sqlite-chat");
  const sqliteToken = generateToken();
  sqliteStore.writeUser("sqlite-chat", {
    ...sqliteDefault,
    email: "sqlite-chat@example.com",
    token: sqliteToken,
  });
  const sqlitePersisted = sqliteStore.readUser("sqlite-chat");
  assert.strictEqual(sqlitePersisted.email, "sqlite-chat@example.com");
  assert.strictEqual(sqlitePersisted.token, sqliteToken);
  const sqliteLookup = sqliteStore.findUserByToken(sqliteToken);
  assert.ok(sqliteLookup, "sqlite backend should resolve token index");
  assert.strictEqual(sqliteLookup.chatId, "sqlite-chat");

  const canaryStore = createStore({
    backend: "canary",
    dataDir: canaryDir,
    sqlitePath: path.join(canaryDir, "signalbrief.sqlite"),
    canaryChatIds: ["canary-chat"],
    canaryMirrorWrites: true,
  });
  canaryStore.initStore({ rebuildIndex: true });
  const canaryToken = generateToken();
  canaryStore.writeUser("canary-chat", {
    ...canaryStore.readUser("canary-chat"),
    email: "canary@example.com",
    token: canaryToken,
  });
  canaryStore.writeUser("file-chat", {
    ...canaryStore.readUser("file-chat"),
    email: "file@example.com",
    token: generateToken(),
  });
  const canaryRead = canaryStore.readUser("canary-chat");
  assert.strictEqual(canaryRead.email, "canary@example.com");
  const canaryByToken = canaryStore.findUserByToken(canaryToken);
  assert.ok(canaryByToken, "canary backend should resolve token for canary cohort");
  assert.strictEqual(canaryByToken.chatId, "canary-chat");
  assert.strictEqual(canaryStore.allUsers().length, 2, "canary backend should merge file/sqlite user views");
  assert.deepStrictEqual(canaryStore.getCanaryChatIds(), ["canary-chat"]);
} finally {
  resetStoreState();
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(tempDirIsolated, { recursive: true, force: true });
  fs.rmSync(sqliteDir, { recursive: true, force: true });
  fs.rmSync(canaryDir, { recursive: true, force: true });
}
