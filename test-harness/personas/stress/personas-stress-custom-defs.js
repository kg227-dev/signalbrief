function buildStressCustomPersonaSpecs() {
  return [
    {
      id: "stress_custom_biopharma",
      name: "Stress: Custom Biopharma",
      description: "Custom-heavy user for therapeutic signal tracking.",
      overrides: {
        is_stress: true,
        topics: ["HEALTHCARE", "LIFE SCIENCES", "custom_glp_1", "custom_obesity_drugs", "custom_medtech"],
        custom_topics: ["custom_glp_1", "custom_obesity_drugs", "custom_medtech"],
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_custom_macro",
      name: "Stress: Custom Macro",
      description: "Custom-heavy macro and policy watcher.",
      overrides: {
        is_stress: true,
        topics: ["POLICY×REGULATORY", "FINANCIAL SERVICES", "custom_rate_cuts", "custom_sec_rulemaking", "custom_doge"],
        custom_topics: ["custom_rate_cuts", "custom_sec_rulemaking", "custom_doge"],
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_custom_quantum",
      name: "Stress: Custom Quantum",
      description: "Custom-heavy technology frontier watcher.",
      overrides: {
        is_stress: true,
        topics: ["AI×TECH", "TECHNOLOGY", "custom_quantum_computing", "custom_agentic_ai", "custom_semicap"],
        custom_topics: ["custom_quantum_computing", "custom_agentic_ai", "custom_semicap"],
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
  ];
}

module.exports = {
  buildStressCustomPersonaSpecs,
};
