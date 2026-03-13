#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  resolveDualReadCompareOptions,
  runDualReadCompare,
} = require("./store-dual-read-compare");

const ROOT = path.resolve(__dirname, "..");

function log(message) {
  process.stdout.write(`[store-rollback-verify] ${message}\n`);
}

function resolveRollbackVerifyOptions(argv, env = process.env, baseDir = ROOT) {
  const options = resolveDualReadCompareOptions(argv, env, baseDir);
  return {
    ...options,
    allowDiff: false,
    allowExtraSqlite: false,
    strictTokenMatch: true,
  };
}

function runRollbackVerify(options) {
  return runDualReadCompare({
    ...options,
    allowDiff: false,
    allowExtraSqlite: false,
    strictTokenMatch: true,
  });
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/store-rollback-verify.js [options]",
      "",
      "Purpose:",
      "  Verify rollback safety by enforcing strict file vs sqlite parity.",
      "",
      "Options:",
      "  --data-dir <dir>               File-store directory (default: ./data)",
      "  --sqlite-path <file>           SQLite file path (default: <data-dir>/signalbrief.sqlite)",
      "  --artifact-dir <dir>           Report artifact directory (default: ./artifacts/releases)",
      "  --artifact-name <file.json>    Explicit report artifact name",
      "  --help                         Show help",
    ].join("\n")
  );
}

function main() {
  const options = resolveRollbackVerifyOptions(process.argv.slice(2), process.env, ROOT);
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const report = runRollbackVerify(options);
    log(
      `summary: source=${report.summary.source_users} sqlite=${report.summary.sqlite_users} `
      + `missing=${report.summary.missing_in_sqlite} extra=${report.summary.extra_in_sqlite} `
      + `mismatches=${report.summary.field_mismatches} pass=${report.summary.pass}`
    );
    log(`artifact=${report.artifact_path}`);
    if (!report.summary.pass) process.exit(1);
  } catch (error) {
    process.stderr.write(`[store-rollback-verify] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveRollbackVerifyOptions,
  runRollbackVerify,
};
