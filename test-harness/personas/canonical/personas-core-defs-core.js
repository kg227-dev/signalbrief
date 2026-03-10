const { buildStaticCorePersonaSpecs } = require("./personas-core-static-defs");

function buildCoreCanonicalPersonaSpecs(allTopics) {
  return [
    {
      id: "generalist",
      name: "The Generalist",
      description: "All topics enabled with deep mode and max item count.",
      overrides: {
        topics: [...allTopics],
        preferences: { depth: "headline_plus_why", items_per_digest: 10 },
      },
    },
    {
      id: "fresh_subscriber",
      name: "The Fresh Subscriber",
      description: "New user defaults from current signup behavior.",
      overrides: {
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
      },
    },
    ...buildStaticCorePersonaSpecs(),
  ];
}

module.exports = {
  buildCoreCanonicalPersonaSpecs,
};
