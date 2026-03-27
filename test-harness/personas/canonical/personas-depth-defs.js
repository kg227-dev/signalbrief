function buildDepthCanonicalPersonaSpecs() {
  return [
    {
      id: "depth_a",
      name: "Depth Tester A",
      description: "Depth pair A (brief).",
      overrides: {
        topics: ["TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES"],
        preferences: { depth: "headline_plus_oneliner" },
      },
    },
    {
      id: "depth_b",
      name: "Depth Tester B",
      description: "Depth pair B (deep).",
      overrides: {
        topics: ["TECHNOLOGY", "ENERGY", "FINANCIAL SERVICES"],
        preferences: { depth: "headline_plus_why" },
      },
    },
  ];
}

module.exports = {
  buildDepthCanonicalPersonaSpecs,
};
