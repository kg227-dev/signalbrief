"use strict";

const crypto = require("crypto");
const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("./topic-domain-runtime");

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

// Source type classification for originality detection
const SOURCE_TYPE_MAP = Object.freeze({
  primary: [
    "sec.gov", "fda.gov", "cms.gov", "treasury.gov", "federalreserve.gov",
    "whitehouse.gov", "congress.gov", "irs.gov",
  ],
  wire: [
    "businesswire.com", "prnewswire.com", "globenewswire.com",
    "accesswire.com", "newswire.com",
  ],
  top_tier: [
    "reuters.com", "bloomberg.com", "ft.com", "wsj.com",
    "nytimes.com", "economist.com", "apnews.com",
    "washingtonpost.com", "bbc.com", "theguardian.com",
  ],
  aggregator: [
    "investing.com", "barchart.com", "benzinga.com",
    "financialcontent.com", "seekingalpha.com", "fool.com",
    "stockstotrade.com", "mexc.com",
  ],
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
  let d = String(raw || "").trim().toLowerCase().replace(/^www\./, "");
  // Strip common non-content subdomains so ng.investing.com → investing.com
  d = d.replace(/^(?:ng|m|amp|mobile|rss|feeds|api|cdn|static|images)\./i, "");
  // Strip single-letter subdomains (e.g., t.co-style but for longer domains)
  d = d.replace(/^[a-z]\./i, "");
  return d;
}

// Learned domain authority adjustments (populated at runtime via setLearnedDomainAdjustments)
let _learnedAdjustments = null;

function setLearnedDomainAdjustments(adjustmentsMap) {
  _learnedAdjustments = adjustmentsMap instanceof Map ? adjustmentsMap : null;
}

function classifySourceTier(sourceDomainRaw, tag) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) return { source_tier: "unknown", source_authority: 0.45, topic_fit: 0 };

  let baseTier = null;
  let baseScore = 0;
  for (const [sourceTier, rule] of Object.entries(SOURCE_TIER_RULES)) {
    if (rule.domains.some((domain) => sourceDomain === domain || sourceDomain.endsWith(`.${domain}`))) {
      baseTier = sourceTier;
      baseScore = rule.score;
      break;
    }
  }

  if (!baseTier) {
    if (sourceDomain.endsWith(".medium.com")) {
      baseTier = "weak";
      baseScore = 0.28;
    } else if (sourceDomain.includes("blog.") || sourceDomain.includes(".blog")) {
      baseTier = "blog";
      baseScore = 0.48;
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
      baseScore = 0.30;
    }
  }

  // Apply learned domain authority for unknown/suspect domains
  if ((baseTier === "unknown" || baseTier === "suspect") && _learnedAdjustments && _learnedAdjustments.has(sourceDomain)) {
    const learned = _learnedAdjustments.get(sourceDomain);
    if (Number.isFinite(learned) && learned > 0) {
      baseScore = learned;
      if (learned >= 0.45) baseTier = "learned-standard";
      else if (learned <= 0.18) baseTier = "learned-suspect";
    }
  }

  // Apply topic-domain fit overrides
  const fit = computeTopicDomainFit(sourceDomain, tag);
  const finalScore = fit.overrideScore != null && fit.overrideScore > baseScore
    ? fit.overrideScore
    : baseScore;

  return {
    source_tier: baseTier,
    source_authority: finalScore,
    topic_fit: fit.topicFit,
  };
}

function computeTopicDomainFit(sourceDomain, tag) {
  if (!tag || !sourceDomain) return { overrideScore: null, topicFit: 0 };
  const tagToken = normalizeTopicToken(tag);
  const overrides = TOPIC_AUTHORITY_OVERRIDES[sourceDomain];
  if (!overrides) return { overrideScore: null, topicFit: 0 };

  // Direct match
  if (overrides[tagToken] != null) {
    return { overrideScore: overrides[tagToken], topicFit: 1.0 };
  }

  // Related topic match
  for (const [overrideTag, overrideVal] of Object.entries(overrides)) {
    if (topicsRelated(tagToken, overrideTag)) {
      return { overrideScore: overrideVal, topicFit: 0.7 };
    }
  }

  return { overrideScore: null, topicFit: 0 };
}

function classifySourceType(sourceDomainRaw) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) return "unknown";

  for (const [sourceType, domains] of Object.entries(SOURCE_TYPE_MAP)) {
    if (domains.some((d) => sourceDomain === d || sourceDomain.endsWith(`.${d}`))) {
      return sourceType;
    }
  }
  if (sourceDomain.includes("blog.") || sourceDomain.includes(".blog") || sourceDomain.endsWith(".medium.com")) {
    return "blog";
  }
  return "unknown";
}

function computeOriginalitySignal(item, sourceInfo) {
  const sourceType = sourceInfo?.source_type || "unknown";
  let score = 1.0;

  // Source type penalties
  if (sourceType === "wire") score = 0.5;
  else if (sourceType === "aggregator") score = 0.35;
  else if (sourceType === "blog" || sourceInfo?.source_tier === "suspect") score = 0.4;

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
  if (sourceType !== "wire" && sourceType !== "primary" && sourceInfo?.source_tier !== "corporate") {
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
  if (flags.has("guidance")) bonus += 0.04;
  if (flags.has("earnings")) bonus += 0.03;
  if (flags.has("product_launch")) bonus += 0.03;
  if (flags.has("generic_commentary")) bonus -= 0.14;
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
    const sourceType = classifySourceType(item?.source_domain || item?.source);
    const extendedSourceInfo = { ...sourceInfo, source_type: sourceType };
    const originalitySignal = computeOriginalitySignal(item, extendedSourceInfo);
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
      source_type: sourceType,
      topic_fit: Number((sourceInfo.topic_fit || 0).toFixed(3)),
      originality_signal: Number(originalitySignal.toFixed(3)),
      routine_item_score: Number(routineItemScore.toFixed(3)),
      strategic_value: Number(strategicValue.toFixed(3)),
      hard_exclude: hardExclude,
      storyline_key: buildStorylineFingerprint({
        ...item,
        entity_keys: entityKeys,
        storyline_hints: storylineHints,
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

function chooseRepresentative(items) {
  const ranked = (Array.isArray(items) ? items : []).slice().sort((left, right) => {
    const leftScore = (
      Number(left?.strategic_value || 0) * 0.40
      + Number(left?.source_authority || 0) * 0.24
      + clamp(Number(left?.baseScore || 0) / 10, 0, 1) * 0.16
      + (1 - Number(left?.routine_item_score || 0)) * 0.10
      + Number(left?.originality_signal || 0.5) * 0.10
    );
    const rightScore = (
      Number(right?.strategic_value || 0) * 0.40
      + Number(right?.source_authority || 0) * 0.24
      + clamp(Number(right?.baseScore || 0) / 10, 0, 1) * 0.16
      + (1 - Number(right?.routine_item_score || 0)) * 0.10
      + Number(right?.originality_signal || 0.5) * 0.10
    );
    return rightScore - leftScore;
  });
  return ranked[0] || null;
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
  const primaryTypes = new Set(["primary", "top_tier"]);
  const hasPrimary = cluster.items.some((item) => primaryTypes.has(item.source_type));
  if (!hasPrimary) return;
  for (const item of cluster.items) {
    if (primaryTypes.has(item.source_type)) continue;
    const sourceType = item.source_type || "unknown";
    if (sourceType === "wire" || sourceType === "aggregator" || sourceType === "blog"
      || item.source_tier === "suspect" || item.source_tier === "weak") {
      item.derivative_of_primary = true;
      item.originality_signal = clamp(Number(item.originality_signal || 0.5) - 0.15, 0, 1);
    }
  }
}

function buildStorylineCandidates(items = []) {
  return clusterStorylines(items).map((cluster) => {
    flagClusterDerivatives(cluster);
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
      storyline_key: buildStorylineFingerprint({
        entity_keys: cluster.entity_keys,
        storyline_hints: cluster.storyline_hints,
      }),
    };
  });
}

function applyStrategicQualityGate(items = [], opts = {}) {
  const candidates = Array.isArray(items) ? items : [];
  if (!candidates.length) return [];

  const minStrategicValue = clamp(opts.minStrategicValue != null ? opts.minStrategicValue : 0.34, 0, 1);
  const maxRoutineScore = clamp(opts.maxRoutineScore != null ? opts.maxRoutineScore : 0.74, 0, 1);
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
  classifySourceTier,
  classifySourceType,
  clusterStorylines,
  computeOriginalitySignal,
  computeStrategicValue,
  computeTopicDomainFit,
  detectLocalContentFlags,
  extractEntityKeys,
  normalizeSourceDomain,
  setLearnedDomainAdjustments,
  storylineSimilarity,
};
