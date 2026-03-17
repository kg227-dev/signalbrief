"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/storyline-domain-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildStorylineCandidates,
  applyStrategicQualityGate,
  classifySourceTier,
  classifySourceType,
  computeOriginalitySignal,
  computeTopicDomainFit,
  detectLocalContentFlags,
  normalizeSourceDomain,
} = runtime;

assert.strictEqual(typeof buildStorylineCandidates, "function");

const pfizerItems = [
  {
    tag: "PFIZER",
    headline: "Pfizer Fast-Tracks Obesity Programs in Race Against Patent Cliff",
    summary: "Pfizer accelerated a lead obesity asset into Phase III to offset looming patent cliff losses.",
    wim: "The move brings Pfizer's obesity pipeline forward and sharpens the post-Covid repositioning story.",
    source: "BioSpace",
    source_domain: "biospace.com",
    baseScore: 9.2,
    strategic_value: 0.88,
  },
  {
    tag: "PFIZER",
    headline: "J.P. Morgan 2026: Pfizer's Pivot from Covid to Pipeline Execution",
    summary: "Pfizer is shifting from Covid volatility toward pipeline execution and acquisitions.",
    wim: "Management is framing obesity and oncology as the path through the patent cliff.",
    source: "Pharm Exec",
    source_domain: "pharmexec.com",
    baseScore: 9.0,
    strategic_value: 0.85,
  },
  {
    tag: "PFIZER",
    headline: "Pfizer declares $0.43 quarterly dividend payable in March 2026",
    summary: "Pfizer announced its next quarterly dividend payable to shareholders of record.",
    wim: "This is a routine capital-return announcement with limited strategic value.",
    source: "Investing",
    source_domain: "ng.investing.com",
    baseScore: 4.2,
    strategic_value: 0.12,
  },
];

const storylineCandidates = buildStorylineCandidates(pfizerItems);
assert.strictEqual(storylineCandidates.length, 2, "pipeline/patent-cliff coverage should cluster into one storyline");

const retained = applyStrategicQualityGate(storylineCandidates, {
  minStrategicValue: 0.34,
  maxRoutineScore: 0.74,
  minKeep: 1,
});
assert.strictEqual(retained.length, 1, "routine dividend coverage should be filtered by the strategic gate");
assert.ok(String(retained[0].headline || "").toLowerCase().includes("pfizer"));
assert.ok((retained[0].cross_source_count || 0) >= 2, "clustered storyline should retain cross-source evidence");

const flags = detectLocalContentFlags(pfizerItems[2]);
assert.ok(flags.includes("routine_dividend"));

const corporateTier = classifySourceTier("pfizer.com");
assert.strictEqual(corporateTier.source_tier, "corporate");
assert.ok(corporateTier.source_authority < 0.5);

// ── Source tier expansion: Industry Dive publications are "strong" ──
{
  const cio = classifySourceTier("ciodive.com");
  assert.strictEqual(cio.source_tier, "strong", "ciodive.com should be classified as strong");
  assert.ok(cio.source_authority >= 0.8, "ciodive.com should have strong-tier authority");

  const supply = classifySourceTier("supplychaindive.com");
  assert.strictEqual(supply.source_tier, "strong");
}

// ── Suspect domain detection ──
{
  const suspect = classifySourceTier("cloudcomputing-news.net");
  assert.strictEqual(suspect.source_tier, "suspect", "cloudcomputing-news.net should be suspect (SEO compound name + .net)");
  assert.ok(suspect.source_authority <= 0.15, `suspect authority should be <= 0.15, got ${suspect.source_authority}`);
}

// ── Unknown baseline lowered to 0.30 ──
{
  const unknown = classifySourceTier("examplepublication.com");
  assert.strictEqual(unknown.source_tier, "unknown", `expected unknown, got ${unknown.source_tier}`);
  assert.strictEqual(unknown.source_authority, 0.30, "unknown baseline should be 0.30");
}

// ── Topic-domain fit: statnews strong for healthcare, base for tech ──
{
  const healthcareFit = classifySourceTier("statnews.com", "HEALTHCARE");
  assert.ok(healthcareFit.source_authority >= 0.85, `statnews + HEALTHCARE should override to >= 0.85, got ${healthcareFit.source_authority}`);
  assert.ok(healthcareFit.topic_fit > 0, "topic_fit should be positive for matching override");

  const techFit = classifySourceTier("statnews.com", "TECHNOLOGY");
  assert.strictEqual(techFit.source_authority, 0.8, "statnews + TECHNOLOGY should use base strong tier (0.8)");
  assert.strictEqual(techFit.topic_fit, 0, "topic_fit should be 0 for non-matching topic");
}

// ── Subdomain normalization: ng.investing.com → investing.com ──
{
  const ngInvesting = classifySourceTier("ng.investing.com");
  const baseInvesting = classifySourceTier("investing.com");
  assert.strictEqual(ngInvesting.source_tier, baseInvesting.source_tier,
    "ng.investing.com and investing.com should have the same tier");
  assert.strictEqual(ngInvesting.source_authority, baseInvesting.source_authority,
    "ng.investing.com and investing.com should have the same authority");
}

// ── normalizeSourceDomain strips common prefixes ──
{
  assert.strictEqual(normalizeSourceDomain("www.reuters.com"), "reuters.com");
  assert.strictEqual(normalizeSourceDomain("ng.investing.com"), "investing.com");
  assert.strictEqual(normalizeSourceDomain("m.cnbc.com"), "cnbc.com");
  assert.strictEqual(normalizeSourceDomain("amp.ft.com"), "ft.com");
}

// ── Source type classification ──
{
  assert.strictEqual(classifySourceType("reuters.com"), "top_tier");
  assert.strictEqual(classifySourceType("businesswire.com"), "wire");
  assert.strictEqual(classifySourceType("sec.gov"), "primary");
  assert.strictEqual(classifySourceType("investing.com"), "aggregator");
  assert.strictEqual(classifySourceType("ng.investing.com"), "aggregator", "subdomain should normalize for source type");
  assert.strictEqual(classifySourceType("random-blog.blog"), "blog");
  assert.strictEqual(classifySourceType("totally-random.com"), "unknown");
}

// ── Originality signal: top-tier > aggregator with generic headline ──
{
  const reutersItem = { headline: "FDA Approves New Cancer Treatment for Rare Lymphoma" };
  const reutersInfo = { source_type: "top_tier", source_tier: "premium" };
  const reutersOriginality = computeOriginalitySignal(reutersItem, reutersInfo);

  const aggregatorItem = { headline: "AI demand pushes companies to invest billions in cloud infrastructure" };
  const aggregatorInfo = { source_type: "aggregator", source_tier: "weak" };
  const aggregatorOriginality = computeOriginalitySignal(aggregatorItem, aggregatorInfo);

  assert.ok(reutersOriginality > aggregatorOriginality,
    `reuters originality (${reutersOriginality}) should beat aggregator (${aggregatorOriginality})`);
  assert.ok(reutersOriginality >= 0.9, "top-tier with non-derivative headline should score >= 0.9");
  assert.ok(aggregatorOriginality <= 0.25, "aggregator with derivative headline should score <= 0.25");
}

// ── chooseRepresentative prefers authority over raw baseScore ──
{
  const clusterItems = [
    {
      tag: "TECHNOLOGY",
      headline: "AI demand pushes companies to invest billions in cloud infrastructure",
      summary: "Tech firms expected to spend $650B on AI cloud.",
      source_domain: "cloudcomputing-news.net",
      baseScore: 8.5,
      strategic_value: 0.82,
      source_authority: 0.15,
      originality_signal: 0.2,
      routine_item_score: 0,
    },
    {
      tag: "TECHNOLOGY",
      headline: "Hyperscaler AI capex hits $650B as cloud giants race",
      summary: "AWS, Azure, Google invest heavily in AI infrastructure.",
      source_domain: "reuters.com",
      baseScore: 7.8,
      strategic_value: 0.80,
      source_authority: 0.95,
      originality_signal: 1.0,
      routine_item_score: 0,
    },
  ];
  const candidates = buildStorylineCandidates(clusterItems);
  // Items may or may not cluster — if they do, reuters should be representative
  // If they don't cluster, both should surface but reuters should score higher
  const reutersCandidate = candidates.find((c) => c.source_domain === "reuters.com");
  const suspectCandidate = candidates.find((c) => c.source_domain === "cloudcomputing-news.net");
  if (candidates.length === 1) {
    // Clustered: reuters should be the representative
    assert.strictEqual(candidates[0].source_domain, "reuters.com",
      "reuters should be chosen as representative over cloudcomputing-news.net");
  } else if (reutersCandidate && suspectCandidate) {
    // Not clustered: reuters authority should be higher
    assert.ok(reutersCandidate.source_authority > suspectCandidate.source_authority);
  }
}

// ── Topic-domain fit function directly ──
{
  const fit = computeTopicDomainFit("esgtoday.com", "SUSTAINABILITY");
  assert.ok(fit.overrideScore >= 0.88, "esgtoday + SUSTAINABILITY should have high override");
  assert.strictEqual(fit.topicFit, 1.0, "direct match should give topicFit 1.0");

  const noFit = computeTopicDomainFit("esgtoday.com", "TECHNOLOGY");
  assert.strictEqual(noFit.topicFit, 0, "esgtoday + TECHNOLOGY should have no topic fit");

  const noOverride = computeTopicDomainFit("random.com", "HEALTHCARE");
  assert.strictEqual(noOverride.overrideScore, null);
  assert.strictEqual(noOverride.topicFit, 0);
}

// ── Wire services classified as corporate tier ──
{
  const gn = classifySourceTier("globenewswire.com");
  assert.strictEqual(gn.source_tier, "corporate");
  assert.strictEqual(classifySourceType("globenewswire.com"), "wire");
}

// ── Premium tier additions ──
{
  assert.strictEqual(classifySourceTier("apnews.com").source_tier, "premium");
  assert.strictEqual(classifySourceTier("washingtonpost.com").source_tier, "premium");
  assert.strictEqual(classifySourceTier("bbc.com").source_tier, "premium");
}

// ── Weak tier additions ──
{
  assert.strictEqual(classifySourceTier("benzinga.com").source_tier, "weak");
  assert.strictEqual(classifySourceTier("fool.com").source_tier, "weak");
  assert.strictEqual(classifySourceTier("substack.com").source_tier, "weak");
}
