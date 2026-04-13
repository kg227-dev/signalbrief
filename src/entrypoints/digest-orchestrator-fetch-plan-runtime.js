"use strict";

const { MVP_TOPIC_TAGS, isMvpTopic } = require("../platform/config/mvp-topics");
const { canonicalizeMvpTopicTag } = require("../runtime/topic-normalization-runtime");

const DEFAULT_SEARCH_BUDGET = Object.freeze({
  scheduled: Object.freeze({
    soft_calls: 24,
    hard_calls: 36,
  }),
});
const STANDARD_ONLY_AGGRESSIVE_RUN_MODES = new Set(["standard_topics", "standard_phase1"]);
const PHASE1_STANDARD_TOPIC_TAGS = new Set(MVP_TOPIC_TAGS);
const PHASE1_FOCUS_STANDARD_TOPIC_TAGS = new Set([
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
]);
const TRACKED_TOPIC_QUERY_OVERRIDES = Object.freeze({
  HEALTHCARE: Object.freeze([
    "hospital system merger acquisition payer provider strategy Reuters Modern Healthcare STAT last 48 hours",
    "Medicare Advantage payer provider value-based care CMS hospital strategy last 48 hours",
    "clinical AI hospital operations FDA healthcare rollout provider strategy last 48 hours",
    "health system labor reimbursement payer prior authorization healthcare last 48 hours",
  ]),
  "FINANCIAL SERVICES": Object.freeze([
    "bank regulation capital liquidity private credit lending Reuters Bloomberg FT WSJ last 48 hours",
    "Federal Reserve OCC FDIC CFPB bank supervision capital rule last 48 hours",
    "payments cards fintech bank partnership enforcement last 48 hours",
    "asset management insurance wealth regulation strategy last 48 hours",
  ]),
  ENERGY: Object.freeze([
    "utility grid transmission interconnection power demand policy Reuters Utility Dive FERC last 48 hours",
    "renewables battery storage utility strategy power demand last 48 hours",
    "oil gas LNG refinery energy markets capex strategy last 48 hours",
    "transformer transmission data center load energy reliability last 48 hours",
  ]),
  "CONSUMER & RETAIL": Object.freeze([
    "retail earnings pricing promotion store traffic consumer demand Reuters WSJ last 48 hours",
    "consumer brand strategy supply chain tariff pricing last 48 hours",
    "ecommerce marketplace retail media grocery apparel last 48 hours",
    "restaurant grocery apparel retail restructuring antitrust FTC last 48 hours",
  ]),
  "LIFE SCIENCES": Object.freeze([
    "FDA approval clinical trial pharma licensing biotech STAT Fierce last 48 hours",
    "biopharma M&A licensing deal trial readout last 48 hours",
    "drug pricing obesity drug biotech manufacturing last 48 hours",
    "clinical readout trial setback biotech financing last 48 hours",
  ]),
  TECHNOLOGY: Object.freeze([
    "enterprise software cloud infrastructure CIO platform strategy Reuters Bloomberg FT WSJ last 48 hours",
    "data center AI infrastructure enterprise tech capex export controls last 48 hours",
    "cybersecurity enterprise software vendor strategy regulation last 48 hours",
    "semiconductor cloud enterprise platform pricing product launch Reuters Bloomberg last 48 hours",
  ]),
  INDUSTRIALS: Object.freeze([
    "manufacturing automation reshoring supply chain industrial strategy Reuters last 48 hours",
    "aerospace defense logistics freight industrial demand last 48 hours",
    "factory capex industrial order book pricing last 48 hours",
    "procurement tariff trade industrial supply chain last 48 hours",
  ]),
});
const THIN_TOPIC_QUERY_EXPANSIONS = Object.freeze({
  HEALTHCARE: Object.freeze([
    "hospital investment partnership operations cost margin healthcare regulatory impact last 48 hours",
    "provider payer M&A partnership strategy reimbursement cost margin last 48 hours",
  ]),
  "CONSUMER & RETAIL": Object.freeze([
    "retail investment partnership operations cost margin consumer strategy last 48 hours",
    "grocery apparel restaurant retail regulatory impact M&A margin last 48 hours",
  ]),
  "LIFE SCIENCES": Object.freeze([
    "biotech investment partnership operations cost margin regulatory impact last 48 hours",
    "biopharma M&A partnership manufacturing strategy margin clinical operations last 48 hours",
  ]),
  INDUSTRIALS: Object.freeze([
    "industrial investment partnership operations cost margin manufacturing regulatory impact last 48 hours",
    "supply chain logistics factory M&A strategy operations margin last 48 hours",
  ]),
});
const TRACKED_DEEP_STANDARD_TAGS = new Set(MVP_TOPIC_TAGS);
const FULL_EXHAUST_STANDARD_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
]);

function resolveSelectionTarget(dueUsers, defaultItemCount = 5) {
  return 5;
}

function buildTagPriority(dueUsers, normalizeTopicToken) {
  const topicNormalizer = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").toLowerCase().trim();
  const priority = {};
  for (const user of (Array.isArray(dueUsers) ? dueUsers : [])) {
    for (const topic of (Array.isArray(user?.topics) ? user.topics : [])) {
      const key = topicNormalizer(topic);
      if (!key) continue;
      priority[key] = (priority[key] || 0) + 1;
    }
  }
  return priority;
}

function sanitizeConfigTopicsToMvp(configTopics = []) {
  const seenTags = new Set();
  const topics = [];
  for (const rawTopic of (Array.isArray(configTopics) ? configTopics : [])) {
    const canonicalTag = canonicalizeMvpTopicTag(rawTopic?.tag);
    if (!canonicalTag || seenTags.has(canonicalTag)) continue;
    seenTags.add(canonicalTag);
    const overrideQueries = TRACKED_TOPIC_QUERY_OVERRIDES[canonicalTag];
    topics.push({
      ...(rawTopic && typeof rawTopic === "object" ? rawTopic : {}),
      tag: canonicalTag,
      queries: Array.isArray(overrideQueries) && overrideQueries.length > 0
        ? overrideQueries.slice()
        : (Array.isArray(rawTopic?.queries) ? rawTopic.queries.slice() : []),
      thin_queries: Array.isArray(THIN_TOPIC_QUERY_EXPANSIONS[canonicalTag])
        ? THIN_TOPIC_QUERY_EXPANSIONS[canonicalTag].slice()
        : [],
    });
  }
  return topics;
}

function resolveTopicsToFetch({ configTopics, dueUsers, runMode, log }) {
  const topics = sanitizeConfigTopicsToMvp(configTopics);
  const logger = typeof log === "function" ? log : () => {};
  if (String(runMode || "").trim() === "admin_topic_audit_rerun") {
    const focusedTags = new Set(
      flattenDueUserTopics(dueUsers)
        .map((value) => canonicalizeMvpTopicTag(value))
        .filter(Boolean)
    );
    const focusedTopics = topics.filter((topic) => focusedTags.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Admin topic audit rerun: fetching ${focusedTopics.length}/${topics.length} topic(s) for ${Array.from(focusedTags).join(", ") || "none"}`);
    return focusedTopics;
  }
  if (String(runMode || "").trim() === "standard_core") {
    const focusedTags = buildFocusedStandardTagSet(dueUsers, (value) => String(value || "").trim().toUpperCase());
    const focusedTopics = topics.filter((topic) => focusedTags.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Focused eval: fetching ${focusedTopics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return focusedTopics;
  }
  if (String(runMode || "").trim() === "standard_phase1") {
    const phase1Topics = topics.filter((topic) => PHASE1_STANDARD_TOPIC_TAGS.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Phase 1 eval: fetching ${phase1Topics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return phase1Topics;
  }
  if (String(runMode || "").trim() === "standard_phase1_focus") {
    const focusTopics = topics.filter((topic) => PHASE1_FOCUS_STANDARD_TOPIC_TAGS.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Focused Phase 1 eval: fetching ${focusTopics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return focusTopics;
  }
  if (isAggressiveStandardRun(runMode)) {
    const focusedTags = buildAllStandardTagSet(dueUsers, (value) => String(value || "").trim().toUpperCase());
    const focusedTopics = topics.filter((topic) => focusedTags.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Standard-only eval: fetching ${focusedTopics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return focusedTopics;
  }
  return topics;
}

function isTrackedDeepCoverageState(state) {
  const tag = String(state?.topic?.tag || "").trim().toUpperCase();
  return TRACKED_DEEP_STANDARD_TAGS.has(tag);
}

function buildFocusedStandardTagSet(dueUsers = [], normalizeTopicToken = (value) => String(value || "").trim().toUpperCase()) {
  const normalized = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").trim().toUpperCase();
  const focused = new Set();
  for (const topic of flattenDueUserTopics(dueUsers)) {
    const key = canonicalizeMvpTopicTag(topic) || String(normalized(topic) || "").trim().toUpperCase();
    if (!key) continue;
    if (FULL_EXHAUST_STANDARD_TAGS.has(key)) focused.add(key);
  }
  return focused;
}

function buildAllStandardTagSet(dueUsers = [], normalizeTopicToken = (value) => String(value || "").trim().toUpperCase()) {
  const normalized = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").trim().toUpperCase();
  const focused = new Set();
  for (const topic of flattenDueUserTopics(dueUsers)) {
    const key = canonicalizeMvpTopicTag(topic) || String(normalized(topic) || "").trim().toUpperCase();
    if (!isMvpTopic(key)) continue;
    focused.add(key);
  }
  return focused;
}

function isFocusedStandardDeepCoverageState(state, focusedStandardTags) {
  const tag = String(state?.topic?.tag || "").trim().toUpperCase();
  return focusedStandardTags instanceof Set && focusedStandardTags.has(tag);
}

function flattenDueUserTopics(dueUsers = []) {
  const topics = [];
  for (const user of (Array.isArray(dueUsers) ? dueUsers : [])) {
    for (const topic of (Array.isArray(user?.topics) ? user.topics : [])) {
      topics.push(topic);
    }
  }
  return topics;
}

function isAggressiveStandardRun(runMode) {
  return STANDARD_ONLY_AGGRESSIVE_RUN_MODES.has(String(runMode || "").trim());
}

function toBoundedInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function resolveSearchBudget(digestConfig) {
  const configured = digestConfig?.search_budget || {};
  const modeKey = "scheduled";
  const modeDefaults = DEFAULT_SEARCH_BUDGET[modeKey];
  const modeConfigured = configured?.[modeKey] || {};
  const hardCalls = toBoundedInt(modeConfigured?.hard_calls, modeDefaults.hard_calls, { min: 1, max: 200 });
  const softCalls = Math.min(
    hardCalls,
    toBoundedInt(modeConfigured?.soft_calls, modeDefaults.soft_calls, { min: 1, max: 200 })
  );
  return {
    mode: modeKey,
    soft_calls: softCalls,
    hard_calls: hardCalls,
  };
}

function applyRunModeSearchBudgetOverrides(searchBudget, { runMode, standardTopicCount = 0 } = {}) {
  const base = searchBudget && typeof searchBudget === "object" ? searchBudget : resolveSearchBudget({});
  if (!isAggressiveStandardRun(runMode)) return base;
  const standardCount = Math.max(0, Number(standardTopicCount || 0));
  return {
    ...base,
    soft_calls: Math.max(base.soft_calls, Math.min(96, (standardCount * 3) + 8)),
    hard_calls: Math.max(base.hard_calls, Math.min(120, (standardCount * 4) + 12)),
  };
}

module.exports = {
  applyRunModeSearchBudgetOverrides,
  buildAllStandardTagSet,
  buildFocusedStandardTagSet,
  buildTagPriority,
  flattenDueUserTopics,
  isAggressiveStandardRun,
  isFocusedStandardDeepCoverageState,
  isTrackedDeepCoverageState,
  resolveSearchBudget,
  resolveSelectionTarget,
  resolveTopicsToFetch,
};
