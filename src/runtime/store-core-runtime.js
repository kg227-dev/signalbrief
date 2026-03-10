/**
 * SignalBrief — store.js
 * Simple JSON-based data store. One file per user keyed by chatId.
 * Upgrade path: swap readUser/writeUser for SQLite when multi-user hits ~20+.
 */
// @ts-check

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDefaultUser, normalizeUserRecord } = require("./user-contract-runtime");
const { createStoreRecordRuntime } = require("./store-record-runtime");
/** @typedef {import("./runtime-types").UserRecord} UserRecord */

const APP_ROOT = path.resolve(__dirname, "..", "..");

function defaultDataDir() {
  return path.resolve(process.env.SIGNALBRIEF_DATA_DIR || path.join(APP_ROOT, "data"));
}

function createStoreIndex() {
  return new Map();
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

  const recordRuntime = createStoreRecordRuntime({
    currentDataDir,
    currentTokenIndex,
    ensureStoreInitialized,
    defaultUser,
    normalizeUserRecord,
    generateToken,
    warnStoreRecovery,
  });
  const {
    readUser,
    writeUser,
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

function allUsers() {
  return getSingletonStore().allUsers();
}

function findUserByToken(token) {
  return getSingletonStore().findUserByToken(token);
}

module.exports = {
  createStoreIndex,
  createStoreState,
  createStore,
  createStoreRuntime,
  initStore,
  resetStoreState,
  readUser,
  writeUser,
  allUsers,
  defaultUser,
  generateToken,
  findUserByToken,
  get singletonStore() {
    return getSingletonStore();
  },
};
