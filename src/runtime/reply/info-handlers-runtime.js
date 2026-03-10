const { normalizeUserRecord } = require("../user-contract-runtime");
const {
  buildBookmarksMessage,
  buildHelpMessage,
  buildSettingsMessage,
  buildTopicsMessage,
} = require("./info-renderers-runtime");

function createInfoHandlers({
  userStore,
  runtimeConfig,
  messaging,
  topicCatalog,
}) {
  const { readUser } = userStore;
  const { getConfig, getBaseUrl, formatDeliveryTime } = runtimeConfig;
  const { send, anthropicTransport } = messaging;
  const { INDUSTRY_TOPICS, CAPABILITY_TOPICS } = topicCatalog;

  async function handleSettings(chatId) {
    const user = normalizeUserRecord(readUser(chatId), { chatId: String(chatId) });
    const topics = Array.isArray(user.topics) ? user.topics : [];
    const industries = topics.filter((t) => INDUSTRY_TOPICS.includes(t));
    const capabilities = topics.filter((t) => CAPABILITY_TOPICS.includes(t));
    await send(
      chatId,
      buildSettingsMessage({
        user,
        industries,
        capabilities,
        formatDeliveryTime,
        baseUrl: getBaseUrl(),
      }),
    );
  }

  async function handleBookmarks(chatId) {
    const user = normalizeUserRecord(readUser(chatId), { chatId: String(chatId) });
    await send(chatId, buildBookmarksMessage(user.bookmarks || []));
  }

  async function handleTopics(chatId) {
    const user = normalizeUserRecord(readUser(chatId), { chatId: String(chatId) });
    const defaultTopics = (getConfig().topics || []).map((t) => t.tag);
    const custom = user.custom_topics || [];
    const weights = user.topic_weights || {};
    await send(chatId, buildTopicsMessage(defaultTopics, custom, weights));
  }

  async function handleHelp(chatId) {
    const user = normalizeUserRecord(readUser(chatId), { chatId: String(chatId) });
    await send(chatId, buildHelpMessage(formatDeliveryTime(user.preferences)));
  }

  async function handleQuestion(chatId, question) {
    const res = await anthropicTransport.requestMessage({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `You are SignalBrief, a business and strategy news assistant covering AI, healthcare, financial services, PE/M&A, energy, consumer, policy, and consulting. Answer this question concisely (2-3 sentences max, plain text, no markdown headers): ${question}`,
      }],
    });
    const responseBody = res && res.kind === "json" && res.body && typeof res.body === "object"
      ? res.body
      : null;
    const answer = responseBody?.content?.[0]?.text || "I'm not sure — try asking again.";
    await send(chatId, answer);
  }

  return {
    handleSettings,
    handleBookmarks,
    handleTopics,
    handleHelp,
    handleQuestion,
  };
}

module.exports = {
  createInfoHandlers,
};
