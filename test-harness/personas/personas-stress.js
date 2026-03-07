const { basePersona } = require("./persona-factory");
const { DEFAULT_TOPICS } = require("./persona-topics");

function buildStressPersonas(allTopics) {
  const fallback = allTopics.length ? allTopics : DEFAULT_TOPICS;
  return [
    basePersona("stress_ultra_healthcare", "Stress: Ultra Healthcare", "Single-topic ultra-narrow user.", {
      is_stress: true,
      topics: ["HEALTHCARE"],
      topic_weights: { HEALTHCARE: 5 },
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),
    basePersona("stress_ultra_ai", "Stress: Ultra AI", "Single-topic AI stress persona.", {
      is_stress: true,
      topics: ["AI×TECH"],
      topic_weights: { "AI×TECH": 5 },
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),
    basePersona("stress_ultra_policy", "Stress: Ultra Policy", "Single-topic policy stress persona.", {
      is_stress: true,
      topics: ["POLICY×REGULATORY"],
      topic_weights: { "POLICY×REGULATORY": 5 },
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),
    basePersona("stress_conflict_ai_vs_tech", "Stress: AI High, Tech Low", "Contradictory high positive and negative topic weights.", {
      is_stress: true,
      topics: ["AI×TECH", "STRATEGY"],
      topic_weights: { "AI×TECH": 5, TECHNOLOGY: -5, DIGITAL: -3 },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_conflict_pe_vs_fs", "Stress: PE High, FS Low", "PE favored while adjacent finance is downweighted.", {
      is_stress: true,
      topics: ["PE×M&A", "M&A ADVISORY"],
      topic_weights: { "PE×M&A": 5, "FINANCIAL SERVICES": -5, "M&A ADVISORY": 3 },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_custom_biopharma", "Stress: Custom Biopharma", "Custom-heavy user for therapeutic signal tracking.", {
      is_stress: true,
      topics: ["HEALTHCARE", "LIFE SCIENCES", "custom_glp_1", "custom_obesity_drugs", "custom_medtech"],
      custom_topics: ["custom_glp_1", "custom_obesity_drugs", "custom_medtech"],
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_custom_macro", "Stress: Custom Macro", "Custom-heavy macro and policy watcher.", {
      is_stress: true,
      topics: ["POLICY×REGULATORY", "FINANCIAL SERVICES", "custom_rate_cuts", "custom_sec_rulemaking", "custom_doge"],
      custom_topics: ["custom_rate_cuts", "custom_sec_rulemaking", "custom_doge"],
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_custom_quantum", "Stress: Custom Quantum", "Custom-heavy technology frontier watcher.", {
      is_stress: true,
      topics: ["AI×TECH", "TECHNOLOGY", "custom_quantum_computing", "custom_agentic_ai", "custom_semicap"],
      custom_topics: ["custom_quantum_computing", "custom_agentic_ai", "custom_semicap"],
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_low_item_brief_1", "Stress: Low Item Brief A", "Low item count user with brief depth.", {
      is_stress: true,
      topics: ["AI×TECH", "TECHNOLOGY", "DIGITAL"],
      preferences: { items_per_digest: 3, depth: "headline_plus_oneliner" },
    }),
    basePersona("stress_low_item_brief_2", "Stress: Low Item Brief B", "Another low item count with different topic mix.", {
      is_stress: true,
      topics: ["ENERGY", "SUSTAINABILITY", "POLICY×REGULATORY"],
      preferences: { items_per_digest: 4, depth: "headline_plus_oneliner" },
    }),
    basePersona("stress_high_item_generalist_1", "Stress: High Item Generalist A", "High item count broad coverage persona.", {
      is_stress: true,
      topics: fallback.slice(0, Math.min(10, fallback.length)),
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_high_item_generalist_2", "Stress: High Item Generalist B", "High item count with alternate broad mix.", {
      is_stress: true,
      topics: [...fallback].reverse().slice(0, Math.min(10, fallback.length)),
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_negative_weights_mix", "Stress: Negative Weights Mix", "Heavy negative weighting edge case.", {
      is_stress: true,
      topics: ["AI×TECH", "HEALTHCARE", "ENERGY", "FINANCIAL SERVICES", "CONSUMER"],
      topic_weights: {
        "AI×TECH": 2,
        HEALTHCARE: 1,
        ENERGY: -5,
        "FINANCIAL SERVICES": -4,
        CONSUMER: -3,
      },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_positive_spike_mix", "Stress: Positive Spike Mix", "Max-positive weighting spread.", {
      is_stress: true,
      topics: ["PE×M&A", "M&A ADVISORY", "STRATEGY", "AI×TECH", "TECHNOLOGY"],
      topic_weights: {
        "PE×M&A": 5,
        "M&A ADVISORY": 4,
        STRATEGY: 4,
        "AI×TECH": 3,
        TECHNOLOGY: 2,
      },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),
    basePersona("stress_sparse_three_topic_deep", "Stress: Sparse Three Topic Deep", "Sparse-topic deep reader persona.", {
      is_stress: true,
      topics: ["LIFE SCIENCES", "PUBLIC SECTOR", "REAL ESTATE"],
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),
  ];
}

module.exports = {
  buildStressPersonas,
};
