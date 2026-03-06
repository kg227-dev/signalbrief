const crypto = require("crypto");

const INDUSTRY_TOPICS = [
  "HEALTHCARE",
  "FINANCIAL SERVICES",
  "PE×M&A",
  "ENERGY",
  "CONSUMER",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "INDUSTRIALS",
  "REAL ESTATE",
  "PUBLIC SECTOR",
];

const CAPABILITY_TOPICS = [
  "AI×TECH",
  "STRATEGY",
  "POLICY×REGULATORY",
  "SUSTAINABILITY",
  "DIGITAL",
  "M&A ADVISORY",
  "TALENT",
];

const DEFAULT_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];

function buildQaToken(id) {
  return crypto.createHash("sha256").update(`qa-persona:${id}`).digest("hex");
}

function basePersona(id, name, purpose, overrides = {}) {
  const persona = {
    id,
    name,
    purpose,
    is_stress: false,
    chatId: `qa-${id}`,
    email: `${id}@qa.signalbrief.local`,
    status: "active",
    token: buildQaToken(id),
    digests_received: 0,
    joined_at: "2026-03-01T00:00:00.000Z",
    last_digest_at: null,
    topic_weights: {},
    custom_topics: [],
    digest_dates: [],
    bookmarks: [],
    last_digest_items: [],
    topics: DEFAULT_TOPICS.slice(0, 5),
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
  };

  const merged = {
    ...persona,
    ...overrides,
    preferences: {
      ...persona.preferences,
      ...(overrides.preferences || {}),
    },
  };

  const customFromTopics = (merged.topics || []).filter((t) => String(t).startsWith("custom_"));
  merged.custom_topics = [...new Set([...(merged.custom_topics || []), ...customFromTopics])];

  return merged;
}

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

function buildStressPersonas(allTopics) {
  const fallback = allTopics.length ? allTopics : DEFAULT_TOPICS;
  return [
    basePersona("stress_ultra_healthcare", "Stress: Ultra Healthcare", "Single-topic ultra-narrow user.", {
      is_stress: true,
      topics: ["HEALTHCARE"],
      topic_weights: { HEALTHCARE: 5 },
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),

    basePersona("stress_ultra_ai", "Stress: Ultra AI", "Single-topic AI stress persona.", {
      is_stress: true,
      topics: ["AI×TECH"],
      topic_weights: { "AI×TECH": 5 },
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),

    basePersona("stress_ultra_policy", "Stress: Ultra Policy", "Single-topic policy stress persona.", {
      is_stress: true,
      topics: ["POLICY×REGULATORY"],
      topic_weights: { "POLICY×REGULATORY": 5 },
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),

    basePersona("stress_conflict_ai_vs_tech", "Stress: AI High, Tech Low", "Contradictory high positive and negative topic weights.", {
      is_stress: true,
      topics: ["AI×TECH", "STRATEGY"],
      topic_weights: { "AI×TECH": 5, TECHNOLOGY: -5, DIGITAL: -3 },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_conflict_pe_vs_fs", "Stress: PE High, FS Low", "PE favored while adjacent finance is downweighted.", {
      is_stress: true,
      topics: ["PE×M&A", "M&A ADVISORY"],
      topic_weights: { "PE×M&A": 5, "FINANCIAL SERVICES": -5, "M&A ADVISORY": 3 },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_custom_biopharma", "Stress: Custom Biopharma", "Custom-heavy user for therapeutic signal tracking.", {
      is_stress: true,
      topics: ["HEALTHCARE", "LIFE SCIENCES", "custom_glp_1", "custom_obesity_drugs", "custom_medtech"],
      custom_topics: ["custom_glp_1", "custom_obesity_drugs", "custom_medtech"],
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_custom_macro", "Stress: Custom Macro", "Custom-heavy macro and policy watcher.", {
      is_stress: true,
      topics: ["POLICY×REGULATORY", "FINANCIAL SERVICES", "custom_rate_cuts", "custom_sec_rulemaking", "custom_doge"],
      custom_topics: ["custom_rate_cuts", "custom_sec_rulemaking", "custom_doge"],
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_custom_quantum", "Stress: Custom Quantum", "Custom-heavy technology frontier watcher.", {
      is_stress: true,
      topics: ["AI×TECH", "TECHNOLOGY", "custom_quantum_computing", "custom_agentic_ai", "custom_semicap"],
      custom_topics: ["custom_quantum_computing", "custom_agentic_ai", "custom_semicap"],
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_low_item_brief_1", "Stress: Low Item Brief A", "Low item count user with brief depth.", {
      is_stress: true,
      topics: ["AI×TECH", "TECHNOLOGY", "DIGITAL"],
      preferences: { items_per_digest: 3, depth: "headline_plus_oneliner" },
    }),

    basePersona("stress_low_item_brief_2", "Stress: Low Item Brief B", "Another low item count with different topic mix.", {
      is_stress: true,
      topics: ["ENERGY", "SUSTAINABILITY", "POLICY×REGULATORY"],
      preferences: { items_per_digest: 4, depth: "headline_plus_oneliner" },
    }),

    basePersona("stress_high_item_generalist_1", "Stress: High Item Generalist A", "High item count broad coverage persona.", {
      is_stress: true,
      topics: fallback.slice(0, Math.min(10, fallback.length)),
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_high_item_generalist_2", "Stress: High Item Generalist B", "High item count with alternate broad mix.", {
      is_stress: true,
      topics: [...fallback].reverse().slice(0, Math.min(10, fallback.length)),
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_negative_weights_mix", "Stress: Negative Weights Mix", "Heavy negative weighting edge case.", {
      is_stress: true,
      topics: ["AI×TECH", "HEALTHCARE", "ENERGY", "FINANCIAL SERVICES", "CONSUMER"],
      topic_weights: {
        "AI×TECH": 2,
        HEALTHCARE: 1,
        ENERGY: -5,
        "FINANCIAL SERVICES": -4,
        CONSUMER: -3,
      },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_positive_spike_mix", "Stress: Positive Spike Mix", "Max-positive weighting spread.", {
      is_stress: true,
      topics: ["PE×M&A", "M&A ADVISORY", "STRATEGY", "AI×TECH", "TECHNOLOGY"],
      topic_weights: {
        "PE×M&A": 5,
        "M&A ADVISORY": 4,
        STRATEGY: 4,
        "AI×TECH": 3,
        TECHNOLOGY: 2,
      },
      preferences: { items_per_digest: 10, depth: "headline_plus_why" },
    }),

    basePersona("stress_sparse_three_topic_deep", "Stress: Sparse Three Topic Deep", "Sparse-topic deep reader persona.", {
      is_stress: true,
      topics: ["LIFE SCIENCES", "PUBLIC SECTOR", "REAL ESTATE"],
      preferences: { items_per_digest: 5, depth: "headline_plus_why" },
    }),
  ];
}

function buildPersonas(topicUniverse = DEFAULT_TOPICS, opts = {}) {
  const allTopics = Array.isArray(topicUniverse) && topicUniverse.length
    ? topicUniverse
    : DEFAULT_TOPICS;

  const includeStress = opts.includeStress !== false;
  const canonical = buildCanonicalPersonas(allTopics);
  const stress = includeStress ? buildStressPersonas(allTopics) : [];
  return [...canonical, ...stress];
}

module.exports = {
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
  DEFAULT_TOPICS,
  buildPersonas,
};
