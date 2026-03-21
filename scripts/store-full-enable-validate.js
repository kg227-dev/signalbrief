#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createStore } = require("../src/runtime/store-core-runtime");
const { runDualReadCompare } = require("./store-dual-read-compare");
const { backupTimestamp, parseArgs } = require("./migrate-store-file-to-sqlite");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(ROOT, "data");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts", "releases");

function log(message) {
  process.stdout.write(`[store-full-enable] ${message}\n`);
}

function readOption(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return String(options[key] || "").trim();
    }
  }
  return "";
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function resolvePath(raw, fallback, baseDir = ROOT) {
  const value = String(raw || "").trim();
  if (!value) return path.resolve(fallback);
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(baseDir, value);
}

function writeArtifact(options, payload) {
  const defaultName = `store-full-enable-validate-${backupTimestamp()}.json`;
  const fileName = options.artifactName || defaultName;
  const artifactPath = path.join(options.artifactDir, fileName);
  fs.mkdirSync(options.artifactDir, { recursive: true });
  if (fs.existsSync(artifactPath)) {
    throw new Error(`artifact already exists: ${artifactPath}`);
  }
  fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
  return artifactPath;
}

function resolveFullEnableValidateOptions(argv, env = process.env, baseDir = ROOT) {
  const { options, flags } = parseArgs(argv);
  const dataDir = resolvePath(
    readOption(options, "data-dir", "data_dir") || String(env.SIGNALBRIEF_DATA_DIR || ""),
    DEFAULT_DATA_DIR,
    baseDir
  );
  const sqlitePath = resolvePath(
    readOption(options, "sqlite-path", "sqlite_path") || String(env.SIGNALBRIEF_SQLITE_PATH || ""),
    path.join(dataDir, "signalbrief.sqlite"),
    baseDir
  );
  const artifactDir = resolvePath(
    readOption(options, "artifact-dir", "artifact_dir") || String(env.SIGNALBRIEF_RELEASE_ARTIFACT_DIR || ""),
    DEFAULT_ARTIFACT_DIR,
    baseDir
  );
  return {
    dataDir,
    sqlitePath,
    artifactDir,
    artifactName: readOption(options, "artifact-name", "artifact_name"),
    compareArtifactName: readOption(options, "compare-artifact-name", "compare_artifact_name"),
    sampleSize: parsePositiveInt(readOption(options, "sample-size", "sample_size"), 5),
    allowEmpty: flags.has("allow-empty"),
    help: flags.has("help") || flags.has("h"),
  };
}

function toChatIdList(users) {
  return users
    .map((user) => String(user?.chatId || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function sliceSamples(users, sampleSize) {
  const withTokens = [];
  const withoutTokens = [];
  for (const user of users) {
    if (String(user?.token || "").trim()) withTokens.push(user);
    else withoutTokens.push(user);
  }
  const samples = withTokens.slice(0, sampleSize);
  if (samples.length < sampleSize) {
    samples.push(...withoutTokens.slice(0, sampleSize - samples.length));
  }
  return samples;
}

function runFullEnableValidate(rawOptions) {
  const options = {
    ...rawOptions,
    dataDir: path.resolve(String(rawOptions.dataDir || DEFAULT_DATA_DIR)),
    sqlitePath: path.resolve(String(rawOptions.sqlitePath || path.join(DEFAULT_DATA_DIR, "signalbrief.sqlite"))),
    artifactDir: path.resolve(String(rawOptions.artifactDir || DEFAULT_ARTIFACT_DIR)),
    artifactName: String(rawOptions.artifactName || "").trim(),
    compareArtifactName: String(rawOptions.compareArtifactName || "").trim(),
    sampleSize: parsePositiveInt(rawOptions.sampleSize, 5),
    allowEmpty: rawOptions.allowEmpty === true,
  };

  const compareArtifactName = options.compareArtifactName
    || `store-full-enable-compare-${backupTimestamp()}.json`;
  const compare = runDualReadCompare({
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    artifactDir: options.artifactDir,
    artifactName: compareArtifactName,
    allowDiff: false,
    allowExtraSqlite: false,
    strictTokenMatch: true,
  });
  if (!compare.summary.pass) {
    throw new Error("dual-read compare failed; cannot approve full enablement");
  }

  const warnings = [];
  const fileStore = createStore({
    backend: "file",
    dataDir: options.dataDir,
    warningThrottleMs: 0,
    onWarning: (message) => warnings.push(String(message || "")),
  });
  const sqliteStore = createStore({
    backend: "sqlite",
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    warningThrottleMs: 0,
    onWarning: (message) => warnings.push(String(message || "")),
  });

  fileStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });
  sqliteStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });

  const fileUsers = fileStore.allUsers();
  const sqliteUsers = sqliteStore.allUsers();
  const fileChatIds = toChatIdList(fileUsers);
  const sqliteChatIds = toChatIdList(sqliteUsers);

  if (!fileChatIds.length && !options.allowEmpty) {
    throw new Error("file-store has zero users; pass --allow-empty only for bootstrap environments");
  }

  const fileSet = new Set(fileChatIds);
  const sqliteSet = new Set(sqliteChatIds);
  const missingInSqlite = fileChatIds.filter((chatId) => !sqliteSet.has(chatId));
  const extraInSqlite = sqliteChatIds.filter((chatId) => !fileSet.has(chatId));
  if (missingInSqlite.length || extraInSqlite.length) {
    throw new Error(
      `user set mismatch after parity compare (missing_in_sqlite=${missingInSqlite.length}, `
      + `extra_in_sqlite=${extraInSqlite.length})`
    );
  }

  const tokenLookupMismatches = [];
  const sampleUsers = sliceSamples(fileUsers, options.sampleSize);
  const canaryStore = createStore({
    backend: "canary",
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    canaryChatIds: fileChatIds,
    canaryMirrorWrites: true,
    warningThrottleMs: 0,
    onWarning: (message) => warnings.push(String(message || "")),
  });
  canaryStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });

  for (const sample of sampleUsers) {
    const chatId = String(sample?.chatId || "").trim();
    const token = String(sample?.token || "").trim();
    if (!chatId || !token) continue;
    const fileHit = fileStore.findUserByToken(token);
    const sqliteHit = sqliteStore.findUserByToken(token);
    const canaryHit = canaryStore.findUserByToken(token);
    const fileChatId = String(fileHit?.chatId || "");
    const sqliteChatId = String(sqliteHit?.chatId || "");
    const canaryChatId = String(canaryHit?.chatId || "");
    if (fileChatId !== chatId || sqliteChatId !== chatId || canaryChatId !== chatId) {
      tokenLookupMismatches.push({
        token_suffix: token.slice(-8),
        expected_chat_id: chatId,
        file_chat_id: fileChatId || null,
        sqlite_chat_id: sqliteChatId || null,
        canary_chat_id: canaryChatId || null,
      });
    }
  }

  const rollbackStore = createStore({
    backend: "file",
    dataDir: options.dataDir,
    warningThrottleMs: 0,
    onWarning: (message) => warnings.push(String(message || "")),
  });
  rollbackStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });
  const rollbackStoreUsers = rollbackStore.allUsers();
  const rollbackSwitchValidated = rollbackStoreUsers.length === fileUsers.length;
  if (!rollbackSwitchValidated) {
    throw new Error(
      `rollback backend validation failed (file_users=${fileUsers.length}, rollback_users=${rollbackStoreUsers.length})`
    );
  }

  const pass = tokenLookupMismatches.length === 0;
  const report = {
    version: 1,
    workflow: "store_full_enable_validate",
    options: {
      data_dir: options.dataDir,
      sqlite_path: options.sqlitePath,
      artifact_dir: options.artifactDir,
      artifact_name: options.artifactName || null,
      compare_artifact_name: compareArtifactName,
      sample_size: options.sampleSize,
      allow_empty: options.allowEmpty,
    },
    compare: {
      pass: compare.summary.pass,
      artifact_path: compare.artifact_path,
      summary: compare.summary,
    },
    checks: {
      file_users: fileUsers.length,
      sqlite_users: sqliteUsers.length,
      sampled_users: sampleUsers.length,
      rollback_switch_validated: rollbackSwitchValidated,
      token_lookup_mismatches: tokenLookupMismatches.length,
    },
    mismatches: {
      token_lookup: tokenLookupMismatches,
    },
    pass,
    export: {
      SIGNALBRIEF_STORE_BACKEND: "sqlite",
      SIGNALBRIEF_SQLITE_PATH: options.sqlitePath,
      SIGNALBRIEF_STORE_ROLLBACK_BACKEND: "file",
    },
    warnings: warnings.filter(Boolean),
  };

  const artifactPath = writeArtifact(options, report);
  return {
    ...report,
    artifact_path: artifactPath,
  };
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/store-full-enable-validate.js [options]",
      "",
      "Purpose:",
      "  Validate sqlite cutover readiness and rollback switch safety.",
      "",
      "Options:",
      "  --data-dir <dir>                 File-store directory (default: ./data)",
      "  --sqlite-path <file>             SQLite file path (default: <data-dir>/signalbrief.sqlite)",
      "  --artifact-dir <dir>             Output artifact dir (default: ./artifacts/releases)",
      "  --artifact-name <file.json>      Explicit artifact file name",
      "  --compare-artifact-name <file>   Explicit strict compare artifact name",
      "  --sample-size <n>                Token lookup sample size (default: 5)",
      "  --allow-empty                    Allow zero-user bootstrap environments",
      "  --help                           Show help",
    ].join("\n")
  );
}

function main() {
  const options = resolveFullEnableValidateOptions(process.argv.slice(2), process.env, ROOT);
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const report = runFullEnableValidate(options);
    log(
      `summary: pass=${report.pass} file_users=${report.checks.file_users} `
      + `sqlite_users=${report.checks.sqlite_users} sampled=${report.checks.sampled_users} `
      + `rollback_switch_validated=${report.checks.rollback_switch_validated}`
    );
    log(`export SIGNALBRIEF_STORE_BACKEND=${report.export.SIGNALBRIEF_STORE_BACKEND}`);
    log(`export SIGNALBRIEF_SQLITE_PATH=${report.export.SIGNALBRIEF_SQLITE_PATH}`);
    log(`export SIGNALBRIEF_STORE_ROLLBACK_BACKEND=${report.export.SIGNALBRIEF_STORE_ROLLBACK_BACKEND}`);
    log(`artifact=${report.artifact_path}`);
    if (!report.pass) process.exit(1);
  } catch (error) {
    process.stderr.write(`[store-full-enable] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveFullEnableValidateOptions,
  runFullEnableValidate,
};
