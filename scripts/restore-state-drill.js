#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BACKUP_DIR = process.env.SIGNALBRIEF_BACKUP_DIR || path.join(ROOT, "artifacts", "backups");

function log(message) {
  process.stdout.write(`[restore-state-drill] ${message}\n`);
}

function fail(message, detail = "") {
  process.stderr.write(`[restore-state-drill] FAIL: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (!key) continue;
    const next = argv[i + 1];
    if (next != null && !String(next).startsWith("--")) {
      options[key] = String(next);
      i += 1;
    } else {
      flags.add(key);
    }
  }
  return { options, flags };
}

function readOption(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return String(options[key] || "").trim();
    }
  }
  return "";
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/restore-state-drill.js [options]",
      "",
      "Options:",
      "  --backup <file.tgz>              Backup archive to verify (absolute or relative path)",
      "  --backup-dir <dir>               Backup directory for --latest (default: artifacts/backups)",
      "  --latest                         Use newest .tgz in backup dir (default if --backup omitted)",
      "  --target-dir <dir>               Drill extraction directory (default: /tmp/signalbrief-restore-drill-*)",
      "  --force                          Remove target-dir if it already exists",
      "  --clean                          Delete extraction directory after successful verification",
      "  --dry-run                        Resolve archive/target only; skip extraction and checksum verification",
      "  --help                           Show help",
    ].join("\n")
  );
}

function run(command, args, { cwd = ROOT, label = "" } = {}) {
  const pretty = [command, ...args].join(" ");
  log(`${label ? `${label}: ` : ""}${pretty}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = [String(result.stdout || "").trim(), String(result.stderr || "").trim()]
      .filter(Boolean)
      .join("\n");
    fail(`command failed (exit=${result.status}): ${pretty}`, detail);
  }
}

function drillTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function pickLatestArchive(backupDir) {
  if (!fs.existsSync(backupDir)) fail(`backup dir does not exist: ${backupDir}`);
  const candidates = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => {
      const absPath = path.join(backupDir, entry.name);
      const stat = fs.statSync(absPath);
      return { absPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (candidates.length === 0) fail(`no .tgz archives found in ${backupDir}`);
  return candidates[0].absPath;
}

function normalizeArchivePath(backupOption, backupDir, preferLatest) {
  if (backupOption) {
    const abs = path.resolve(ROOT, backupOption);
    if (!fs.existsSync(abs)) fail(`backup archive not found: ${abs}`);
    return abs;
  }
  if (preferLatest) return pickLatestArchive(backupDir);
  return pickLatestArchive(backupDir);
}

function prepareTargetDir(targetDir, force) {
  const absTarget = targetDir
    ? path.resolve(ROOT, targetDir)
    : path.join(os.tmpdir(), `signalbrief-restore-drill-${drillTimestamp()}`);
  if (fs.existsSync(absTarget)) {
    if (!force) fail(`target dir exists: ${absTarget} (pass --force to replace)`);
    fs.rmSync(absTarget, { recursive: true, force: true });
  }
  fs.mkdirSync(absTarget, { recursive: true });
  return absTarget;
}

function verifyManifest(extractDir) {
  const manifestPath = path.join(extractDir, "backup-manifest.json");
  if (!fs.existsSync(manifestPath)) fail(`manifest missing from extracted backup: ${manifestPath}`);

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("unable to parse backup manifest", String(error?.message || error));
  }

  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (files.length === 0) {
    fail("manifest contains zero files; backup appears incomplete");
  }

  let verified = 0;
  let totalBytes = 0;
  const mismatches = [];
  for (const row of files) {
    const relPath = String(row?.path || "").trim();
    if (!relPath) continue;
    const absPath = path.join(extractDir, relPath);
    if (!fs.existsSync(absPath)) {
      mismatches.push(`${relPath}: missing`);
      continue;
    }
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      mismatches.push(`${relPath}: not a file`);
      continue;
    }
    const expectedSize = Number(row?.size || 0);
    if (expectedSize !== stat.size) {
      mismatches.push(`${relPath}: size mismatch expected=${expectedSize} actual=${stat.size}`);
      continue;
    }
    const expectedSha = String(row?.sha256 || "").trim();
    if (!expectedSha) {
      mismatches.push(`${relPath}: missing sha256 in manifest`);
      continue;
    }
    const actualSha = hashFile(absPath);
    if (actualSha !== expectedSha) {
      mismatches.push(`${relPath}: sha mismatch expected=${expectedSha} actual=${actualSha}`);
      continue;
    }
    verified += 1;
    totalBytes += stat.size;
  }

  if (mismatches.length > 0) {
    fail("manifest verification failed", mismatches.slice(0, 20).join("\n"));
  }

  log(`verified files=${verified} bytes=${totalBytes}`);
  return {
    verified,
    totalBytes,
    manifest,
  };
}

function main() {
  const { options, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) {
    printHelp();
    return;
  }

  const backupDirRaw = readOption(options, "backup-dir", "backup_dir");
  const backupRaw = readOption(options, "backup");
  const targetDirRaw = readOption(options, "target-dir", "target_dir");
  const preferLatest = flags.has("latest");
  const force = flags.has("force");
  const clean = flags.has("clean");
  const dryRun = flags.has("dry-run");

  const backupDir = backupDirRaw ? path.resolve(ROOT, backupDirRaw) : DEFAULT_BACKUP_DIR;
  const archivePath = normalizeArchivePath(backupRaw, backupDir, preferLatest);
  const extractDir = prepareTargetDir(targetDirRaw, force);

  log(`archive=${archivePath}`);
  log(`target=${extractDir}`);
  if (dryRun) {
    log("dry-run: skipped extraction and manifest verification");
    return;
  }

  let success = false;
  try {
    run("tar", ["-xzf", archivePath, "-C", extractDir], { label: "extract" });
    verifyManifest(extractDir);
    success = true;
    log("restore drill OK");
  } finally {
    if (clean && success) {
      fs.rmSync(extractDir, { recursive: true, force: true });
      log(`clean: removed ${extractDir}`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  drillTimestamp,
  parseArgs,
};
