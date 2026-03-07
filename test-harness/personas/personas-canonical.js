const { basePersona } = require("./persona-factory");

function buildCanonicalPersonas(allTopics) {
  return [
    basePersona("generalist", "The Generalist", "All topics enabled with deep mode and max item count.", {
      topics: [...allTopics],
      preferences: {
        depth: "headline_plus_why",
        items_per_digest: 10,
      },
    }),
    basePersona("specialist", "The Specialist", "Healthcare-only obsessive profile.", {
      topics: ["HEALTHCARE"],
      topic_weights: {
        HEALTHCARE: 5,
      },
      preferences: {
        items_per_digest: 10,
        depth: "headline_plus_why",
      },
    }),
    basePersona("pe_deal_hunter", "The PE Deal Hunter", "Narrow PE + M&A and advisory focus.", {
      topics: ["PE×M&A", "M&A ADVISORY", "FINANCIAL SERVICES"],
      topic_weights: {
        "PE×M&A": 4,
        "M&A ADVISORY": 3,
        "FINANCIAL SERVICES": 1,
      },
      preferences: {
        items_per_digest: 10,
      },
    }),
    basePersona("custom_keyword", "The Custom Keyword User", "Custom keyword tracking for GLP-1, DOGE, and quantum computing.", {
      topics: [
        "HEALTHCARE",
        "AI×TECH",
        "POLICY×REGULATORY",
        "custom_glp_1",
        "custom_doge",
        "custom_quantum_computing",
      ],
      custom_topics: ["custom_glp_1", "custom_doge", "custom_quantum_computing"],
      preferences: {
        items_per_digest: 10,
      },
    }),
    basePersona("minimalist", "The Minimalist", "Minimal digest with brief mode.", {
      topics: ["AI×TECH", "STRATEGY", "TECHNOLOGY"],
      preferences: {
        items_per_digest: 5,
        depth: "headline_plus_oneliner",
      },
    }),
    basePersona("conflicting", "The Conflicting Prefs", "Contradictory focus: wants AIxTECH/PExM&A but downweights adjacent sectors.", {
      topics: ["AI×TECH", "PE×M&A", "STRATEGY"],
      topic_weights: {
        "AI×TECH": 3,
        "PE×M&A": 3,
        TECHNOLOGY: -4,
        "FINANCIAL SERVICES": -4,
      },
      preferences: {
        items_per_digest: 10,
      },
    }),
    basePersona("fresh_subscriber", "The Fresh Subscriber", "New user defaults from current signup behavior.", {
      topics: allTopics.slice(0, 5),
      topic_weights: {},
      preferences: {
        depth: "headline_plus_why",
        delivery_time: "07:00",
        frequency: "daily_weekday",
        days_of_week: [1, 2, 3, 4, 5],
        items_per_digest: 5,
        timezone: "America/New_York",
        email_enabled: true,
        telegram_enabled: true,
      },
    }),
    basePersona("weight_tweaker", "The Weight Tweaker", "Large spread of topic weights to test rank sensitivity.", {
      topics: [
        "AI×TECH",
        "HEALTHCARE",
        "PE×M&A",
        "FINANCIAL SERVICES",
        "POLICY×REGULATORY",
        "TECHNOLOGY",
        "ENERGY",
      ],
      topic_weights: {
        "AI×TECH": 5,
        HEALTHCARE: 4,
        "PE×M&A": 2,
        TECHNOLOGY: 1,
        ENERGY: -2,
        "FINANCIAL SERVICES": -3,
      },
      preferences: {
        items_per_digest: 10,
      },
    }),
    basePersona("depth_a", "Depth Tester A", "Depth pair A (brief).", {
      topics: ["AI×TECH", "STRATEGY", "TECHNOLOGY", "POLICY×REGULATORY"],
      preferences: {
        depth: "headline_plus_oneliner",
        items_per_digest: 10,
      },
    }),
    basePersona("depth_b", "Depth Tester B", "Depth pair B (deep).", {
      topics: ["AI×TECH", "STRATEGY", "TECHNOLOGY", "POLICY×REGULATORY"],
      preferences: {
        depth: "headline_plus_why",
        items_per_digest: 10,
      },
    }),
  ];
}

module.exports = {
  buildCanonicalPersonas,
};
