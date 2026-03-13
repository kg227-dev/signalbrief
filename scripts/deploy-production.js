#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const {
  DEFAULT_RELEASE_WINDOWS_ET,
  evaluateReleaseWindowGuard,
} = require("./release-window-guard-runtime");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_VERIFY_ATTEMPTS = parsePositiveInt(process.env.DEPLOY_PUBLIC_VERIFY_ATTEMPTS, 8, 1);
const PUBLIC_VERIFY_DELAY_MS = parsePositiveInt(process.env.DEPLOY_PUBLIC_VERIFY_DELAY_MS, 2500, 250);

function log(message) {
  process.stdout.write(`[deploy-prod] ${message}\n`);
}

function fail(message, detail = "") {
  process.stderr.write(`[deploy-prod] FAIL: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
}

function parsePositiveInt(rawValue, fallback, min = 1) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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
      return String(options[key]);
    }
  }
  return "";
}

function run(command, args, { cwd = ROOT, label = "", capture = false, env = null } = {}) {
  const pretty = [command, ...args].join(" ");
  log(`${label ? `${label}: ` : ""}${pretty}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.status !== 0) {
    const detail = capture
      ? [String(result.stdout || "").trim(), String(result.stderr || "").trim()].filter(Boolean).join("\n")
      : "";
    fail(`command failed (exit=${result.status}): ${pretty}`, detail);
  }
  return result;
}

function parseServiceList(rawValue) {
  return String(rawValue || "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return false;
  return ["1", "true", "yes", "y", "on"].includes(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactSnippet(text, maxLen = 280) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function responseDebugLines(response) {
  if (!response || typeof response !== "object") return [];
  const headers = response.headers && typeof response.headers === "object" ? response.headers : {};
  const snippet = compactSnippet(response.body || "");
  const lines = [
    `url: ${response.url || "-"}`,
    `status: ${Number(response.status || 0)}`,
    `cache-control: ${headers["cache-control"] || "-"}`,
    `location: ${headers.location || "-"}`,
  ];
  if (snippet) lines.push(`body: ${snippet}`);
  return lines;
}

function createVerifyError(message, response = null, detail = "") {
  const error = new Error(message);
  error.response = response;
  error.detail = detail;
  return error;
}

function verifyErrorDetail(error) {
  const lines = [];
  if (error?.message) lines.push(String(error.message));
  if (error?.detail) lines.push(String(error.detail));
  lines.push(...responseDebugLines(error?.response));
  return lines.filter(Boolean).join("\n");
}

async function eventually(label, attempts, delayMs, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        log(`${label}: attempt ${attempt}/${attempts} failed (${String(error?.message || error)}); retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError || new Error(`${label} failed`);
}

function fetchUrl(url, { timeoutMs = 8000, maxRedirects = 4 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`invalid URL: ${url}`));
      return;
    }
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(parsed, {
      method: "GET",
      timeout: timeoutMs,
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "signalbrief-deploy-prod/1.0",
      },
    }, (res) => {
      const status = Number(res.statusCode || 0);
      const location = res.headers && res.headers.location ? String(res.headers.location) : "";
      if (status >= 300 && status < 400 && location && maxRedirects > 0) {
        const redirected = new URL(location, parsed).toString();
        res.resume();
        fetchUrl(redirected, { timeoutMs, maxRedirects: maxRedirects - 1 }).then(resolve).catch(reject);
        return;
      }

      let body = "";
      res.on("data", (chunk) => { body += String(chunk); });
      res.on("end", () => {
        resolve({
          url: parsed.toString(),
          status,
          headers: res.headers || {},
          body,
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

function getGitShortSha(ref = "HEAD") {
  const target = String(ref || "HEAD").trim() || "HEAD";
  try {
    const result = spawnSync("git", ["rev-parse", "--short", `${target}^{commit}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      fail("unable to resolve git commit SHA", String(result.stderr || result.stdout || "").trim());
    }
    return String(result.stdout || "").trim();
  } catch (error) {
    fail("unable to resolve git commit SHA", String(error?.message || error));
  }
  return "";
}

function verifyGitCommit(ref) {
  const target = String(ref || "").trim();
  if (!target) fail("archive-sha cannot be empty");
  const result = spawnSync("git", ["rev-parse", "--verify", `${target}^{commit}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`archive-sha is not a valid commit: ${target}`, String(result.stderr || result.stdout || "").trim());
  }
}

function packageWorkingTreeArchive(archivePath) {
  run("tar", [
    "-czf",
    archivePath,
    "--exclude=.git",
    "--exclude=node_modules",
    "--exclude=data",
    "--exclude=archive",
    "--exclude=config.json",
    "--exclude=.env",
    "--exclude=.env.*",
    "--exclude=tmp",
    "--exclude=.desloppify",
    ".",
  ], {
    label: "pack",
    env: {
      COPYFILE_DISABLE: "1",
      COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
    },
  });
}

function packageCommitArchive(archivePath, archiveSha) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalbrief-pack-sha-"));
  const sourceTarPath = path.join(tmpRoot, `source-${String(archiveSha).slice(0, 12)}.tar`);
  const extractDir = path.join(tmpRoot, "extract");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    run("git", [
      "archive",
      "--format=tar",
      "--output",
      sourceTarPath,
      archiveSha,
    ], { label: "pack source" });
    run("tar", ["-xf", sourceTarPath, "-C", extractDir], { label: "pack extract" });
    run("tar", [
      "-czf",
      archivePath,
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=data",
      "--exclude=archive",
      "--exclude=config.json",
      "--exclude=.env",
      "--exclude=.env.*",
      "--exclude=tmp",
      "--exclude=.desloppify",
      ".",
    ], {
      cwd: extractDir,
      label: "pack",
      env: {
        COPYFILE_DISABLE: "1",
        COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
      },
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function verifyPublicEndpoints(publicBaseUrl) {
  const base = String(publicBaseUrl || "").replace(/\/+$/, "");
  if (!base) fail("public URL is required for verification");
  const attempts = PUBLIC_VERIFY_ATTEMPTS;
  const delayMs = PUBLIC_VERIFY_DELAY_MS;

  let homeCheck = null;
  try {
    log(`public verify: ${base}/`);
    homeCheck = await eventually("homepage check", attempts, delayMs, async () => {
      const response = await fetchUrl(`${base}/`);
      if (response.status !== 200) {
        throw createVerifyError(`expected 200, got ${response.status}`, response);
      }
      if (!response.body.includes(`id="darkToggle"`)) {
        throw createVerifyError("dark-toggle button markup missing", response);
      }
      if (response.body.includes("__ASSET_VERSION__")) {
        throw createVerifyError("asset version token was not rendered", response);
      }
      const indexJsMatch = response.body.match(/<script\s+src="(index\.js\?v=[^"]+)"/i);
      if (!indexJsMatch) {
        throw createVerifyError("cache-busted index.js script tag missing", response);
      }
      return {
        response,
        indexJsPath: indexJsMatch[1],
      };
    });
  } catch (error) {
    fail("homepage check failed after retries", verifyErrorDetail(error));
  }

  try {
    const indexJsUrl = `${base}/${homeCheck.indexJsPath}`;
    log(`public verify: ${indexJsUrl}`);
    await eventually("index.js check", attempts, delayMs, async () => {
      const response = await fetchUrl(indexJsUrl);
      if (response.status !== 200) {
        throw createVerifyError(`expected 200, got ${response.status}`, response);
      }
      if (!response.body.includes("window.toggleDark = toggleDark")) {
        throw createVerifyError("dark-mode runtime export missing", response);
      }
      return response;
    });
  } catch (error) {
    fail("index.js check failed after retries", verifyErrorDetail(error));
  }

  try {
    const healthUrl = `${base}/api/health/scheduler`;
    log(`public verify: ${healthUrl}`);
    await eventually("scheduler health check", attempts, delayMs, async () => {
      const response = await fetchUrl(healthUrl);
      let parsed = null;
      try {
        parsed = JSON.parse(response.body || "{}");
      } catch {
        throw createVerifyError(`non-JSON response (status=${response.status})`, response);
      }
      if (response.status !== 200 || !parsed || parsed.ok !== true) {
        throw createVerifyError(
          `expected status=200 and ok=true, got status=${response.status} ok=${parsed?.ok}`,
          response,
          `scheduler payload: ${JSON.stringify(parsed, null, 2)}`
        );
      }
      return response;
    });
  } catch (error) {
    fail("scheduler health check failed after retries", verifyErrorDetail(error));
  }

  log("public verification passed");
}

async function main() {
  const { options, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) {
    process.stdout.write(
      [
        "Usage: node scripts/deploy-production.js [options]",
        "",
        "Options:",
        "  --host <ip-or-hostname>",
        "  --user <ssh-user>",
        "  --key <path-to-private-key>",
        "  --remote-dir <remote-app-dir>",
        "  --remote-tmp-dir <remote-tmp-dir>",
        "  --public-url <https://public-host>",
        "  --archive-sha <commit-sha>",
        "  --target-env <production|staging>",
        "  --services \"web bot worker\"",
        "  --release-windows-et <spec>",
        "  --release-window-tolerance-minutes <n>",
        "  --hotfix",
        "  --allow-outside-window",
        "  --skip-build",
        "  --skip-remote-verify",
        "  --skip-public-verify",
        "",
        `Default release windows (ET): ${DEFAULT_RELEASE_WINDOWS_ET}`,
      ].join("\n")
    );
    return;
  }

  const sshHost = readOption(options, "host") || process.env.DEPLOY_SSH_HOST || "129.213.92.102";
  const sshUser = readOption(options, "user") || process.env.DEPLOY_SSH_USER || "ubuntu";
  const sshKey = readOption(options, "key") || process.env.DEPLOY_SSH_KEY || path.join(os.homedir(), ".ssh", "signalbrief_vm");
  const remoteDir = readOption(options, "remote-dir", "remote_dir") || process.env.DEPLOY_REMOTE_DIR || "/opt/signalbrief/app";
  const remoteTmpDir = readOption(options, "remote-tmp-dir", "remote_tmp_dir") || process.env.DEPLOY_REMOTE_TMP_DIR || "/tmp";
  const publicUrl = readOption(options, "public-url", "public_url") || process.env.DEPLOY_PUBLIC_URL || "https://getsignalbrief.com";
  const archiveSha = readOption(options, "archive-sha", "archive_sha");
  const targetEnv = (readOption(options, "target-env", "target_env") || process.env.DEPLOY_TARGET_ENV || "production")
    .toLowerCase()
    .trim();

  const serviceListRaw = readOption(options, "services") || process.env.DEPLOY_SERVICES || "web bot worker";
  const services = parseServiceList(serviceListRaw);
  if (services.length === 0) fail("no deploy services provided");

  const skipBuild = flags.has("skip-build");
  const skipPublicVerify = flags.has("skip-public-verify");
  const skipRemoteVerify = flags.has("skip-remote-verify");

  if (archiveSha) verifyGitCommit(archiveSha);
  const sha = getGitShortSha(archiveSha || "HEAD");
  const archiveName = `signalbrief-deploy-${sha}.tgz`;
  const archivePath = path.join(os.tmpdir(), archiveName);
  const remoteArchivePath = `${remoteTmpDir.replace(/\/+$/, "")}/${archiveName}`;
  const sshTarget = `${sshUser}@${sshHost}`;

  if (targetEnv === "production") {
    const releaseWindowResult = evaluateReleaseWindowGuard({
      windowsSpec: readOption(options, "release-windows-et", "release_windows_et")
        || process.env.DEPLOY_RELEASE_WINDOWS_ET
        || DEFAULT_RELEASE_WINDOWS_ET,
      toleranceMinutes: parsePositiveInt(
        readOption(options, "release-window-tolerance-minutes", "release_window_tolerance_minutes")
        || process.env.DEPLOY_RELEASE_WINDOW_TOLERANCE_MINUTES,
        45
      ),
      hotfix: flags.has("hotfix") || parseBoolean(process.env.DEPLOY_HOTFIX),
      allowOutsideWindow: flags.has("allow-outside-window") || parseBoolean(process.env.DEPLOY_ALLOW_OUTSIDE_WINDOW),
    });

    const nextWindow = releaseWindowResult.next_window
      ? `${releaseWindowResult.next_window.label} (in ${releaseWindowResult.next_window.eta})`
      : "n/a";
    if (!releaseWindowResult.allowed) {
      fail(
        "release window gate blocked deploy",
        [
          `now_et=${releaseWindowResult.now_et.weekday_label} ${releaseWindowResult.now_et.time} ${releaseWindowResult.now_et.timezone}`,
          `next_window=${nextWindow}`,
          "Use --hotfix only for active incidents, or ship in the next planned release window.",
        ].join("\n")
      );
    }
    log(`release window gate: pass (mode=${releaseWindowResult.mode}, next_window=${nextWindow})`);
  } else {
    log(`release window gate: skipped (target_env=${targetEnv})`);
  }

  log(`commit=${sha}`);
  if (archiveSha) {
    log(`pack source commit=${archiveSha}`);
    packageCommitArchive(archivePath, archiveSha);
  } else {
    packageWorkingTreeArchive(archivePath);
  }

  run("scp", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    archivePath,
    `${sshTarget}:${remoteArchivePath}`,
  ], { label: "upload" });

  const composeArgs = ["docker", "compose", "up", "-d"];
  if (!skipBuild) composeArgs.push("--build");
  composeArgs.push(...services);

  const remoteSteps = [
    "set -euo pipefail",
    `cd ${shellQuote(remoteDir)}`,
    "echo '[deploy-prod] remote: extract archive'",
    `tar -xzf ${shellQuote(remoteArchivePath)}`,
    "echo '[deploy-prod] remote: compose up'",
    composeArgs.map((arg) => shellQuote(arg)).join(" "),
  ];
  if (!skipRemoteVerify) {
    remoteSteps.push(
      "echo '[deploy-prod] remote: runtime verify'",
      "if command -v npm >/dev/null 2>&1; then "
      + "npm run -s ops:verify-runtime:quick; "
      + "elif command -v node >/dev/null 2>&1; then "
      + "node scripts/verify-runtime.js --skip-canary; "
      + "else "
      + "echo '[deploy-prod] WARN: remote verify skipped (npm and node missing on VM host)' >&2; "
      + "fi"
    );
  }
  remoteSteps.push("echo '[deploy-prod] remote: compose ps'");
  remoteSteps.push("docker compose ps");
  remoteSteps.push(`rm -f ${shellQuote(remoteArchivePath)}`);

  run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "ConnectTimeout=30",
    sshTarget,
    remoteSteps.join("; "),
  ], { label: "remote deploy" });

  if (!skipPublicVerify) {
    await verifyPublicEndpoints(publicUrl);
  } else {
    log("public verification skipped by flag");
  }

  log(`DONE deploy=${sha} host=${sshHost}`);
}

main().catch((error) => {
  fail(error?.message || String(error));
});
