"use strict";

const {
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
} = require("../../../test-harness/personas/persona-topics");
const { normalizeTopicToken } = require("../../digest/domain/topic-domain-runtime");
const { CUSTOM_KEYWORD_SETS } = require("./constants-runtime");

const CAPABILITY_ANCHORS = Object.freeze({
  "AI×TECH": "TECHNOLOGY",
  "STRATEGY": "PE×M&A",
  "POLICY×REGULATORY": "PUBLIC SECTOR",
  "SUSTAINABILITY": "ENERGY",
  "DIGITAL": "CONSUMER",
  "M&A ADVISORY": "FINANCIAL SERVICES",
  "TALENT": "INDUSTRIALS",
});

const MIXED_PERSONAS = Object.freeze([
  {
    id: "mixed_health_policy",
    label: "Healthcare + Policy",
    topics: ["HEALTHCARE", "LIFE SCIENCES", "POLICY×REGULATORY"],
    group: "mixed_realistic",
  },
  {
    id: "mixed_ai_strategy",
    label: "AI + Strategy",
    topics: ["AI×TECH", "TECHNOLOGY", "STRATEGY"],
    group: "mixed_realistic",
  },
  {
    id: "mixed_fs_mna",
    label: "FS + M&A",
    topics: ["FINANCIAL SERVICES", "PE×M&A", "M&A ADVISORY"],
    group: "mixed_realistic",
  },
  {
    id: "mixed_energy_esg",
    label: "Energy + ESG",
    topics: ["ENERGY", "SUSTAINABILITY", "POLICY×REGULATORY"],
    group: "mixed_realistic",
  },
]);
const STANDARD_CORE_PERSONAS = Object.freeze([
  {
    id: "core_healthcare",
    label: "HEALTHCARE",
    topics: ["HEALTHCARE", "STRATEGY"],
    group: "standard_core",
  },
  {
    id: "core_life_sciences",
    label: "LIFE SCIENCES",
    topics: ["LIFE SCIENCES", "HEALTHCARE"],
    group: "standard_core",
  },
  {
    id: "core_technology",
    label: "TECHNOLOGY",
    topics: ["TECHNOLOGY", "AI×TECH"],
    group: "standard_core",
  },
  {
    id: "core_strategy",
    label: "STRATEGY",
    topics: ["STRATEGY", "PE×M&A"],
    group: "standard_core",
  },
  {
    id: "core_policy_regulatory",
    label: "POLICY×REGULATORY",
    topics: ["POLICY×REGULATORY", "PUBLIC SECTOR"],
    group: "standard_core",
  },
]);

function topicSlug(value) {
  return normalizeTopicToken(value).replace(/\s+/g, "_");
}

function buildVirtualUser({
  id,
  label,
  group,
  topics,
  itemsPerDigest = 5,
}) {
  const normalizedTopics = Array.from(new Set((Array.isArray(topics) ? topics : []).filter(Boolean)));
  return {
    chatId: `eval-${id}`,
    email: `eval-${id}@example.com`,
    name: label,
    eval_label: label,
    eval_group: group,
    status: "active",
    topics: normalizedTopics,
    topic_weights: {},
    source_preferences: {
      blocked_sources: [],
      trusted_sources: [],
    },
    preferences: {
      depth: "headline_plus_why",
      delivery_time: "07:00",
      days_of_week: [1, 2, 3, 4, 5],
      items_per_digest: itemsPerDigest,
      timezone: "America/New_York",
      email_enabled: false,
      telegram_enabled: false,
    },
    recent_digest_url_history: [],
    last_digest_items: [],
  };
}

function buildIndustryPersonas() {
  return INDUSTRY_TOPICS.map((topic) => buildVirtualUser({
    id: `industry_${topicSlug(topic)}`,
    label: topic,
    group: "industry",
    topics: [topic, "STRATEGY"],
  }));
}

function buildCapabilityPersonas() {
  return CAPABILITY_TOPICS.map((topic) => buildVirtualUser({
    id: `capability_${topicSlug(topic)}`,
    label: topic,
    group: "capability",
    topics: [topic, CAPABILITY_ANCHORS[topic] || "TECHNOLOGY"],
  }));
}

function buildMixedPersonas() {
  return MIXED_PERSONAS.map((persona) => buildVirtualUser({
    id: persona.id,
    label: persona.label,
    group: persona.group,
    topics: persona.topics,
  }));
}

function buildStandardCorePersonas() {
  return STANDARD_CORE_PERSONAS.map((persona) => buildVirtualUser({
    id: persona.id,
    label: persona.label,
    group: persona.group,
    topics: persona.topics,
  }));
}

function buildStandardTopicPersonas() {
  return [
    ...buildIndustryPersonas().map((user) => ({ ...user, eval_group: "standard_topics" })),
    ...buildCapabilityPersonas().map((user) => ({ ...user, eval_group: "standard_topics" })),
  ];
}

function buildCustomPersonas(keywords, group) {
  return (Array.isArray(keywords) ? keywords : []).map((keyword) => {
    const anchorTopic = group === "custom_adversarial" ? "AI×TECH" : "STRATEGY";
    const slug = normalizeTopicToken(keyword).replace(/\s+/g, "_");
    return buildVirtualUser({
      id: `${group}_${slug}`,
      label: keyword,
      group,
      topics: [anchorTopic, `custom_${slug}`],
    });
  });
}

function buildScenarioRoster(scenarioId) {
  if (scenarioId === "standard_full") {
    return [
      ...buildIndustryPersonas(),
      ...buildCapabilityPersonas(),
      ...buildMixedPersonas(),
    ];
  }
  if (scenarioId === "custom_realistic") {
    return buildCustomPersonas(CUSTOM_KEYWORD_SETS.realistic, "custom_realistic");
  }
  if (scenarioId === "custom_adversarial") {
    return buildCustomPersonas(CUSTOM_KEYWORD_SETS.adversarial, "custom_adversarial");
  }
  if (scenarioId === "standard_core") {
    return buildStandardCorePersonas();
  }
  if (scenarioId === "standard_topics") {
    return buildStandardTopicPersonas();
  }
  return [];
}

function buildScenarioDefinition(scenarioId) {
  const roster = buildScenarioRoster(scenarioId);
  return {
    id: scenarioId,
    label: scenarioId.replace(/_/g, " "),
    dueUsers: roster,
    personaCount: roster.length,
  };
}

function buildScenarioMatrix(scenarios) {
  return (Array.isArray(scenarios) ? scenarios : []).map(buildScenarioDefinition).filter((scenario) => scenario.dueUsers.length > 0);
}

module.exports = {
  buildCapabilityPersonas,
  buildIndustryPersonas,
  buildMixedPersonas,
  buildStandardCorePersonas,
  buildScenarioDefinition,
  buildScenarioMatrix,
  buildScenarioRoster,
  buildStandardTopicPersonas,
  buildVirtualUser,
};
