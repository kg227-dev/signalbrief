"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
  assertSourceIncludesFile,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/storyline-domain-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  'require("./storyline-domain-helpers-runtime")',
  'require("./storyline-domain-source-quality-runtime")',
]);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  annotateEditorialSignals,
  buildStorylineCandidates,
  applyStrategicQualityGate,
  classifySourceTierBaseline,
  classifySourceTier,
  classifySourceType,
  computeOriginalitySignal,
  computeTopicDomainFit,
  detectLocalContentFlags,
  explainSourcePolicy,
  normalizeSourceDomain,
  setAdminSourceRegistry,
  setPreferredSourceRegistry,
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
  assert.strictEqual(suspect.source_policy, "review");
  assert.strictEqual(suspect.review_status, "unreviewed");
}

// ── Unknown baseline shifts to unreviewed review-state ──
{
  const unknown = classifySourceTier("examplepublication.com");
  assert.strictEqual(unknown.source_tier, "unknown", `expected unknown, got ${unknown.source_tier}`);
  assert.strictEqual(unknown.source_authority, 0.42, "unknown baseline should use review-state authority");
  assert.strictEqual(unknown.source_policy, "review");
  assert.strictEqual(unknown.review_status, "unreviewed");
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
  assert.strictEqual(classifySourceType("reuters.com"), "reported_media");
  assert.strictEqual(classifySourceType("businesswire.com"), "corporate_pr");
  assert.strictEqual(classifySourceType("sec.gov"), "primary_official");
  assert.strictEqual(classifySourceType("investing.com"), "aggregator_republisher");
  assert.strictEqual(classifySourceType("ng.investing.com"), "aggregator_republisher", "subdomain should normalize for source type");
  assert.strictEqual(classifySourceType("random-blog.blog"), "analysis_blog");
  assert.strictEqual(classifySourceType("totally-random.com"), "unclassified");
  assert.strictEqual(classifySourceTier("corporate.target.com").source_type, "corporate_pr");
  assert.strictEqual(classifySourceTier("corporate.target.com").source_policy, "limited");
  assert.strictEqual(classifySourceType("signals.substack.com"), "platform_user_generated");
  assert.strictEqual(classifySourceTier("signals.substack.com").source_policy, "review");
  assert.strictEqual(classifySourceType("publication.medium.com"), "platform_user_generated");
}

// ── Originality signal: reported media > aggregator with generic headline ──
{
  const reutersItem = { headline: "FDA Approves New Cancer Treatment for Rare Lymphoma" };
  const reutersInfo = { source_type: "reported_media", source_tier: "premium", originality_profile: "original_reporting" };
  const reutersOriginality = computeOriginalitySignal(reutersItem, reutersInfo);

  const aggregatorItem = { headline: "AI demand pushes companies to invest billions in cloud infrastructure" };
  const aggregatorInfo = { source_type: "aggregator_republisher", source_tier: "weak", originality_profile: "rewrite_aggregator" };
  const aggregatorOriginality = computeOriginalitySignal(aggregatorItem, aggregatorInfo);

  assert.ok(reutersOriginality > aggregatorOriginality,
    `reuters originality (${reutersOriginality}) should beat aggregator (${aggregatorOriginality})`);
  assert.ok(reutersOriginality >= 0.85, "reported media with non-derivative headline should score >= 0.85");
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

// ── Preferred source annotations + close-substitute suppression ──
{
  setPreferredSourceRegistry({
    version: 1,
    global: {
      reported: ["reuters.com"],
      official: ["sec.gov"],
    },
    topics: {
      technology: {
        reported: ["theinformation.com"],
        official: [],
      },
    },
    aliases: {},
  });
  setAdminSourceRegistry(new Map([
    ["theinformation.com", {
      domain: "theinformation.com",
      source_type: "reported_media",
      policy: "allowed",
      review_status: "reviewed",
      authority_override: 0.42,
      note: "Preferred technology reporting",
    }],
  ]));

  const candidates = buildStorylineCandidates([
    {
      tag: "TECHNOLOGY",
      headline: "AI infrastructure boom pushes cloud spending higher",
      summary: "Enterprise AI demand is reshaping hyperscaler capex plans.",
      source_domain: "financialcontent.com",
      baseScore: 9.6,
      strategic_value: 0.94,
    },
    {
      tag: "TECHNOLOGY",
      headline: "AI infrastructure boom pushes cloud spending higher",
      summary: "Enterprises are forcing a new wave of hyperscaler AI capex.",
      source_domain: "theinformation.com",
      baseScore: 6.0,
      strategic_value: 0.32,
    },
  ]);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].source_domain, "theinformation.com");
  assert.strictEqual(candidates[0].preferred_source_match, "topic_reported");
  assert.ok(Array.isArray(candidates[0].selection_reason_codes) && candidates[0].selection_reason_codes.includes("preferred_domain_match"));

  const annotated = runtime.annotateEditorialSignals([{
    tag: "POLICY×REGULATORY",
    headline: "SEC proposes new disclosure rule for private funds",
    summary: "The proposal would widen quarterly reporting requirements.",
    source_domain: "www.sec.gov",
    baseScore: 7,
  }]);
  assert.strictEqual(annotated[0].preferred_source_match, "global_official");
  assert.strictEqual(annotated[0].preferred_source_kind, "official");

  setAdminSourceRegistry(null);
  setPreferredSourceRegistry(null);
}

// ── Publisher-level preferred identity matches without bypassing governance ──
{
  setPreferredSourceRegistry({
    version: 1,
    global: { reported: [], official: [] },
    topics: {
      technology: { reported: [], official: [] },
    },
    publishers: {
      global: { reported: [], official: [] },
      topics: {
        technology: {
          reported: ["youtube:@insideboardroom"],
          official: [],
        },
      },
    },
    aliases: {},
  });

  const annotated = annotateEditorialSignals([{
    tag: "TECHNOLOGY",
    headline: "Inside Boardroom breaks down AI infrastructure spending",
    summary: "Channel coverage explains hyperscaler capex implications.",
    url: "https://www.youtube.com/@InsideBoardroom/videos",
    source_domain: "youtube.com",
    baseScore: 6.5,
  }]);
  assert.strictEqual(annotated[0].preferred_source_match, "topic_reported");
  assert.strictEqual(annotated[0].preferred_source_match_scope, "publisher");
  assert.strictEqual(annotated[0].preferred_source_identity_key, "youtube:@insideboardroom");
  assert.strictEqual(annotated[0].source_identity_ambiguous, false);
  assert.strictEqual(annotated[0].source_policy, "review", "publisher preferred match must not rescue platform governance");
  setPreferredSourceRegistry(null);
}

// ── Derivative wrappers lose to better story representations ──
{
  setPreferredSourceRegistry({
    version: 1,
    global: { reported: ["reuters.com"], official: [] },
    topics: {},
    aliases: {},
  });
  const candidates = buildStorylineCandidates([
    {
      tag: "TECHNOLOGY",
      headline: "AI infrastructure boom pushes cloud spending higher",
      summary: "Enterprise AI demand is driving a new hyperscaler capex cycle.",
      source_domain: "financialcontent.com",
      baseScore: 8.9,
      strategic_value: 0.84,
    },
    {
      tag: "TECHNOLOGY",
      headline: "AI infrastructure boom pushes cloud spending higher",
      summary: "Reuters reports hyperscalers are accelerating AI capex plans.",
      source_domain: "reuters.com",
      baseScore: 7.4,
      strategic_value: 0.78,
    },
  ]);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].source_domain, "reuters.com");
  assert.ok(Number(candidates[0].cluster_derivative_suppressed_count || 0) >= 1);
  assert.ok(Array.isArray(candidates[0].selection_reason_codes) && candidates[0].selection_reason_codes.includes("best_source_representation"));
  setPreferredSourceRegistry(null);
}

// ── Event fingerprinting clusters paraphrased versions of the same regulatory story ──
{
  setPreferredSourceRegistry({
    version: 1,
    global: { reported: ["reuters.com"], official: [] },
    topics: {},
    aliases: {},
  });
  const candidates = buildStorylineCandidates([
    {
      tag: "POLICY×REGULATORY",
      headline: "FTC proposes new AI merger disclosure rule for private funds in 2026",
      summary: "Reuters says the proposal would expand reporting requirements for private fund managers in 2026.",
      source_domain: "reuters.com",
      baseScore: 7.4,
      strategic_value: 0.76,
    },
    {
      tag: "POLICY×REGULATORY",
      headline: "Private funds face fresh AI merger disclosure mandate under FTC proposal for 2026",
      summary: "A weaker rewrite says managers could face broader 2026 reporting duties.",
      source_domain: "benzinga.com",
      baseScore: 8.0,
      strategic_value: 0.81,
    },
  ]);
  assert.strictEqual(candidates.length, 1, "paraphrased coverage of the same FTC proposal should cluster");
  assert.strictEqual(candidates[0].source_domain, "reuters.com");
  assert.ok(String(candidates[0].event_fingerprint || "").includes("year:2026"));
  assert.ok(Array.isArray(candidates[0].selection_reason_codes) && candidates[0].selection_reason_codes.includes("canonical_event_match"));
  assert.ok(Number(candidates[0].cluster_derivative_suppressed_count || 0) >= 1);
  setPreferredSourceRegistry(null);
}

// ── Event fingerprinting should not collapse distinct events from the same company ──
{
  const candidates = buildStorylineCandidates([
    {
      tag: "PFIZER",
      headline: "Pfizer acquires oncology platform company in $11 billion deal",
      summary: "The acquisition expands Pfizer's cancer pipeline.",
      source_domain: "reuters.com",
      baseScore: 7.8,
      strategic_value: 0.79,
    },
    {
      tag: "PFIZER",
      headline: "Pfizer names new chief financial officer after finance leadership reshuffle",
      summary: "The company announced a new CFO appointment following a broader finance reorganization.",
      source_domain: "reuters.com",
      baseScore: 6.9,
      strategic_value: 0.62,
    },
  ]);
  assert.strictEqual(candidates.length, 2, "different Pfizer events should not cluster just because the entity matches");
}

// ── Specialist trade can beat a global preferred generalist on topic fit ──
{
  setPreferredSourceRegistry({
    version: 1,
    global: { reported: ["reuters.com"], official: [] },
    topics: {},
    aliases: {},
  });
  const candidates = buildStorylineCandidates([
    {
      tag: "HEALTHCARE",
      headline: "FDA approves new obesity therapy for adults",
      summary: "Reuters says the approval expands a fast-growing market.",
      source_domain: "reuters.com",
      baseScore: 7.4,
      strategic_value: 0.74,
    },
    {
      tag: "HEALTHCARE",
      headline: "FDA approves new obesity therapy for adults",
      summary: "STAT explains the clinical and market implications of the approval.",
      source_domain: "statnews.com",
      baseScore: 7.1,
      strategic_value: 0.75,
    },
  ]);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].source_domain, "statnews.com");
  assert.strictEqual(candidates[0].specialist_trade_outperformed_preferred, true);
  assert.strictEqual(candidates[0].coverage_gap_status, "preferred_exists_but_weaker");
  assert.strictEqual(candidates[0].winner_selection_reason, "specialist_trade_best_fit");
  setPreferredSourceRegistry(null);
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
  assert.strictEqual(classifySourceType("globenewswire.com"), "corporate_pr");
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

// ── Admin registry overrides beat baseline / learned logic ──
{
  setAdminSourceRegistry(new Map([
    ["benzinga.com", {
      domain: "benzinga.com",
      tier_override: "premium",
      authority_override: 0.99,
      hard_block: false,
      note: "Reviewed manually",
    }],
  ]));
  const baseline = classifySourceTierBaseline("benzinga.com");
  const effective = explainSourcePolicy("benzinga.com");
  assert.strictEqual(baseline.source_tier, "weak");
  assert.strictEqual(effective.source_tier, "premium");
  assert.strictEqual(effective.source_authority, 0.99);
  assert.strictEqual(effective.policy_source, "admin_override");
  setAdminSourceRegistry(null);
}

// ── Null authority override should not zero out governance-derived authority ──
{
  setAdminSourceRegistry(new Map([
    ["pharmavoice.com", {
      domain: "pharmavoice.com",
      source_type: "trade_specialist",
      policy: "preferred",
      review_status: "reviewed",
      authority_override: null,
      note: "Governance-only override",
    }],
  ]));
  const effective = explainSourcePolicy("pharmavoice.com", "HEALTHCARE");
  assert.strictEqual(effective.source_type, "trade_specialist");
  assert.strictEqual(effective.source_policy, "preferred");
  assert.ok(effective.source_authority > 0.7, `expected governance-derived authority > 0.7, got ${effective.source_authority}`);
  assert.strictEqual(effective.admin_override.authority_override, null);
  setAdminSourceRegistry(null);
}

// ── Root-domain governance inherits to subdomains, with most-specific match winning ──
{
  setAdminSourceRegistry(new Map([
    ["target.com", {
      domain: "target.com",
      source_type: "corporate_pr",
      policy: "limited",
      review_status: "reviewed",
      note: "Root family policy",
    }],
    ["research.target.com", {
      domain: "research.target.com",
      source_type: "reported_media",
      policy: "allowed",
      review_status: "reviewed",
      note: "Research newsroom override",
    }],
  ]));
  const inherited = explainSourcePolicy("corporate.target.com");
  assert.strictEqual(inherited.source_type, "corporate_pr");
  assert.strictEqual(inherited.source_policy, "limited");
  assert.strictEqual(inherited.inherits_from_domain, "target.com");

  const specific = explainSourcePolicy("research.target.com");
  assert.strictEqual(specific.source_type, "reported_media");
  assert.strictEqual(specific.source_policy, "allowed");
  assert.strictEqual(specific.inherits_from_domain, null);
  assert.strictEqual(specific.admin_override.match_domain, "research.target.com");
  setAdminSourceRegistry(null);
}

// ── Identity-level governance overrides can outrank restrictive platform-domain defaults ──
{
  setAdminSourceRegistry({
    domains: new Map([
      ["youtube.com", {
        domain: "youtube.com",
        source_type: "platform_user_generated",
        policy: "review",
        review_status: "monitor",
        note: "Platform default",
      }],
    ]),
    identities: new Map([
      ["youtube:@insideboardroom", {
        identity_key: "youtube:@insideboardroom",
        source_type: "reported_media",
        policy: "allowed",
        review_status: "reviewed",
        note: "Reviewed channel override",
      }],
    ]),
  });

  const effective = explainSourcePolicy("youtube.com", "TECHNOLOGY", {
    sourceIdentityKey: "youtube:@InsideBoardroom",
  });
  assert.strictEqual(effective.source_type, "reported_media");
  assert.strictEqual(effective.source_policy, "allowed");
  assert.strictEqual(effective.review_status, "reviewed");
  assert.strictEqual(effective.policy_source, "admin_identity_override");
  assert.strictEqual(effective.inherits_from_identity, "youtube:@insideboardroom");
  assert.strictEqual(effective.admin_override.match_scope, "identity");
  assert.strictEqual(effective.admin_override.match_identity_key, "youtube:@insideboardroom");

  const annotated = annotateEditorialSignals([{
    tag: "TECHNOLOGY",
    headline: "Inside Boardroom breaks down hyperscaler AI capex",
    summary: "Channel coverage of cloud infrastructure spending.",
    url: "https://www.youtube.com/@InsideBoardroom/videos",
    source: "YouTube",
    baseScore: 7.5,
  }]);
  assert.strictEqual(annotated[0].source_policy, "allowed");
  assert.strictEqual(annotated[0].source_policy_source, "admin_identity_override");
  assert.strictEqual(annotated[0].source_inherits_from_identity, "youtube:@insideboardroom");
  assert.strictEqual(annotated[0].source_identity_key, "youtube:@insideboardroom");
  setAdminSourceRegistry(null);
}

// ── Domain fallback still applies when no identity-specific governance exists ──
{
  setAdminSourceRegistry({
    domains: new Map([
      ["youtube.com", {
        domain: "youtube.com",
        source_type: "platform_user_generated",
        policy: "review",
        review_status: "monitor",
        note: "Platform default",
      }],
    ]),
    identities: new Map(),
  });
  const fallback = explainSourcePolicy("youtube.com", "TECHNOLOGY", {
    sourceIdentityKey: "youtube:@unknownchannel",
  });
  assert.strictEqual(fallback.source_policy, "review");
  assert.strictEqual(fallback.review_status, "monitor");
  assert.strictEqual(fallback.policy_source, "admin_override");
  assert.strictEqual(fallback.inherits_from_identity, null);
  setAdminSourceRegistry(null);
}

// ── Admin hard block marks domain as blocked + excluded ──
{
  setAdminSourceRegistry(new Map([
    ["exampleblocked.com", {
      domain: "exampleblocked.com",
      tier_override: "weak",
      authority_override: 0.1,
      hard_block: true,
      note: "Blocked globally",
    }],
  ]));
  const blocked = classifySourceTier("exampleblocked.com");
  assert.strictEqual(blocked.source_tier, "blocked");
  assert.strictEqual(blocked.source_authority, 0);
  assert.strictEqual(blocked.hard_block, true);
  const annotated = runtime.annotateEditorialSignals([{
    tag: "TECHNOLOGY",
    headline: "Example blocked source story",
    summary: "Blocked source content.",
    source_domain: "exampleblocked.com",
    baseScore: 7,
  }]);
  assert.strictEqual(annotated[0].hard_exclude, true);
  assert.strictEqual(annotated[0].source_policy_source, "admin_hard_block");
  setAdminSourceRegistry(null);
}

// ── Derivative flagging: cluster with top_tier + weak sources ──
{
  const clusterItems = [
    {
      tag: "TECHNOLOGY",
      headline: "Hyperscaler AI capex hits $650B as cloud giants race",
      summary: "AWS, Azure, Google invest heavily in AI infrastructure.",
      source_domain: "reuters.com",
      baseScore: 8.0,
      strategic_value: 0.80,
    },
    {
      tag: "TECHNOLOGY",
      headline: "AI demand pushes companies to invest billions in cloud infrastructure",
      summary: "Tech firms expected to spend $650B on AI cloud.",
      source_domain: "benzinga.com",
      baseScore: 8.5,
      strategic_value: 0.82,
    },
  ];
  const candidates = buildStorylineCandidates(clusterItems);
  // If clustered, the weak/aggregator item should be flagged as derivative
  if (candidates.length === 1) {
    // Clustered: representative should be reuters
    assert.strictEqual(candidates[0].source_domain, "reuters.com",
      "reuters should be representative over benzinga in a cluster");
  }
  // Verify derivative_of_primary flag is set on non-primary items within clusters
  const allClusterItems = candidates.flatMap((c) => c.items || []);
  const benzingaItem = allClusterItems.find((i) => i.source_domain === "benzinga.com");
  if (benzingaItem && candidates.length === 1) {
    assert.strictEqual(benzingaItem.derivative_of_primary, true,
      "benzinga item should be flagged as derivative when clustered with reuters");
    assert.ok(benzingaItem.originality_signal <= 0.35,
      `derivative item originality should be penalized, got ${benzingaItem.originality_signal}`);
  }
}
