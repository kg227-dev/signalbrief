"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/strict-quality-domain-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  evaluateDuplicateStoryline,
  evaluateFinalDigestAssembly,
  evaluateTopicItem,
  runPreRankingFilter,
} = runtime;

function makeItem(url, headline, overrides = {}) {
  return {
    url,
    headline,
    tag: "TECHNOLOGY",
    summary: "Acme repriced enterprise AI contracts for new buyers.",
    source: "Example",
    source_domain: "example.com",
    source_policy: "preferred",
    source_type: "reported_media",
    source_tier: 1,
    source_authority: 0.92,
    topic_fit: 0.9,
    published_date: "2026-03-27T10:00:00.000Z",
    freshness_key: `fresh:${headline}`,
    storyline_key: `story:${headline}`,
    baseScore: 8.4,
    strategic_value: 0.81,
    cross_source_count: 2,
    _score: 0.84,
    signal_shift: "Acme repriced AI contracts",
    implication_type: "cost",
    wim_brief: "Acme's pricing reset raises enterprise software costs this quarter.",
    wim: "Acme repriced AI contracts, which raises enterprise software costs and resets CIO budget assumptions this quarter.",
    writeup_status: "model_pass",
    writeup_attempt_count: 1,
    writeup_rejection_reasons: [],
    ...overrides,
  };
}

{
  const prefilter = runPreRankingFilter([
    makeItem("https://example.com/a", "Alpha"),
    makeItem("https://example.com/a", "Alpha duplicate"),
    makeItem("https://example.com/b", "Beta stale", { published_date: "2026-03-20T10:00:00.000Z" }),
    makeItem("https://example.com/c", "Gamma blocked", { source_hard_block: true }),
  ], {
    configDigest: {
      strict_quality: {
        freshness_hours_cap: 48,
        topic_fit_min: 0.7,
      },
    },
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });
  assert.strictEqual(prefilter.kept.length, 1);
  assert.strictEqual(prefilter.diagnostics.removed_count, 3);
}

{
  const accepted = [makeItem("https://example.com/original", "Original", {
    freshness_key: "shared-freshness",
    storyline_key: "shared-story",
    entity_keys: ["Acme"],
    event_markers: ["pricing-reset"],
  })];
  const exactDup = evaluateDuplicateStoryline(makeItem("https://example.com/original", "Original 2"), accepted);
  assert.strictEqual(exactDup.pass, false);
  assert.strictEqual(exactDup.reason, "exact_duplicate_url");

  const sameStory = evaluateDuplicateStoryline(makeItem("https://example.com/new-angle", "Same story", {
    freshness_key: "other-freshness",
    storyline_key: "shared-story",
    signal_shift: "Acme repriced AI contracts",
    entity_keys: ["Acme"],
    event_markers: ["pricing-reset"],
  }), accepted);
  assert.strictEqual(sameStory.pass, false);
  assert.strictEqual(sameStory.reason, "same_story_no_new_angle");

  const followUp = evaluateDuplicateStoryline(makeItem("https://example.com/follow-up", "Follow-up", {
    freshness_key: "other-freshness",
    storyline_key: "shared-story",
    signal_shift: "Acme expanded reseller pricing",
    entity_keys: ["Acme", "Channel"],
    event_markers: ["channel-expansion"],
  }), accepted);
  assert.strictEqual(followUp.pass, true);
  assert.strictEqual(followUp.follow_up_allowed, true);
}

{
  const tier3ThinPool = evaluateTopicItem(makeItem("https://example.com/tier3", "Tier 3 thin pool", {
    source_tier: 3,
    source_policy: "allowed",
    source_authority: 0.55,
  }), {
    configDigest: {
      strict_quality: {
        topic_fit_min: 0.7,
        max_exceptions_per_digest: 1,
        allow_tier3_in_thin_pool: true,
      },
    },
    acceptedItems: [],
    remainingExceptions: 1,
    topicCandidateCount: 6,
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });
  assert.strictEqual(tier3ThinPool.pass, true);
  assert.strictEqual(tier3ThinPool.exception_used, true);

  const weakSource = evaluateTopicItem(makeItem("https://example.com/weak", "Weak source", {
    source_type: "corporate_pr",
    source_policy: "limited",
    source_tier: 3,
    source_authority: 0.2,
  }), {
    configDigest: {
      strict_quality: {
        topic_fit_min: 0.7,
      },
    },
    acceptedItems: [],
    remainingExceptions: 1,
    topicCandidateCount: 6,
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });
  assert.strictEqual(weakSource.pass, false);
  assert.strictEqual(weakSource.rejected_rule, "source_quality");
}

{
  const assembly = evaluateFinalDigestAssembly({
    TECHNOLOGY: [makeItem("https://example.com/tech", "Technology lead", {
      storyline_key: "shared-story",
      freshness_key: "shared-story:1",
    })],
    ENERGY: [makeItem("https://example.com/energy", "Energy overlap", {
      tag: "ENERGY",
      storyline_key: "shared-story",
      freshness_key: "shared-story:1",
      _score: 0.79,
      strategic_value: 0.78,
      baseScore: 8.1,
    })],
  }, {
    configDigest: {
      strict_quality: {
        enabled: true,
        max_exceptions_per_digest: 1,
        ship_ready: {
          extreme_underfill_item_count: 1,
        },
      },
    },
    subscribedTopics: ["TECHNOLOGY", "ENERGY"],
    maxItemsPerSourceDomain: 2,
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });

  assert.strictEqual(assembly.delivery_eligible, true);
  assert.strictEqual(assembly.items.length, 1);
  assert.strictEqual(assembly.surviving_topic_bucket_count, 1);
  assert.strictEqual(assembly.extreme_underfill, true);
  assert.strictEqual(assembly.blocked_topics.length, 1);
  assert.strictEqual(assembly.blocked_topics[0].tag, "ENERGY");
}
