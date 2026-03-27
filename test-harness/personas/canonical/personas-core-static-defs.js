function buildStaticCorePersonaSpecs() {
  return [
    {
      id: "healthcare_operator",
      name: "The Healthcare Operator",
      description: "Single-topic healthcare reader.",
      overrides: {
        topics: ["HEALTHCARE"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "life_sciences_exec",
      name: "The Life Sciences Executive",
      description: "Biotech and healthcare crossover reader.",
      overrides: {
        topics: ["LIFE SCIENCES", "HEALTHCARE"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "technology_exec",
      name: "The Technology Executive",
      description: "Technology and industrials crossover reader.",
      overrides: {
        topics: ["TECHNOLOGY", "INDUSTRIALS"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "minimalist",
      name: "The Minimalist",
      description: "Minimal digest with brief mode.",
      overrides: {
        topics: ["TECHNOLOGY"],
        preferences: { depth: "headline_plus_oneliner" },
      },
    },
    {
      id: "energy_finance_reader",
      name: "The Energy and Finance Reader",
      description: "Two-lane reader focused on capital-heavy sectors.",
      overrides: {
        topics: ["ENERGY", "FINANCIAL SERVICES"],
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "consumer_industrials_reader",
      name: "The Consumer and Industrials Reader",
      description: "Three-topic mixed operator profile.",
      overrides: {
        topics: ["CONSUMER & RETAIL", "INDUSTRIALS", "TECHNOLOGY"],
        preferences: { depth: "headline_plus_why" },
      },
    },
  ];
}

module.exports = {
  buildStaticCorePersonaSpecs,
};
