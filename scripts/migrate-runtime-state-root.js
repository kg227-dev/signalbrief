#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  resolveSignalBriefRuntimePaths,
} = require("../src/runtime/runtime-state-paths-runtime");

const ROOT = path.resolve(__dirname, "..");
const EPHEMERAL_FILE_NAMES = new Set([
  "digest-run.lock",
  "scheduler-heartbeat.json",
  "scheduler-control.json",
]);

function readOption(argv, name, fallback = "") {
  const flag = `--${name}`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      return String(argv[index + 1]).trim();
    }
    if (String(argv[index] || "").startsWith(`${flag}=`)) {
      return String(argv[index]).slice(flag.length + 1).trim();
    }
  }
  return String(fallback || "").trim();
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function resolveOptions(argv) {
  const dryRun = hasFlag(argv, "dry-run");
  const overwrite = hasFlag(argv, "overwrite");
  const verifyOnly = hasFlag(argv, "verify-only");
  const includeEphemeral = hasFlag(argv, "include-ephemeral");
  const runtimePaths = resolveSignalBriefRuntimePaths({
    appRoot: ROOT,
    env: process.env,
    dataDir: readOption(argv, "data-dir", ""),
    archiveDir: readOption(argv, "archive-dir", ""),
    sqlitePath: readOption(argv, "sqlite-path", ""),
  });

  return {
    dryRun,
    overwrite,
    verifyOnly,
    includeEphemeral,
    runtimePaths,
  };
}

function shouldSkipFile(relativePath, includeEphemeral) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const baseName = path.basename(normalized);
  if (baseName.endsWith(".tmp")) return true;
  if (!includeEphemeral && EPHEMERAL_FILE_NAMES.has(baseName)) return true;
  return false;
}

function walkFiles(rootDir, options = {}) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, options).map((child) => path.join(entry.name, child)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipFile(relativePath, options.includeEphemeral)) continue;
    files.push(entry.name);
  }
  return files;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function inventoryCopyPlan(sourceRoot, targetRoot, options = {}) {
  const sourceFiles = walkFiles(sourceRoot, { includeEphemeral: options.includeEphemeral });
  const planned = [];

  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(targetRoot, relativePath);
    const targetExists = fs.existsSync(targetPath);
    let action = "copy";
    let sourceHash = null;
    let targetHash = null;

    if (targetExists) {
      sourceHash = sha256File(sourcePath);
      targetHash = sha256File(targetPath);
      if (sourceHash === targetHash) {
        action = "skip_identical";
      } else if (options.overwrite) {
        action = "overwrite";
      } else {
        action = "conflict";
      }
    }

    planned.push({
      relative_path: relativePath,
      source_path: sourcePath,
      target_path: targetPath,
      action,
      source_hash: sourceHash,
      target_hash: targetHash,
    });
  }

  return planned.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

function copyFileVerified(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  const sourceHash = sha256File(sourcePath);
  const targetHash = sha256File(targetPath);
  if (sourceHash !== targetHash) {
    throw new Error(`checksum mismatch after copy for ${targetPath}`);
  }
  return sourceHash;
}

function executePlan(entries, options = {}) {
  const summary = {
    copied: 0,
    overwritten: 0,
    skipped_identical: 0,
    conflicts: 0,
    verified: 0,
  };

  for (const entry of entries) {
    if (entry.action === "skip_identical") {
      summary.skipped_identical += 1;
      continue;
    }
    if (entry.action === "conflict") {
      summary.conflicts += 1;
      continue;
    }
    if (options.dryRun) {
      if (entry.action === "overwrite") summary.overwritten += 1;
      else summary.copied += 1;
      continue;
    }
    copyFileVerified(entry.source_path, entry.target_path);
    summary.verified += 1;
    if (entry.action === "overwrite") summary.overwritten += 1;
    else summary.copied += 1;
  }

  return summary;
}

function printPlan(label, entries) {
  process.stdout.write(`\n[${label}]\n`);
  if (entries.length === 0) {
    process.stdout.write("  no source files found\n");
    return;
  }
  for (const entry of entries) {
    process.stdout.write(`  ${entry.action.padEnd(15)} ${entry.relative_path}\n`);
  }
}

function main() {
  const options = resolveOptions(process.argv.slice(2));
  const { runtimePaths } = options;
  const sourceDataRoot = runtimePaths.legacyDataDir;
  const sourceArchiveRoot = runtimePaths.legacyArchiveDir;
  const targetDataRoot = runtimePaths.dataDir;
  const targetArchiveRoot = runtimePaths.archiveDir;

  const dataEntries = path.resolve(sourceDataRoot) === path.resolve(targetDataRoot)
    ? []
    : inventoryCopyPlan(sourceDataRoot, targetDataRoot, options);
  const archiveEntries = path.resolve(sourceArchiveRoot) === path.resolve(targetArchiveRoot)
    ? []
    : inventoryCopyPlan(sourceArchiveRoot, targetArchiveRoot, options);

  printPlan(`legacy-data ${sourceDataRoot} -> ${targetDataRoot}`, dataEntries);
  printPlan(`legacy-archive ${sourceArchiveRoot} -> ${targetArchiveRoot}`, archiveEntries);

  const conflicts = [...dataEntries, ...archiveEntries].filter((entry) => entry.action === "conflict");
  if (conflicts.length > 0 && !options.overwrite) {
    process.stderr.write(`\n[migrate-runtime-state-root] found ${conflicts.length} conflicting file(s); rerun with --overwrite to replace them\n`);
    if (!options.dryRun && !options.verifyOnly) process.exit(1);
  }

  if (options.verifyOnly) {
    process.stdout.write("\n[migrate-runtime-state-root] verify-only complete\n");
    return;
  }

  const dataSummary = executePlan(dataEntries, options);
  const archiveSummary = executePlan(archiveEntries, options);
  const combined = {
    data: dataSummary,
    archive: archiveSummary,
    dry_run: options.dryRun,
    overwrite: options.overwrite,
    include_ephemeral: options.includeEphemeral,
  };
  process.stdout.write(`\n${JSON.stringify(combined, null, 2)}\n`);

  if ((dataSummary.conflicts + archiveSummary.conflicts) > 0 && !options.dryRun && !options.overwrite) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveOptions,
  shouldSkipFile,
  walkFiles,
  inventoryCopyPlan,
  executePlan,
  copyFileVerified,
  main,
};
