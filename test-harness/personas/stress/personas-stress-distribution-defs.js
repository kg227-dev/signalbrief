function buildStressDistributionPersonaSpecs(fallbackTopics) {
  const fallback = Array.isArray(fallbackTopics) && fallbackTopics.length
    ? fallbackTopics
    : ["HEALTHCARE", "LIFE SCIENCES", "TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES", "CONSUMER & RETAIL", "INDUSTRIALS"];
  return [
    {
      id: "stress_brief_consumer",
      name: "Stress: Brief Consumer",
      description: "Single-topic brief reader.",
      overrides: {
        is_stress: true,
        topics: ["CONSUMER & RETAIL"],
        preferences: { depth: "headline_plus_oneliner" },
      },
    },
    {
      id: "stress_brief_industrials",
      name: "Stress: Brief Industrials",
      description: "Another brief single-topic reader.",
      overrides: {
        is_stress: true,
        topics: ["INDUSTRIALS"],
        preferences: { depth: "headline_plus_oneliner" },
      },
    },
    {
      id: "stress_deep_multi_sector",
      name: "Stress: Deep Multi-Sector",
      description: "Three-topic deep reader.",
      overrides: {
        is_stress: true,
        topics: fallback.slice(0, 3),
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_finance_energy",
      name: "Stress: Finance and Energy",
      description: "Two-topic capital-intensive pairing.",
      overrides: {
        is_stress: true,
        topics: ["FINANCIAL SERVICES", "ENERGY"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_consumer_health",
      name: "Stress: Consumer and Health",
      description: "Mixed-sector operator pairing.",
      overrides: {
        is_stress: true,
        topics: ["CONSUMER & RETAIL", "HEALTHCARE"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_industrials_tech",
      name: "Stress: Industrials and Tech",
      description: "Two-topic industrial technology reader.",
      overrides: {
        is_stress: true,
        topics: ["INDUSTRIALS", "TECHNOLOGY"],
        preferences: { depth: "headline_plus_why" },
      },
    },
  ];
}

module.exports = {
  buildStressDistributionPersonaSpecs,
};
