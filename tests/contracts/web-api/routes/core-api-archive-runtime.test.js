"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core-api-archive-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { handleCoreArchiveRoutes } = runtime;
assert.strictEqual(typeof handleCoreArchiveRoutes, "function");

function buildMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this.body = String(body || "");
      return this.body;
    },
  };
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function invoke(pathname, search, deps) {
  const req = { method: "GET", url: `${pathname}${search}` };
  const res = buildMockRes();
  const url = new URL(`http://localhost${pathname}${search}`);
  const handled = await handleCoreArchiveRoutes({ req, res, url, pathname }, deps);
  return { handled, res };
}

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-core-archive-route-"));
  const archiveDir = path.join(rootDir, "archive");
  fs.mkdirSync(archiveDir, { recursive: true });

  const digest = {
    date: "2026-03-12",
    dateStr: "March 12, 2026",
    quickScan: "Markets steady",
    generatedAt: "2026-03-12T10:00:00.000Z",
    items: [
      {
        tag: "AI×TECH",
        headline: "Test headline",
        summary: "Test summary",
        url: "https://example.com/story",
        source: "Example",
      },
    ],
  };
  fs.writeFileSync(path.join(archiveDir, "2026-03-12.json"), JSON.stringify(digest, null, 2));

  try {
    let readArchiveFilesCalls = 0;
    const steadyUser = {
      chatId: "steady-user",
      digest_dates: ["2026-03-12"],
      topics: ["AI×TECH"],
      topic_weights: {},
      digests_received: 1,
    };

    const steadyDeps = {
      json,
      findUserByToken: () => steadyUser,
      readArchiveFiles: () => {
        readArchiveFilesCalls += 1;
        return ["2026-03-12.json"];
      },
      getAllowedArchiveDates: (user, _archiveDir, files) => {
        if (Array.isArray(files) && files.length > 0) {
          return new Set(["2026-03-12"]);
        }
        return new Set(Array.isArray(user.digest_dates) ? user.digest_dates : []);
      },
      archiveRelevanceScore: () => 0,
      path,
      fs,
      APP_ROOT: rootDir,
      isLegacyArchiveEndpointEnabled: () => true,
      recordLegacyArchiveUsage: () => {},
      ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC: "2026-06-30T00:00:00Z",
    };

    const steadyResult = await invoke("/api/archive/all", "?token=ok", steadyDeps);
    assert.strictEqual(steadyResult.handled, true);
    assert.strictEqual(steadyResult.res.statusCode, 200);
    const steadyBody = JSON.parse(steadyResult.res.body || "{}");
    assert.strictEqual(Array.isArray(steadyBody.items), true);
    assert.strictEqual(steadyBody.items.length, 1);
    assert.strictEqual(readArchiveFilesCalls, 0, "steady-state archive reads should not require directory scans");

    let fallbackCalls = 0;
    const legacyUser = {
      chatId: "legacy-user",
      digest_dates: [],
      topics: ["AI×TECH"],
      topic_weights: {},
      digests_received: 1,
    };

    const legacyDeps = {
      ...steadyDeps,
      findUserByToken: () => legacyUser,
      readArchiveFiles: () => {
        fallbackCalls += 1;
        return ["2026-03-12.json"];
      },
      getAllowedArchiveDates: (_user, _archiveDir, files) => {
        if (Array.isArray(files) && files.length > 0) return new Set(["2026-03-12"]);
        return new Set();
      },
    };

    const legacyResult = await invoke("/api/archive/all", "?token=legacy", legacyDeps);
    assert.strictEqual(legacyResult.handled, true);
    assert.strictEqual(legacyResult.res.statusCode, 200);
    const legacyBody = JSON.parse(legacyResult.res.body || "{}");
    assert.strictEqual(Array.isArray(legacyBody.items), true);
    assert.strictEqual(legacyBody.items.length, 1);
    assert.strictEqual(fallbackCalls, 1, "legacy fallback may scan archive files when digest_dates are missing");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
