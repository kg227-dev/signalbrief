"use strict";
// @ts-check
/** @typedef {import("../runtime-types").ReplyState} ReplyState */

/**
 * @returns {ReplyState}
 */
function createReplyState() {
  return {
    awaitingEmail: new Map(),
    digestCooldown: new Map(),
    digestInflight: new Set(),
    pendingLinkVerifications: new Map(),
  };
}

/**
 * @param {{ store: { initStore: (opts?: Object) => unknown }, storeInitOptions?: Object }} options
 */
function createReplySessionController(options = {}) {
  const store = options.store && typeof options.store === "object" ? options.store : null;
  if (!store || typeof store.initStore !== "function") {
    throw new TypeError("createReplySessionController requires a store with initStore()");
  }

  const storeInitOptions = options.storeInitOptions && typeof options.storeInitOptions === "object"
    ? options.storeInitOptions
    : {};

  let replyState = createReplyState();
  let storeReady = false;

  function ensureStoreReady() {
    if (storeReady) return;
    store.initStore(storeInitOptions);
    storeReady = true;
  }

  function getState() {
    return replyState;
  }

  function resetReplyState() {
    replyState = createReplyState();
    return replyState;
  }

  function resetRuntimeState() {
    replyState = createReplyState();
    storeReady = false;
    return replyState;
  }

  function isStoreReady() {
    return storeReady;
  }

  return {
    ensureStoreReady,
    getState,
    resetReplyState,
    resetRuntimeState,
    isStoreReady,
  };
}

module.exports = {
  createReplyState,
  createReplySessionController,
};
