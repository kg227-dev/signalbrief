"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/config-schema-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { validateConfigSchema } = runtime;
assert.strictEqual(typeof validateConfigSchema, "function");

const validConfig = {
  user: {
    email: "user@example.com",
    deliveryTime: "07:00",
    timezone: "America/New_York",
  },
  digest: {
    itemCount: 5,
    maxItemsPerTag: 2,
    maxItemsPerSourceDomain: 2,
    lookbackHours: 48,
  },
  topics: [
    { tag: "TECHNOLOGY", queries: ["enterprise software last 48 hours"] },
  ],
  admin: {
    email: "admin@example.com",
    salt: "salt",
    passwordHash: "hash",
  },
  keys: {
    resendApiKey: "",
    fromEmail: "digest@getsignalbrief.com",
    fromName: "SignalBrief",
  },
};

{
  const result = validateConfigSchema(validConfig);
  assert.strictEqual(result.ok, true, `expected valid config, got: ${result.errors?.join("; ")}`);
}

{
  const result = validateConfigSchema({
    ...validConfig,
    digest: {
      ...validConfig.digest,
      itemCount: 7,
    },
  });
  assert.strictEqual(result.ok, false, "itemCount other than 5 must be rejected");
  assert.ok(result.errors.some((error) => error.includes("digest.itemCount")), "schema error should point at digest.itemCount");
}
