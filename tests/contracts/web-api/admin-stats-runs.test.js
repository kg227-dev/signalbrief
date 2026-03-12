"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-stats-runs.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { enrichRunsWithDigestMetadata } = require(TARGET_PATH);

const sampleRuns = [
  {
    date: "2026-03-11",
    run_at: "2026-03-11T15:00:00.230Z",
    run_at_et: "Mar 11, 11:00 AM",
    on_demand: false,
    users_served: 2,
    per_user: [
      { id: "alpha@example.com" },
      { id: "beta@example.com" },
    ],
  },
];

const sampleEvents = [
  {
    event_type: "digest_sent",
    run_id: "scheduled:2026-03-11T15-00-00-120Z",
    user_email: "alpha@example.com",
    digest_id: "2026-03-11:email-alpha",
    metadata: { quality_score: 90.2 },
  },
  {
    event_type: "digest_sent",
    run_id: "scheduled:2026-03-11T15-00-00-120Z",
    user_email: "beta@example.com",
    digest_id: "2026-03-11:email-beta",
    metadata: { quality_score: 79.8 },
  },
];

const enriched = enrichRunsWithDigestMetadata(sampleRuns, sampleEvents);
if (!Array.isArray(enriched) || enriched.length !== 1) {
  throw new Error("expected one enriched run");
}
if (enriched[0].digest_quality_score !== 85) {
  throw new Error(`expected digest_quality_score=85, got ${String(enriched[0].digest_quality_score)}`);
}
if (enriched[0].digest_url !== "/digest/2026-03-11") {
  throw new Error(`expected digest_url=/digest/2026-03-11, got ${String(enriched[0].digest_url)}`);
}
