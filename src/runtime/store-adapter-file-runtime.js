"use strict";

const { createStoreRecordRuntime } = require("./store-record-runtime");
const { assertStoreAdapterContract } = require("./store-adapter-contract-runtime");

function createFileStoreAdapter(deps) {
  const adapter = createStoreRecordRuntime(deps);
  return assertStoreAdapterContract(adapter, { label: "file store adapter" });
}

module.exports = {
  createFileStoreAdapter,
};
