/**
 * SignalBrief — store.js
 * User store runtime with adapter boundary.
 * Default backend is SQLite in production; file-store remains available by explicit override.
 */
// @ts-check

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDefaultUser, normalizeUserRecord } = require("./user-contract-runtime");
const { createFileStoreAdapter } = require("./store-adapter-file-runtime");
const { assertStoreAdapterContract } = require("./store-adapter-contract-runtime");
const {
  defaultDataDir,
  resolveSignalBriefRuntimePaths,
} = require("./runtime-state-paths-runtime");
/** @typedef {import("./runtime-types").UserRecord} UserRecord */

function createStoreIndex() {
  return new Map();
}

function normalizeStoreBackend(value) {
  const normalized = String(value || "").toLowerCase().trim();
  if (normalized === "sqlite") return "sqlite";
  if (normalized === "canary") return "canary";
  return "file";
}

function resolveStoreBackend(options = {}) {
  if (typeof options.backend === "string" && options.backend.trim()) {
    return normalizeStoreBackend(options.backend);
  }
  const envOverride = String(process.env.SIGNALBRIEF_STORE_BACKEND || "").trim();
  if (envOverride) return normalizeStoreBackend(envOverride);

  const nodeEnv = String(
    (typeof options.nodeEnv === "string" && options.nodeEnv)
      ? options.nodeEnv
      : (process.env.NODE_ENV || "")
  ).toLowerCase().trim();
  if (nodeEnv === "production") return "sqlite";
  return "file";
}

function createSqliteStoreAdapter(deps, options = {}) {
  const { createSqliteStoreAdapter: createSqliteAdapterRuntime } = require("./store-adapter-sqlite-runtime");
  return createSqliteAdapterRuntime(deps, options);
}

function parseCanaryChatIds(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }
  return String(raw || "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveCanaryChatIds(options = {}) {
  if (Array.isArray(options.canaryChatIds)) {
    return parseCanaryChatIds(options.canaryChatIds);
  }
  if (typeof options.canaryChatIds === "string" && options.canaryChatIds.trim()) {
    return parseCanaryChatIds(options.canaryChatIds);
  }
  return parseCanaryChatIds(process.env.SIGNALBRIEF_STORE_CANARY_CHAT_IDS);
}

function resolveCanaryMirrorWrites(options = {}) {
  if (typeof options.canaryMirrorWrites === "boolean") return options.canaryMirrorWrites;
  const envRaw = String(process.env.SIGNALBRIEF_STORE_CANARY_MIRROR_WRITES || "").trim().toLowerCase();
  if (envRaw === "0" || envRaw === "false" || envRaw === "no") return false;
  return true;
}

function createStoreState(opts = {}) {
  return {
    dataDir: opts.dataDir ? path.resolve(String(opts.dataDir)) : defaultDataDir(),
    initialized: false,
    tokenIndex: createStoreIndex(),
  };
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * @param {string} chatId
 * @returns {UserRecord}
 */
function defaultUser(chatId) {
  return createDefaultUser(chatId);
}

function createStore(options = {}) {
  const onWarning = typeof options.onWarning === "function"
    ? options.onWarning
    : (message) => console.warn(message);
  const warningThrottleMs = Math.max(0, Number(options.warningThrottleMs || 60_000));
  const warningState = new Map();
  const backend = resolveStoreBackend(options);
  const resolveSqlitePath = () => resolveSignalBriefRuntimePaths({
    env: process.env,
    dataDir: currentDataDir(),
    sqlitePath: options.sqlitePath || process.env.SIGNALBRIEF_SQLITE_PATH || "",
  }).sqlitePath;
  if (backend === "canary") {
    return createCanaryStoreRuntime({
      ...options,
      onWarning,
      warningThrottleMs,
    });
  }
  let storeState = createStoreState({ dataDir: options.dataDir });

  function warnStoreRecovery(code, context, detail = "") {
    const key = `${String(code || "unknown")}::${String(context || "unknown")}`;
    const now = Date.now();
    const lastAt = warningState.get(key) || 0;
    if (warningThrottleMs > 0 && now - lastAt < warningThrottleMs) return;
    warningState.set(key, now);
    const suffix = detail ? ` (${detail})` : "";
    onWarning(`[store] recovery fallback [${code}] ${context}${suffix}`);
  }

  function currentDataDir() {
    return storeState.dataDir;
  }

  function currentTokenIndex() {
    return storeState.tokenIndex;
  }

  function initStore(opts = {}) {
    const requestedDir = opts.dataDir
      ? path.resolve(String(opts.dataDir))
      : currentDataDir();
    const shouldRebuild =
      !storeState.initialized
      || requestedDir !== storeState.dataDir
      || opts.rebuildIndex === true;
    storeState.dataDir = requestedDir;
    if (!fs.existsSync(storeState.dataDir)) fs.mkdirSync(storeState.dataDir, { recursive: true });
    storeState.initialized = true;
    if (shouldRebuild) rebuildTokenIndex();
    return { dataDir: storeState.dataDir };
  }

  function resetStoreState(opts = {}) {
    storeState = createStoreState({ dataDir: opts.dataDir });
    if (opts.initialize) initStore({ dataDir: storeState.dataDir, rebuildIndex: true });
    return { dataDir: storeState.dataDir };
  }

  function ensureStoreInitialized() {
    if (!storeState.initialized) initStore();
  }

  const adapterDeps = {
    currentDataDir,
    currentTokenIndex,
    ensureStoreInitialized,
    defaultUser,
    normalizeUserRecord,
    generateToken,
    warnStoreRecovery,
  };
  const adapterFactory = (() => {
    if (typeof options.createStoreAdapter === "function") {
      return options.createStoreAdapter;
    }
    if (backend === "sqlite") {
      return (deps) => createSqliteStoreAdapter(deps, { resolveSqlitePath });
    }

    return createFileStoreAdapter;
  })();
  const recordRuntime = assertStoreAdapterContract(
    adapterFactory(adapterDeps),
    { label: "store adapter" }
  );
  const {
    readUser,
    writeUser,
    deleteUser,
    allUsers,
    rebuildTokenIndex,
    findUserByToken,
  } = recordRuntime;

  function getStateSnapshot() {
    return {
      backend,
      dataDir: currentDataDir(),
      sqlitePath: backend === "sqlite" ? resolveSqlitePath() : null,
      initialized: storeState.initialized,
      tokenCount: currentTokenIndex().size,
    };
  }

  return {
    createStoreIndex,
    createStoreState,
    initStore,
    resetStoreState,
    readUser,
    writeUser,
    deleteUser,
    allUsers,
    defaultUser,
    generateToken,
    findUserByToken,
    getStateSnapshot,
  };
}

function createStoreRuntime(options = {}) {
  return createStore(options);
}

function createCanaryStoreRuntime(options = {}) {
  const childOptionsBase = {
    ...options,
    warningThrottleMs: Math.max(0, Number(options.warningThrottleMs || 60_000)),
    onWarning: typeof options.onWarning === "function" ? options.onWarning : undefined,
  };
  delete childOptionsBase.createStoreAdapter;
  delete childOptionsBase.backend;
  delete childOptionsBase.canaryChatIds;
  delete childOptionsBase.canaryMirrorWrites;

  const fileStore = createStore({
    ...childOptionsBase,
    backend: "file",
  });
  const sqliteStore = createStore({
    ...childOptionsBase,
    backend: "sqlite",
  });

  const mirrorWrites = resolveCanaryMirrorWrites(options);
  let canaryChatIds = new Set(resolveCanaryChatIds(options));

  function normalizeChatId(chatId) {
    return String(chatId || "").trim();
  }

  function isCanaryChatId(chatId) {
    const id = normalizeChatId(chatId);
    if (!id) return false;
    return canaryChatIds.has(id);
  }

  function setCanaryChatIds(values) {
    canaryChatIds = new Set(parseCanaryChatIds(values));
    return getCanaryChatIds();
  }

  function getCanaryChatIds() {
    return Array.from(canaryChatIds.values()).sort((a, b) => a.localeCompare(b));
  }

  function initStore(opts = {}) {
    fileStore.initStore(opts);
    sqliteStore.initStore(opts);
    if (Object.prototype.hasOwnProperty.call(opts, "canaryChatIds")) {
      setCanaryChatIds(opts.canaryChatIds);
    }
    return {
      dataDir: fileStore.getStateSnapshot().dataDir,
      canary_count: canaryChatIds.size,
      mirror_writes: mirrorWrites,
    };
  }

  function resetStoreState(opts = {}) {
    fileStore.resetStoreState(opts);
    sqliteStore.resetStoreState(opts);
    if (Object.prototype.hasOwnProperty.call(opts, "canaryChatIds")) {
      setCanaryChatIds(opts.canaryChatIds);
    }
    return {
      dataDir: fileStore.getStateSnapshot().dataDir,
      canary_count: canaryChatIds.size,
      mirror_writes: mirrorWrites,
    };
  }

  function readUser(chatId) {
    return isCanaryChatId(chatId) ? sqliteStore.readUser(chatId) : fileStore.readUser(chatId);
  }

  function writeUser(chatId, data) {
    if (isCanaryChatId(chatId)) {
      sqliteStore.writeUser(chatId, data);
      if (mirrorWrites) fileStore.writeUser(chatId, data);
      return;
    }
    fileStore.writeUser(chatId, data);
  }

  function deleteUser(chatId) {
    if (isCanaryChatId(chatId)) {
      const sqliteResult = sqliteStore.deleteUser(chatId);
      if (mirrorWrites) fileStore.deleteUser(chatId);
      return sqliteResult;
    }
    return fileStore.deleteUser(chatId);
  }

  function allUsers() {
    const fileUsers = fileStore.allUsers();
    const sqliteUsers = sqliteStore.allUsers();
    const merged = new Map();

    for (const user of fileUsers) {
      const id = normalizeChatId(user?.chatId);
      if (!id) continue;
      if (isCanaryChatId(id) && !mirrorWrites) continue;
      merged.set(id, user);
    }

    for (const user of sqliteUsers) {
      const id = normalizeChatId(user?.chatId);
      if (!id || !isCanaryChatId(id)) continue;
      merged.set(id, user);
    }

    return Array.from(merged.values())
      .sort((a, b) => String(a?.chatId || "").localeCompare(String(b?.chatId || "")));
  }

  function findUserByToken(token) {
    const sqliteHit = sqliteStore.findUserByToken(token);
    if (sqliteHit && isCanaryChatId(sqliteHit.chatId)) return sqliteHit;
    return fileStore.findUserByToken(token);
  }

  function getStateSnapshot() {
    return {
      mode: "canary",
      canary_count: canaryChatIds.size,
      mirror_writes: mirrorWrites,
      file: fileStore.getStateSnapshot(),
      sqlite: sqliteStore.getStateSnapshot(),
    };
  }

  return {
    createStoreIndex,
    createStoreState,
    initStore,
    resetStoreState,
    readUser,
    writeUser,
    deleteUser,
    allUsers,
    defaultUser,
    generateToken,
    findUserByToken,
    getStateSnapshot,
    setCanaryChatIds,
    getCanaryChatIds,
  };
}

let singletonStore = null;

function getSingletonStore() {
  if (!singletonStore) {
    singletonStore = createStoreRuntime();
  }
  return singletonStore;
}

function initStore(opts = {}) {
  return getSingletonStore().initStore(opts);
}

function resetStoreState(opts = {}) {
  return getSingletonStore().resetStoreState(opts);
}

function readUser(chatId) {
  return getSingletonStore().readUser(chatId);
}

function writeUser(chatId, data) {
  return getSingletonStore().writeUser(chatId, data);
}

function deleteUser(chatId) {
  return getSingletonStore().deleteUser(chatId);
}

function allUsers() {
  return getSingletonStore().allUsers();
}

function findUserByToken(token) {
  return getSingletonStore().findUserByToken(token);
}

module.exports = {
  createStoreIndex,
  createStoreState,
  parseCanaryChatIds,
  resolveCanaryChatIds,
  resolveCanaryMirrorWrites,
  normalizeStoreBackend,
  resolveStoreBackend,
  createFileStoreAdapter,
  createSqliteStoreAdapter,
  createStore,
  createStoreRuntime,
  initStore,
  resetStoreState,
  readUser,
  writeUser,
  deleteUser,
  allUsers,
  defaultUser,
  generateToken,
  findUserByToken,
  get singletonStore() {
    return getSingletonStore();
  },
};
