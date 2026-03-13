#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");
const { backupTimestamp, parseArgs } = require("./migrate-store-file-to-sqlite");
const { parseCanaryChatIds } = require("../src/runtime/store-core-runtime");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts", "releases");

function log(message) {
  process.stdout.write(`[store-canary-cohort] ${message}\n`);
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

function resolveCanaryCohortUpdateOptions(argv, env = process.env, baseDir = ROOT) {
  const { options, flags } = parseArgs(argv);
  const stagingUrl = readOption(options, "staging-url", "staging_url")
    || String(env.DEPLOY_STAGING_PUBLIC_URL || "").trim();
  const artifactDir = resolvePath(
    readOption(options, "artifact-dir", "artifact_dir") || String(env.SIGNALBRIEF_RELEASE_ARTIFACT_DIR || ""),
    DEFAULT_ARTIFACT_DIR,
    baseDir
  );
  const cohortChatIds = parseCanaryChatIds(
    readOption(options, "cohort-chat-ids", "cohort_chat_ids")
    || readOption(options, "chat-ids", "chat_ids")
  );

  return {
    stagingUrl,
    cohortChatIds,
    artifactDir,
    artifactName: readOption(options, "artifact-name", "artifact_name"),
    maxCanarySize: parsePositiveInt(readOption(options, "max-canary-size", "max_canary_size"), 3),
    skipLocalCi: flags.has("skip-local-ci"),
    help: flags.has("help") || flags.has("h"),
  };
}

function runLocalCommand(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: Number(result.status || 0),
    command: [command, ...args].join(" "),
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function runCiGateChecks(options = {}, deps = {}) {
  if (options.skipLocalCi) {
    return {
      ci_green: true,
      checks: [{
        name: "local-ci-skipped",
        ok: true,
        detail: "skip-local-ci enabled",
      }],
    };
  }
  const runCommand = typeof deps.runCommand === "function"
    ? deps.runCommand
    : (command, args) => runLocalCommand(command, args, ROOT);

  const commands = [
    { name: "module-linkage", command: "npm", args: ["run", "check:module-linkage"] },
    { name: "critical-tests", command: "npm", args: ["test"] },
    { name: "smoke-worker", command: "npm", args: ["run", "smoke:worker"] },
    { name: "smoke-admin-scheduler", command: "npm", args: ["run", "smoke:admin-scheduler"] },
  ];

  const checks = [];
  let ciGreen = true;
  for (const step of commands) {
    const result = runCommand(step.command, step.args, ROOT);
    const ok = !!result && result.ok === true;
    checks.push({
      name: step.name,
      ok,
      command: [step.command, ...step.args].join(" "),
      status: Number(result?.status || 0),
      stderr: String(result?.stderr || ""),
    });
    if (!ok) ciGreen = false;
  }
  return {
    ci_green: ciGreen,
    checks,
  };
}

function httpRequest(url, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(parsed, {
      method: "GET",
      timeout: timeoutMs,
      headers: {
        "User-Agent": "signalbrief-canary-cohort-check",
        "Accept": "application/json,text/html,*/*",
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: Number(res.statusCode || 0),
          headers: res.headers || {},
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function runStagingGateChecks(options = {}, deps = {}) {
  const request = typeof deps.request === "function" ? deps.request : httpRequest;
  const checks = [];
  const baseUrl = String(options.stagingUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      staging_green: false,
      checks: [{
        name: "staging-url",
        ok: false,
        detail: "staging-url is required",
      }],
    };
  }

  const landing = await request(`${baseUrl}/`);
  const landingOk = (
    landing.statusCode === 200
    && landing.body.includes("index.js?v=")
    && !landing.body.includes("__ASSET_VERSION__")
  );
  checks.push({
    name: "staging-landing",
    ok: landingOk,
    statusCode: landing.statusCode,
  });

  const schedulerHealth = await request(`${baseUrl}/api/health/scheduler`);
  let schedulerJson = {};
  try {
    schedulerJson = JSON.parse(schedulerHealth.body || "{}");
  } catch {
    schedulerJson = {};
  }
  const schedulerOk = schedulerHealth.statusCode === 200 && schedulerJson && schedulerJson.ok === true;
  checks.push({
    name: "staging-scheduler-health",
    ok: schedulerOk,
    statusCode: schedulerHealth.statusCode,
  });

  return {
    staging_green: checks.every((check) => check.ok),
    checks,
  };
}

function writeArtifact(options, payload) {
  const defaultName = `store-canary-cohort-update-${backupTimestamp()}.json`;
  const fileName = options.artifactName || defaultName;
  const artifactPath = path.join(options.artifactDir, fileName);
  fs.mkdirSync(options.artifactDir, { recursive: true });
  if (fs.existsSync(artifactPath)) {
    throw new Error(`artifact already exists: ${artifactPath}`);
  }
  fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
  return artifactPath;
}

async function runCanaryCohortUpdate(rawOptions, deps = {}) {
  const options = {
    ...rawOptions,
    stagingUrl: String(rawOptions.stagingUrl || "").trim(),
    cohortChatIds: parseCanaryChatIds(rawOptions.cohortChatIds || []),
    artifactDir: path.resolve(String(rawOptions.artifactDir || DEFAULT_ARTIFACT_DIR)),
    artifactName: String(rawOptions.artifactName || "").trim(),
    maxCanarySize: parsePositiveInt(rawOptions.maxCanarySize, 3),
    skipLocalCi: rawOptions.skipLocalCi === true,
  };

  if (!options.cohortChatIds.length) {
    throw new Error("cohort-chat-ids is required and cannot be empty");
  }
  if (options.cohortChatIds.length > options.maxCanarySize) {
    throw new Error(`cohort size ${options.cohortChatIds.length} exceeds max-canary-size ${options.maxCanarySize}`);
  }

  const ci = runCiGateChecks(options, deps);
  const staging = await runStagingGateChecks(options, deps);
  const pass = ci.ci_green && staging.staging_green;

  const report = {
    version: 1,
    workflow: "canary_cohort_update",
    options: {
      staging_url: options.stagingUrl,
      cohort_chat_ids: options.cohortChatIds,
      max_canary_size: options.maxCanarySize,
      skip_local_ci: options.skipLocalCi,
      artifact_dir: options.artifactDir,
      artifact_name: options.artifactName || null,
    },
    ci,
    staging,
    pass,
    export: {
      SIGNALBRIEF_STORE_BACKEND: "canary",
      SIGNALBRIEF_STORE_CANARY_CHAT_IDS: options.cohortChatIds.join(","),
    },
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
      "Usage: node scripts/store-canary-cohort-update.js [options]",
      "",
      "Purpose:",
      "  Prepare a canary cohort expansion only if CI-equivalent gates and staging gates are green.",
      "",
      "Options:",
      "  --cohort-chat-ids \"id1,id2\"      Required cohort list",
      "  --staging-url <https://...>        Required staging URL",
      "  --max-canary-size <n>              Max allowed cohort size (default: 3)",
      "  --artifact-dir <dir>               Artifact output dir (default: ./artifacts/releases)",
      "  --artifact-name <file.json>        Explicit artifact name",
      "  --skip-local-ci                    Skip local CI-equivalent command checks",
      "  --help                             Show help",
    ].join("\n")
  );
}

async function main() {
  const options = resolveCanaryCohortUpdateOptions(process.argv.slice(2), process.env, ROOT);
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const report = await runCanaryCohortUpdate(options);
    log(
      `summary: pass=${report.pass} ci_green=${report.ci.ci_green} `
      + `staging_green=${report.staging.staging_green} cohort_size=${report.options.cohort_chat_ids.length}`
    );
    log(`export SIGNALBRIEF_STORE_BACKEND=${report.export.SIGNALBRIEF_STORE_BACKEND}`);
    log(`export SIGNALBRIEF_STORE_CANARY_CHAT_IDS=${report.export.SIGNALBRIEF_STORE_CANARY_CHAT_IDS}`);
    log(`artifact=${report.artifact_path}`);
    if (!report.pass) process.exit(1);
  } catch (error) {
    process.stderr.write(`[store-canary-cohort] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveCanaryCohortUpdateOptions,
  runCanaryCohortUpdate,
  runCiGateChecks,
  runStagingGateChecks,
};
