"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-source-registry-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const {
  setAdminSourceRegistry,
} = require(path.join(process.cwd(), "src/digest/domain/storyline-domain-runtime.js"));

const {
  buildRecentDomainMetrics,
  buildSourceRegistryDomainDetail,
  buildSourceRegistryOverview,
} = runtime;

(() => {
  const rows = [
    {
      user_email: "alpha@example.com",
      recipient: "alpha@example.com",
      digest_id: "2026-03-20:alpha",
      run_at_utc: "2026-03-20T11:00:00.000Z",
      quality_score: 61,
      dominant_failure_mode: "weak_source",
      sent_items: [
        {
          source_domain: "benzinga.com",
          source_tier: "weak",
          source_authority: 0.22,
          routine_item_score: 0.4,
          tag: "TECHNOLOGY",
          headline: "Benzinga item",
          url: "https://benzinga.com/story-1",
        },
      ],
    },
    {
      user_email: "beta@example.com",
      recipient: "beta@example.com",
      digest_id: "2026-03-19:beta",
      run_at_utc: "2026-03-19T11:00:00.000Z",
      quality_score: 72,
      dominant_failure_mode: "unknown",
      sent_items: [
        {
          source_domain: "benzinga.com",
          source_tier: "weak",
          source_authority: 0.22,
          routine_item_score: 0.2,
          tag: "AI TECH",
          headline: "Second Benzinga item",
          url: "https://benzinga.com/story-2",
        },
        {
          source_domain: "reuters.com",
          source_tier: "premium",
          source_authority: 0.95,
          routine_item_score: 0.1,
          tag: "TECHNOLOGY",
          headline: "Reuters item",
          url: "https://reuters.com/story-1",
        },
      ],
    },
  ];

  const metrics = buildRecentDomainMetrics(rows);
  const benzinga = metrics.get("benzinga.com");
  assert.ok(benzinga);
  assert.strictEqual(benzinga.send_count, 2);
  assert.strictEqual(benzinga.user_count, 2);
  assert.strictEqual(benzinga.weak_source_item_count, 2);
  assert.strictEqual(benzinga.poor_digest_item_count, 1);

  const registry = {
    version: 1,
    updated_at: "2026-03-20T12:00:00.000Z",
    domains: {
      "benzinga.com": {
        domain: "benzinga.com",
        tier_override: "suspect",
        authority_override: 0.12,
        hard_block: true,
        note: "Too noisy",
        updated_at: "2026-03-20T12:00:00.000Z",
        updated_by: "admin@example.com",
      },
    },
  };

  const overview = buildSourceRegistryOverview({
    loadSourceRegistry: () => registry,
    buildSourceRegistryMap: (value) => new Map(Object.entries(value.domains || {})),
    setAdminSourceRegistry,
    buildRecentDigestsExport: () => ({ rows }),
    query: "benzinga",
    limit: 10,
  });
  assert.strictEqual(overview.override_count, 1);
  assert.strictEqual(overview.suggestions.length, 1);
  assert.strictEqual(overview.suggestions[0].domain, "benzinga.com");
  assert.strictEqual(overview.suggestions[0].effective_policy.hard_block, true);

  const detail = buildSourceRegistryDomainDetail({
    domain: "benzinga.com",
    loadSourceRegistry: () => registry,
    buildSourceRegistryMap: (value) => new Map(Object.entries(value.domains || {})),
    setAdminSourceRegistry,
    buildRecentDigestsExport: () => ({ rows }),
    readJsonLineLog: () => [{
      at: "2026-03-20T12:00:00.000Z",
      actor: "admin@example.com",
      action: "source_policy_upsert",
      success: true,
      details: { domain: "benzinga.com", note: "Too noisy" },
    }],
    adminActionLog: "/tmp/admin-action-log.json",
  });
  assert.ok(detail);
  assert.strictEqual(detail.domain, "benzinga.com");
  assert.strictEqual(detail.effective_policy.hard_block, true);
  assert.strictEqual(detail.recent_metrics.send_count, 2);
  assert.strictEqual(detail.audit_entries.length, 1);
  setAdminSourceRegistry(null);
})();

process.stdout.write("[admin-source-registry-runtime] all assertions passed\n");
