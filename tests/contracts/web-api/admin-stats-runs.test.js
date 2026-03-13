"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-stats-runs.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const {
  enrichRunsWithDigestMetadata,
  expandRunsByRecipient,
} = require(TARGET_PATH);

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
if (enriched[0].digest_url !== "/digest/2026-03-11?run=scheduled%3A2026-03-11T15-00-00-120Z") {
  throw new Error(`expected run-scoped digest_url, got ${String(enriched[0].digest_url)}`);
}

const expanded = expandRunsByRecipient(sampleRuns);
if (!Array.isArray(expanded) || expanded.length !== 2) {
  throw new Error(`expected two expanded per-user rows, got ${Array.isArray(expanded) ? expanded.length : "non-array"}`);
}
if (expanded[0].users_served !== 1 || expanded[1].users_served !== 1) {
  throw new Error("expected expanded rows to normalize users_served=1");
}
if (expanded[0].per_user?.[0]?.id !== "alpha@example.com" || expanded[1].per_user?.[0]?.id !== "beta@example.com") {
  throw new Error("expected expanded rows to keep per-user ordering");
}

const expandedTokens = new Map([
  ["alpha@example.com", "token-alpha"],
  ["beta@example.com", "token-beta"],
]);
const enrichedExpanded = enrichRunsWithDigestMetadata(expanded, sampleEvents, {
  recipientTokenById: expandedTokens,
});
if (enrichedExpanded[0].digest_quality_score !== 90.2) {
  throw new Error(`expected alpha digest_quality_score=90.2, got ${String(enrichedExpanded[0].digest_quality_score)}`);
}
if (enrichedExpanded[1].digest_quality_score !== 79.8) {
  throw new Error(`expected beta digest_quality_score=79.8, got ${String(enrichedExpanded[1].digest_quality_score)}`);
}
if (enrichedExpanded[0].digest_url !== "/digest/2026-03-11?run=scheduled%3A2026-03-11T15-00-00-120Z&ref=token-alpha") {
  throw new Error(`expected alpha run+ref digest_url, got ${String(enrichedExpanded[0].digest_url)}`);
}
if (enrichedExpanded[1].digest_url !== "/digest/2026-03-11?run=scheduled%3A2026-03-11T15-00-00-120Z&ref=token-beta") {
  throw new Error(`expected beta run+ref digest_url, got ${String(enrichedExpanded[1].digest_url)}`);
}

const singleRun = [
  {
    date: "2026-03-11",
    run_at: "2026-03-11T23:09:31.148Z",
    run_at_et: "Mar 11, 7:09 PM",
    on_demand: true,
    users_served: 1,
    per_user: [{ id: "alpha@example.com" }],
  },
];
const singleEvents = [
  {
    event_type: "digest_sent",
    run_id: "targeted:2026-03-11T23-09-31-056Z",
    user_email: "alpha@example.com",
    digest_id: "2026-03-11:email-alpha",
    metadata: { quality_score: 88.03 },
  },
];
const recipientTokenById = new Map([["alpha@example.com", "token-alpha"]]);
const enrichedSingle = enrichRunsWithDigestMetadata(singleRun, singleEvents, { recipientTokenById });
if (enrichedSingle[0].digest_quality_score !== 88) {
  throw new Error(`expected digest_quality_score=88, got ${String(enrichedSingle[0].digest_quality_score)}`);
}
if (enrichedSingle[0].digest_url !== "/digest/2026-03-11?ref=token-alpha") {
  throw new Error(`expected token-scoped digest_url, got ${String(enrichedSingle[0].digest_url)}`);
}
