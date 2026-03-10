#!/usr/bin/env node
"use strict";

const { spawnSync, execSync } = require("child_process");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");

function log(message) {
  process.stdout.write(`[deploy-prod] ${message}\n`);
}

function fail(message, detail = "") {
  process.stderr.write(`[deploy-prod] FAIL: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
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

function run(command, args, { cwd = ROOT, label = "", capture = false } = {}) {
  const pretty = [command, ...args].join(" ");
  log(`${label ? `${label}: ` : ""}${pretty}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
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

function getGitShortSha() {
  try {
    return String(execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || "").trim();
  } catch (error) {
    fail("unable to resolve git commit SHA", String(error?.message || error));
  }
  return "";
}

async function verifyPublicEndpoints(publicBaseUrl) {
  const base = String(publicBaseUrl || "").replace(/\/+$/, "");
  if (!base) fail("public URL is required for verification");

  log(`public verify: ${base}/`);
  const home = await fetchUrl(`${base}/`);
  if (home.status !== 200) {
    fail(`homepage check failed: expected 200, got ${home.status}`);
  }
  if (!home.body.includes(`id="darkToggle"`)) {
    fail("homepage check failed: dark-toggle button markup missing");
  }
  if (home.body.includes("__ASSET_VERSION__")) {
    fail("homepage check failed: asset version token was not rendered");
  }

  const indexJsMatch = home.body.match(/<script\s+src="(index\.js\?v=[^"]+)"/i);
  if (!indexJsMatch) {
    fail("homepage check failed: cache-busted index.js script tag missing");
  }
  const indexJsPath = indexJsMatch[1];
  log(`public verify: ${base}/${indexJsPath}`);
  const indexJs = await fetchUrl(`${base}/${indexJsPath}`);
  if (indexJs.status !== 200) {
    fail(`index.js check failed: expected 200, got ${indexJs.status}`);
  }
  if (!indexJs.body.includes("window.toggleDark = toggleDark")) {
    fail("index.js check failed: dark-mode runtime export missing");
  }

  log(`public verify: ${base}/api/health/scheduler`);
  const scheduler = await fetchUrl(`${base}/api/health/scheduler`);
  if (scheduler.status !== 200) {
    fail(`scheduler health check failed: expected 200, got ${scheduler.status}`);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(scheduler.body || "{}");
  } catch {
    fail("scheduler health check failed: non-JSON response");
  }
  if (!parsed || parsed.ok !== true) {
    fail("scheduler health check failed: api returned not-ok", JSON.stringify(parsed, null, 2));
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
        "  --services \"web bot worker\"",
        "  --skip-build",
        "  --skip-remote-verify",
        "  --skip-public-verify",
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

  const serviceListRaw = readOption(options, "services") || process.env.DEPLOY_SERVICES || "web bot worker";
  const services = parseServiceList(serviceListRaw);
  if (services.length === 0) fail("no deploy services provided");

  const skipBuild = flags.has("skip-build");
  const skipPublicVerify = flags.has("skip-public-verify");
  const skipRemoteVerify = flags.has("skip-remote-verify");

  const sha = getGitShortSha();
  const archiveName = `signalbrief-deploy-${sha}.tgz`;
  const archivePath = path.join(os.tmpdir(), archiveName);
  const remoteArchivePath = `${remoteTmpDir.replace(/\/+$/, "")}/${archiveName}`;
  const sshTarget = `${sshUser}@${sshHost}`;

  log(`commit=${sha}`);
  run("tar", [
    "-czf",
    archivePath,
    "--exclude=.git",
    "--exclude=node_modules",
    "--exclude=tmp",
    "--exclude=.desloppify",
    ".",
  ], { label: "pack" });

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
    `tar -xzf ${shellQuote(remoteArchivePath)}`,
    composeArgs.map((arg) => shellQuote(arg)).join(" "),
  ];
  if (!skipRemoteVerify) {
    remoteSteps.push(
      "if command -v npm >/dev/null 2>&1; then "
      + "npm run -s ops:verify-runtime:quick; "
      + "elif docker compose ps --services --status running | grep -qx web; then "
      + "docker compose exec -T web node scripts/verify-runtime.js --skip-canary; "
      + "else "
      + "echo '[deploy-prod] WARN: remote verify skipped (npm missing and web container unavailable)' >&2; "
      + "fi"
    );
  }
  remoteSteps.push("docker compose ps");

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
