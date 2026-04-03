"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-source-registry-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const STORYLINE_RUNTIME_PATH = require.resolve(path.join(process.cwd(), "src/digest/domain/storyline-domain-runtime.js"));
const METRICS_RUNTIME_PATH = require.resolve(path.join(process.cwd(), "web/services/admin-source-registry-metrics-runtime.js"));
const SUMMARY_RUNTIME_PATH = require.resolve(path.join(process.cwd(), "web/services/admin-source-registry-summary-runtime.js"));
assertNodeSyntaxFile(TARGET_PATH);
delete require.cache[TARGET_PATH];
delete require.cache[STORYLINE_RUNTIME_PATH];
delete require.cache[METRICS_RUNTIME_PATH];
delete require.cache[SUMMARY_RUNTIME_PATH];
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const {
  setAdminSourceRegistry,
} = require(STORYLINE_RUNTIME_PATH);

const {
  buildRecentDomainMetrics,
  buildSourceRegistryDomainDetail,
  buildSourceRegistryOverview,
} = runtime;

(() => {
  const recentDigestsCalls = [];
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
          winner_selection_reason: "best_available_derivative",
          selection_reason_codes: ["best_available_derivative"],
          coverage_gap_status: "preferred_missing",
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
    {
      user_email: "gamma@example.com",
      recipient: "gamma@example.com",
      digest_id: "2026-03-21:gamma",
      run_at_utc: "2026-03-21T11:00:00.000Z",
      quality_score: 84,
      dominant_failure_mode: "unknown",
      sent_items: [
        {
          source_domain: "pharmavoice.com",
          source_tier: "strong",
          source_authority: 0.81,
          routine_item_score: 0.7,
          specialist_trade_outperformed_preferred: true,
          broader_retrieval_found_better: true,
          coverage_gap_status: "preferred_weaker",
          tag: "HEALTHCARE",
          headline: "PharmaVoice item",
          url: "https://pharmavoice.com/story-1",
        },
      ],
    },
    {
      user_email: "delta@example.com",
      recipient: "delta@example.com",
      digest_id: "2026-03-21:delta",
      run_at_utc: "2026-03-21T12:00:00.000Z",
      quality_score: 76,
      dominant_failure_mode: "unknown",
      sent_items: [
        {
          source_domain: "youtube.com",
          source_tier: "unknown",
          source_authority: 0.3,
          routine_item_score: 0.25,
          source_identity_ambiguous: true,
          tag: "TECHNOLOGY",
          headline: "YouTube item",
          url: "https://youtube.com/watch?v=abc123",
        },
      ],
    },
    {
      user_email: "epsilon@example.com",
      recipient: "epsilon@example.com",
      digest_id: "2026-03-21:epsilon",
      run_at_utc: "2026-03-21T13:00:00.000Z",
      quality_score: 81,
      dominant_failure_mode: "unknown",
      sent_items: [
        {
          source_domain: "youtube.com",
          source_identity_key: "youtube:@insideboardroom",
          source_identity_scope: "platform_channel",
          source_identity_label: "@InsideBoardroom",
          source_tier: "unknown",
          source_authority: 0.3,
          source_type: "platform_user_generated",
          source_policy: "review",
          source_review_status: "monitor",
          routine_item_score: 0.55,
          tag: "TECHNOLOGY",
          headline: "InsideBoardroom clip",
          url: "https://youtube.com/@InsideBoardroom/videos",
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
    identities: {
      "youtube:@insideboardroom": {
        identity_key: "youtube:@insideboardroom",
        source_type: "reported_media",
        policy: "allowed",
        review_status: "reviewed",
        note: "Reviewed channel override",
        updated_at: "2026-03-21T12:00:00.000Z",
        updated_by: "admin@example.com",
      },
    },
  };

  const overview = buildSourceRegistryOverview({
    loadSourceRegistry: () => registry,
    loadPreferredSourceRegistry: () => ({
      version: 1,
      global: {
        reported: [],
        official: [],
      },
      standard_topic_source: {
        source_of_truth: "standard_topic_broker",
        source_mode: "runtime",
        active_path: "/tmp/standard-topic-broker-sources.json",
        runtime_path: "/tmp/standard-topic-broker-sources.json",
        bundled_path: "/tmp/bundled-standard-topic-broker-sources.json",
        topic_count: 7,
        topic_keys: ["healthcare", "technology"],
      },
      topics: {
        healthcare: {
          reported: ["statnews.com"],
          official: ["fda.gov"],
        },
      },
    }),
    inspectStandardTopicBrokerConfig: () => ({
      source_mode: "runtime",
      active_path: "/tmp/standard-topic-broker-sources.json",
      runtime_path: "/tmp/standard-topic-broker-sources.json",
      bundled_path: "/tmp/bundled-standard-topic-broker-sources.json",
      config: {
        topics: {
          HEALTHCARE: {
            enabled: true,
            lanes: { publisher_feed: true, official: true },
          },
        },
        sources: [
          {
            id: "stat_rss",
            enabled: true,
            tier: 2,
            lane: "publisher_feed",
            topic_tags: ["HEALTHCARE"],
            domains: ["statnews.com"],
            source_kind: "reported_media",
            source_family: "specialist",
            endpoint: "https://feeds.example.com/stat.xml",
          },
          {
            id: "fda_rss",
            enabled: true,
            tier: 1,
            lane: "official",
            topic_tags: ["HEALTHCARE"],
            domains: ["fda.gov"],
            source_kind: "primary_official",
            source_family: "official",
            endpoint: "https://www.fda.gov/newsroom/rss-feeds",
          },
        ],
      },
    }),
    buildSourceRegistryMap: (value) => ({
      domains: new Map(Object.entries(value.domains || {})),
      identities: new Map(Object.entries(value.identities || {})),
    }),
    setAdminSourceRegistry,
    buildRecentDigestsExport: (options) => {
      recentDigestsCalls.push(options);
      return { rows, window: { all_time: true, days: null } };
    },
    sourceRegistryPath: "/tmp/standard-topic-broker-sources.json",
    preferredSourcesPath: "/tmp/preferred-sources.json",
    query: "benzinga",
    limit: 10,
  });
  assert.strictEqual(overview.override_count, 1);
  assert.strictEqual(overview.history_scope, "all_time");
  assert.strictEqual(overview.suggestions.length, 1);
  assert.strictEqual(overview.suggestions[0].domain, "benzinga.com");
  assert.strictEqual(overview.suggestions[0].effective_policy.hard_block, true);
  assert.strictEqual(overview.preferred_sources.path, "/tmp/standard-topic-broker-sources.json");
  assert.strictEqual(overview.preferred_sources.topic_count, 1);
  assert.strictEqual(overview.preferred_sources.total_unique_domains, 2);
  assert.strictEqual(overview.preferred_sources.standard_topic_source.source_of_truth, "standard_topic_broker");
  assert.strictEqual(overview.broker_config.topic_count, 1);
  assert.strictEqual(overview.broker_config.enabled_source_count, 2);
  assert.strictEqual(overview.broker_config.topics[0].topic_key, "healthcare");
  assert.ok(Array.isArray(overview.broker_config.domains));
  assert.strictEqual(overview.broker_config.domains[0].domain, "fda.gov");
  assert.strictEqual(overview.broker_config.sources[0].id, "fda_rss");
  assert.strictEqual(overview.governance_registry.source_of_truth, "standard_topic_broker.governance");
  assert.strictEqual(overview.governance_registry.active_path, "/tmp/standard-topic-broker-sources.json");
  assert.strictEqual(overview.governance_registry.domain_count, 1);
  assert.strictEqual(overview.governance_registry.identity_count, 1);
  assert.strictEqual(overview.governance_registry.is_effectively_empty, false);
  assert.strictEqual(overview.curation_queues.specialist_candidates[0].domain, "pharmavoice.com");
  assert.strictEqual(overview.curation_queues.derivative_winners[0].domain, "benzinga.com");
  assert.strictEqual(overview.curation_queues.platform_ambiguity[0].domain, "youtube.com");
  assert.ok(
    overview.curation_queues.topic_coverage_gaps.some((entry) => entry.topic === "HEALTHCARE" && entry.broad_rescue_count === 1),
    "topic coverage queues should capture broader retrieval rescues"
  );
  assert.ok(
    overview.curation_queues.topic_coverage_gaps.some((entry) => entry.topic === "TECHNOLOGY" && entry.preferred_missing_count === 1),
    "topic coverage queues should capture preferred-missing cases"
  );
  assert.deepStrictEqual(recentDigestsCalls[0], { all_time: true });

  const detail = buildSourceRegistryDomainDetail({
    domain: "benzinga.com",
    loadSourceRegistry: () => registry,
    buildSourceRegistryMap: (value) => ({
      domains: new Map(Object.entries(value.domains || {})),
      identities: new Map(Object.entries(value.identities || {})),
    }),
    setAdminSourceRegistry,
    buildRecentDigestsExport: (options) => {
      recentDigestsCalls.push(options);
      return { rows, window: { all_time: true, days: null } };
    },
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
  assert.strictEqual(detail.history_scope, "all_time");
  assert.strictEqual(detail.effective_policy.hard_block, true);
  assert.strictEqual(detail.recent_metrics.send_count, 2);
  assert.strictEqual(detail.audit_entries.length, 1);
  assert.deepStrictEqual(recentDigestsCalls[1], { all_time: true });

  const identityDetail = buildSourceRegistryDomainDetail({
    domain: "youtube.com",
    identityKey: "youtube:@insideboardroom",
    loadSourceRegistry: () => registry,
    buildSourceRegistryMap: (value) => ({
      domains: new Map(Object.entries(value.domains || {})),
      identities: new Map(Object.entries(value.identities || {})),
    }),
    setAdminSourceRegistry,
    buildRecentDigestsExport: () => ({ rows, window: { all_time: true, days: null } }),
    readJsonLineLog: () => [{
      at: "2026-03-21T12:00:00.000Z",
      actor: "admin@example.com",
      action: "source_policy_upsert",
      success: true,
      details: {
        domain: "youtube.com",
        identity_key: "youtube:@insideboardroom",
        note: "Reviewed channel override",
      },
    }],
    adminActionLog: "/tmp/admin-action-log.json",
  });
  assert.ok(identityDetail);
  assert.strictEqual(identityDetail.domain, "youtube.com");
  assert.strictEqual(identityDetail.selected_scope, "identity");
  assert.strictEqual(identityDetail.selected_identity_key, "youtube:@insideboardroom");
  assert.strictEqual(identityDetail.recent_metrics.send_count, 1);
  assert.strictEqual(identityDetail.direct_override.identity_key, "youtube:@insideboardroom");
  assert.ok(identityDetail.identity_candidates.some((candidate) => candidate.identity_key === "youtube:@insideboardroom"));
  assert.strictEqual(identityDetail.audit_entries[0].scope, "identity");
  setAdminSourceRegistry(null);
})();

process.stdout.write("[admin-source-registry-runtime] all assertions passed\n");
