const { buildStaticCorePersonaSpecs } = require("./personas-core-static-defs");

function buildCoreCanonicalPersonaSpecs(allTopics) {
  return [
    {
      id: "generalist",
      name: "The Generalist",
      description: "Three-topic generalist with deep mode.",
      overrides: {
        topics: (Array.isArray(allTopics) && allTopics.length ? allTopics : ["HEALTHCARE", "TECHNOLOGY", "FINANCIAL SERVICES"]).slice(0, 3),
        preferences: { depth: "headline_plus_why" },
      },
    },
    {
      id: "fresh_subscriber",
      name: "The Fresh Subscriber",
      description: "New user defaults from current signup behavior.",
      overrides: {
        topics: (Array.isArray(allTopics) && allTopics.length ? allTopics : ["HEALTHCARE", "LIFE SCIENCES"]).slice(0, 2),
        preferences: {
          depth: "headline_plus_why",
          delivery_time: "07:00",
          frequency: "daily_weekday",
          days_of_week: [1, 2, 3, 4, 5],
          timezone: "America/New_York",
          email_enabled: true,
        },
      },
    },
    ...buildStaticCorePersonaSpecs(),
  ];
}

module.exports = {
  buildCoreCanonicalPersonaSpecs,
};
