"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/topic-domain-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { applyTopicRelevanceScores, buildCustomTopicQueries } = runtime;

const [preferredWinner, weakLoser, blockedPreferred] = applyTopicRelevanceScores([
  {
    tag: "TECHNOLOGY",
    headline: "Preferred reporting wins on close substitute",
    summary: "Summary",
    source_domain: "reuters.com",
    source_policy: "allowed",
    source_policy_effects: { score_multiplier: 1, requires_corroboration: false },
    preferred_source_strength: 0.74,
    topic_fit: 0.65,
    topic_fit_band: "medium",
    source_authority: 0.75,
    originality_signal: 0.9,
    strategic_value: 0.7,
    baseScore: 7.4,
  },
  {
    tag: "TECHNOLOGY",
    headline: "Weak rewrite loses on close substitute",
    summary: "Summary",
    source_domain: "financialcontent.com",
    source_policy: "review",
    source_policy_effects: { score_multiplier: 0.76, requires_corroboration: true },
    preferred_source_strength: 0,
    preferred_source_available_in_search: true,
    derivative_competitive_penalty: 0.22,
    source_identity_ambiguous: true,
    topic_fit: 0.1,
    topic_fit_band: "low",
    source_authority: 0.22,
    originality_signal: 0.2,
    strategic_value: 0.72,
    baseScore: 7.8,
  },
  {
    tag: "TECHNOLOGY",
    headline: "Blocked preferred source cannot be rescued",
    summary: "Summary",
    source_domain: "blocked.example.com",
    source_policy: "blocked",
    source_policy_effects: { score_multiplier: 0, requires_corroboration: true },
    preferred_source_strength: 0.9,
    topic_fit: 1,
    topic_fit_band: "high",
    source_authority: 0.95,
    originality_signal: 1,
    strategic_value: 0.9,
    baseScore: 9.5,
  },
], ["TECHNOLOGY"], {});

assert.ok(preferredWinner.relevanceScore > weakLoser.relevanceScore);
assert.ok(preferredWinner.score_breakdown.preferred_source_boost > 0);
assert.strictEqual(weakLoser.score_breakdown.preferred_source_boost, 0);
assert.ok(weakLoser.score_breakdown.preferred_source_available_penalty > 0);
assert.ok(weakLoser.score_breakdown.derivative_content_penalty > 0);
assert.ok(weakLoser.score_breakdown.platform_ambiguity_penalty > 0);
assert.strictEqual(blockedPreferred.score_breakdown.preferred_source_boost, 0);
assert.strictEqual(blockedPreferred.relevanceScore, 0);

const nvidiaQueries = buildCustomTopicQueries("Nvidia");
assert.ok(nvidiaQueries.every((query) => !String(query).includes("72 hours")));
assert.ok(nvidiaQueries.some((query) => String(query).toLowerCase().includes("48 hours")));
assert.ok(nvidiaQueries.some((query) => String(query).toLowerCase().includes("blackwell")));

const cbamQueries = buildCustomTopicQueries("CBAM");
assert.ok(cbamQueries.some((query) => String(query).toLowerCase().includes("importer reporting")));
assert.ok(cbamQueries.some((query) => String(query).toLowerCase().includes("carbon border levy")));

const rateCutQueries = buildCustomTopicQueries("rate cuts");
assert.ok(rateCutQueries.some((query) => String(query).toLowerCase().includes("fomc")));
assert.ok(rateCutQueries.some((query) => String(query).toLowerCase().includes("leveraged finance")));

const semicapQueries = buildCustomTopicQueries("semicap");
assert.ok(semicapQueries.some((query) => String(query).toLowerCase().includes("lam research")));
assert.ok(semicapQueries.some((query) => String(query).toLowerCase().includes("wfe")));
assert.ok(semicapQueries.some((query) => String(query).toLowerCase().includes("lithography")));
