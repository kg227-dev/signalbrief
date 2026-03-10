function buildStressDistributionPersonaSpecs(fallbackTopics) {
  return [
    {
      id: "stress_low_item_brief_1",
      name: "Stress: Low Item Brief A",
      description: "Low item count user with brief depth.",
      overrides: {
        is_stress: true,
        topics: ["AI×TECH", "TECHNOLOGY", "DIGITAL"],
        preferences: { items_per_digest: 3, depth: "headline_plus_oneliner" },
      },
    },
    {
      id: "stress_low_item_brief_2",
      name: "Stress: Low Item Brief B",
      description: "Another low item count with different topic mix.",
      overrides: {
        is_stress: true,
        topics: ["ENERGY", "SUSTAINABILITY", "POLICY×REGULATORY"],
        preferences: { items_per_digest: 4, depth: "headline_plus_oneliner" },
      },
    },
    {
      id: "stress_high_item_generalist_1",
      name: "Stress: High Item Generalist A",
      description: "High item count broad coverage persona.",
      overrides: {
        is_stress: true,
        topics: fallbackTopics.slice(0, Math.min(10, fallbackTopics.length)),
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_high_item_generalist_2",
      name: "Stress: High Item Generalist B",
      description: "High item count with alternate broad mix.",
      overrides: {
        is_stress: true,
        topics: [...fallbackTopics].reverse().slice(0, Math.min(10, fallbackTopics.length)),
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_negative_weights_mix",
      name: "Stress: Negative Weights Mix",
      description: "Heavy negative weighting edge case.",
      overrides: {
        is_stress: true,
        topics: ["AI×TECH", "HEALTHCARE", "ENERGY", "FINANCIAL SERVICES", "CONSUMER"],
        topic_weights: { "AI×TECH": 2, HEALTHCARE: 1, ENERGY: -5, "FINANCIAL SERVICES": -4, CONSUMER: -3 },
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_positive_spike_mix",
      name: "Stress: Positive Spike Mix",
      description: "Max-positive weighting spread.",
      overrides: {
        is_stress: true,
        topics: ["PE×M&A", "M&A ADVISORY", "STRATEGY", "AI×TECH", "TECHNOLOGY"],
        topic_weights: { "PE×M&A": 5, "M&A ADVISORY": 4, STRATEGY: 4, "AI×TECH": 3, TECHNOLOGY: 2 },
        preferences: { items_per_digest: 10, depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_sparse_three_topic_deep",
      name: "Stress: Sparse Three Topic Deep",
      description: "Sparse-topic deep reader persona.",
      overrides: {
        is_stress: true,
        topics: ["LIFE SCIENCES", "PUBLIC SECTOR", "REAL ESTATE"],
        preferences: { items_per_digest: 5, depth: "headline_plus_why" },
      },
    },
  ];
}

module.exports = {
  buildStressDistributionPersonaSpecs,
};
