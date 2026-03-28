"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/config-provider.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  CONFIG_PATH,
  CONFIG_EXAMPLE_PATH,
  resolveConfigPath,
  loadConfig,
} = runtime;

assert.strictEqual(typeof CONFIG_PATH, "string", "config provider should expose CONFIG_PATH");
assert.strictEqual(typeof CONFIG_EXAMPLE_PATH, "string", "config provider should expose CONFIG_EXAMPLE_PATH");
assert.strictEqual(typeof resolveConfigPath, "function", "config provider should expose resolveConfigPath");
assert.strictEqual(typeof loadConfig, "function", "config provider should expose loadConfig");

const envKeys = [
  "SIGNALBRIEF_CONFIG_PATH",
  "SIGNALBRIEF_PERPLEXITY_API_KEY",
  "SIGNALBRIEF_ADMIN_EMAIL",
];
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-config-provider-test-"));
const tempConfigPath = path.join(tempDir, "config.test.json");

const testConfig = {
  user: {
    email: "user@example.com",
    deliveryTime: "07:00",
    timezone: "America/New_York",
  },
  digest: {
    itemCount: 7,
    maxItemsPerTag: 2,
    lookbackHours: 48,
  },
  topics: [
    {
      tag: "AI×TECH",
      queries: ["ai strategy updates 2026"],
    },
    {
      tag: "CONSUMER",
      queries: ["retail and consumer pricing"],
    },
    {
      tag: "HEALTHCARE",
      queries: ["hospital strategy"],
    },
  ],
  admin: {
    email: "config-admin@example.com",
    salt: "config-salt",
    passwordHash: "config-hash",
  },
  keys: {
    perplexity: "config-perplexity",
    anthropic: "config-anthropic",
    resendApiKey: "",
    fromEmail: "digest@example.com",
    fromName: "SignalBrief",
  },
};
fs.writeFileSync(tempConfigPath, JSON.stringify(testConfig, null, 2));

try {
  process.env.SIGNALBRIEF_CONFIG_PATH = tempConfigPath;
  process.env.SIGNALBRIEF_PERPLEXITY_API_KEY = "env-perplexity-key";
  process.env.SIGNALBRIEF_ADMIN_EMAIL = "env-admin@example.com";

  assert.strictEqual(resolveConfigPath(), tempConfigPath, "config provider should honor SIGNALBRIEF_CONFIG_PATH");

  const envOverridden = loadConfig({ reload: true });
  assert.strictEqual(envOverridden.keys.perplexity, "env-perplexity-key", "env key should override config key");
  assert.strictEqual(envOverridden.admin.email, "env-admin@example.com", "env admin email should override config");
  assert.strictEqual(envOverridden.keys.anthropic, "config-anthropic", "non-overridden keys should remain from config");
  assert.strictEqual(envOverridden.digest.itemCount, 5, "runtime config should normalize the MVP digest size to 5");
  assert.deepStrictEqual(
    envOverridden.topics.map((topic) => topic.tag),
    ["HEALTHCARE", "CONSUMER & RETAIL"],
    "runtime config should strip legacy topics and canonicalize consumer to consumer & retail"
  );

  process.env.SIGNALBRIEF_PERPLEXITY_API_KEY = "";
  process.env.SIGNALBRIEF_ADMIN_EMAIL = "";

  const configOnly = loadConfig({ reload: true });
  assert.strictEqual(configOnly.keys.perplexity, "config-perplexity", "config value should be used when env override is absent");
  assert.strictEqual(configOnly.admin.email, "config-admin@example.com", "config admin email should be used when env override is absent");
  assert.strictEqual(configOnly.digest.itemCount, 5, "legacy config itemCount should be coerced to the MVP fixed count");
  assert.deepStrictEqual(
    configOnly.topics.map((topic) => topic.tag),
    ["HEALTHCARE", "CONSUMER & RETAIL"],
    "config-only load should keep only canonical reduced-scope topics"
  );
} finally {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (typeof value === "undefined") delete process.env[key];
    else process.env[key] = value;
  }
  loadConfig({ reload: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
}
