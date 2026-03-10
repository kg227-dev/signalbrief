function buildDepthCanonicalPersonaSpecs() {
  return [
    {
      id: "depth_a",
      name: "Depth Tester A",
      description: "Depth pair A (brief).",
      overrides: {
        topics: ["AI×TECH", "STRATEGY", "TECHNOLOGY", "POLICY×REGULATORY"],
        preferences: { depth: "headline_plus_oneliner", items_per_digest: 10 },
      },
    },
    {
      id: "depth_b",
      name: "Depth Tester B",
      description: "Depth pair B (deep).",
      overrides: {
        topics: ["AI×TECH", "STRATEGY", "TECHNOLOGY", "POLICY×REGULATORY"],
        preferences: { depth: "headline_plus_why", items_per_digest: 10 },
      },
    },
  ];
}

module.exports = {
  buildDepthCanonicalPersonaSpecs,
};
