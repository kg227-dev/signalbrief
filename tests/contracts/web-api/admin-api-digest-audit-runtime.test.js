"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin/admin-api-digest-audit-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { buildDiagnosisWindow } = require(TARGET_PATH);

function makeCandidate(url, sourceTier, selected) {
  return {
    url,
    source_tier: sourceTier,
    selected,
  };
}

function makeDoc({ date, rootCause, dropShare, strongAttempted, strongDropped, selectedCandidates }) {
  return {
    date_et: date,
    summary: {
      writeup: {
        dropped_share_pct: dropShare,
        strong_tier_attempted_count: strongAttempted,
        strong_tier_drop_count: strongDropped,
      },
    },
    topics: {
      TECHNOLOGY: {
        candidates: selectedCandidates,
      },
    },
    runDiagnosis: {
      primaryRootCause: rootCause,
    },
  };
}

const windowSummary = buildDiagnosisWindow([
  makeDoc({
    date: "2026-04-05",
    rootCause: "validator_over_reject",
    dropShare: 18,
    strongAttempted: 4,
    strongDropped: 0,
    selectedCandidates: [
      makeCandidate("https://example.com/a", 1, true),
      makeCandidate("https://example.com/b", 2, true),
      makeCandidate("https://example.com/c", 3, true),
      makeCandidate("https://example.com/d", 1, true),
    ],
  }),
  makeDoc({
    date: "2026-04-06",
    rootCause: "validator_over_reject",
    dropShare: 17,
    strongAttempted: 5,
    strongDropped: 1,
    selectedCandidates: [
      makeCandidate("https://example.com/e", 1, true),
      makeCandidate("https://example.com/f", 2, true),
      makeCandidate("https://example.com/g", 2, true),
      makeCandidate("https://example.com/h", 3, true),
    ],
  }),
  makeDoc({
    date: "2026-04-07",
    rootCause: "selection_ranking_failure",
    dropShare: 19,
    strongAttempted: 4,
    strongDropped: 0,
    selectedCandidates: [
      makeCandidate("https://example.com/i", 1, true),
      makeCandidate("https://example.com/j", 2, true),
      makeCandidate("https://example.com/k", 2, true),
      makeCandidate("https://example.com/l", 2, true),
    ],
  }),
], "2026-04-07");

assert.strictEqual(windowSummary.days_covered, 3, "should include up to the requested date");
assert.strictEqual(windowSummary.latest_primary_root_cause, "selection_ranking_failure");
assert.strictEqual(windowSummary.primary_issue_distribution[0].issueCode, "validator_over_reject");
assert.strictEqual(windowSummary.primary_issue_distribution[0].share_pct, 66.67);
assert.strictEqual(windowSummary.average_writeup_drop_share_pct, 18);
assert.strictEqual(windowSummary.average_strong_tier_drop_rate_pct, 6.67);
assert.strictEqual(windowSummary.average_trusted_share_pct, 83.33);
assert.strictEqual(windowSummary.latest_trusted_share_pct, 100);
assert.strictEqual(windowSummary.trusted_share_delta_pct, 16.67);
assert.strictEqual(windowSummary.observability_only, true, "mixed window should remain observability only");

const decisionReadyWindow = buildDiagnosisWindow([
  makeDoc({
    date: "2026-04-08",
    rootCause: "validator_over_reject",
    dropShare: 19,
    strongAttempted: 5,
    strongDropped: 0,
    selectedCandidates: [
      makeCandidate("https://example.com/m", 1, true),
      makeCandidate("https://example.com/n", 2, true),
      makeCandidate("https://example.com/o", 2, true),
      makeCandidate("https://example.com/p", 2, true),
    ],
  }),
  makeDoc({
    date: "2026-04-09",
    rootCause: "validator_over_reject",
    dropShare: 18,
    strongAttempted: 4,
    strongDropped: 0,
    selectedCandidates: [
      makeCandidate("https://example.com/q", 1, true),
      makeCandidate("https://example.com/r", 1, true),
      makeCandidate("https://example.com/s", 2, true),
      makeCandidate("https://example.com/t", 2, true),
    ],
  }),
  makeDoc({
    date: "2026-04-10",
    rootCause: "validator_over_reject",
    dropShare: 20,
    strongAttempted: 5,
    strongDropped: 0,
    selectedCandidates: [
      makeCandidate("https://example.com/u", 1, true),
      makeCandidate("https://example.com/v", 2, true),
      makeCandidate("https://example.com/w", 2, true),
      makeCandidate("https://example.com/x", 1, true),
    ],
  }),
], "2026-04-10");

assert.strictEqual(decisionReadyWindow.observability_only, false, "three consecutive healthy runs should unlock decision layer");
assert.strictEqual(decisionReadyWindow.decision_layer_active, true);
