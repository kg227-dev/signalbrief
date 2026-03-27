const topicUtils = require("../../utils/topic-utils");
const pipeline = require("../../runtime/pipeline");
const topicDomain = require("../../../src/digest/domain/topic-domain-runtime");
const marketing = require("../../../scripts/marketing-weekly-report");

function buildTopicAndPipelineChecks(check) {
  return [
    check("normalizeTopicToken strips custom_ prefixes", () =>
      topicUtils.normalizeTopicToken("custom_TECHNOLOGY") === "technology"
    ),
    check("pipeline relevance wrapper matches shared topic-domain scorer", () => {
      const sampleItems = [
        {
          tag: "TECHNOLOGY",
          headline: "OpenAI launches enterprise agent platform",
          summary: "Large enterprises are piloting AI agents in core workflows.",
          source: "example.com",
          url: "https://example.com/news/openai-agents",
          baseScore: 8.1,
        },
      ];
      const topics = ["TECHNOLOGY"];
      const shared = topicDomain.applyTopicRelevanceScores(sampleItems, topics, {}, {
        specialistMode: false,
        repeatPenalty: 0,
        isRecentRepeat: () => false,
        sourceDomainForItem: pipeline.parseItemDomain,
      });
      const wrapped = pipeline.applyRelevanceScores(sampleItems, topics, {}, {
        repeatPenalty: 0,
        repeatIndex: null,
      }, false);
      return JSON.stringify(shared) === JSON.stringify(wrapped);
    }),
    check("pipeline topic filter wrapper matches shared boundary", () => {
      const items = [
        { tag: "TECHNOLOGY", headline: "Agentic AI wins budget", summary: "Enterprise pilots expanded." },
        { tag: "HEALTHCARE", headline: "Hospital staffing update", summary: "Regional systems report shortages." },
      ];
      const topics = ["TECHNOLOGY"];
      const shared = topicDomain.filterItemsByTopics(items, topics, {
        minItems: 3,
        strictZeroFallback: "specialist",
      });
      const wrapped = pipeline.filterItemsForPersona(items, topics, { minFilteredItems: 3 }, "specialist");
      return wrapped.mode === shared.mode
        && wrapped.items.length === shared.items.length
        && wrapped.specialistMode === shared.specialistMode
        && Array.isArray(wrapped.standardTopicsLower)
        && wrapped.standardTopicsLower.includes("technology");
    }),
    check("startOfWeekMonday aligns to Monday", () => {
      const wed = new Date(2026, 2, 4, 12, 0, 0, 0); // Mar 4, 2026 (Wed, local)
      const monday = marketing.startOfWeekMonday(wed);
      return monday.getDay() === 1 && monday.getDate() === 2;
    }),
    check("computeDigest2OpenRate returns expected cohort math", () => {
      const users = [
        { chatId: "u1", joined_at: "2026-03-03T10:00:00.000Z" },
        { chatId: "u2", joined_at: "2026-03-04T10:00:00.000Z" },
      ];
      const events = [
        { event_type: "digest_sent", channel: "email", user_chat_id: "u1", digest_id: "2026-03-03:u1", ts_utc: "2026-03-03T12:00:00.000Z" },
        { event_type: "digest_sent", channel: "email", user_chat_id: "u1", digest_id: "2026-03-04:u1", ts_utc: "2026-03-04T12:00:00.000Z" },
        { event_type: "digest_sent", channel: "email", user_chat_id: "u2", digest_id: "2026-03-04:u2", ts_utc: "2026-03-04T12:00:00.000Z" },
        { event_type: "digest_sent", channel: "email", user_chat_id: "u2", digest_id: "2026-03-05:u2", ts_utc: "2026-03-05T12:00:00.000Z" },
        { event_type: "email_open", digest_id: "2026-03-04:u1", ts_utc: "2026-03-04T14:00:00.000Z" },
      ];
      const out = marketing.computeDigest2OpenRate(
        users,
        events,
        new Date("2026-03-02T00:00:00.000Z"),
        new Date("2026-03-08T23:59:59.999Z")
      );
      return out.eligible === 2 && out.opened === 1 && Math.abs(Number(out.rate || 0) - 50) < 0.001;
    }),
  ];
}

module.exports = {
  buildTopicAndPipelineChecks,
};
