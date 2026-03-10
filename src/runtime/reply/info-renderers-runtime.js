function formatTopicAdjustments(topicWeights) {
  const entries = Object.entries(topicWeights || {});
  if (!entries.length) return "none";
  return entries
    .map(([topic, weight]) => {
      const icon = weight > 0
        ? "↑".repeat(Math.min(weight, 3))
        : "↓".repeat(Math.min(-weight, 3));
      return `${icon} ${topic}`;
    })
    .join(" · ");
}

function formatCustomTopics(customTopics) {
  if (!Array.isArray(customTopics) || customTopics.length === 0) return "none";
  return customTopics
    .map((topic) => topic.replace(/^custom_/, "").replace(/_/g, " "))
    .join(", ");
}

function buildSettingsMessage({
  user,
  industries,
  capabilities,
  formatDeliveryTime,
  baseUrl,
}) {
  const topicAdjustments = formatTopicAdjustments(user.topic_weights);
  const customTopics = formatCustomTopics(user.custom_topics);
  const settingsLine = user.token
    ? `\n🔗 [Manage preferences](${baseUrl}/settings?token=${user.token})`
    : "";

  return `⚙️ *Your SignalBrief Settings*\n\n`
    + `📬 Digests received: *${user.digests_received}*\n`
    + `📅 Delivery: *${formatDeliveryTime(user.preferences)}*\n`
    + `💾 Bookmarks saved: *${user.bookmarks?.length || 0}*\n\n`
    + `🏭 Industries: ${industries.length ? industries.join(", ") : "none"}\n`
    + `🧰 Capabilities: ${capabilities.length ? capabilities.join(", ") : "none"}\n`
    + `📊 Topic adjustments: ${topicAdjustments}\n`
    + `➕ Custom topics: ${customTopics}`
    + settingsLine + `\n\n`
    + "_To tune:_ more/less [topic] · add [topic] · /bookmarks";
}

function buildBookmarksMessage(bookmarks) {
  const list = Array.isArray(bookmarks) ? bookmarks : [];
  if (list.length === 0) {
    return "💾 No bookmarks yet.\n\nAfter your next digest, reply *save 3* to bookmark item 3.";
  }

  const recent = list.slice(-10).reverse();
  const lines = [`💾 *Your Bookmarks* (last ${recent.length})`, ""];
  recent.forEach((bookmark) => {
    const tag = bookmark.tag ? `[${bookmark.tag}] ` : "";
    const link = bookmark.url ? `\n→ ${bookmark.url}` : "";
    lines.push(`*${bookmark.date} · #${bookmark.item_num}*\n${tag}${bookmark.headline}${link}`);
    lines.push("");
  });
  return lines.join("\n");
}

function buildTopicsMessage(defaultTopics, customTopics, topicWeights) {
  const lines = defaultTopics.map((topic) => {
    const weight = topicWeights[topic] || 0;
    const adjustment = weight > 0 ? " ↑" : weight < 0 ? " ↓" : "";
    return `• ${topic}${adjustment}`;
  });
  if (customTopics.length) {
    customTopics.forEach((topic) => lines.push(`• ${topic} _(custom)_`));
  }
  return "📋 *Your Tracked Topics*\n\n"
    + lines.join("\n") + "\n\n"
    + "_To tune:_ more [topic] · less [topic] · add [keyword]";
}

function buildHelpMessage(deliveryTime) {
  return "☀️ *SignalBrief Help*\n\n"
    + "*Saving items:*\n"
    + "• `save 3` — bookmark item 3\n"
    + "• `save 1, 4, 6` — bookmark multiple\n\n"
    + "*Tuning topics:*\n"
    + "• `more AI` — see more AI stories\n"
    + "• `less pharma` — fewer pharma stories\n"
    + "• `add GLP-1` — track a new topic\n\n"
    + "*Other commands:*\n"
    + "• /verify 123456 — confirm Telegram account linking\n"
    + "• /bookmarks — view saved items\n"
    + "• /topics — view tracked topics\n"
    + "• /settings — view all preferences\n\n"
    + `Digest arrives at *${deliveryTime}* on your scheduled days.\n`
    + "Questions? Just ask.";
}

module.exports = {
  buildBookmarksMessage,
  buildHelpMessage,
  buildSettingsMessage,
  buildTopicsMessage,
};
