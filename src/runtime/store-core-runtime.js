/**
 * SignalBrief — store.js
 * User store runtime with adapter boundary.
 * Default backend remains JSON file-store; SQLite backend is opt-in.
 */
// @ts-check

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDefaultUser, normalizeUserRecord } = require("./user-contract-runtime");
const { createFileStoreAdapter } = require("./store-adapter-file-runtime");
const { assertStoreAdapterContract } = require("./store-adapter-contract-runtime");
/** @typedef {import("./runtime-types").UserRecord} UserRecord */

const APP_ROOT = path.resolve(__dirname, "..", "..");

function defaultDataDir() {
  const explicit = String(process.env.SIGNALBRIEF_DATA_DIR || "").trim();
  if (explicit) return path.resolve(explicit);
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase().trim();
  if (nodeEnv === "test") {
    return path.resolve(path.join(APP_ROOT, ".tmp", "test-data"));
  }
  return path.resolve(path.join(APP_ROOT, "data"));
}

function createStoreIndex() {
  return new Map();
}

function normalizeStoreBackend(value) {
  const normalized = String(value || "").toLowerCase().trim();
  if (normalized === "sqlite") return "sqlite";
  return "file";
}

function resolveStoreBackend(options = {}) {
  if (typeof options.backend === "string" && options.backend.trim()) {
    return normalizeStoreBackend(options.backend);
  }
  return normalizeStoreBackend(process.env.SIGNALBRIEF_STORE_BACKEND);
}

function createSqliteStoreAdapter(deps, options = {}) {
  const { createSqliteStoreAdapter: createSqliteAdapterRuntime } = require("./store-adapter-sqlite-runtime");
  return createSqliteAdapterRuntime(deps, options);
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

    const backend = resolveStoreBackend(options);
    if (backend === "sqlite") {
      const explicitSqlitePath = String(options.sqlitePath || process.env.SIGNALBRIEF_SQLITE_PATH || "").trim();
      const resolveSqlitePath = () => (
        explicitSqlitePath
          ? path.resolve(explicitSqlitePath)
          : path.join(currentDataDir(), "signalbrief.sqlite")
      );
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
      dataDir: currentDataDir(),
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
