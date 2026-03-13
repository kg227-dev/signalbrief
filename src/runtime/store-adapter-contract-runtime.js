"use strict";

const STORE_ADAPTER_METHODS = Object.freeze([
  "readUser",
  "writeUser",
  "deleteUser",
  "allUsers",
  "rebuildTokenIndex",
  "findUserByToken",
]);

function assertStoreAdapterContract(adapter, options = {}) {
  const label = String(options.label || "store adapter");
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError(`${label} must be an object`);
  }

  for (const methodName of STORE_ADAPTER_METHODS) {
    if (typeof adapter[methodName] !== "function") {
      throw new TypeError(`${label} missing required method: ${methodName}`);
    }
  }

  return adapter;
}

module.exports = {
  STORE_ADAPTER_METHODS,
  assertStoreAdapterContract,
};
