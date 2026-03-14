"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/archive-digest-stats-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { createArchiveDigestStatsRuntime } = require(TARGET_PATH);

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-archive-digest-count-"));
const archiveDir = path.join(rootDir, "archive");
fs.mkdirSync(archiveDir, { recursive: true });

fs.writeFileSync(path.join(archiveDir, "2026-03-10.json"), JSON.stringify({
  date: "2026-03-10",
  items: [{ headline: "A", tag: "AI", url: "https://example.com/a" }],
}, null, 2));
fs.writeFileSync(path.join(archiveDir, "2026-03-11.json"), JSON.stringify({
  date: "2026-03-11",
  items: [{ headline: "B", tag: "AI", url: "https://example.com/b" }],
}, null, 2));

try {
  const runtime = createArchiveDigestStatsRuntime({
    APP_ROOT: rootDir,
    fs,
    path,
    readArchiveFiles: () => ["2026-03-11.json", "2026-03-10.json"],
    getAllowedArchiveDates: (user, _archiveDir, files) => {
      if (Array.isArray(user.digest_dates) && user.digest_dates.length) return new Set(user.digest_dates);
      if (Array.isArray(files) && files.length) return new Set(["2026-03-10", "2026-03-11"]);
      return new Set();
    },
    loadLatestDigestSnapshot: () => null,
    loadEngagementEvents: () => [],
  });

  const userWithDistinctDates = {
    chatId: "user-1",
    digest_dates: ["2026-03-10", "2026-03-11"],
    digests_received: 19,
  };
  assert.strictEqual(
    runtime.countArchiveDigestsForUser(userWithDistinctDates),
    2,
    "canonical archive count should follow visible distinct digest dates, not raw digests_received"
  );

  const userNeedingLegacyBackfill = {
    chatId: "user-2",
    digest_dates: [],
    digests_received: 5,
  };
  assert.strictEqual(
    runtime.countArchiveDigestsForUser(userNeedingLegacyBackfill),
    2,
    "legacy fallback should still count visible archive digests when digest_dates are missing"
  );

  const snapshotRuntime = createArchiveDigestStatsRuntime({
    APP_ROOT: rootDir,
    fs,
    path,
    readArchiveFiles: () => [],
    getAllowedArchiveDates: () => new Set(["2026-03-12"]),
    loadLatestDigestSnapshot: (userId, dateKey) => {
      if (userId !== "user-3" || dateKey !== "2026-03-12") return null;
      return {
        user_id: userId,
        date_et: dateKey,
        items: [{ headline: "Snapshot headline", tag: "PFIZER", url: "https://example.com/snapshot" }],
      };
    },
    loadEngagementEvents: () => [],
  });

  assert.strictEqual(
    snapshotRuntime.countArchiveDigestsForUser({ chatId: "user-3", digest_dates: ["2026-03-12"], digests_received: 1 }),
    1,
    "snapshot-only delivered digests should count even when the archive file is absent"
  );
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
