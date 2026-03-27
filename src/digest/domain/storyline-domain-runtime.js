"use strict";

const crypto = require("crypto");
const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("./topic-domain-runtime");
const {
  parseSourceIdentity,
} = require("./source-domain-runtime");
const { buildFreshnessKey } = require("../runtime/repeat-freshness-runtime");
const {
  normalizeSourceIdentityKey,
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
      "endpointsnews.com", "americanbanker.com", "bankingdive.com", "paymentsdive.com",
      "pitchbook.com", "pehub.com", "mergermarket.com", "globalcompetitionreview.com",
      "govexec.com", "federalnewsnetwork.com", "route-fifty.com", "nextgov.com",
      "trellis.net", "responsible-investor.com",
      "datacenterknowledge.com", "informationweek.com", "techtarget.com", "cio.com",
      "costar.com", "bisnow.com", "powermag.com", "heatmap.news",
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
      "manufacturingdive.com",
      "freightwaves.com", "modernretail.co", "chainstoreage.com", "progressivegrocer.com",
      "commercialobserver.com", "housingwire.com", "workforce.com", "staffingindustry.com",
      "canarymedia.com", "solarpowerworldonline.com",
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
  "federalregister.gov", "regulations.gov", "govinfo.gov", "ftc.gov", "justice.gov",
  "epa.gov", "energy.gov", "eia.gov", "ferc.gov", "hhs.gov", "nih.gov",
  "bls.gov", "dol.gov", "eeoc.gov", "uscis.gov", "gao.gov", "gsa.gov", "hud.gov",
  "bis.gov", "clinicaltrials.gov", "ema.europa.eu", "ec.europa.eu", "eur-lex.europa.eu", "iea.org",
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
  "endpointsnews.com", "americanbanker.com", "bankingdive.com", "paymentsdive.com",
  "pitchbook.com", "pehub.com", "mergermarket.com", "globalcompetitionreview.com",
  "govexec.com", "federalnewsnetwork.com", "route-fifty.com", "nextgov.com",
  "trellis.net", "responsible-investor.com",
  "datacenterknowledge.com", "informationweek.com", "techtarget.com", "cio.com",
  "costar.com", "bisnow.com", "powermag.com", "heatmap.news",
  "healthaffairs.org", "statnews.com",
  "utilitydive.com", "energydive.com",
  "ciodive.com", "supplychaindive.com", "retaildive.com", "hrdive.com",
  "biopharmadive.com", "healthcaredive.com", "cybersecuritydive.com", "cfodive.com",
  "fiercepharma.com", "fierceelectronics.com", "fiercewireless.com",
  "morningstar.com", "barrons.com",
  "therecord.media", "darkreading.com",
  "freightwaves.com", "modernretail.co", "chainstoreage.com", "progressivegrocer.com",
  "commercialobserver.com", "housingwire.com", "workforce.com", "staffingindustry.com",
  "canarymedia.com", "solarpowerworldonline.com", "manufacturingdive.com",
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
  "youtu.be",
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
  "endpointsnews.com": { "healthcare": 0.88, "life sciences": 0.90 },
  "pharmavoice.com": { "healthcare": 0.85, "life sciences": 0.82 },
  // Sustainability / Energy specialists
  "esgtoday.com": { "sustainability": 0.90, "energy": 0.85 },
  "esgdive.com": { "sustainability": 0.90, "energy": 0.85 },
  "utilitydive.com": { "energy": 0.88, "sustainability": 0.82 },
  "energydive.com": { "energy": 0.88, "sustainability": 0.82 },
  "powermag.com": { "energy": 0.86, "sustainability": 0.78 },
  "heatmap.news": { "energy": 0.84, "sustainability": 0.88 },
  "canarymedia.com": { "energy": 0.86, "sustainability": 0.90 },
  "solarpowerworldonline.com": { "energy": 0.84, "sustainability": 0.88 },
  // Technology specialists
  "ciodive.com": { "technology": 0.85, "digital": 0.85, "ai tech": 0.82 },
  "techcrunch.com": { "technology": 0.80, "ai tech": 0.80, "digital": 0.78 },
  "zdnet.com": { "technology": 0.78, "digital": 0.78 },
  "theverge.com": { "technology": 0.78, "digital": 0.75 },
  "wired.com": { "technology": 0.85, "ai tech": 0.82 },
  "arstechnica.com": { "technology": 0.85 },
  "cybersecuritydive.com": { "technology": 0.85, "digital": 0.82 },
  "semianalysis.com": { "technology": 0.92, "ai tech": 0.94 },
  "theinformation.com": { "technology": 0.88, "ai tech": 0.88, "digital": 0.82 },
  "datacenterknowledge.com": { "technology": 0.86, "ai tech": 0.84, "digital": 0.82 },
  "informationweek.com": { "technology": 0.82, "digital": 0.84 },
  "techtarget.com": { "technology": 0.80, "digital": 0.82 },
  "cio.com": { "technology": 0.78, "digital": 0.82 },
  // Financial / Regulatory specialists
  "sec.gov": { "financial services": 0.98, "pe m a": 0.95, "policy regulatory": 0.95 },
  "fda.gov": { "healthcare": 0.98, "life sciences": 0.98 },
  "cms.gov": { "healthcare": 0.95, "public sector": 0.90 },
  "treasury.gov": { "financial services": 0.98, "policy regulatory": 0.95 },
  "federalreserve.gov": { "financial services": 0.98 },
  "cnbc.com": { "financial services": 0.85 },
  "barrons.com": { "financial services": 0.88 },
  "morningstar.com": { "financial services": 0.85 },
  "americanbanker.com": { "financial services": 0.90 },
  "bankingdive.com": { "financial services": 0.86 },
  "paymentsdive.com": { "financial services": 0.84 },
  "pitchbook.com": { "pe m a": 0.90, "m a advisory": 0.88, "strategy": 0.78 },
  "pehub.com": { "pe m a": 0.88, "m a advisory": 0.86 },
  "mergermarket.com": { "pe m a": 0.88, "m a advisory": 0.90 },
  "globalcompetitionreview.com": { "m a advisory": 0.86, "policy regulatory": 0.84 },
  "govexec.com": { "public sector": 0.88, "policy regulatory": 0.82 },
  "federalnewsnetwork.com": { "public sector": 0.88, "policy regulatory": 0.82 },
  "route-fifty.com": { "public sector": 0.86, "policy regulatory": 0.80 },
  "nextgov.com": { "public sector": 0.86, "digital": 0.82, "policy regulatory": 0.78 },
  // Industry / Supply chain
  "supplychaindive.com": { "industrials": 0.85, "consumer": 0.80 },
  "retaildive.com": { "consumer": 0.85 },
  "modernretail.co": { "consumer": 0.82, "digital": 0.78 },
  "chainstoreage.com": { "consumer": 0.78 },
  "progressivegrocer.com": { "consumer": 0.80 },
  "freightwaves.com": { "industrials": 0.82, "consumer": 0.72 },
  "manufacturingdive.com": { "industrials": 0.84 },
  "costar.com": { "real estate": 0.90 },
  "bisnow.com": { "real estate": 0.84 },
  "commercialobserver.com": { "real estate": 0.80 },
  "housingwire.com": { "real estate": 0.82, "financial services": 0.72 },
  // Strategy / Consulting
  "mckinsey.com": { "strategy": 0.88 },
  "bcg.com": { "strategy": 0.88 },
  "bain.com": { "strategy": 0.85, "pe m a": 0.85 },
  "hbr.org": { "strategy": 0.88 },
  "economist.com": { "strategy": 0.92, "financial services": 0.80, "policy regulatory": 0.78 },
  "semafor.com": { "strategy": 0.82, "technology": 0.76, "financial services": 0.74 },
  "trellis.net": { "sustainability": 0.90, "energy": 0.78 },
  "responsible-investor.com": { "sustainability": 0.88, "financial services": 0.74 },
  "workforce.com": { "talent": 0.82 },
  "staffingindustry.com": { "talent": 0.80 },
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

const EVENT_MARKER_CONTENT_FLAGS = Object.freeze({
  trial_readout: "evt:trial",
  m_and_a: "evt:deal",
  regulatory: "evt:regulatory",
  earnings: "evt:earnings",
  product_launch: "evt:launch",
  guidance: "evt:guidance",
  investor_relations: "evt:investor",
  conference_recap: "evt:conference",
});

const EVENT_ACTION_RULES = [
  { marker: "evt:deal", pattern: /\b(acquire|acquisition|buyout|merger|sell|sale|takeover|deal)\b/i },
  { marker: "evt:regulatory", pattern: /\b(rule|rules|regulation|regulatory|guidance|proposal|proposed|filing|disclosure|enforcement|deadline)\b/i },
  { marker: "evt:approval", pattern: /\b(approves?|approval|approved|clearance|cleared|authorization)\b/i },
  { marker: "evt:trial", pattern: /\b(phase ii|phase iii|trial|study|readout|clinical data|clinical)\b/i },
  { marker: "evt:earnings", pattern: /\b(earnings|results|quarter|q1|q2|q3|q4)\b/i },
  { marker: "evt:launch", pattern: /\b(launch|rollout|release|introduces?|debut)\b/i },
  { marker: "evt:funding", pattern: /\b(capex|capital expenditure|investment|investing|invests|raises?|funding)\b/i },
  { marker: "evt:partnership", pattern: /\b(partnership|partner(?:s|ed)?|collaboration|alliance)\b/i },
  { marker: "evt:leadership", pattern: /\b(appoint(?:s|ed)?|names?|hire(?:s|d)?|resigns?|steps down|chief financial officer|cfo|chief executive officer|ceo)\b/i },
];

const EVENT_MARKER_STOPWORDS = new Set([
  "about", "across", "after", "amid", "among", "around", "before", "below", "between",
  "beyond", "fresh", "from", "into", "latest", "more", "less", "much", "near", "news",
  "over", "their", "these", "those", "this", "through", "under", "very", "with", "without",
  "would", "could", "should", "report", "reports", "reporting", "says", "said", "faces",
  "face", "proposes", "proposal", "announces", "announced", "company", "companies", "market",
  "markets", "business", "industry", "industries", "giants", "firms", "shareholders", "record",
  "quarterly", "payout", "executives", "leaders", "strategy", "technology", "healthcare",
]);

const EVENT_BIGRAM_BLOCK_TOKENS = new Set([
  "approval", "approves", "approved", "deal", "deals", "disclosure", "earnings", "launch",
  "launches", "guidance", "regulatory", "rule", "rules", "study", "trial", "results", "proposal",
]);

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

function uniqPreserveOrder(values) {
  const seen = new Set();
  const out = [];
  for (const value of (Array.isArray(values) ? values : [])) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
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

function appendUniqueCode(list, code) {
  const normalized = String(code || "").trim();
  if (!normalized) return Array.isArray(list) ? list : [];
  const next = Array.isArray(list) ? list.slice() : [];
  if (!next.includes(normalized)) next.push(normalized);
  return next;
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

function isPlatformDomain(sourceDomainRaw) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) return false;
  return sourceDomain === "youtu.be"
    || matchesDomain(sourceDomain, "youtube.com")
    || matchesDomain(sourceDomain, "medium.com")
    || matchesDomain(sourceDomain, "substack.com");
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
    if (!resolvedTier && isPlatformDomain(sourceDomain)) resolvedTier = "weak";
    if (!resolvedTier && (sourceDomain.includes("blog.") || sourceDomain.includes(".blog"))) resolvedTier = "blog";
  }
  if (PRIMARY_OFFICIAL_DOMAINS.has(sourceDomain) || sourceDomain.endsWith(".gov")) return "primary_official";
  if (CORPORATE_PR_DOMAINS.has(sourceDomain) || isCorporateAnnouncementDomain(sourceDomain)) return "corporate_pr";
  if (isPlatformDomain(sourceDomain)) return "platform_user_generated";
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
  return "allowed";
}

function deriveReviewStatusFromBaseline(baseTier, sourceType) {
  if (baseTier === "unknown" || baseTier === "suspect") return "unreviewed";
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

let _adminSourceRegistry = null;
let _preferredSourceRegistry = null;

function setAdminSourceRegistry(registryMap) {
  if (registryMap instanceof Map) {
    _adminSourceRegistry = {
      domains: registryMap,
      identities: new Map(),
    };
    return;
  }
  if (registryMap && typeof registryMap === "object") {
    const domains = registryMap.domains instanceof Map ? registryMap.domains : new Map();
    const identities = registryMap.identities instanceof Map ? registryMap.identities : new Map();
    _adminSourceRegistry = { domains, identities };
    return;
  }
  _adminSourceRegistry = null;
}

function setPreferredSourceRegistry(registry) {
  _preferredSourceRegistry = registry && typeof registry === "object" ? registry : null;
}

function resolveAdminSourceRegistryEntry(sourceDomain, sourceIdentityKey = null) {
  const normalizedDomain = normalizeSourceDomain(sourceDomain);
  const normalizedIdentityKey = normalizeSourceIdentityKey(sourceIdentityKey);
  if (!_adminSourceRegistry || (!normalizedDomain && !normalizedIdentityKey)) return null;
  const identityEntries = _adminSourceRegistry.identities instanceof Map ? _adminSourceRegistry.identities : new Map();
  if (normalizedIdentityKey && identityEntries.has(normalizedIdentityKey)) {
    return {
      match_scope: "identity",
      matched_identity_key: normalizedIdentityKey,
      matched_domain: null,
      entry: identityEntries.get(normalizedIdentityKey) || null,
    };
  }
  if (!normalizedDomain) return null;
  const domainEntries = _adminSourceRegistry.domains instanceof Map ? _adminSourceRegistry.domains : new Map();
  let bestMatch = null;
  for (const [domain, entry] of domainEntries.entries()) {
    const normalizedEntryDomain = normalizeSourceDomain(domain);
    if (!normalizedEntryDomain) continue;
    if (!matchesDomain(normalizedDomain, normalizedEntryDomain)) continue;
    if (!bestMatch || normalizedEntryDomain.length > bestMatch.matched_domain.length) {
      bestMatch = {
        match_scope: "domain",
        matched_domain: normalizedEntryDomain,
        matched_identity_key: null,
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
    } else if (sourceDomain.endsWith(".substack.com")) {
      baseTier = "weak";
      baseScore = 0.22;
      matchedRuleDomain = "substack.com";
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
    preserveLowBase: baseTier === "suspect",
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
    topic_override_score: fit.overrideScore,
    topic_override_applied: topicOverrideApplied,
    policy_source: topicOverrideApplied
      ? "topic_override"
      : "baseline",
    policy_effects: policyEffects,
    hard_block: false,
    source_family_domain: matchedRuleDomain || sourceDomain,
    inherits_from_domain: null,
    admin_override: null,
  };
}

function resolvePreferredSourceMatch(sourceDomain, tag, sourceIdentityKey = null) {
  if (!_preferredSourceRegistry) {
    return {
      match: "none",
      kind: null,
      scope: "none",
      topics: [],
      strength: 0,
      matched_domain: null,
      matched_identity: null,
    };
  }
  return matchPreferredSourceDomain(_preferredSourceRegistry, sourceDomain, tag, {
    sourceIdentityKey,
  });
}

function explainSourcePolicy(sourceDomainRaw, tag, options = {}) {
  const baseline = classifySourceTierBaseline(sourceDomainRaw, tag);
  const sourceDomain = String(baseline?.source_domain || "").trim();
  const sourceIdentityKey = normalizeSourceIdentityKey(options?.sourceIdentityKey);
  const adminMatch = resolveAdminSourceRegistryEntry(sourceDomain, sourceIdentityKey);
  if (!adminMatch || !adminMatch.entry) return baseline;

  const adminEntry = adminMatch.entry;
  const matchedScope = String(adminMatch.match_scope || "domain").trim() || "domain";
  const matchedDomain = String(adminMatch.matched_domain || "").trim() || null;
  const matchedIdentityKey = String(adminMatch.matched_identity_key || "").trim() || null;
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
      preserveLowBase: tierOverride === "suspect" || (!tierOverride && baseline.source_tier === "suspect"),
    });
  }
  if (authorityOverride != null) effectiveAuthority = authorityOverride;
  if (hardBlock) {
    effectiveTier = "blocked";
    effectiveAuthority = 0;
    policySource = "admin_hard_block";
  } else if (matchedScope === "identity") {
    policySource = "admin_identity_override";
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
    inherits_from_identity: matchedScope === "identity" ? matchedIdentityKey : null,
    admin_override: {
      domain: String(adminEntry?.domain || matchedDomain || sourceDomain).trim() || null,
      identity_key: String(adminEntry?.identity_key || matchedIdentityKey || "").trim() || null,
      match_domain: matchedDomain,
      match_identity_key: matchedIdentityKey,
      match_scope: matchedScope,
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

function classifySourceTier(sourceDomainRaw, tag, options = {}) {
  return explainSourcePolicy(sourceDomainRaw, tag, options);
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

function extractAmountMarkers(text) {
  const markers = [];
  const regex = /\b(?:\$|usd\s*)?(\d+(?:\.\d+)?)\s*(trillion|billion|million|bn|mn|b|m|t)\b/gi;
  let match;
  while ((match = regex.exec(String(text || ""))) !== null) {
    const amount = String(match[1] || "").trim();
    const unitRaw = String(match[2] || "").trim().toLowerCase();
    if (!amount || !unitRaw) continue;
    const unit = unitRaw === "trillion" || unitRaw === "t" ? "t"
      : (unitRaw === "billion" || unitRaw === "bn" || unitRaw === "b" ? "b" : "m");
    markers.push(`amt:${amount}${unit}`);
    if (markers.length >= 2) break;
  }
  return uniqPreserveOrder(markers);
}

function extractTimeMarkers(text) {
  const markers = [];
  const years = String(text || "").match(/\b20\d{2}\b/g) || [];
  for (const year of years) {
    markers.push(`year:${year}`);
    if (markers.length >= 2) break;
  }
  const quarters = String(text || "").match(/\bq[1-4]\b/gi) || [];
  for (const quarter of quarters) {
    markers.push(`quarter:${String(quarter).toLowerCase()}`);
    if (markers.length >= 4) break;
  }
  return uniqPreserveOrder(markers);
}

function buildIgnoredEventTokens(entityKeys, storylineHints) {
  const ignored = new Set();
  const primaryEntityKeys = Array.isArray(entityKeys) && entityKeys.length ? [entityKeys[0]] : [];
  for (const rawValue of uniqPreserveOrder([...primaryEntityKeys, ...(storylineHints || [])])) {
    for (const token of normalizeMatchText(rawValue).split(" ").filter(Boolean)) {
      ignored.add(token);
    }
  }
  return ignored;
}

function extractHeadlineBigramMarkers(text, entityKeys = [], storylineHints = []) {
  const ignoredTokens = buildIgnoredEventTokens(entityKeys, storylineHints);
  const tokens = normalizeMatchText(text)
    .split(" ")
    .filter((token) => token.length >= 4)
    .filter((token) => !EVENT_MARKER_STOPWORDS.has(token))
    .filter((token) => !ignoredTokens.has(token));
  const markers = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index];
    const right = tokens[index + 1];
    if (!left || !right || left === right) continue;
    if (EVENT_BIGRAM_BLOCK_TOKENS.has(left) && EVENT_BIGRAM_BLOCK_TOKENS.has(right)) continue;
    markers.push(`lex:${left}_${right}`);
    if (markers.length >= 4) break;
  }
  return uniqPreserveOrder(markers);
}

function buildEventMarkers(item, contentFlags = [], storylineHints = [], entityKeys = []) {
  const text = `${item?.headline || ""} ${item?.summary || ""} ${stripHtml(item?.wim || "")}`;
  const markers = [];
  for (const flag of (Array.isArray(contentFlags) ? contentFlags : [])) {
    const marker = EVENT_MARKER_CONTENT_FLAGS[String(flag || "").trim()];
    if (marker) markers.push(marker);
  }
  for (const hint of (Array.isArray(storylineHints) ? storylineHints : []).slice(0, 3)) {
    if (!hint) continue;
    markers.push(`hint:${hint}`);
  }
  for (const rule of EVENT_ACTION_RULES) {
    if (rule.pattern.test(text)) markers.push(rule.marker);
  }
  markers.push(...extractAmountMarkers(text));
  markers.push(...extractTimeMarkers(text));
  markers.push(...extractHeadlineBigramMarkers(item?.headline || "", entityKeys, storylineHints));
  return uniqPreserveOrder(markers).slice(0, 8);
}

function eventMarkerPriority(marker) {
  const value = String(marker || "").trim();
  if (!value) return 99;
  if (value.startsWith("amt:")) return 0;
  if (value.startsWith("year:") || value.startsWith("quarter:")) return 1;
  if (value.startsWith("hint:")) return 2;
  if (value.startsWith("lex:")) return 3;
  if (value.startsWith("evt:")) return 4;
  return 9;
}

function buildEventFingerprint(item) {
  const entityKeys = uniqPreserveOrder(Array.isArray(item?.entity_keys) ? item.entity_keys : []);
  const tagToken = normalizeTopicToken(item?.tag || "");
  const eventMarkers = uniqPreserveOrder(Array.isArray(item?.event_markers) ? item.event_markers : []);
  const baseKeys = entityKeys.length > 0
    ? entityKeys.slice(0, 1)
    : ((tagToken && !STANDARD_TOPIC_TOKENS.has(tagToken)) ? [tagToken] : []);
  const prioritizedMarkers = eventMarkers
    .slice()
    .sort((left, right) => eventMarkerPriority(left) - eventMarkerPriority(right) || String(left).localeCompare(String(right)))
    .slice(0, 4);
  const components = uniqPreserveOrder([...baseKeys, ...prioritizedMarkers]);
  if (components.length < 3) return "";
  if (baseKeys.length === 0 && prioritizedMarkers.length < 3) return "";
  return components.join("|");
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
  const eventFingerprint = buildEventFingerprint(item);
  if (eventFingerprint) return eventFingerprint;
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
    const sourceIdentity = parseSourceIdentity({
      ...item,
    });
    const sourceInfo = classifySourceTier(
      sourceIdentity.source_domain || item?.source_domain || item?.source,
      item?.tag,
      { sourceIdentityKey: sourceIdentity.source_identity_key }
    );
    const preferredSourceMatch = resolvePreferredSourceMatch(
      sourceInfo.source_domain || item?.source_domain || item?.source,
      item?.tag,
      sourceIdentity.source_identity_key
    );
    const originalitySignal = computeOriginalitySignal(item, sourceInfo);
    const storylineHints = buildStorylineHints(item, contentFlags, promptHints);
    const entityKeys = extractEntityKeys(item);
    const eventMarkers = buildEventMarkers(item, contentFlags, storylineHints, entityKeys);
    const eventFingerprint = buildEventFingerprint({
      ...item,
      tag: item?.tag,
      entity_keys: entityKeys,
      event_markers: eventMarkers,
    });
    const routineItemScore = computeRoutineItemScore(contentFlags, sourceInfo);
    const strategicValue = computeStrategicValue(item, sourceInfo, routineItemScore, contentFlags);
    const hardExclude = contentFlags.some((flag) => HARD_EXCLUDE_FLAGS.has(flag));

    return {
      ...item,
      content_flags: contentFlags,
      entity_keys: entityKeys,
      storyline_hints: storylineHints,
      event_markers: eventMarkers,
      event_fingerprint: eventFingerprint || null,
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
      source_platform: sourceIdentity.source_platform || null,
      source_identity_key: sourceIdentity.source_identity_key || sourceInfo.source_domain || item?.source_domain || "unknown",
      source_identity_scope: sourceIdentity.source_identity_scope || "domain",
      source_identity_label: sourceIdentity.source_identity_label || sourceInfo.source_domain || item?.source_domain || "unknown",
      source_identity_ambiguous: sourceIdentity.source_identity_ambiguous === true,
      topic_fit: Number((sourceInfo.topic_fit || 0).toFixed(3)),
      topic_fit_band: sourceInfo.topic_fit_band || null,
      topic_fit_map: sourceInfo.topic_fit_map || {},
      source_family_domain: sourceInfo.source_family_domain || item?.source_domain || item?.source || null,
      source_inherits_from_domain: sourceInfo.inherits_from_domain || null,
      source_inherits_from_identity: sourceInfo.inherits_from_identity || null,
      preferred_source_match: preferredSourceMatch.match || "none",
      preferred_source_kind: preferredSourceMatch.kind || null,
      preferred_source_match_scope: preferredSourceMatch.scope || "none",
      preferred_source_topics: Array.isArray(preferredSourceMatch.topics) ? preferredSourceMatch.topics : [],
      preferred_source_strength: Number(Number(preferredSourceMatch.strength || 0).toFixed(3)),
      preferred_source_domain: preferredSourceMatch.matched_domain || null,
      preferred_source_identity_key: preferredSourceMatch.matched_identity || null,
      retrieval_search_result_domains: Array.isArray(item?.retrieval_search_result_domains)
        ? item.retrieval_search_result_domains.slice(0, 10)
        : [],
      retrieval_preferred_search_domains: Array.isArray(item?.retrieval_preferred_search_domains)
        ? item.retrieval_preferred_search_domains.slice(0, 10)
        : [],
      preferred_source_available_in_search: item?.preferred_source_available_in_search === true
        && String(preferredSourceMatch.match || "none") === "none",
      originality_signal: Number(originalitySignal.toFixed(3)),
      routine_item_score: Number(routineItemScore.toFixed(3)),
      strategic_value: Number(strategicValue.toFixed(3)),
      hard_exclude: hardExclude || sourceInfo.hard_block === true,
      retrieval_pass: String(item?.retrieval_pass || "").trim() || null,
      suppressed_by_preferred_source: false,
      suppressed_by_derivative_source: false,
      preferred_close_substitute_penalty: 0,
      derivative_competitive_penalty: 0,
      derivative_confidence: 0,
      derivative_reason_codes: [],
      derivative_parent_domain: null,
      derivative_parent_identity_key: null,
      derivative_of_primary: false,
      suppression_reason_codes: [],
      selection_reason_codes: [],
      winner_selection_reason: null,
      specialist_trade_outperformed_preferred: false,
      coverage_gap_status: "no_preferred_signal",
      won_by_preferred_substitute: false,
      storyline_key: buildStorylineFingerprint({
        ...item,
        entity_keys: entityKeys,
        storyline_hints: storylineHints,
        event_markers: eventMarkers,
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
  const eventOverlap = jaccard(leftItem?.event_markers || [], rightItem?.event_markers || []);
  const textOverlap = headlineTokenOverlap(leftItem, rightItem);
  const tagRelated = topicsRelated(leftItem?.tag || "", rightItem?.tag || "") ? 1 : 0;
  const exactEventFingerprint = String(leftItem?.event_fingerprint || "").trim()
    && String(leftItem?.event_fingerprint || "").trim() === String(rightItem?.event_fingerprint || "").trim();

  if (exactEventFingerprint && (entityOverlap > 0 || eventOverlap >= 0.34 || tagRelated > 0)) return 0.92;

  if (
    entityOverlap > 0
    && eventOverlap === 0
    && hintOverlap === 0
    && textOverlap < 0.18
  ) {
    return 0;
  }

  if (entityOverlap >= 0.5 && eventOverlap >= 0.34) return 0.88;
  if (entityOverlap >= 0.5 && hintOverlap >= 0.34) return 0.86;
  if (eventOverlap >= 0.45 && (entityOverlap >= 0.25 || tagRelated > 0)) return 0.82;
  if (entityOverlap >= 0.5 && textOverlap >= 0.34) return 0.8;
  if (textOverlap >= 0.52 && (tagRelated > 0 || entityOverlap >= 0.2)) return 0.78;

  const weightedScore = (
    0.3 * entityOverlap
    + 0.22 * eventOverlap
    + 0.2 * hintOverlap
    + 0.18 * textOverlap
    + 0.1 * tagRelated
  );
  const trigramSim = headlineTrigramOverlap(leftItem, rightItem);
  if (trigramSim >= 0.35 && (tagRelated > 0 || eventOverlap >= 0.2)) {
    return Math.min(1, weightedScore + 0.12);
  }
  return weightedScore;
}

function hasPreferredSourceMatch(item) {
  return String(item?.preferred_source_match || "").trim().toLowerCase() !== "none";
}

function isOriginClusterCandidate(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  if (!isGovernanceEligiblePreferredItem(item)) return false;
  return sourceType === "primary_official"
    || sourceType === "reported_media"
    || sourceType === "trade_specialist";
}

function isDerivativeProneCandidate(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const originalityProfile = String(item?.originality_profile || "").trim().toLowerCase();
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceTier = String(item?.source_tier || "").trim().toLowerCase();
  return sourceType === "analysis_blog"
    || sourceType === "aggregator_republisher"
    || sourceType === "corporate_pr"
    || sourceType === "platform_user_generated"
    || sourcePolicy === "limited"
    || sourcePolicy === "review"
    || sourceTier === "weak"
    || sourceTier === "suspect"
    || originalityProfile === "derived_synthesis"
    || originalityProfile === "press_release_repost"
    || originalityProfile === "rewrite_aggregator";
}

function computePreferredRepresentativeBoost(item) {
  if (!isGovernanceEligiblePreferredItem(item)) return 0;
  let boost = Number(item?.preferred_source_strength || 0);
  if (String(item?.preferred_source_match_scope || "").trim().toLowerCase() === "publisher") boost += 0.08;
  else if (String(item?.preferred_source_match_scope || "").trim().toLowerCase() === "domain") boost += 0.03;
  return clamp(boost, 0, 1);
}

function computeRepresentativeScore(item, opts = {}) {
  const ignoreCompetitivePenalties = opts.ignoreCompetitivePenalties === true;
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const preferredBoost = computePreferredRepresentativeBoost(item);
  const primaryBonus = sourceType === "primary_official" ? 0.08 : 0;
  const originBonus = isOriginClusterCandidate(item) ? 0.04 : 0;
  const specialistFitBonus = sourceType === "trade_specialist"
    ? clamp(Number(item?.topic_fit || 0), 0, 1) * 0.07
    : 0;
  const platformAmbiguityPenalty = item?.source_identity_ambiguous === true ? 0.05 : 0;
  const availablePreferredPenalty = item?.preferred_source_available_in_search === true && isWeakClusterCandidate(item)
    ? 0.08
    : 0;
  const competitivePenalty = ignoreCompetitivePenalties
    ? 0
    : (
      Number(item?.preferred_close_substitute_penalty || 0) * 0.4
      + Number(item?.derivative_competitive_penalty || 0) * 0.45
    );

  return (
    Number(item?.strategic_value || 0) * 0.34
    + Number(item?.source_authority || 0) * 0.22
    + clamp(Number(item?.baseScore || 0) / 10, 0, 1) * 0.12
    + (1 - Number(item?.routine_item_score || 0)) * 0.08
    + Number(item?.originality_signal || 0.5) * 0.14
    + Number(item?.topic_fit || 0) * 0.08
    + preferredBoost * 0.09
    + primaryBonus
    + originBonus
    + specialistFitBonus
    - availablePreferredPenalty
    - platformAmbiguityPenalty
    - competitivePenalty
  );
}

function chooseRepresentative(items, opts = {}) {
  const ignoreCompetitivePenalties = opts.ignorePreferredSuppression === true || opts.ignoreCompetitivePenalties === true;
  const ranked = (Array.isArray(items) ? items : []).slice().map((item) => ({
    item,
    score: computeRepresentativeScore(item, { ignoreCompetitivePenalties }),
  })).sort((left, right) => right.score - left.score);
  const winner = ranked[0]?.item || null;
  if (!winner) return null;
  const winnerOfficial = String(winner?.content_kind || "").trim().toLowerCase() !== "article"
    || String(winner?.source_type || "").trim().toLowerCase() === "primary_official";
  if (!winnerOfficial) return winner;
  const reportedAlternative = ranked.find((entry) => {
    if (!entry?.item || entry.item === winner) return false;
    const sourceType = String(entry.item?.source_type || "").trim().toLowerCase();
    const contentKind = String(entry.item?.content_kind || "article").trim().toLowerCase();
    if (contentKind !== "article") return false;
    if (sourceType !== "reported_media" && sourceType !== "trade_specialist") return false;
    if (!isGovernanceEligiblePreferredItem(entry.item)) return false;
    return entry.score >= (ranked[0].score - 0.06);
  });
  return reportedAlternative?.item || winner;
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

function findBestComparableOriginCandidate(item, originCandidates = []) {
  let bestOrigin = null;
  let bestSimilarity = 0;
  for (const candidate of (Array.isArray(originCandidates) ? originCandidates : [])) {
    if (!candidate || candidate === item) continue;
    const similarity = storylineSimilarity(item, candidate);
    if (similarity < 0.58) continue;
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestOrigin = candidate;
    }
  }
  return {
    bestOrigin,
    similarity: bestSimilarity,
  };
}

function estimateDerivativeCompetition(item, originCandidate, similarity) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const originalityProfile = String(item?.originality_profile || "").trim().toLowerCase();
  const reasonCodes = [];
  let confidence = 0;

  if (!originCandidate || !isDerivativeProneCandidate(item)) {
    return {
      confidence: 0,
      penalty: 0,
      reasonCodes,
    };
  }

  if (sourceType === "aggregator_republisher" || sourceType === "corporate_pr" || sourceType === "platform_user_generated") {
    confidence += 0.34;
    reasonCodes.push("derivative_source_type");
  } else if (sourceType === "analysis_blog") {
    confidence += 0.18;
    reasonCodes.push("derived_analysis");
  }

  if (originalityProfile === "rewrite_aggregator" || originalityProfile === "press_release_repost") {
    confidence += 0.24;
    reasonCodes.push("low_originality_profile");
  } else if (originalityProfile === "derived_synthesis") {
    confidence += 0.12;
    reasonCodes.push("derived_synthesis_profile");
  }

  if (similarity >= 0.72) {
    confidence += 0.22;
    reasonCodes.push("close_story_overlap");
  } else if (similarity >= 0.58) {
    confidence += 0.12;
    reasonCodes.push("story_overlap");
  }

  const exactEventFingerprint = String(item?.event_fingerprint || "").trim()
    && String(item?.event_fingerprint || "").trim() === String(originCandidate?.event_fingerprint || "").trim();
  const eventOverlap = jaccard(item?.event_markers || [], originCandidate?.event_markers || []);
  if (exactEventFingerprint) {
    confidence += 0.18;
    reasonCodes.push("exact_event_fingerprint");
  } else if (eventOverlap >= 0.42) {
    confidence += 0.1;
    reasonCodes.push("event_marker_overlap");
  }

  if (Number(originCandidate?.originality_signal || 0) >= Number(item?.originality_signal || 0) + 0.12) {
    confidence += 0.12;
    reasonCodes.push("weaker_than_original");
  }

  if (item?.preferred_source_available_in_search === true && !hasPreferredSourceMatch(item)) {
    confidence += 0.08;
    reasonCodes.push("preferred_search_evidence");
  }

  let penalty = 0;
  if (confidence >= 0.62) penalty = 0.22;
  else if (confidence >= 0.45) penalty = 0.15;
  else if (confidence >= 0.32 && isWeakClusterCandidate(item)) penalty = 0.08;

  return {
    confidence: Number(clamp(confidence, 0, 1).toFixed(3)),
    penalty: Number(clamp(penalty, 0, 0.4).toFixed(3)),
    reasonCodes,
  };
}

function applyPreferredCloseSubstituteSuppression(cluster) {
  if (!cluster || !Array.isArray(cluster.items) || cluster.items.length < 2) {
    return {
      derivative_suppressed_count: 0,
      preferred_suppressed_count: 0,
      platform_identity_ambiguity_count: 0,
      preferred_candidate_count: 0,
      preferred_signal_present: false,
    };
  }
  const preferredCandidates = cluster.items.filter((item) => isStrongPreferredClusterCandidate(item));
  const originCandidates = cluster.items.filter((item) => isOriginClusterCandidate(item));
  const preferredSignalPresent = preferredCandidates.length > 0
    || cluster.items.some((item) => item?.preferred_source_available_in_search === true);

  for (const item of cluster.items) {
    item.preferred_close_substitute_penalty = 0;
    item.suppressed_by_preferred_source = false;
    item.preferred_substitute_domain = null;
    item.derivative_competitive_penalty = 0;
    item.derivative_confidence = 0;
    item.suppressed_by_derivative_source = false;
    item.derivative_reason_codes = [];
    item.derivative_parent_domain = null;
    item.derivative_parent_identity_key = null;
    item.derivative_of_primary = false;
    item.suppression_reason_codes = [];
    item.selection_reason_codes = Array.isArray(item.selection_reason_codes) ? item.selection_reason_codes : [];
  }

  const derivativeSuppressedItems = new Set();
  const preferredSuppressedItems = new Set();

  for (const item of cluster.items) {
    const { bestOrigin, similarity } = findBestComparableOriginCandidate(item, originCandidates);
    if (!bestOrigin || bestOrigin === item) continue;
    const derivative = estimateDerivativeCompetition(item, bestOrigin, similarity);
    if (derivative.penalty <= 0) continue;
    item.derivative_competitive_penalty = derivative.penalty;
    item.derivative_confidence = derivative.confidence;
    item.derivative_reason_codes = derivative.reasonCodes.slice();
    item.derivative_parent_domain = String(bestOrigin?.source_domain || bestOrigin?.source || "").trim() || null;
    item.derivative_parent_identity_key = String(bestOrigin?.source_identity_key || "").trim() || item.derivative_parent_domain;
    item.suppressed_by_derivative_source = true;
    item.derivative_of_primary = true;
    item.suppression_reason_codes = appendUniqueCode(item.suppression_reason_codes, "derivative_source_suppressed");
    for (const reasonCode of derivative.reasonCodes) {
      item.suppression_reason_codes = appendUniqueCode(item.suppression_reason_codes, reasonCode);
    }
    derivativeSuppressedItems.add(item);
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
    weakItem.preferred_close_substitute_penalty = Number(Math.max(
      weakItem.preferred_close_substitute_penalty || 0,
      bestSimilarity >= 0.75 ? 0.24 : 0.18
    ).toFixed(3));
    weakItem.suppressed_by_preferred_source = true;
    weakItem.preferred_substitute_domain = String(bestPreferred?.source_domain || bestPreferred?.source || "").trim() || null;
    weakItem.suppression_reason_codes = appendUniqueCode(weakItem.suppression_reason_codes, "preferred_close_substitute");
    weakItem.suppression_reason_codes = appendUniqueCode(
      weakItem.suppression_reason_codes,
      String(bestPreferred?.preferred_source_match_scope || "").trim().toLowerCase() === "publisher"
        ? "preferred_publisher_available"
        : "preferred_domain_available"
    );
    preferredSuppressedItems.add(weakItem);
  }

  return {
    derivative_suppressed_count: derivativeSuppressedItems.size,
    preferred_suppressed_count: preferredSuppressedItems.size,
    platform_identity_ambiguity_count: cluster.items.filter((item) => item?.source_identity_ambiguous === true).length,
    preferred_candidate_count: preferredCandidates.length,
    preferred_signal_present: preferredSignalPresent,
  };
}

function annotateClusterOutcome(cluster, baselineRepresentative, representative, competitionStats = {}) {
  if (!cluster || !representative) return {
    coverage_gap_status: "no_preferred_signal",
    specialist_trade_beat_preferred: false,
    broader_retrieval_found_better: false,
  };

  const strongPreferredAlternatives = cluster.items.filter((item) => item !== representative && isStrongPreferredClusterCandidate(item));
  const sharedEventFingerprint = cluster.items.some((item) => {
    if (!item || item === representative) return false;
    const exactFingerprint = String(representative?.event_fingerprint || "").trim()
      && String(item?.event_fingerprint || "").trim() === String(representative?.event_fingerprint || "").trim();
    if (exactFingerprint) return true;
    const eventOverlap = jaccard(representative?.event_markers || [], item?.event_markers || []);
    const entityOverlap = jaccard(representative?.entity_keys || [], item?.entity_keys || []);
    const tagRelated = topicsRelated(representative?.tag || "", item?.tag || "");
    return eventOverlap >= 0.42 && (entityOverlap > 0 || tagRelated);
  });
  const specialistTradeBeatPreferred = String(representative?.source_type || "").trim().toLowerCase() === "trade_specialist"
    && strongPreferredAlternatives.some((candidate) => canTradeSpecialistOutperformPreferred(representative, candidate));
  const hasPreferredSignal = competitionStats.preferred_signal_present === true;
  const preferredWinner = isStrongPreferredClusterCandidate(representative) || String(representative?.source_type || "").trim().toLowerCase() === "primary_official";
  const broaderRetrievalFoundBetter = String(representative?.retrieval_pass || "").trim().toLowerCase() === "broad"
    && hasPreferredSignal
    && !preferredWinner;

  let coverageGapStatus = "no_preferred_signal";
  if (preferredWinner) coverageGapStatus = "preferred_exists_and_should_win";
  else if (specialistTradeBeatPreferred) coverageGapStatus = "preferred_exists_but_weaker";
  else if (broaderRetrievalFoundBetter) coverageGapStatus = "preferred_missing";
  else if (hasPreferredSignal) coverageGapStatus = "preferred_exists_but_weaker";

  representative.coverage_gap_status = coverageGapStatus;
  representative.specialist_trade_outperformed_preferred = specialistTradeBeatPreferred;

  if (String(representative?.source_type || "").trim().toLowerCase() === "primary_official") {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "official_primary");
  }
  if (String(representative?.preferred_source_match_scope || "").trim().toLowerCase() === "publisher") {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "preferred_publisher_match");
  } else if (hasPreferredSourceMatch(representative)) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "preferred_domain_match");
  }
  if (specialistTradeBeatPreferred) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "specialist_trade_best_fit");
  }
  if (competitionStats.derivative_suppressed_count > 0) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "best_source_representation");
  }
  if (sharedEventFingerprint) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "canonical_event_match");
  }
  if (baselineRepresentative && baselineRepresentative !== representative) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "displaced_weaker_substitute");
  }
  if (broaderRetrievalFoundBetter) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "broad_fallback_better_source");
  }
  if (Number(representative?.derivative_confidence || 0) >= 0.35) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "best_available_derivative");
  } else if (Number(representative?.originality_signal || 0) >= 0.82) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "high_originality");
  }
  if (representative?.source_identity_ambiguous === true) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "platform_identity_ambiguous");
  }

  representative.winner_selection_reason = representative.selection_reason_codes[0] || "best_source_representation";
  return {
    coverage_gap_status: coverageGapStatus,
    specialist_trade_beat_preferred: specialistTradeBeatPreferred,
    broader_retrieval_found_better: broaderRetrievalFoundBetter,
  };
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
    const competitionStats = applyPreferredCloseSubstituteSuppression(cluster);
    const baselineRepresentative = chooseRepresentative(cluster.items, { ignoreCompetitivePenalties: true });
    const representative = chooseRepresentative(cluster.items);
    const outcome = annotateClusterOutcome(cluster, baselineRepresentative, representative, competitionStats);
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
      derivative_suppressed_count: Number(competitionStats.derivative_suppressed_count || 0),
      preferred_suppressed_count: Number(competitionStats.preferred_suppressed_count || 0),
      preferred_candidate_count: Number(competitionStats.preferred_candidate_count || 0),
      platform_identity_ambiguity_count: Number(competitionStats.platform_identity_ambiguity_count || 0),
      coverage_gap_status: outcome.coverage_gap_status,
      specialist_trade_beat_preferred: outcome.specialist_trade_beat_preferred === true,
      broader_retrieval_found_better: outcome.broader_retrieval_found_better === true,
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
      cluster_derivative_suppressed_count: Number(cluster.derivative_suppressed_count || 0),
      cluster_preferred_suppressed_count: Number(cluster.preferred_suppressed_count || 0),
      cluster_preferred_candidate_count: Number(cluster.preferred_candidate_count || 0),
      cluster_platform_identity_ambiguity_count: Number(cluster.platform_identity_ambiguity_count || 0),
      coverage_gap_status: cluster.coverage_gap_status || cluster.representative?.coverage_gap_status || "no_preferred_signal",
      specialist_trade_outperformed_preferred: cluster.specialist_trade_beat_preferred === true
        || (cluster.representative?.specialist_trade_outperformed_preferred === true),
      broader_retrieval_found_better: cluster.broader_retrieval_found_better === true,
      storyline_key: buildStorylineFingerprint({
        ...(cluster.representative || {}),
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
  setPreferredSourceRegistry,
  storylineSimilarity,
};
