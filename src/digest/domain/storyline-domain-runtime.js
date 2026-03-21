"use strict";

const crypto = require("crypto");
const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("./topic-domain-runtime");
const { buildFreshnessKey } = require("../runtime/repeat-freshness-runtime");
const {
  SOURCE_POLICY_RANKING_EFFECTS,
  normalizeSourcePolicyDomain,
  normalizeSourceTopicToken,
  TIER_OVERRIDE_SCORES,
  TOPIC_FIT_BAND_SCORES,
} = require("../../runtime/source-policy-registry-runtime");
const { matchPreferredSourceDomain } = require("../../runtime/preferred-source-registry-runtime");

const STANDARD_TOPIC_TOKENS = new Set([
  "healthcare",
  "financial services",
  "pe m a",
  "energy",
  "consumer",
  "life sciences",
  "technology",
  "industrials",
  "real estate",
  "public sector",
  "ai tech",
  "strategy",
  "policy regulatory",
  "sustainability",
  "digital",
  "m a advisory",
  "talent",
]);

const GENERIC_ENTITY_STOPWORDS = new Set([
  "friday",
  "thursday",
  "wednesday",
  "tuesday",
  "monday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "business",
  "boardroom",
  "strategy",
  "inside",
  "reality",
  "signals",
  "daily",
  "enterprise",
  "world",
  "conference",
  "report",
  "guidance",
  "ceos",
  "ceo",
]);

const SOURCE_TIER_RULES = Object.freeze({
  premium: {
    score: 0.95,
    domains: [
      "reuters.com", "bloomberg.com", "ft.com", "wsj.com",
      "sec.gov", "fda.gov", "cms.gov", "treasury.gov", "federalreserve.gov",
      "nytimes.com", "economist.com", "nature.com",
      "apnews.com", "washingtonpost.com", "bbc.com", "theguardian.com",
      "lancet.com",
    ],
  },
  strong: {
    score: 0.8,
    domains: [
      "spglobal.com", "gartner.com", "nasdaq.com",
      "esgtoday.com", "esgdive.com",
      "pharmexec.com", "biospace.com",
      "fiercebiotech.com", "fiercehealthcare.com", "modernhealthcare.com",
      "cnbc.com", "axios.com", "thehill.com", "politico.com",
      "healthaffairs.org", "statnews.com",
      "utilitydive.com", "energydive.com",
      // Industry Dive family
      "ciodive.com", "supplychaindive.com", "retaildive.com", "hrdive.com",
      "biopharmadive.com", "healthcaredive.com", "cybersecuritydive.com", "cfodive.com",
      // Fierce family
      "fiercepharma.com", "fierceelectronics.com", "fiercewireless.com",
      // Top analysis / trade
      "morningstar.com", "barrons.com", "hbr.org",
      "wired.com", "arstechnica.com", "theregister.com",
      "mckinsey.com", "bcg.com", "bain.com",
      "scientificamerican.com", "fortune.com",
    ],
  },
  standard: {
    score: 0.6,
    domains: [
      "cpapracticeadvisor.com", "bottomline.com",
      "conference-board.org", "fintechfutures.com",
      "crowdfundinsider.com", "reinsurancene.ws",
      "apmdigest.com", "deloitte.com", "forvismazars.us",
      "techcrunch.com", "venturebeat.com", "zdnet.com", "theverge.com",
      // Additional trade / analysis
      "businessinsider.com", "inc.com", "fastcompany.com", "semafor.com",
      "therecord.media", "darkreading.com", "pymnts.com",
      "beckershospitalreview.com", "medpagetoday.com",
      "insurancejournal.com", "healthleadersmedia.com",
    ],
  },
  corporate: {
    score: 0.42,
    domains: [
      "pfizer.com", "businesswire.com", "prnewswire.com",
      "globenewswire.com", "accesswire.com", "newswire.com",
    ],
  },
  weak: {
    score: 0.22,
    domains: [
      "investing.com",
      "barchart.com", "financialcontent.com", "markets.financialcontent.com",
      "mexc.com", "promptinjection.net", "stockstotrade.com",
      "youtube.com", "medium.com", "seekingalpha.com",
      "benzinga.com", "fool.com", "substack.com",
    ],
  },
});
const PRIMARY_OFFICIAL_DOMAINS = new Set([
  "sec.gov", "fda.gov", "cms.gov", "treasury.gov", "federalreserve.gov",
  "whitehouse.gov", "congress.gov", "irs.gov",
]);
const CORPORATE_PR_DOMAINS = new Set([
  "businesswire.com", "prnewswire.com", "globenewswire.com",
  "accesswire.com", "newswire.com", "pfizer.com",
]);
const TRADE_SPECIALIST_DOMAINS = new Set([
  "spglobal.com", "gartner.com",
  "esgtoday.com", "esgdive.com",
  "pharmexec.com", "biospace.com",
  "fiercebiotech.com", "fiercehealthcare.com", "modernhealthcare.com",
  "healthaffairs.org", "statnews.com",
  "utilitydive.com", "energydive.com",
  "ciodive.com", "supplychaindive.com", "retaildive.com", "hrdive.com",
  "biopharmadive.com", "healthcaredive.com", "cybersecuritydive.com", "cfodive.com",
  "fiercepharma.com", "fierceelectronics.com", "fiercewireless.com",
  "morningstar.com", "barrons.com",
  "therecord.media", "darkreading.com",
  "beckershospitalreview.com", "medpagetoday.com",
  "insurancejournal.com", "healthleadersmedia.com",
]);
const ANALYSIS_BLOG_DOMAINS = new Set([
  "hbr.org", "mckinsey.com", "bcg.com", "bain.com",
  "bottomline.com", "conference-board.org", "inc.com", "fastcompany.com",
]);
const AGGREGATOR_DOMAINS = new Set([
  "investing.com", "barchart.com", "benzinga.com",
  "financialcontent.com", "seekingalpha.com", "fool.com",
  "stockstotrade.com", "mexc.com",
]);
const PLATFORM_ROOT_DOMAINS = new Set([
  "youtube.com",
  "medium.com",
  "substack.com",
]);
const CORPORATE_SUBDOMAIN_PATTERNS = [
  /^(?:corporate|investor|investors|investorrelations|ir|press|newsroom|media|about|company)\./i,
  /\.(?:corporate|investor|investors|investorrelations|ir|press|newsroom|media)\./i,
];

// Legitimate .net domains that should NOT be flagged as suspect
const KNOWN_LEGIT_NET = new Set([
  "zdnet.com", // already in standard tier — won't reach heuristics, but defensive
]);

// Heuristic patterns for detecting suspect unknown domains
const SUSPECT_DOMAIN_PATTERNS = [
  // SEO-style compound names with multiple hyphens: cloudcomputing-news.net, ai-daily-report.com
  { test: (d) => (d.split(".")[0].match(/-/g) || []).length >= 2, reason: "seo-compound-name" },
  // Unestablished .net TLD (known legit .net domains are already classified in tiers above)
  { test: (d) => d.endsWith(".net") && !KNOWN_LEGIT_NET.has(d), reason: "unestablished-net" },
  // .info TLD — almost always low quality for news
  { test: (d) => d.endsWith(".info"), reason: "info-tld" },
  // Long domain names with SEO news patterns
  { test: (d) => {
    const base = d.split(".")[0];
    return base.length > 18 && /(?:news|daily|report|digest|insider|alert|update)/.test(base);
  }, reason: "seo-news-pattern" },
  // Numeric-heavy domains
  { test: (d) => /\d{3,}/.test(d.split(".")[0]), reason: "numeric-domain" },
];

// Topic-specific authority overrides: { domain: { topicToken: overrideScore } }
const TOPIC_AUTHORITY_OVERRIDES = Object.freeze({
  // Healthcare / Life Sciences specialists
  "statnews.com": { "healthcare": 0.90, "life sciences": 0.90 },
  "fiercehealthcare.com": { "healthcare": 0.90 },
  "fiercepharma.com": { "healthcare": 0.88, "life sciences": 0.90 },
  "modernhealthcare.com": { "healthcare": 0.90 },
  "healthaffairs.org": { "healthcare": 0.92, "public sector": 0.85 },
  "biospace.com": { "life sciences": 0.88, "healthcare": 0.82 },
  "fiercebiotech.com": { "life sciences": 0.90, "healthcare": 0.85 },
  "biopharmadive.com": { "life sciences": 0.88, "healthcare": 0.85 },
  "healthcaredive.com": { "healthcare": 0.88 },
  "beckershospitalreview.com": { "healthcare": 0.78 },
  "medpagetoday.com": { "healthcare": 0.78, "life sciences": 0.75 },
  // Sustainability / Energy specialists
  "esgtoday.com": { "sustainability": 0.90, "energy": 0.85 },
  "esgdive.com": { "sustainability": 0.90, "energy": 0.85 },
  "utilitydive.com": { "energy": 0.88, "sustainability": 0.82 },
  "energydive.com": { "energy": 0.88, "sustainability": 0.82 },
  // Technology specialists
  "ciodive.com": { "technology": 0.85, "digital": 0.85, "ai tech": 0.82 },
  "techcrunch.com": { "technology": 0.80, "ai tech": 0.80, "digital": 0.78 },
  "zdnet.com": { "technology": 0.78, "digital": 0.78 },
  "theverge.com": { "technology": 0.78, "digital": 0.75 },
  "wired.com": { "technology": 0.85, "ai tech": 0.82 },
  "arstechnica.com": { "technology": 0.85 },
  "cybersecuritydive.com": { "technology": 0.85, "digital": 0.82 },
  // Financial / Regulatory specialists
  "sec.gov": { "financial services": 0.98, "pe m a": 0.95, "policy regulatory": 0.95 },
  "fda.gov": { "healthcare": 0.98, "life sciences": 0.98 },
  "cms.gov": { "healthcare": 0.95, "public sector": 0.90 },
  "treasury.gov": { "financial services": 0.98, "policy regulatory": 0.95 },
  "federalreserve.gov": { "financial services": 0.98 },
  "cnbc.com": { "financial services": 0.85 },
  "barrons.com": { "financial services": 0.88 },
  "morningstar.com": { "financial services": 0.85 },
  // Industry / Supply chain
  "supplychaindive.com": { "industrials": 0.85, "consumer": 0.80 },
  "retaildive.com": { "consumer": 0.85 },
  // Strategy / Consulting
  "mckinsey.com": { "strategy": 0.88 },
  "bcg.com": { "strategy": 0.88 },
  "bain.com": { "strategy": 0.85, "pe m a": 0.85 },
  "hbr.org": { "strategy": 0.88 },
});

// Headline patterns indicating derivative/low-originality content
const DERIVATIVE_HEADLINE_PATTERNS = [
  /\b(?:pushes|drives|leads)\s+companies\s+to\s+(?:invest|spend)\b/i,
  /\bmarket\s+(?:expected|projected|set)\s+to\s+(?:reach|grow|hit)\b/i,
  /\b(?:companies|firms)\s+are\s+(?:investing|spending|pouring)\s+billions\b/i,
  /\btop\s+\d+\s+(?:trends?|stocks?|companies|things)\b/i,
  /\beverything\s+you\s+need\s+to\s+know\b/i,
  /\bwhat\s+you\s+(?:need|should)\s+to\s+know\b/i,
];

// Patterns suggesting press release rewrites (not from original company or wire)
const PRESS_RELEASE_REWRITE_PATTERNS = [
  /\b(?:announces?|declares?|reports?|appoints?|names?)\s/i,
];

const FLAG_RULES = [
  { flag: "routine_dividend", pattern: /\b(dividend|shareholders? of record|quarterly payout|consecutive quarterly dividend|payable march)\b/i },
  { flag: "investor_relations", pattern: /\b(j\.?\s?p\.?\s?morgan|td cowen|investor day|conference|shareholder meeting|fireside chat)\b/i },
  { flag: "conference_recap", pattern: /\b(showcased|shines at|world 2026|conference recap|summit)\b/i },
  { flag: "stock_promo", pattern: /\b(stock|shares?)\b.*\b(up|jumped|surged|optimism|bitcoin ventures)\b/i },
  { flag: "generic_commentary", pattern: /\b(challenges ceos can't ignore|must prioritize|business reality|inside the boardroom|customer centric|innovation velocity)\b/i },
  { flag: "guidance", pattern: /\b(guidance|outlook|forecast|projects? .* revenue|revenue of \$|\brevenue\b.*\b2026\b)\b/i },
  { flag: "trial_readout", pattern: /\b(phase ii|phase iii|pivotal study|trial|readout|clinical data)\b/i },
  { flag: "m_and_a", pattern: /\b(acquires?|acquisition|buyout|merger|deal|sale of|sells?)\b/i },
  { flag: "regulatory", pattern: /\b(rule|rules|regulation|regulatory|deadline|bill|approval|approved)\b/i },
  { flag: "earnings", pattern: /\b(earnings|results|quarter|q1|q2|q3|q4)\b/i },
  { flag: "product_launch", pattern: /\b(launch|approval|approved|rollout)\b/i },
  { flag: "evergreen_trend", pattern: /\b(trends?\s+(every|ceos?|leaders?|executives?|companies)|must.{0,20}(watch|know|prepare)|can't ignore|game.?chang|transform(?:ing|ation)\s+(?:every|your|the)|future of .{3,20}(?:is|looks)|(?:revolution|disruption)\s+(?:is|in)\s+(?:here|coming))\b/i },
  { flag: "thin_listicle", pattern: /\b\d+\s+(?:ways?|things?|tips?|strategies?|reasons?|steps?)\s+(?:to|for|why|every|that)\b/i },
];

const HINT_RULES = [
  { hint: "obesity_pipeline", pattern: /\b(obesity|glp[- ]?1|weight loss)\b/i },
  { hint: "oncology_pipeline", pattern: /\b(oncology|cancer)\b/i },
  { hint: "patent_cliff", pattern: /\b(patent cliff|loe|loss of exclusivity)\b/i },
  { hint: "pipeline_execution", pattern: /\b(pipeline|r&d|phase iii|pivotal study)\b/i },
  { hint: "capital_return", pattern: /\b(dividend|buyback|capital return)\b/i },
  { hint: "guidance", pattern: /\b(guidance|outlook|forecast|revenue)\b/i },
  { hint: "investor_day", pattern: /\b(j\.?\s?p\.?\s?morgan|td cowen|conference|investor day)\b/i },
  { hint: "regulatory_shift", pattern: /\b(rule|regulation|deadline|bill|approval)\b/i },
  { hint: "deal_activity", pattern: /\b(acquire|acquisition|buyout|merger|sale)\b/i },
  { hint: "executive_commentary", pattern: /\b(ceo|boardroom|must prioritize|business reality)\b/i },
];

const HARD_EXCLUDE_FLAGS = new Set(["routine_dividend", "stock_promo"]);

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function stripHtml(value) {
  return String(value || "").replace(/<\/?[^>]+>/g, " ");
}

function uniqSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort();
}

function tokenSet(value) {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .filter((token) => token.length >= 4)
  );
}

function headlineTrigramOverlap(leftItem, rightItem) {
  const leftWords = normalizeMatchText(leftItem?.headline || "").split(" ").filter((t) => t.length >= 3);
  const rightWords = normalizeMatchText(rightItem?.headline || "").split(" ").filter((t) => t.length >= 3);
  if (leftWords.length < 3 || rightWords.length < 3) return 0;
  const trigrams = (words) => {
    const set = new Set();
    for (let i = 0; i <= words.length - 3; i++) {
      set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    return set;
  };
  return jaccard(trigrams(leftWords), trigrams(rightWords));
}

function jaccard(aValues, bValues) {
  const a = new Set(Array.isArray(aValues) ? aValues : aValues instanceof Set ? Array.from(aValues) : []);
  const b = new Set(Array.isArray(bValues) ? bValues : bValues instanceof Set ? Array.from(bValues) : []);
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size || 1;
  return intersection / union;
}

function normalizeSourceDomain(raw) {
  return normalizeSourcePolicyDomain(raw);
}

function matchesDomain(sourceDomain, candidateDomain) {
  const source = normalizeSourceDomain(sourceDomain);
  const candidate = normalizeSourceDomain(candidateDomain);
  if (!source || !candidate) return false;
  return source === candidate || source.endsWith(`.${candidate}`);
}

function resolveTopicAuthorityOverrides(sourceDomain) {
  const normalized = normalizeSourceDomain(sourceDomain);
  if (!normalized) return null;
  let bestDomain = null;
  let bestOverrides = null;
  for (const [domain, overrides] of Object.entries(TOPIC_AUTHORITY_OVERRIDES)) {
    if (!matchesDomain(normalized, domain)) continue;
    if (!bestDomain || domain.length > bestDomain.length) {
      bestDomain = domain;
      bestOverrides = overrides;
    }
  }
  return bestOverrides;
}

function buildBaselineTopicFitMap(sourceDomain) {
  const overrides = resolveTopicAuthorityOverrides(sourceDomain);
  const topicFitMap = {};
  for (const topic of Object.keys(overrides || {})) {
    topicFitMap[normalizeSourceTopicToken(topic)] = "high";
  }
  return topicFitMap;
}

function isCorporateAnnouncementDomain(sourceDomain) {
  const normalized = normalizeSourceDomain(sourceDomain);
  if (!normalized) return false;
  return CORPORATE_SUBDOMAIN_PATTERNS.some((pattern) => pattern.test(normalized));
}

function classifySourceType(sourceDomainRaw, baselineTier = null) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) return "unclassified";
  let resolvedTier = baselineTier;
  if (!resolvedTier) {
    for (const [sourceTier, rule] of Object.entries(SOURCE_TIER_RULES)) {
      if (rule.domains.some((domain) => matchesDomain(sourceDomain, domain))) {
        resolvedTier = sourceTier;
        break;
      }
    }
    if (!resolvedTier && isCorporateAnnouncementDomain(sourceDomain)) resolvedTier = "corporate";
    if (!resolvedTier && sourceDomain.endsWith(".medium.com")) resolvedTier = "weak";
    if (!resolvedTier && (sourceDomain.includes("blog.") || sourceDomain.includes(".blog"))) resolvedTier = "blog";
  }
  if (PRIMARY_OFFICIAL_DOMAINS.has(sourceDomain) || sourceDomain.endsWith(".gov")) return "primary_official";
  if (CORPORATE_PR_DOMAINS.has(sourceDomain) || isCorporateAnnouncementDomain(sourceDomain)) return "corporate_pr";
  if (PLATFORM_ROOT_DOMAINS.has(sourceDomain) || sourceDomain.endsWith(".medium.com")) return "platform_user_generated";
  if (AGGREGATOR_DOMAINS.has(sourceDomain)) return "aggregator_republisher";
  if (ANALYSIS_BLOG_DOMAINS.has(sourceDomain) || sourceDomain.includes("blog.") || sourceDomain.includes(".blog")) return "analysis_blog";
  if (TRADE_SPECIALIST_DOMAINS.has(sourceDomain)) return "trade_specialist";
  if (resolvedTier === "premium" || resolvedTier === "strong" || resolvedTier === "standard") return "reported_media";
  if (resolvedTier === "blog") return "analysis_blog";
  if (resolvedTier === "corporate") return "corporate_pr";
  if (resolvedTier === "weak") return "aggregator_republisher";
  return "unclassified";
}

function derivePolicyFromBaseline(baseTier, sourceType) {
  if (baseTier === "blocked") return "blocked";
  if (baseTier === "weak") return sourceType === "platform_user_generated" ? "review" : "limited";
  if (baseTier === "corporate") return "limited";
  if (baseTier === "blog") return "allowed";
  if (baseTier === "suspect" || baseTier === "unknown") return "review";
  if (sourceType === "primary_official") return "preferred";
  if (sourceType === "reported_media" || sourceType === "trade_specialist") {
    return (baseTier === "premium" || baseTier === "strong") ? "preferred" : "allowed";
  }
  if (sourceType === "analysis_blog") {
    return (baseTier === "premium" || baseTier === "strong" || baseTier === "standard") ? "allowed" : "limited";
  }
  if (sourceType === "platform_user_generated") return "review";
  if (sourceType === "corporate_pr") return "limited";
  if (sourceType === "aggregator_republisher") return baseTier === "suspect" ? "review" : "limited";
  if (String(baseTier || "").startsWith("learned-")) return baseTier === "learned-standard" ? "allowed" : "review";
  return "allowed";
}

function deriveReviewStatusFromBaseline(baseTier, sourceType) {
  if (baseTier === "unknown" || baseTier === "suspect") return "unreviewed";
  if (String(baseTier || "").startsWith("learned-")) return "monitor";
  if (sourceType === "platform_user_generated") return "monitor";
  return "reviewed";
}

function deriveOriginalityProfile(sourceType) {
  if (sourceType === "primary_official") return "primary";
  if (sourceType === "reported_media" || sourceType === "trade_specialist") return "original_reporting";
  if (sourceType === "analysis_blog") return "derived_synthesis";
  if (sourceType === "corporate_pr") return "press_release_repost";
  if (sourceType === "aggregator_republisher") return "rewrite_aggregator";
  return "unknown";
}

function deriveTierFromGovernance(baselineTier, sourceType, policy) {
  if (policy === "blocked") return "blocked";
  if (sourceType === "primary_official") return "premium";
  if (sourceType === "reported_media") {
    return policy === "preferred"
      ? (baselineTier === "premium" ? "premium" : "strong")
      : "standard";
  }
  if (sourceType === "trade_specialist") {
    return policy === "preferred" ? "strong" : "standard";
  }
  if (sourceType === "analysis_blog") return "blog";
  if (sourceType === "corporate_pr") return "corporate";
  if (sourceType === "platform_user_generated") return policy === "review" ? "unknown" : "weak";
  if (sourceType === "aggregator_republisher") return policy === "review" ? "suspect" : "weak";
  if (policy === "review") return "unknown";
  return baselineTier || "unknown";
}

const TYPE_AUTHORITY_RANGES = Object.freeze({
  primary_official: Object.freeze([0.85, 0.99]),
  reported_media: Object.freeze([0.58, 0.96]),
  trade_specialist: Object.freeze([0.58, 0.92]),
  analysis_blog: Object.freeze([0.42, 0.74]),
  corporate_pr: Object.freeze([0.32, 0.56]),
  aggregator_republisher: Object.freeze([0.16, 0.45]),
  platform_user_generated: Object.freeze([0.18, 0.5]),
  unclassified: Object.freeze([0.28, 0.62]),
});

const POLICY_AUTHORITY_RANGES = Object.freeze({
  preferred: Object.freeze([0.72, 0.99]),
  allowed: Object.freeze([0.46, 0.84]),
  limited: Object.freeze([0.28, 0.58]),
  review: Object.freeze([0.32, 0.5]),
  blocked: Object.freeze([0, 0]),
});

function deriveAuthorityFromGovernance({
  baseAuthority,
  sourceType,
  policy,
  reviewStatus,
  topicFitBand,
  originalityProfile,
  preserveLowBase = false,
}) {
  if (policy === "blocked") return 0;
  const numericBase = Number.isFinite(Number(baseAuthority))
    ? Number(baseAuthority)
    : (policy === "preferred" ? 0.85 : policy === "allowed" ? 0.62 : policy === "limited" ? 0.42 : 0.4);
  const [typeMin, typeMax] = TYPE_AUTHORITY_RANGES[sourceType] || TYPE_AUTHORITY_RANGES.unclassified;
  const [policyMin, policyMax] = POLICY_AUTHORITY_RANGES[policy] || POLICY_AUTHORITY_RANGES.allowed;
  const floor = Math.min(Math.max(typeMin, policyMin), Math.min(typeMax, policyMax));
  const ceiling = Math.max(floor, Math.min(typeMax, policyMax));
  let score = clamp(numericBase, floor, ceiling);
  if (topicFitBand === "high") score += 0.05;
  if (topicFitBand === "medium") score += 0.02;
  if (topicFitBand === "low") score -= 0.08;
  if (originalityProfile === "rewrite_aggregator") score -= 0.04;
  if (!preserveLowBase && reviewStatus === "unreviewed" && policy === "review") score = clamp(score, 0.38, 0.48);
  if (!preserveLowBase && reviewStatus === "monitor" && policy === "review") score = clamp(score, 0.34, 0.5);
  if (preserveLowBase) score = Math.min(score, numericBase);
  return clamp(score, 0, 1);
}

function buildPolicyEffects(policy, sourceType) {
  const base = SOURCE_POLICY_RANKING_EFFECTS[policy] || SOURCE_POLICY_RANKING_EFFECTS.allowed;
  const requiresCorroboration = policy === "limited"
    ? sourceType !== "corporate_pr"
    : base.requires_corroboration;
  const leadEligible = policy === "allowed"
    ? sourceType !== "analysis_blog"
    : base.lead_eligible;
  const exposureCap = policy === "limited" && sourceType === "corporate_pr"
    ? 1
    : base.exposure_cap;
  return {
    policy,
    lead_eligible: leadEligible,
    exposure_cap: exposureCap,
    requires_corroboration: requiresCorroboration,
    score_multiplier: Number(base.score_multiplier.toFixed(3)),
  };
}

// Learned domain authority adjustments (populated at runtime via setLearnedDomainAdjustments)
let _learnedAdjustments = null;
let _adminSourceRegistry = null;
let _preferredSourceRegistry = null;

function setLearnedDomainAdjustments(adjustmentsMap) {
  _learnedAdjustments = adjustmentsMap instanceof Map ? adjustmentsMap : null;
}

function setAdminSourceRegistry(registryMap) {
  _adminSourceRegistry = registryMap instanceof Map ? registryMap : null;
}

function setPreferredSourceRegistry(registry) {
  _preferredSourceRegistry = registry && typeof registry === "object" ? registry : null;
}

function resolveAdminSourceRegistryEntry(sourceDomain) {
  const normalizedDomain = normalizeSourceDomain(sourceDomain);
  if (!_adminSourceRegistry || !normalizedDomain) return null;
  let bestMatch = null;
  for (const [domain, entry] of _adminSourceRegistry.entries()) {
    const normalizedEntryDomain = normalizeSourceDomain(domain);
    if (!normalizedEntryDomain) continue;
    if (!matchesDomain(normalizedDomain, normalizedEntryDomain)) continue;
    if (!bestMatch || normalizedEntryDomain.length > bestMatch.matched_domain.length) {
      bestMatch = {
        matched_domain: normalizedEntryDomain,
        entry: entry && typeof entry === "object" ? entry : null,
      };
    }
  }
  return bestMatch;
}

function classifySourceTierBaseline(sourceDomainRaw, tag) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) {
    const sourceType = "unclassified";
    const policy = "review";
    const reviewStatus = "unreviewed";
    const originalityProfile = "unknown";
    const policyEffects = buildPolicyEffects(policy, sourceType);
    return {
      source_domain: "",
      source_type: sourceType,
      source_policy: policy,
      review_status: reviewStatus,
      originality_profile: originalityProfile,
      source_tier: "unknown",
      source_authority: deriveAuthorityFromGovernance({
        baseAuthority: 0.42,
        sourceType,
        policy,
        reviewStatus,
        topicFitBand: null,
        originalityProfile,
      }),
      topic_fit: 0,
      topic_fit_band: null,
      topic_fit_map: {},
      baseline_source_tier: "unknown",
      baseline_source_authority: 0.42,
      learned_adjustment: null,
      topic_override_score: null,
      topic_override_applied: false,
      policy_source: "baseline",
      policy_effects: policyEffects,
      hard_block: false,
      inherits_from_domain: null,
      admin_override: null,
    };
  }

  let baseTier = null;
  let baseScore = 0;
  let matchedRuleDomain = null;
  for (const [sourceTier, rule] of Object.entries(SOURCE_TIER_RULES)) {
    const matchedDomain = rule.domains.find((domain) => matchesDomain(sourceDomain, domain));
    if (matchedDomain) {
      baseTier = sourceTier;
      baseScore = rule.score;
      matchedRuleDomain = matchedDomain;
      break;
    }
  }

  if (!baseTier) {
    if (isCorporateAnnouncementDomain(sourceDomain)) {
      baseTier = "corporate";
      baseScore = 0.42;
      matchedRuleDomain = sourceDomain;
    } else if (sourceDomain.endsWith(".medium.com")) {
      baseTier = "weak";
      baseScore = 0.28;
      matchedRuleDomain = "medium.com";
    } else if (sourceDomain.includes("blog.") || sourceDomain.includes(".blog")) {
      baseTier = "blog";
      baseScore = 0.48;
      matchedRuleDomain = sourceDomain;
    }
  }

  // For unknown domains, apply suspect heuristics
  if (!baseTier) {
    const suspectMatch = SUSPECT_DOMAIN_PATTERNS.find((p) => p.test(sourceDomain));
    if (suspectMatch) {
      baseTier = "suspect";
      baseScore = 0.15;
    } else {
      baseTier = "unknown";
      baseScore = 0.42;
    }
  }

  // Apply learned domain authority for unknown/suspect domains
  let learnedAdjustment = null;
  if ((baseTier === "unknown" || baseTier === "suspect") && _learnedAdjustments && _learnedAdjustments.has(sourceDomain)) {
    const learned = _learnedAdjustments.get(sourceDomain);
    if (Number.isFinite(learned) && learned > 0) {
      learnedAdjustment = learned;
      baseScore = learned;
      if (learned >= 0.45) baseTier = "learned-standard";
      else if (learned <= 0.18) baseTier = "learned-suspect";
    }
  }

  // Apply topic-domain fit overrides
  const fit = computeTopicDomainFit(sourceDomain, tag);
  const sourceType = classifySourceType(sourceDomain, baseTier);
  const policy = derivePolicyFromBaseline(baseTier, sourceType);
  const reviewStatus = deriveReviewStatusFromBaseline(baseTier, sourceType);
  const originalityProfile = deriveOriginalityProfile(sourceType);
  const topicOverrideApplied = fit.overrideScore != null && fit.overrideScore > baseScore;
  const finalScore = deriveAuthorityFromGovernance({
    baseAuthority: topicOverrideApplied ? fit.overrideScore : baseScore,
    sourceType,
    policy,
    reviewStatus,
    topicFitBand: fit.band || null,
    originalityProfile,
    preserveLowBase: baseTier === "suspect" || baseTier === "learned-suspect",
  });
  const policyEffects = buildPolicyEffects(policy, sourceType);

  return {
    source_domain: sourceDomain,
    source_type: sourceType,
    source_policy: policy,
    review_status: reviewStatus,
    originality_profile: originalityProfile,
    source_tier: baseTier,
    source_authority: finalScore,
    topic_fit: fit.topicFit,
    topic_fit_band: fit.band || null,
    topic_fit_map: buildBaselineTopicFitMap(sourceDomain),
    baseline_source_tier: baseTier,
    baseline_source_authority: finalScore,
    learned_adjustment: learnedAdjustment,
    topic_override_score: fit.overrideScore,
    topic_override_applied: topicOverrideApplied,
    policy_source: topicOverrideApplied
      ? "topic_override"
      : (learnedAdjustment != null ? "learned_adjustment" : "baseline"),
    policy_effects: policyEffects,
    hard_block: false,
    source_family_domain: matchedRuleDomain || sourceDomain,
    inherits_from_domain: null,
    admin_override: null,
  };
}

function resolvePreferredSourceMatch(sourceDomain, tag) {
  if (!_preferredSourceRegistry) {
    return {
      match: "none",
      kind: null,
      topics: [],
      strength: 0,
      matched_domain: null,
    };
  }
  return matchPreferredSourceDomain(_preferredSourceRegistry, sourceDomain, tag);
}

function explainSourcePolicy(sourceDomainRaw, tag) {
  const baseline = classifySourceTierBaseline(sourceDomainRaw, tag);
  const sourceDomain = String(baseline?.source_domain || "").trim();
  const adminMatch = resolveAdminSourceRegistryEntry(sourceDomain);
  if (!adminMatch || !adminMatch.entry) return baseline;

  const adminEntry = adminMatch.entry;
  const matchedDomain = String(adminMatch.matched_domain || "").trim() || null;
  const tierOverride = String(adminEntry?.tier_override || "").trim().toLowerCase() || null;
  const authorityOverride = adminEntry?.authority_override === "" || adminEntry?.authority_override == null
    ? null
    : (Number.isFinite(Number(adminEntry.authority_override))
      ? Number(adminEntry.authority_override)
      : null);
  const hardBlock = adminEntry?.hard_block === true;
  const legacySourceType = tierOverride ? classifySourceType(sourceDomain, tierOverride) : null;
  const legacyPolicy = tierOverride ? derivePolicyFromBaseline(tierOverride, legacySourceType) : null;
  const legacyReviewStatus = tierOverride ? deriveReviewStatusFromBaseline(tierOverride, legacySourceType) : null;
  const legacyOriginalityProfile = legacySourceType ? deriveOriginalityProfile(legacySourceType) : null;
  const effectiveSourceType = String(adminEntry?.source_type || "").trim() || legacySourceType || baseline.source_type;
  const effectivePolicy = hardBlock
    ? "blocked"
    : (String(adminEntry?.policy || "").trim() || legacyPolicy || baseline.source_policy);
  const effectiveReviewStatus = String(adminEntry?.review_status || "").trim() || legacyReviewStatus || baseline.review_status;
  const effectiveOriginalityProfile = String(adminEntry?.originality_profile || "").trim()
    || legacyOriginalityProfile
    || baseline.originality_profile;
  const fit = computeTopicDomainFit(sourceDomain, tag, adminEntry?.topic_fit || null);

  let effectiveTier = tierOverride || baseline.source_tier;
  let effectiveAuthority = baseline.source_authority;
  let policySource = baseline.policy_source || "baseline";

  if (authorityOverride == null) {
    effectiveTier = tierOverride || deriveTierFromGovernance(baseline.source_tier, effectiveSourceType, effectivePolicy);
    effectiveAuthority = deriveAuthorityFromGovernance({
      baseAuthority: tierOverride && Object.prototype.hasOwnProperty.call(TIER_OVERRIDE_SCORES, tierOverride)
        ? TIER_OVERRIDE_SCORES[tierOverride]
        : baseline.source_authority,
      sourceType: effectiveSourceType,
      policy: effectivePolicy,
      reviewStatus: effectiveReviewStatus,
      topicFitBand: fit.band || baseline.topic_fit_band || null,
      originalityProfile: effectiveOriginalityProfile,
      preserveLowBase: tierOverride === "suspect" || tierOverride === "learned-suspect" || (!tierOverride && baseline.source_tier === "suspect"),
    });
  }
  if (authorityOverride != null) effectiveAuthority = authorityOverride;
  if (hardBlock) {
    effectiveTier = "blocked";
    effectiveAuthority = 0;
    policySource = "admin_hard_block";
  } else {
    policySource = matchedDomain && matchedDomain !== sourceDomain
      ? "admin_inherited_override"
      : "admin_override";
  }

  const effectiveTopicFitMap = {
    ...(baseline.topic_fit_map || {}),
    ...((adminEntry?.topic_fit && typeof adminEntry.topic_fit === "object") ? adminEntry.topic_fit : {}),
  };
  const policyEffects = buildPolicyEffects(effectivePolicy, effectiveSourceType);

  return {
    ...baseline,
    source_type: effectiveSourceType,
    source_policy: effectivePolicy,
    review_status: effectiveReviewStatus,
    originality_profile: effectiveOriginalityProfile,
    source_tier: effectiveTier,
    source_authority: effectiveAuthority,
    topic_fit: fit.topicFit != null ? fit.topicFit : baseline.topic_fit,
    topic_fit_band: fit.band || baseline.topic_fit_band || null,
    topic_fit_map: effectiveTopicFitMap,
    policy_effects: policyEffects,
    hard_block: hardBlock,
    policy_source: policySource,
    source_family_domain: baseline.source_family_domain || sourceDomain,
    inherits_from_domain: matchedDomain && matchedDomain !== sourceDomain ? matchedDomain : null,
    admin_override: {
      domain: String(adminEntry?.domain || matchedDomain || sourceDomain).trim() || null,
      match_domain: matchedDomain,
      source_type: String(adminEntry?.source_type || "").trim() || null,
      policy: String(adminEntry?.policy || "").trim() || null,
      review_status: String(adminEntry?.review_status || "").trim() || null,
      topic_fit: (adminEntry?.topic_fit && typeof adminEntry.topic_fit === "object") ? adminEntry.topic_fit : {},
      originality_profile: String(adminEntry?.originality_profile || "").trim() || null,
      tier_override: tierOverride,
      authority_override: authorityOverride,
      hard_block: hardBlock,
      note: String(adminEntry?.note || "").trim() || "",
      updated_at: String(adminEntry?.updated_at || "").trim() || null,
      updated_by: String(adminEntry?.updated_by || "").trim() || null,
    },
  };
}

function classifySourceTier(sourceDomainRaw, tag) {
  return explainSourcePolicy(sourceDomainRaw, tag);
}

function computeTopicDomainFit(sourceDomain, tag, adminTopicFit = null) {
  if (!tag || !sourceDomain) return { overrideScore: null, topicFit: 0, band: null, matchedTopic: null };
  const tagToken = normalizeTopicToken(tag);
  const topicFitMap = adminTopicFit && typeof adminTopicFit === "object" ? adminTopicFit : null;
  if (topicFitMap) {
    const exactBand = topicFitMap[tagToken];
    if (exactBand) {
      return {
        overrideScore: null,
        topicFit: TOPIC_FIT_BAND_SCORES[exactBand] || 0,
        band: exactBand,
        matchedTopic: tagToken,
      };
    }
    for (const [overrideTag, overrideBand] of Object.entries(topicFitMap)) {
      if (topicsRelated(tagToken, overrideTag)) {
        return {
          overrideScore: null,
          topicFit: Math.max(0.4, (TOPIC_FIT_BAND_SCORES[overrideBand] || 0.65) * 0.75),
          band: overrideBand === "high" ? "medium" : overrideBand,
          matchedTopic: overrideTag,
        };
      }
    }
  }
  const overrides = resolveTopicAuthorityOverrides(sourceDomain);
  if (!overrides) return { overrideScore: null, topicFit: 0, band: null, matchedTopic: null };

  // Direct match
  if (overrides[tagToken] != null) {
    return { overrideScore: overrides[tagToken], topicFit: 1.0, band: "high", matchedTopic: tagToken };
  }

  // Related topic match
  for (const [overrideTag, overrideVal] of Object.entries(overrides)) {
    if (topicsRelated(tagToken, overrideTag)) {
      return { overrideScore: overrideVal, topicFit: 0.7, band: "medium", matchedTopic: overrideTag };
    }
  }

  return { overrideScore: null, topicFit: 0, band: null, matchedTopic: null };
}

function isWeakSourceItem(item = {}) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase()
    || classifySourceType(item?.source_domain || item?.source, String(item?.source_tier || "").trim().toLowerCase());
  const policy = String(item?.source_policy || "").trim().toLowerCase()
    || derivePolicyFromBaseline(String(item?.source_tier || "").trim().toLowerCase(), sourceType);
  const authority = Number(item?.source_authority || 0);
  const routineScore = Number(item?.routine_item_score || 0);
  const corroborated = Number(item?.cross_source_count || 0) >= 2
    || Number(item?.supporting_sources_avg_authority || 0) >= 0.7;
  if (policy === "blocked" || item?.source_hard_block === true) return true;
  if (routineScore >= 0.72) return true;
  if (sourceType === "corporate_pr") {
    return routineScore >= 0.6 || authority < 0.28;
  }
  if (policy === "limited") {
    return !corroborated && authority < 0.46;
  }
  if (policy === "review") {
    return !corroborated && authority < 0.4;
  }
  return authority < 0.2;
}

function computeOriginalitySignal(item, sourceInfo) {
  const sourceType = sourceInfo?.source_type || "unclassified";
  const originalityProfile = sourceInfo?.originality_profile || deriveOriginalityProfile(sourceType);
  let score = 1.0;

  if (originalityProfile === "primary") score = 1.0;
  else if (originalityProfile === "original_reporting") score = 0.9;
  else if (originalityProfile === "derived_synthesis") score = 0.62;
  else if (originalityProfile === "press_release_repost") score = 0.52;
  else if (originalityProfile === "rewrite_aggregator") score = 0.35;
  else if (sourceType === "platform_user_generated") score = 0.45;

  // Derivative headline detection
  const headline = String(item?.headline || "");
  for (const pattern of DERIVATIVE_HEADLINE_PATTERNS) {
    if (pattern.test(headline)) {
      score -= 0.15;
      break; // apply only once
    }
  }

  // Press release rewrite detection: headline looks like a press release
  // but source is not the company itself and not a wire service
  if (sourceType !== "corporate_pr" && sourceType !== "primary_official") {
    for (const pattern of PRESS_RELEASE_REWRITE_PATTERNS) {
      if (pattern.test(headline)) {
        score -= 0.1;
        break;
      }
    }
  }

  return clamp(score, 0, 1);
}

function normalizePromptFlags(flags) {
  return uniqSorted((Array.isArray(flags) ? flags : []).map((flag) => normalizeTopicToken(flag)).filter(Boolean));
}

function normalizePromptHints(hints) {
  return uniqSorted((Array.isArray(hints) ? hints : []).map((hint) => normalizeTopicToken(hint)).filter(Boolean));
}

function detectLocalContentFlags(item) {
  const text = `${item?.headline || ""} ${item?.summary || ""} ${stripHtml(item?.wim || "")}`;
  const flags = [];
  for (const rule of FLAG_RULES) {
    if (rule.pattern.test(text)) flags.push(rule.flag);
  }
  return uniqSorted(flags);
}

function buildStorylineHints(item, contentFlags, promptHints = []) {
  const text = `${item?.headline || ""} ${item?.summary || ""} ${stripHtml(item?.wim || "")}`;
  const hints = Array.isArray(promptHints) ? promptHints.slice() : [];
  for (const rule of HINT_RULES) {
    if (rule.pattern.test(text)) hints.push(rule.hint);
  }
  if (Array.isArray(contentFlags)) {
    if (contentFlags.includes("trial_readout")) hints.push("trial_progress");
    if (contentFlags.includes("m_and_a")) hints.push("deal_activity");
    if (contentFlags.includes("regulatory")) hints.push("regulatory_shift");
    if (contentFlags.includes("generic_commentary")) hints.push("executive_commentary");
  }
  return uniqSorted(hints.map((hint) => normalizeTopicToken(hint)).filter(Boolean));
}

function extractEntityKeys(item) {
  const entities = new Set();
  const tagToken = normalizeTopicToken(item?.tag || "");
  const hasSpecificTag = tagToken && !STANDARD_TOPIC_TOKENS.has(tagToken);
  if (hasSpecificTag) entities.add(tagToken);

  const headline = String(item?.headline || "");
  if (hasSpecificTag) {
    const acronyms = headline.match(/\b[A-Z]{2,6}\b/g) || [];
    for (const raw of acronyms) {
      const normalized = normalizeTopicToken(raw);
      if (!normalized || normalized === tagToken || STANDARD_TOPIC_TOKENS.has(normalized) || GENERIC_ENTITY_STOPWORDS.has(normalized)) continue;
      entities.add(normalized);
      if (entities.size >= 5) break;
    }
    return uniqSorted([...entities]);
  }

  const matches = headline.match(/\b(?:[A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+){0,2}|[A-Z]{2,6})\b/g) || [];
  for (const raw of matches) {
    const normalized = normalizeTopicToken(raw);
    if (!normalized || STANDARD_TOPIC_TOKENS.has(normalized) || GENERIC_ENTITY_STOPWORDS.has(normalized)) continue;
    if (normalized.length < 3) continue;
    entities.add(normalized);
    if (entities.size >= 5) break;
  }

  return uniqSorted([...entities]);
}

function computeRoutineItemScore(contentFlags, sourceInfo) {
  const flags = new Set(Array.isArray(contentFlags) ? contentFlags : []);
  let score = 0;
  if (flags.has("routine_dividend")) score += 0.82;
  if (flags.has("stock_promo")) score += 0.88;
  if (flags.has("generic_commentary")) score += 0.58;
  if (flags.has("evergreen_trend")) score += 0.42;
  if (flags.has("thin_listicle")) score += 0.38;
  if (flags.has("conference_recap")) score += 0.46;
  if (flags.has("investor_relations")) score += 0.34;
  if (sourceInfo.source_tier === "suspect") score += 0.24;
  if (sourceInfo.source_tier === "weak") score += 0.16;
  if (sourceInfo.source_tier === "corporate") score += 0.08;
  return clamp(score, 0, 1);
}

function computeStrategicValue(item, sourceInfo, routineItemScore, contentFlags) {
  const baseNorm = clamp(Number(item?.baseScore || 0) / 10, 0, 1);
  const promptStrategic = Number.isFinite(Number(item?.strategic_value))
    ? clamp(Number(item.strategic_value), 0, 1)
    : baseNorm;
  const flags = new Set(Array.isArray(contentFlags) ? contentFlags : []);

  let bonus = 0;
  if (flags.has("trial_readout")) bonus += 0.08;
  if (flags.has("regulatory")) bonus += 0.08;
  if (flags.has("m_and_a")) bonus += 0.08;
  if (flags.has("guidance")) bonus -= 0.02;
  if (flags.has("earnings")) bonus -= 0.02;
  if (flags.has("product_launch")) bonus += 0.03;
  if (flags.has("generic_commentary")) bonus -= 0.20;
  if (flags.has("evergreen_trend")) bonus -= 0.12;
  if (flags.has("thin_listicle")) bonus -= 0.10;
  if (flags.has("conference_recap")) bonus -= 0.06;
  if (flags.has("routine_dividend")) bonus -= 0.28;
  if (flags.has("stock_promo")) bonus -= 0.34;

  const text = `${item?.headline || ""} ${item?.summary || ""}`;
  if (/\b(deadline|effective date|enforcement|compliance date|due by|expires?)\b/i.test(text)) bonus += 0.06;
  if (/\b(capex|capital expenditure|\$\d+[BMT]|\d+\s*billion|\d+\s*million\s+investment)\b/i.test(text)) bonus += 0.04;

  const topicFit = Number(sourceInfo?.topic_fit || 0);
  const score = (
    0.59 * promptStrategic
    + 0.24 * baseNorm
    + 0.15 * sourceInfo.source_authority
    + 0.02 * topicFit
    + bonus
    - (routineItemScore * 0.42)
  );
  return clamp(score, 0, 1);
}

function buildStorylineFingerprint(item) {
  const entity = Array.isArray(item?.entity_keys) && item.entity_keys.length ? item.entity_keys[0] : normalizeTopicToken(item?.tag || "");
  const hints = Array.isArray(item?.storyline_hints) ? item.storyline_hints.slice(0, 3) : [];
  return uniqSorted([entity, ...hints]).join("|");
}

function annotateEditorialSignals(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const promptFlags = normalizePromptFlags(item?.content_flags);
    const promptHints = normalizePromptHints(item?.storyline_hints);
    const localFlags = detectLocalContentFlags(item);
    const contentFlags = uniqSorted([...promptFlags, ...localFlags]);
    const sourceInfo = classifySourceTier(item?.source_domain || item?.source, item?.tag);
    const preferredSourceMatch = resolvePreferredSourceMatch(sourceInfo.source_domain || item?.source_domain || item?.source, item?.tag);
    const originalitySignal = computeOriginalitySignal(item, sourceInfo);
    const storylineHints = buildStorylineHints(item, contentFlags, promptHints);
    const entityKeys = extractEntityKeys(item);
    const routineItemScore = computeRoutineItemScore(contentFlags, sourceInfo);
    const strategicValue = computeStrategicValue(item, sourceInfo, routineItemScore, contentFlags);
    const hardExclude = contentFlags.some((flag) => HARD_EXCLUDE_FLAGS.has(flag));

    return {
      ...item,
      content_flags: contentFlags,
      entity_keys: entityKeys,
      storyline_hints: storylineHints,
      source_tier: sourceInfo.source_tier,
      source_authority: Number(sourceInfo.source_authority.toFixed(3)),
      baseline_source_tier: sourceInfo.baseline_source_tier || sourceInfo.source_tier,
      baseline_source_authority: Number(
        Number(sourceInfo.baseline_source_authority != null ? sourceInfo.baseline_source_authority : sourceInfo.source_authority).toFixed(3)
      ),
      source_type: sourceInfo.source_type,
      source_policy: sourceInfo.source_policy,
      source_review_status: sourceInfo.review_status,
      originality_profile: sourceInfo.originality_profile,
      source_policy_source: sourceInfo.policy_source || "baseline",
      source_policy_effects: sourceInfo.policy_effects || buildPolicyEffects(sourceInfo.source_policy, sourceInfo.source_type),
      source_hard_block: sourceInfo.hard_block === true,
      source_policy_note: String(sourceInfo?.admin_override?.note || "").trim() || null,
      topic_fit: Number((sourceInfo.topic_fit || 0).toFixed(3)),
      topic_fit_band: sourceInfo.topic_fit_band || null,
      topic_fit_map: sourceInfo.topic_fit_map || {},
      source_family_domain: sourceInfo.source_family_domain || item?.source_domain || item?.source || null,
      source_inherits_from_domain: sourceInfo.inherits_from_domain || null,
      preferred_source_match: preferredSourceMatch.match || "none",
      preferred_source_kind: preferredSourceMatch.kind || null,
      preferred_source_topics: Array.isArray(preferredSourceMatch.topics) ? preferredSourceMatch.topics : [],
      preferred_source_strength: Number(Number(preferredSourceMatch.strength || 0).toFixed(3)),
      preferred_source_domain: preferredSourceMatch.matched_domain || null,
      originality_signal: Number(originalitySignal.toFixed(3)),
      routine_item_score: Number(routineItemScore.toFixed(3)),
      strategic_value: Number(strategicValue.toFixed(3)),
      hard_exclude: hardExclude || sourceInfo.hard_block === true,
      retrieval_pass: String(item?.retrieval_pass || "").trim() || null,
      suppressed_by_preferred_source: false,
      preferred_close_substitute_penalty: 0,
      won_by_preferred_substitute: false,
      storyline_key: buildStorylineFingerprint({
        ...item,
        entity_keys: entityKeys,
        storyline_hints: storylineHints,
      }),
      freshness_key: buildFreshnessKey({
        ...item,
        tag: item?.tag,
        entity_keys: entityKeys,
        storyline_hints: storylineHints,
        content_flags: contentFlags,
      }),
    };
  });
}

function headlineTokenOverlap(leftItem, rightItem) {
  const leftTokens = tokenSet(`${leftItem?.headline || ""} ${leftItem?.summary || ""}`);
  const rightTokens = tokenSet(`${rightItem?.headline || ""} ${rightItem?.summary || ""}`);
  return jaccard(leftTokens, rightTokens);
}

function storylineSimilarity(leftItem, rightItem) {
  if (!leftItem || !rightItem) return 0;

  const sameUrl = String(leftItem?.url || "").trim() && String(leftItem?.url || "").trim() === String(rightItem?.url || "").trim();
  const sameHeadline = normalizeMatchText(leftItem?.headline || "") === normalizeMatchText(rightItem?.headline || "");
  if (sameUrl || sameHeadline) return 1;

  const entityOverlap = jaccard(leftItem?.entity_keys || [], rightItem?.entity_keys || []);
  const hintOverlap = jaccard(leftItem?.storyline_hints || [], rightItem?.storyline_hints || []);
  const textOverlap = headlineTokenOverlap(leftItem, rightItem);
  const tagRelated = topicsRelated(leftItem?.tag || "", rightItem?.tag || "") ? 1 : 0;

  if (
    entityOverlap > 0
    && hintOverlap === 0
    && textOverlap < 0.18
    && ((leftItem?.storyline_hints || []).length > 0 || (rightItem?.storyline_hints || []).length > 0)
  ) {
    return 0;
  }

  if (entityOverlap >= 0.5 && hintOverlap >= 0.34) return 0.86;
  if (entityOverlap >= 0.5 && textOverlap >= 0.34) return 0.8;
  if (textOverlap >= 0.52 && (tagRelated > 0 || entityOverlap >= 0.2)) return 0.78;

  const weightedScore = (
    0.38 * entityOverlap
    + 0.28 * hintOverlap
    + 0.24 * textOverlap
    + 0.1 * tagRelated
  );
  const trigramSim = headlineTrigramOverlap(leftItem, rightItem);
  if (trigramSim >= 0.35 && tagRelated > 0) {
    return Math.min(1, weightedScore + 0.12);
  }
  return weightedScore;
}

function chooseRepresentative(items, opts = {}) {
  const ignoreSuppression = opts.ignorePreferredSuppression === true;
  const ranked = (Array.isArray(items) ? items : []).slice().sort((left, right) => {
    const leftScore = (
      Number(left?.strategic_value || 0) * 0.40
      + Number(left?.source_authority || 0) * 0.24
      + clamp(Number(left?.baseScore || 0) / 10, 0, 1) * 0.16
      + (1 - Number(left?.routine_item_score || 0)) * 0.10
      + Number(left?.originality_signal || 0.5) * 0.10
      + Number(left?.preferred_source_strength || 0) * 0.08
      + Number(left?.topic_fit || 0) * 0.05
      - (ignoreSuppression ? 0 : Number(left?.preferred_close_substitute_penalty || 0) * 0.4)
    );
    const rightScore = (
      Number(right?.strategic_value || 0) * 0.40
      + Number(right?.source_authority || 0) * 0.24
      + clamp(Number(right?.baseScore || 0) / 10, 0, 1) * 0.16
      + (1 - Number(right?.routine_item_score || 0)) * 0.10
      + Number(right?.originality_signal || 0.5) * 0.10
      + Number(right?.preferred_source_strength || 0) * 0.08
      + Number(right?.topic_fit || 0) * 0.05
      - (ignoreSuppression ? 0 : Number(right?.preferred_close_substitute_penalty || 0) * 0.4)
    );
    return rightScore - leftScore;
  });
  return ranked[0] || null;
}

function isGovernanceEligiblePreferredItem(item) {
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  return sourcePolicy === "allowed" || sourcePolicy === "preferred";
}

function isWeakClusterCandidate(item) {
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const sourceTier = String(item?.source_tier || "").trim().toLowerCase();
  return sourcePolicy === "limited"
    || sourcePolicy === "review"
    || sourceType === "aggregator_republisher"
    || sourceType === "corporate_pr"
    || sourceType === "platform_user_generated"
    || sourceTier === "weak"
    || sourceTier === "suspect";
}

function isStrongPreferredClusterCandidate(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const preferredStrength = Number(item?.preferred_source_strength || 0);
  return isGovernanceEligiblePreferredItem(item) && (
    preferredStrength >= 0.38
    || sourceType === "primary_official"
    || (sourceType === "reported_media" && String(item?.source_policy || "").trim().toLowerCase() === "preferred")
  );
}

function canTradeSpecialistOutperformPreferred(candidate, preferredCandidate) {
  if (String(candidate?.source_type || "").trim().toLowerCase() !== "trade_specialist") return false;
  if (!isGovernanceEligiblePreferredItem(candidate)) return false;
  const candidateTopicFit = Number(candidate?.topic_fit || 0);
  const preferredTopicFit = Number(preferredCandidate?.topic_fit || 0);
  const candidateAuthority = Number(candidate?.source_authority || 0);
  const preferredAuthority = Number(preferredCandidate?.source_authority || 0);
  return candidateTopicFit >= (preferredTopicFit + 0.18)
    && candidateAuthority >= (preferredAuthority - 0.08);
}

function applyPreferredCloseSubstituteSuppression(cluster) {
  if (!cluster || !Array.isArray(cluster.items) || cluster.items.length < 2) return;
  const preferredCandidates = cluster.items.filter((item) => isStrongPreferredClusterCandidate(item));
  if (preferredCandidates.length === 0) return;

  for (const item of cluster.items) {
    item.preferred_close_substitute_penalty = 0;
    item.suppressed_by_preferred_source = false;
    item.preferred_substitute_domain = null;
  }

  for (const weakItem of cluster.items) {
    if (!isWeakClusterCandidate(weakItem)) continue;
    let bestPreferred = null;
    let bestSimilarity = 0;
    for (const preferredCandidate of preferredCandidates) {
      if (preferredCandidate === weakItem) continue;
      const similarity = storylineSimilarity(weakItem, preferredCandidate);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestPreferred = preferredCandidate;
      }
    }
    if (!bestPreferred || bestSimilarity < 0.62) continue;
    if (canTradeSpecialistOutperformPreferred(weakItem, bestPreferred)) continue;
    weakItem.preferred_close_substitute_penalty = 0.2;
    weakItem.suppressed_by_preferred_source = true;
    weakItem.preferred_substitute_domain = String(bestPreferred?.source_domain || bestPreferred?.source || "").trim() || null;
  }
}

function clusterStorylines(items = []) {
  const annotated = annotateEditorialSignals(items);
  const clusters = [];

  for (const item of annotated) {
    let bestCluster = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const comparisonItems = cluster.items.slice(0, 4);
      const scores = comparisonItems.map((candidate) => storylineSimilarity(candidate, item));
      const similarity = scores.length
        ? scores.reduce((sum, value) => sum + value, 0) / scores.length
        : 0;
      if (similarity >= 0.46 && similarity > bestScore) {
        bestScore = similarity;
        bestCluster = cluster;
      }
    }

    if (!bestCluster) {
      clusters.push({ items: [item], similarities: [] });
      continue;
    }

    bestCluster.items.push(item);
    bestCluster.similarities.push(bestScore);
  }

  return clusters.map((cluster, index) => {
    flagClusterDerivatives(cluster);
    const baselineRepresentative = chooseRepresentative(cluster.items, { ignorePreferredSuppression: true });
    applyPreferredCloseSubstituteSuppression(cluster);
    const representative = chooseRepresentative(cluster.items);
    const sources = uniqSorted(cluster.items.map((item) => String(item?.source_domain || item?.source || "").trim()).filter(Boolean));
    const confidence = cluster.similarities.length
      ? cluster.similarities.reduce((sum, value) => sum + value, 0) / cluster.similarities.length
      : 1;
    const storylineId = crypto
      .createHash("sha1")
      .update(`${buildStorylineFingerprint(representative || {})}:${index}`)
      .digest("hex")
      .slice(0, 12);

    return {
      storyline_id: `story-${storylineId}`,
      canonical_headline: representative?.headline || cluster.items[0]?.headline || "",
      representative: representative || cluster.items[0] || null,
      supporting_sources: sources,
      supporting_headlines: cluster.items.map((item) => String(item?.headline || "")).filter(Boolean),
      cross_source_count: sources.length,
      storyline_size: cluster.items.length,
      entity_keys: uniqSorted(cluster.items.flatMap((item) => item?.entity_keys || [])),
      storyline_hints: uniqSorted(cluster.items.flatMap((item) => item?.storyline_hints || [])),
      cluster_confidence: Number(clamp(confidence, 0, 1).toFixed(3)),
      strategic_value: Number(clamp(Math.max(...cluster.items.map((item) => Number(item?.strategic_value || 0))), 0, 1).toFixed(3)),
      preferred_displaced_weak: baselineRepresentative
        && representative
        && baselineRepresentative !== representative
        && isWeakClusterCandidate(baselineRepresentative)
        && isStrongPreferredClusterCandidate(representative),
      items: cluster.items,
    };
  });
}

function computeSupportingSourcesAvgAuthority(supportingSources) {
  const sources = Array.isArray(supportingSources) ? supportingSources.filter(Boolean) : [];
  if (sources.length === 0) return 0.5;
  const total = sources.reduce((sum, domain) => {
    const info = classifySourceTier(domain);
    return sum + info.source_authority;
  }, 0);
  return total / sources.length;
}

function flagClusterDerivatives(cluster) {
  if (!cluster || !Array.isArray(cluster.items) || cluster.items.length < 2) return;
  const originatingTypes = new Set(["primary_official", "reported_media", "trade_specialist"]);
  const hasPrimary = cluster.items.some((item) => originatingTypes.has(item.source_type));
  if (!hasPrimary) return;
  for (const item of cluster.items) {
    if (originatingTypes.has(item.source_type)) continue;
    const sourceType = item.source_type || "unclassified";
    if (sourceType === "corporate_pr"
      || sourceType === "aggregator_republisher"
      || sourceType === "analysis_blog"
      || sourceType === "platform_user_generated"
      || item.source_policy === "limited"
      || item.source_policy === "review"
      || item.source_tier === "suspect"
      || item.source_tier === "weak") {
      item.derivative_of_primary = true;
      item.originality_signal = clamp(Number(item.originality_signal || 0.5) - 0.15, 0, 1);
    }
  }
}

function buildStorylineCandidates(items = []) {
  return clusterStorylines(items).map((cluster) => {
    const avgAuthority = computeSupportingSourcesAvgAuthority(cluster.supporting_sources);
    return {
      ...(cluster.representative || {}),
      storyline_id: cluster.storyline_id,
      storyline_size: cluster.storyline_size,
      supporting_sources: cluster.supporting_sources,
      supporting_headlines: cluster.supporting_headlines,
      cross_source_count: cluster.cross_source_count,
      supporting_sources_avg_authority: Number(avgAuthority.toFixed(3)),
      entity_keys: cluster.entity_keys,
      storyline_hints: cluster.storyline_hints,
      cluster_confidence: cluster.cluster_confidence,
      storyline_strategic_value: cluster.strategic_value,
      won_by_preferred_substitute: cluster.preferred_displaced_weak === true,
      storyline_key: buildStorylineFingerprint({
        entity_keys: cluster.entity_keys,
        storyline_hints: cluster.storyline_hints,
      }),
      freshness_key: buildFreshnessKey({
        ...(cluster.representative || {}),
        entity_keys: cluster.entity_keys,
        storyline_hints: cluster.storyline_hints,
        content_flags: Array.isArray(cluster.representative?.content_flags) ? cluster.representative.content_flags : [],
      }),
    };
  });
}

function applyStrategicQualityGate(items = [], opts = {}) {
  const candidates = Array.isArray(items) ? items : [];
  if (!candidates.length) return [];

  const minStrategicValue = clamp(opts.minStrategicValue != null ? opts.minStrategicValue : 0.34, 0, 1);
  const maxRoutineScore = clamp(opts.maxRoutineScore != null ? opts.maxRoutineScore : 0.65, 0, 1);
  const minKeep = Math.max(1, Number(opts.minKeep || 3));

  const kept = candidates.filter((item) => (
    !item?.hard_exclude
    && Number(item?.strategic_value || 0) >= minStrategicValue
    && Number(item?.routine_item_score || 0) <= maxRoutineScore
  ));
  if (kept.length >= minKeep) return kept;

  const fallback = candidates
    .filter((item) => !item?.hard_exclude)
    .sort((left, right) => {
      const leftScore = Number(left?.strategic_value || 0) - Number(left?.routine_item_score || 0) * 0.35;
      const rightScore = Number(right?.strategic_value || 0) - Number(right?.routine_item_score || 0) * 0.35;
      return rightScore - leftScore;
    });
  if (fallback.length > 0) return fallback.slice(0, Math.max(minKeep, kept.length));

  return candidates
    .slice()
    .sort((left, right) => Number(right?.strategic_value || 0) - Number(left?.strategic_value || 0))
    .slice(0, 1);
}

function buildRecentEntityHistory(records = [], maxDigests = 3) {
  const history = Array.isArray(records) ? records.slice(0, Math.max(0, Number(maxDigests || 3))) : [];
  const entityCounts = {};
  const storylineKeys = new Set();

  for (const record of history) {
    const items = Array.isArray(record?.items) ? record.items : [];
    for (const item of items) {
      const entityKeys = Array.isArray(item?.entity_keys) ? item.entity_keys : [];
      for (const entityKey of entityKeys) {
        entityCounts[entityKey] = (entityCounts[entityKey] || 0) + 1;
      }
      const storylineKey = String(item?.storyline_key || "").trim();
      if (storylineKey) storylineKeys.add(storylineKey);
    }
  }

  return {
    entityCounts,
    storylineKeys,
  };
}

function applyEntityCoverageCap(items = [], maxPerEntity = 1) {
  const limit = Math.max(1, Number(maxPerEntity || 1));
  const counts = {};
  const kept = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const entityKeys = Array.isArray(item?.entity_keys) ? item.entity_keys : [];
    if (entityKeys.length === 0) {
      kept.push(item);
      continue;
    }
    const blocked = entityKeys.some((entityKey) => (counts[entityKey] || 0) >= limit);
    if (blocked) continue;
    kept.push(item);
    for (const entityKey of entityKeys) {
      counts[entityKey] = (counts[entityKey] || 0) + 1;
    }
  }
  return kept;
}

module.exports = {
  HARD_EXCLUDE_FLAGS,
  annotateEditorialSignals,
  applyEntityCoverageCap,
  applyStrategicQualityGate,
  buildRecentEntityHistory,
  buildStorylineCandidates,
  buildStorylineFingerprint,
  classifySourceTierBaseline,
  classifySourceTier,
  classifySourceType,
  clusterStorylines,
  computeOriginalitySignal,
  computeStrategicValue,
  computeTopicDomainFit,
  detectLocalContentFlags,
  explainSourcePolicy,
  extractEntityKeys,
  isWeakSourceItem,
  normalizeSourceDomain,
  setAdminSourceRegistry,
  setLearnedDomainAdjustments,
  setPreferredSourceRegistry,
  storylineSimilarity,
};
