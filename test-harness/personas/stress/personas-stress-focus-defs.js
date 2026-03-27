function buildStressFocusPersonaSpecs() {
  return [
    {
      id: "stress_single_healthcare",
      name: "Stress: Single Healthcare",
      description: "Single-topic healthcare stress persona.",
      overrides: {
        is_stress: true,
        topics: ["HEALTHCARE"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_single_life_sciences",
      name: "Stress: Single Life Sciences",
      description: "Single-topic life sciences stress persona.",
      overrides: {
        is_stress: true,
        topics: ["LIFE SCIENCES"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_single_technology",
      name: "Stress: Single Technology",
      description: "Single-topic technology stress persona.",
      overrides: {
        is_stress: true,
        topics: ["TECHNOLOGY"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_three_topic_balanced",
      name: "Stress: Three Topic Balanced",
      description: "Max-width MVP subscription.",
      overrides: {
        is_stress: true,
        topics: ["HEALTHCARE", "TECHNOLOGY", "FINANCIAL SERVICES"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "stress_cross_sector_pair",
      name: "Stress: Cross-Sector Pair",
      description: "Two-topic industrial and energy pairing.",
      overrides: {
        is_stress: true,
        topics: ["ENERGY", "INDUSTRIALS"],
        preferences: { depth: "headline_plus_why" },
      },
    },
  ];
}

module.exports = {
  buildStressFocusPersonaSpecs,
};
