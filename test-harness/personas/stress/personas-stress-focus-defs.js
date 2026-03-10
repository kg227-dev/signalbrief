function buildStressFocusPersonaSpecs() {
  return [
    {
      id: "stress_ultra_healthcare",
      name: "Stress: Ultra Healthcare",
      description: "Single-topic ultra-narrow user.",
      overrides: {
        is_stress: true,
        topics: ["HEALTHCARE"],
        topic_weights: { HEALTHCARE: 5 },
        preferences: { items_per_digest: 5, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_ultra_ai",
      name: "Stress: Ultra AI",
      description: "Single-topic AI stress persona.",
      overrides: {
        is_stress: true,
        topics: ["AI×TECH"],
        topic_weights: { "AI×TECH": 5 },
        preferences: { items_per_digest: 5, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_ultra_policy",
      name: "Stress: Ultra Policy",
      description: "Single-topic policy stress persona.",
      overrides: {
        is_stress: true,
        topics: ["POLICY×REGULATORY"],
        topic_weights: { "POLICY×REGULATORY": 5 },
        preferences: { items_per_digest: 5, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_conflict_ai_vs_tech",
      name: "Stress: AI High, Tech Low",
      description: "Contradictory high positive and negative topic weights.",
      overrides: {
        is_stress: true,
        topics: ["AI×TECH", "STRATEGY"],
        topic_weights: { "AI×TECH": 5, TECHNOLOGY: -5, DIGITAL: -3 },
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_conflict_pe_vs_fs",
      name: "Stress: PE High, FS Low",
      description: "PE favored while adjacent finance is downweighted.",
      overrides: {
        is_stress: true,
        topics: ["PE×M&A", "M&A ADVISORY"],
        topic_weights: { "PE×M&A": 5, "FINANCIAL SERVICES": -5, "M&A ADVISORY": 3 },
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
  ];
}

module.exports = {
  buildStressFocusPersonaSpecs,
};
