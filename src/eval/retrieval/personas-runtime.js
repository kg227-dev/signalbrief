"use strict";

const {
  INDUSTRY_TOPICS,
} = require("../../../test-harness/personas/persona-topics");
const { normalizeTopicToken } = require("../../digest/domain/topic-domain-runtime");

const MIXED_PERSONAS = Object.freeze([
  {
    id: "mixed_health_lifesciences",
    label: "Healthcare + Life Sciences",
    topics: ["HEALTHCARE", "LIFE SCIENCES"],
    group: "mixed_realistic",
  },
  {
    id: "mixed_energy_finance",
    label: "Energy + Financial Services",
    topics: ["ENERGY", "FINANCIAL SERVICES"],
    group: "mixed_realistic",
  },
  {
    id: "mixed_consumer_industrials",
    label: "Consumer + Industrials",
    topics: ["CONSUMER & RETAIL", "INDUSTRIALS"],
    group: "mixed_realistic",
  },
  {
    id: "mixed_technology_triage",
    label: "Technology + Energy + Financial Services",
    topics: ["TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES"],
    group: "mixed_realistic",
  },
]);

const STANDARD_CORE_PERSONAS = Object.freeze([
  { id: "core_healthcare", label: "HEALTHCARE", topics: ["HEALTHCARE"], group: "standard_core" },
  { id: "core_life_sciences", label: "LIFE SCIENCES", topics: ["LIFE SCIENCES"], group: "standard_core" },
  { id: "core_technology", label: "TECHNOLOGY", topics: ["TECHNOLOGY"], group: "standard_core" },
  { id: "core_energy", label: "ENERGY", topics: ["ENERGY"], group: "standard_core" },
  { id: "core_financial_services", label: "FINANCIAL SERVICES", topics: ["FINANCIAL SERVICES"], group: "standard_core" },
]);

const STANDARD_PHASE1_PERSONAS = Object.freeze([
  { id: "phase1_healthcare", label: "HEALTHCARE", topics: ["HEALTHCARE"], group: "standard_phase1" },
  { id: "phase1_life_sciences", label: "LIFE SCIENCES", topics: ["LIFE SCIENCES"], group: "standard_phase1" },
  { id: "phase1_technology", label: "TECHNOLOGY", topics: ["TECHNOLOGY"], group: "standard_phase1" },
  { id: "phase1_energy", label: "ENERGY", topics: ["ENERGY"], group: "standard_phase1" },
  { id: "phase1_financial_services", label: "FINANCIAL SERVICES", topics: ["FINANCIAL SERVICES"], group: "standard_phase1" },
  { id: "phase1_consumer_retail", label: "CONSUMER & RETAIL", topics: ["CONSUMER & RETAIL"], group: "standard_phase1" },
  { id: "phase1_industrials", label: "INDUSTRIALS", topics: ["INDUSTRIALS"], group: "standard_phase1" },
]);

const STANDARD_PHASE1_FOCUS_PERSONAS = Object.freeze([
  { id: "phase1_focus_technology", label: "TECHNOLOGY", topics: ["TECHNOLOGY"], group: "standard_phase1_focus" },
  { id: "phase1_focus_energy", label: "ENERGY", topics: ["ENERGY"], group: "standard_phase1_focus" },
  { id: "phase1_focus_financial_services", label: "FINANCIAL SERVICES", topics: ["FINANCIAL SERVICES"], group: "standard_phase1_focus" },
]);

function topicSlug(value) {
  return normalizeTopicToken(value).replace(/\s+/g, "_");
}

function buildVirtualUser({
  id,
  label,
  group,
  topics,
}) {
  const normalizedTopics = Array.from(new Set((Array.isArray(topics) ? topics : []).filter(Boolean))).slice(0, 3);
  return {
    chatId: `eval-${id}`,
    email: `eval-${id}@example.com`,
    name: label,
    eval_label: label,
    eval_group: group,
    status: "active",
    topics: normalizedTopics,
    preferences: {
      depth: "headline_plus_why",
      delivery_time: "07:00",
      days_of_week: [1, 2, 3, 4, 5],
      timezone: "America/New_York",
      email_enabled: false,
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
    topics: [topic],
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
  return STANDARD_CORE_PERSONAS.map((persona) => buildVirtualUser(persona));
}

function buildStandardPhase1Personas() {
  return STANDARD_PHASE1_PERSONAS.map((persona) => buildVirtualUser(persona));
}

function buildStandardPhase1FocusPersonas() {
  return STANDARD_PHASE1_FOCUS_PERSONAS.map((persona) => buildVirtualUser(persona));
}

function buildStandardTopicPersonas() {
  return buildIndustryPersonas().map((user) => ({ ...user, eval_group: "standard_topics" }));
}

function buildScenarioRoster(scenarioId) {
  if (scenarioId === "standard_full") {
    return [
      ...buildIndustryPersonas(),
      ...buildMixedPersonas(),
    ];
  }
  if (scenarioId === "standard_core") {
    return buildStandardCorePersonas();
  }
  if (scenarioId === "standard_phase1") {
    return buildStandardPhase1Personas();
  }
  if (scenarioId === "standard_phase1_focus") {
    return buildStandardPhase1FocusPersonas();
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
  return (Array.isArray(scenarios) ? scenarios : [])
    .map(buildScenarioDefinition)
    .filter((scenario) => scenario.dueUsers.length > 0);
}

module.exports = {
  buildIndustryPersonas,
  buildMixedPersonas,
  buildStandardCorePersonas,
  buildStandardPhase1Personas,
  buildStandardPhase1FocusPersonas,
  buildScenarioDefinition,
  buildScenarioMatrix,
  buildScenarioRoster,
  buildStandardTopicPersonas,
  buildVirtualUser,
};
