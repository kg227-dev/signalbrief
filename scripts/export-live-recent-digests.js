#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

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
  const flag = `--${name}`;
  return argv.includes(flag);
}

function resolveOutputPath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value || value === "-") return "";
  return path.resolve(value);
}

async function loginAndGetCookie({ baseUrl, email, password }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/admin/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`admin login failed (${response.status}): ${body}`);
  }

  const cookieHeader = response.headers.get("set-cookie") || "";
  const sessionCookie = cookieHeader.split(",").find((value) => String(value || "").includes("sb_admin=")) || cookieHeader;
  const cookie = String(sessionCookie || "").split(";")[0].trim();
  if (!cookie.startsWith("sb_admin=")) {
    throw new Error("admin login succeeded but no sb_admin cookie was returned");
  }
  return cookie;
}

async function fetchJson({ url, cookie }) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: cookie,
    },
  });
  const bodyText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(bodyText || "{}");
  } catch {
    throw new Error(`non-JSON response from ${url}: ${bodyText}`);
  }
  if (!response.ok) {
    throw new Error(`request failed (${response.status}) for ${url}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function main() {
  const argv = process.argv.slice(2);
  const baseUrl = readOption(argv, "base-url", process.env.SIGNALBRIEF_BASE_URL || process.env.BASE_URL || "https://getsignalbrief.com");
  const days = Math.min(60, Math.max(1, Number(readOption(argv, "days", "7")) || 7));
  const outputPath = resolveOutputPath(readOption(argv, "output", ""));
  const includeRuntimeState = hasFlag(argv, "include-runtime-state");
  const email = readOption(
    argv,
    "email",
    process.env.SIGNALBRIEF_ADMIN_EMAIL || process.env.ADMIN_EMAIL || ""
  );
  const password = readOption(
    argv,
    "password",
    process.env.SIGNALBRIEF_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || ""
  );

  if (!email || !password) {
    throw new Error("admin credentials required via --email/--password or SIGNALBRIEF_ADMIN_EMAIL/SIGNALBRIEF_ADMIN_PASSWORD");
  }

  const cookie = await loginAndGetCookie({ baseUrl, email, password });
  const recentDigests = await fetchJson({
    url: `${baseUrl.replace(/\/+$/, "")}/api/admin/export/recent-digests?days=${days}`,
    cookie,
  });

  const payload = includeRuntimeState
    ? {
      generated_at: new Date().toISOString(),
      recent_digests: recentDigests,
      runtime_state: await fetchJson({
        url: `${baseUrl.replace(/\/+$/, "")}/api/admin/runtime-state`,
        cookie,
      }),
    }
    : recentDigests;

  const rendered = `${JSON.stringify(payload, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, rendered, "utf8");
    process.stdout.write(`[export-live-recent-digests] wrote ${outputPath}\n`);
    return;
  }
  process.stdout.write(rendered);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[export-live-recent-digests] ${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  readOption,
  hasFlag,
  resolveOutputPath,
  loginAndGetCookie,
  fetchJson,
  main,
};
