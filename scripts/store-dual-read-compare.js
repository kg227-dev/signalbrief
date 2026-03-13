#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/runtime/store-core-runtime");
const { normalizeUserRecord } = require("../src/runtime/user-contract-runtime");
const {
  backupTimestamp,
  loadSourceUsers,
  mapUsersByChatId,
  parseArgs,
  readOption: readOptionFromMigrationScript,
} = (() => {
  const runtime = require("./migrate-store-file-to-sqlite");
  return {
    backupTimestamp: runtime.backupTimestamp,
    loadSourceUsers: runtime.loadSourceUsers,
    mapUsersByChatId: runtime.mapUsersByChatId,
    parseArgs: runtime.parseArgs,
    // Reuse option reader behavior via tiny adapter.
    readOption: (options, ...keys) => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(options, key)) {
          return String(options[key] || "").trim();
        }
      }
      return "";
    },
  };
})();

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(ROOT, "data");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts", "releases");

function log(message) {
  process.stdout.write(`[store-dual-read] ${message}\n`);
}

function resolvePath(raw, fallback, baseDir = ROOT) {
  const value = String(raw || "").trim();
  if (!value) return path.resolve(fallback);
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(baseDir, value);
}

function parseIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis)) return "";
  return new Date(millis).toISOString();
}

function resolveNormalizationNowIso(raw) {
  return parseIso(raw?.last_updated) || parseIso(raw?.joined_at) || "1970-01-01T00:00:00.000Z";
}

function normalizeForCompare(rawUser) {
  const chatId = String(rawUser?.chatId || "").trim();
  return normalizeUserRecord(rawUser, {
    chatId,
    nowIso: resolveNormalizationNowIso(rawUser),
  });
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map((entry) => stableClone(entry));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = stableClone(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value));
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function readOption(options, ...keys) {
  return readOptionFromMigrationScript(options, ...keys);
}

function resolveDualReadCompareOptions(argv, env = process.env, baseDir = ROOT) {
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
    allowDiff: flags.has("allow-diff"),
    allowExtraSqlite: flags.has("allow-extra-sqlite"),
    strictTokenMatch: flags.has("strict-token-match"),
    help: flags.has("help") || flags.has("h"),
  };
}

function compareUserRecords(sourceUser, sqliteUser, options = {}) {
  const source = normalizeForCompare(sourceUser);
  const sqlite = normalizeForCompare(sqliteUser);
  let tokenBackfilled = false;
  if (!options.strictTokenMatch && !source.token && sqlite.token) {
    source.token = sqlite.token;
    tokenBackfilled = true;
  }
  const sourceHash = hash(stableStringify(source));
  const sqliteHash = hash(stableStringify(sqlite));
  return {
    ok: sourceHash === sqliteHash,
    token_backfilled: tokenBackfilled,
    source_hash: sourceHash,
    sqlite_hash: sqliteHash,
  };
}

function writeArtifact(options, payload) {
  const defaultName = `store-dual-read-compare-${backupTimestamp()}.json`;
  const fileName = options.artifactName || defaultName;
  const artifactPath = path.join(options.artifactDir, fileName);
  fs.mkdirSync(options.artifactDir, { recursive: true });
  if (fs.existsSync(artifactPath)) {
    throw new Error(`artifact already exists: ${artifactPath}`);
  }
  fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
  return artifactPath;
}

function runDualReadCompare(rawOptions) {
  const startedAt = new Date();
  const options = {
    dataDir: path.resolve(String(rawOptions.dataDir || DEFAULT_DATA_DIR)),
    sqlitePath: path.resolve(String(rawOptions.sqlitePath || path.join(DEFAULT_DATA_DIR, "signalbrief.sqlite"))),
    artifactDir: path.resolve(String(rawOptions.artifactDir || DEFAULT_ARTIFACT_DIR)),
    artifactName: String(rawOptions.artifactName || "").trim(),
    allowDiff: rawOptions.allowDiff === true,
    allowExtraSqlite: rawOptions.allowExtraSqlite === true,
    strictTokenMatch: rawOptions.strictTokenMatch === true,
  };

  if (!fs.existsSync(options.dataDir)) {
    throw new Error(`data dir missing: ${options.dataDir}`);
  }
  if (!fs.existsSync(options.sqlitePath)) {
    throw new Error(`sqlite file missing: ${options.sqlitePath}`);
  }

  const source = loadSourceUsers(options.dataDir);
  const sourceMap = mapUsersByChatId(source.users, "file-store users");

  const sqliteWarnings = [];
  const sqliteStore = createStore({
    backend: "sqlite",
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    warningThrottleMs: 0,
    onWarning: (message) => sqliteWarnings.push(String(message || "")),
  });
  sqliteStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });
  const sqliteMap = mapUsersByChatId(sqliteStore.allUsers(), "sqlite users");

  const missingInSqlite = [];
  const mismatches = [];
  let tokenBackfillComparisons = 0;

  for (const chatId of Array.from(sourceMap.keys()).sort((a, b) => a.localeCompare(b))) {
    const sourceUser = sourceMap.get(chatId);
    const sqliteUser = sqliteMap.get(chatId);
    if (!sqliteUser) {
      missingInSqlite.push(chatId);
      continue;
    }
    const result = compareUserRecords(sourceUser, sqliteUser, {
      strictTokenMatch: options.strictTokenMatch,
    });
    if (result.token_backfilled) tokenBackfillComparisons += 1;
    if (!result.ok) {
      mismatches.push({
        chatId,
        source_hash: result.source_hash,
        sqlite_hash: result.sqlite_hash,
      });
    }
  }

  const extraInSqlite = Array.from(sqliteMap.keys())
    .filter((chatId) => !sourceMap.has(chatId))
    .sort((a, b) => a.localeCompare(b));

  const diffDetected = (
    missingInSqlite.length > 0
    || mismatches.length > 0
    || (!options.allowExtraSqlite && extraInSqlite.length > 0)
  );
  const pass = options.allowDiff ? true : !diffDetected;

  const report = {
    version: 1,
    comparison: "file_vs_sqlite",
    host: os.hostname(),
    started_at_utc: startedAt.toISOString(),
    finished_at_utc: new Date().toISOString(),
    options: {
      data_dir: options.dataDir,
      sqlite_path: options.sqlitePath,
      artifact_dir: options.artifactDir,
      artifact_name: options.artifactName || null,
      allow_diff: options.allowDiff,
      allow_extra_sqlite: options.allowExtraSqlite,
      strict_token_match: options.strictTokenMatch,
    },
    summary: {
      source_users: sourceMap.size,
      sqlite_users: sqliteMap.size,
      missing_in_sqlite: missingInSqlite.length,
      extra_in_sqlite: extraInSqlite.length,
      field_mismatches: mismatches.length,
      token_backfill_comparisons: tokenBackfillComparisons,
      diff_detected: diffDetected,
      pass,
    },
    diffs: {
      missing_in_sqlite: missingInSqlite,
      extra_in_sqlite: extraInSqlite,
      mismatches,
    },
    warnings: sqliteWarnings.filter(Boolean),
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
      "Usage: node scripts/store-dual-read-compare.js [options]",
      "",
      "Purpose:",
      "  Compare file-store user records and SQLite user records for parity.",
      "  Writes a compare report artifact JSON.",
      "",
      "Options:",
      "  --data-dir <dir>               Source file-store directory (default: ./data)",
      "  --sqlite-path <file>           SQLite file path (default: <data-dir>/signalbrief.sqlite)",
      "  --artifact-dir <dir>           Report artifact directory (default: ./artifacts/releases)",
      "  --artifact-name <file.json>    Explicit report artifact name",
      "  --allow-extra-sqlite           Do not fail when sqlite has users not present in file-store",
      "  --strict-token-match           Do not auto-bridge file missing token to sqlite token",
      "  --allow-diff                   Emit report but do not fail on detected diffs",
      "  --help                         Show help",
    ].join("\n")
  );
}

function main() {
  const options = resolveDualReadCompareOptions(process.argv.slice(2), process.env, ROOT);
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const report = runDualReadCompare(options);
    log(
      `summary: source=${report.summary.source_users} sqlite=${report.summary.sqlite_users} `
      + `missing=${report.summary.missing_in_sqlite} extra=${report.summary.extra_in_sqlite} `
      + `mismatches=${report.summary.field_mismatches} pass=${report.summary.pass}`
    );
    if (report.warnings.length) {
      for (const warning of report.warnings) {
        log(`warn: ${warning}`);
      }
    }
    log(`artifact=${report.artifact_path}`);
    if (!report.summary.pass) process.exit(1);
  } catch (error) {
    process.stderr.write(`[store-dual-read] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  compareUserRecords,
  normalizeForCompare,
  resolveDualReadCompareOptions,
  runDualReadCompare,
  stableStringify,
};
