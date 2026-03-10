function buildStaticCorePersonaSpecs() {
  return [
    {
      id: "specialist",
      name: "The Specialist",
      description: "Healthcare-only obsessive profile.",
      overrides: {
        topics: ["HEALTHCARE"],
        topic_weights: { HEALTHCARE: 5 },
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "pe_deal_hunter",
      name: "The PE Deal Hunter",
      description: "Narrow PE + M&A and advisory focus.",
      overrides: {
        topics: ["PE×M&A", "M&A ADVISORY", "FINANCIAL SERVICES"],
        topic_weights: { "PE×M&A": 4, "M&A ADVISORY": 3, "FINANCIAL SERVICES": 1 },
        preferences: { items_per_digest: 10 },
      },
    },
    {
      id: "custom_keyword",
      name: "The Custom Keyword User",
      description: "Custom keyword tracking for GLP-1, DOGE, and quantum computing.",
      overrides: {
        topics: ["HEALTHCARE", "AI×TECH", "POLICY×REGULATORY", "custom_glp_1", "custom_doge", "custom_quantum_computing"],
        custom_topics: ["custom_glp_1", "custom_doge", "custom_quantum_computing"],
        preferences: { items_per_digest: 10 },
      },
    },
    {
      id: "minimalist",
      name: "The Minimalist",
      description: "Minimal digest with brief mode.",
      overrides: {
        topics: ["AI×TECH", "STRATEGY", "TECHNOLOGY"],
        preferences: { items_per_digest: 5, depth: "headline_plus_oneliner" },
      },
    },
    {
      id: "conflicting",
      name: "The Conflicting Prefs",
      description: "Contradictory focus: wants AIxTECH/PExM&A but downweights adjacent sectors.",
      overrides: {
        topics: ["AI×TECH", "PE×M&A", "STRATEGY"],
        topic_weights: { "AI×TECH": 3, "PE×M&A": 3, TECHNOLOGY: -4, "FINANCIAL SERVICES": -4 },
        preferences: { items_per_digest: 10 },
      },
    },
    {
      id: "weight_tweaker",
      name: "The Weight Tweaker",
      description: "Large spread of topic weights to test rank sensitivity.",
      overrides: {
        topics: ["AI×TECH", "HEALTHCARE", "PE×M&A", "FINANCIAL SERVICES", "POLICY×REGULATORY", "TECHNOLOGY", "ENERGY"],
        topic_weights: {
          "AI×TECH": 5,
          HEALTHCARE: 4,
          "PE×M&A": 2,
          TECHNOLOGY: 1,
          ENERGY: -2,
          "FINANCIAL SERVICES": -3,
        },
        preferences: { items_per_digest: 10 },
      },
    },
  ];
}

module.exports = {
  buildStaticCorePersonaSpecs,
};
