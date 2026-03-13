#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { backupTimestamp, parseArgs } = require("./migrate-store-file-to-sqlite");
const { runDualReadCompare } = require("./store-dual-read-compare");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(ROOT, "data");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts", "releases");

function log(message) {
  process.stdout.write(`[store-canary-guard] ${message}\n`);
}

function readOption(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return String(options[key] || "").trim();
    }
  }
  return "";
}

function parseNonNegativeInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function parseNonNegativeFloat(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function resolvePath(raw, fallback, baseDir = ROOT) {
  const value = String(raw || "").trim();
  if (!value) return path.resolve(fallback);
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(baseDir, value);
}

function resolveCanaryGuardOptions(argv, env = process.env, baseDir = ROOT) {
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
    maxMissingInSqlite: parseNonNegativeInt(readOption(options, "max-missing-in-sqlite", "max_missing_in_sqlite"), 0),
    maxExtraInSqlite: parseNonNegativeInt(readOption(options, "max-extra-in-sqlite", "max_extra_in_sqlite"), 0),
    maxFieldMismatches: parseNonNegativeInt(readOption(options, "max-field-mismatches", "max_field_mismatches"), 0),
    maxMismatchRatePercent: parseNonNegativeFloat(
      readOption(options, "max-mismatch-rate-percent", "max_mismatch_rate_percent"),
      0
    ),
    warnOnly: flags.has("warn-only"),
    help: flags.has("help") || flags.has("h"),
  };
}

function writeArtifact(options, payload) {
  const defaultName = `store-canary-guard-${backupTimestamp()}.json`;
  const fileName = options.artifactName || defaultName;
  const artifactPath = path.join(options.artifactDir, fileName);
  fs.mkdirSync(options.artifactDir, { recursive: true });
  if (fs.existsSync(artifactPath)) {
    throw new Error(`artifact already exists: ${artifactPath}`);
  }
  fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
  return artifactPath;
}

function runCanaryGuard(rawOptions) {
  const options = {
    ...rawOptions,
    dataDir: path.resolve(String(rawOptions.dataDir || DEFAULT_DATA_DIR)),
    sqlitePath: path.resolve(String(rawOptions.sqlitePath || path.join(DEFAULT_DATA_DIR, "signalbrief.sqlite"))),
    artifactDir: path.resolve(String(rawOptions.artifactDir || DEFAULT_ARTIFACT_DIR)),
    artifactName: String(rawOptions.artifactName || "").trim(),
    compareArtifactName: String(rawOptions.compareArtifactName || "").trim(),
    maxMissingInSqlite: parseNonNegativeInt(rawOptions.maxMissingInSqlite, 0),
    maxExtraInSqlite: parseNonNegativeInt(rawOptions.maxExtraInSqlite, 0),
    maxFieldMismatches: parseNonNegativeInt(rawOptions.maxFieldMismatches, 0),
    maxMismatchRatePercent: parseNonNegativeFloat(rawOptions.maxMismatchRatePercent, 0),
    warnOnly: rawOptions.warnOnly === true,
  };

  const compareArtifactName = options.compareArtifactName
    || `store-canary-guard-compare-${backupTimestamp()}.json`;
  const compareReport = runDualReadCompare({
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    artifactDir: options.artifactDir,
    artifactName: compareArtifactName,
    allowDiff: true,
    allowExtraSqlite: false,
    strictTokenMatch: false,
  });

  const sourceUsers = Number(compareReport.summary.source_users || 0);
  const mismatchRatePercent = sourceUsers > 0
    ? Number((((Number(compareReport.summary.field_mismatches || 0)) / sourceUsers) * 100).toFixed(4))
    : 0;

  const breaches = [];
  if (Number(compareReport.summary.missing_in_sqlite || 0) > options.maxMissingInSqlite) {
    breaches.push(`missing_in_sqlite>${options.maxMissingInSqlite}`);
  }
  if (Number(compareReport.summary.extra_in_sqlite || 0) > options.maxExtraInSqlite) {
    breaches.push(`extra_in_sqlite>${options.maxExtraInSqlite}`);
  }
  if (Number(compareReport.summary.field_mismatches || 0) > options.maxFieldMismatches) {
    breaches.push(`field_mismatches>${options.maxFieldMismatches}`);
  }
  if (mismatchRatePercent > options.maxMismatchRatePercent) {
    breaches.push(`mismatch_rate_percent>${options.maxMismatchRatePercent}`);
  }

  const rollbackTriggered = breaches.length > 0;
  const report = {
    version: 1,
    guard: "store_canary_thresholds",
    options: {
      data_dir: options.dataDir,
      sqlite_path: options.sqlitePath,
      artifact_dir: options.artifactDir,
      artifact_name: options.artifactName || null,
      compare_artifact_name: compareArtifactName,
      max_missing_in_sqlite: options.maxMissingInSqlite,
      max_extra_in_sqlite: options.maxExtraInSqlite,
      max_field_mismatches: options.maxFieldMismatches,
      max_mismatch_rate_percent: options.maxMismatchRatePercent,
      warn_only: options.warnOnly,
    },
    compare: {
      artifact_path: compareReport.artifact_path,
      summary: compareReport.summary,
      mismatch_rate_percent: mismatchRatePercent,
    },
    breaches,
    rollback_triggered: rollbackTriggered,
    pass: options.warnOnly ? true : !rollbackTriggered,
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
      "Usage: node scripts/store-canary-guard.js [options]",
      "",
      "Purpose:",
      "  Evaluate file-vs-sqlite parity against rollback trigger thresholds.",
      "  Exits non-zero when thresholds are breached (unless --warn-only).",
      "",
      "Options:",
      "  --data-dir <dir>                 File-store directory (default: ./data)",
      "  --sqlite-path <file>             SQLite file path (default: <data-dir>/signalbrief.sqlite)",
      "  --artifact-dir <dir>             Guard artifact directory (default: ./artifacts/releases)",
      "  --artifact-name <file.json>      Explicit guard artifact name",
      "  --compare-artifact-name <file>   Explicit dual-read compare artifact name",
      "  --max-missing-in-sqlite <n>      Threshold (default: 0)",
      "  --max-extra-in-sqlite <n>        Threshold (default: 0)",
      "  --max-field-mismatches <n>       Threshold (default: 0)",
      "  --max-mismatch-rate-percent <n>  Threshold (default: 0)",
      "  --warn-only                      Never fail process exit code on breach",
      "  --help                           Show help",
    ].join("\n")
  );
}

function main() {
  const options = resolveCanaryGuardOptions(process.argv.slice(2), process.env, ROOT);
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const report = runCanaryGuard(options);
    log(
      `summary: missing=${report.compare.summary.missing_in_sqlite} `
      + `extra=${report.compare.summary.extra_in_sqlite} `
      + `mismatches=${report.compare.summary.field_mismatches} `
      + `mismatch_rate_percent=${report.compare.mismatch_rate_percent} `
      + `rollback_triggered=${report.rollback_triggered} pass=${report.pass}`
    );
    if (report.breaches.length) {
      for (const breach of report.breaches) {
        log(`breach: ${breach}`);
      }
    }
    log(`artifact=${report.artifact_path}`);
    if (!report.pass) process.exit(1);
  } catch (error) {
    process.stderr.write(`[store-canary-guard] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveCanaryGuardOptions,
  runCanaryGuard,
};
