"use strict";

const { appendEngagementEventChecked, buildDigestId } = require("../engagement/engagement-events-runtime");
const MAX_CUSTOM_KEYWORDS = 3;

function etDateKeyNow() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function etDateKeyFromIso(iso) {
  if (!iso) return etDateKeyNow();
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function createEngagementCommandHandlers(deps) {
  const {
    send,
    readUser,
    writeUser,
    standardTopics,
  } = deps;

  async function handleSave(chatId, items) {
    const user = readUser(chatId);
    const lastItems = user.last_digest_items || [];
    if (!Array.isArray(items) || items.length === 0) {
      await send(chatId, "Tell me which items to save — for example: *save 2* or *save 1, 3*.");
      return;
    }
    if (lastItems.length === 0) {
      await send(chatId, "I don't have a recent digest to save from yet. After your next digest, reply *save 3*.");
      return;
    }

    const saved = [];
    const already = [];
    const outOfBounds = [];
    const digestDateKey = etDateKeyFromIso(user.last_digest_at);
    const digestId = buildDigestId(digestDateKey, chatId);

    items.forEach((itemNumber) => {
      if (itemNumber < 1 || itemNumber > 10 || (lastItems.length > 0 && itemNumber > lastItems.length)) {
        outOfBounds.push(itemNumber);
        return;
      }

      const existing = user.bookmarks.find((bookmark) => {
        const today = etDateKeyNow();
        return bookmark.date === today && bookmark.item_num === itemNumber;
      });
      if (existing) {
        already.push(itemNumber);
        return;
      }

      const digestItem = lastItems[itemNumber - 1];
      const today = etDateKeyNow();
      user.bookmarks.push({
        date: today,
        item_num: itemNumber,
        headline: digestItem?.headline || `Item ${itemNumber}`,
        url: digestItem?.url || null,
        tag: digestItem?.tag || null,
      });
      appendEngagementEventChecked({
        event_type: "item_saved",
        event_key: `item_saved:${digestId}:${itemNumber}`,
        date_et: digestDateKey,
        user_chat_id: String(chatId),
        user_email: user.email || null,
        digest_id: digestId,
        channel: "telegram",
        source: "bot-command",
        item: {
          index: itemNumber,
          headline: digestItem?.headline || null,
          url: digestItem?.url || null,
          tag: digestItem?.tag || null,
        },
        metadata: {
          command: "save",
        },
      }, { scope: "reply-handler", context: `item_saved:${digestId}:${itemNumber}` });
      saved.push(itemNumber);
    });

    writeUser(chatId, user);

    const savedList = saved.map((itemNumber) => `#${itemNumber}`).join(", ");
    const alreadyList = already.map((itemNumber) => `#${itemNumber}`).join(", ");

    let reply = "";
    if (saved.length > 0) {
      reply += `✅ Saved ${saved.length === 1 ? "item" : "items"} ${savedList} to your bookmarks.`;
    }
    if (already.length > 0) {
      reply += `${reply ? "\n" : ""}ℹ️ ${alreadyList} already bookmarked.`;
    }
    if (outOfBounds.length > 0) {
      reply += `${reply ? "\n" : ""}❓ Item${outOfBounds.length > 1 ? "s" : ""} ${outOfBounds.map((itemNumber) => `#${itemNumber}`).join(", ")} not found in your last digest.`;
    }
    if (saved.length === 1) {
      reply += "\n\nWant to save any others from today? Just reply with the numbers.";
    }

    await send(chatId, reply || "Nothing to save.");
  }

  async function handleTopicMore(chatId, topic) {
    const user = readUser(chatId);
    const previous = Number(user.topic_weights[topic] || 0);
    const dateKey = etDateKeyNow();
    user.topic_weights[topic] = Math.min(5, (user.topic_weights[topic] || 0) + 1);
    writeUser(chatId, user);
    const next = Number(user.topic_weights[topic] || 0);
    appendEngagementEventChecked({
      event_type: "topic_weight_adjusted",
      event_key: `weight:${dateKey}:${chatId}:${topic}:manual:${next}:${Date.now()}`,
      date_et: dateKey,
      user_chat_id: String(chatId),
      user_email: user.email || null,
      digest_id: buildDigestId(dateKey, chatId),
      channel: "telegram",
      source: "bot-command",
      topic: {
        key: topic,
        delta: next - previous,
        mode: "manual",
        reason: "more command",
      },
    }, { scope: "reply-handler", context: `topic_weight_adjusted:more:${chatId}:${topic}` });
    await send(chatId, `📊 Got it — more *${topic}* stories starting tomorrow.`);
  }

  async function handleTopicLess(chatId, topic) {
    const user = readUser(chatId);
    const previous = Number(user.topic_weights[topic] || 0);
    const dateKey = etDateKeyNow();
    user.topic_weights[topic] = Math.max(-5, (user.topic_weights[topic] || 0) - 1);
    writeUser(chatId, user);
    const next = Number(user.topic_weights[topic] || 0);
    appendEngagementEventChecked({
      event_type: "topic_weight_adjusted",
      event_key: `weight:${dateKey}:${chatId}:${topic}:manual:${next}:${Date.now()}`,
      date_et: dateKey,
      user_chat_id: String(chatId),
      user_email: user.email || null,
      digest_id: buildDigestId(dateKey, chatId),
      channel: "telegram",
      source: "bot-command",
      topic: {
        key: topic,
        delta: next - previous,
        mode: "manual",
        reason: "less command",
      },
    }, { scope: "reply-handler", context: `topic_weight_adjusted:less:${chatId}:${topic}` });
    await send(chatId, `📉 Got it — fewer *${topic}* stories starting tomorrow.`);
  }

  function getTopicFromLastDigestItem(user, itemIndex) {
    const idx = Number(itemIndex || 0);
    if (!Number.isFinite(idx) || idx < 1) return null;
    const items = Array.isArray(user?.last_digest_items) ? user.last_digest_items : [];
    const item = items[idx - 1];
    const tag = String(item?.tag || "").trim();
    return tag || null;
  }

  async function handleDigestFeedback(chatId, reactionKey) {
    const FEEDBACK = {
      great: { label: "great", emoji: "🔥", score: 2, ack: "Love it — keep those coming." },
      fine: { label: "fine", emoji: "👍", score: 1, ack: "Noted — we will keep tuning." },
      meh: { label: "meh", emoji: "👎", score: 0, ack: "Thanks — we will sharpen tomorrow's brief." },
    };
    const chosen = FEEDBACK[String(reactionKey || "").toLowerCase()];
    if (!chosen) {
      await send(chatId, "I couldn't record that reaction. Try one of the digest feedback buttons again.");
      return { ok: false, notice: "Invalid feedback" };
    }

    const user = readUser(chatId);
    if (!user.last_digest_at) {
      await send(chatId, "I don't have a recent digest to score yet.");
      return { ok: false, notice: "No recent digest" };
    }

    const dateKey = etDateKeyFromIso(user.last_digest_at);
    const digestId = buildDigestId(dateKey, chatId);
    if (!Array.isArray(user.digest_feedback)) user.digest_feedback = [];

    const existing = user.digest_feedback.find((row) => String(row?.digest_id || "") === digestId);
    if (existing) {
      await send(chatId, `Feedback already recorded for this digest (${existing.emoji || existing.label || "saved"}).`);
      return { ok: false, notice: "Already recorded" };
    }

    const nowIso = new Date().toISOString();
    const entry = {
      digest_id: digestId,
      date_et: dateKey,
      ts_utc: nowIso,
      label: chosen.label,
      emoji: chosen.emoji,
      score: chosen.score,
      channel: "telegram",
    };
    user.digest_feedback.push(entry);
    if (user.digest_feedback.length > 120) {
      user.digest_feedback.splice(0, user.digest_feedback.length - 120);
    }
    writeUser(chatId, user);

    appendEngagementEventChecked({
      event_type: "digest_feedback_submitted",
      event_key: `feedback:${digestId}`,
      date_et: dateKey,
      user_chat_id: String(chatId),
      user_email: user.email || null,
      digest_id: digestId,
      channel: "telegram",
      source: "inline-keyboard",
      feedback: {
        label: chosen.label,
        score: chosen.score,
        emoji: chosen.emoji,
      },
    }, { scope: "reply-handler", context: `digest_feedback_submitted:${digestId}` });

    await send(chatId, `${chosen.emoji} Feedback saved. ${chosen.ack}`);
    return { ok: true, notice: "Feedback saved" };
  }

  async function handleTopicAdd(chatId, topic) {
    const rawTopic = String(topic || "").trim();
    if (!rawTopic) return;
    const user = readUser(chatId);
    if (!Array.isArray(user.topics)) user.topics = [];
    if (!Array.isArray(user.custom_topics)) user.custom_topics = [];

    const matchStandard = standardTopics.find((entry) => entry.toLowerCase() === rawTopic.toLowerCase());
    let topicKey = matchStandard || "";
    let displayLabel = matchStandard || rawTopic.replace(/[_]/g, " ");

    if (!matchStandard) {
      const slug = rawTopic.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!slug) {
        await send(chatId, "Please add a valid keyword using letters or numbers.");
        return;
      }

      topicKey = `custom_${slug}`;
      displayLabel = rawTopic;

      const existingCustom = new Set(
        [
          ...user.custom_topics,
          ...user.topics.filter((entry) => String(entry || "").startsWith("custom_")),
        ]
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      );

      if (!existingCustom.has(topicKey) && existingCustom.size >= MAX_CUSTOM_KEYWORDS) {
        await send(chatId, `You can track up to ${MAX_CUSTOM_KEYWORDS} custom keywords. Remove one in settings before adding another.`);
        return;
      }

      existingCustom.add(topicKey);
      user.custom_topics = Array.from(existingCustom);
    }

    if (!user.topics.includes(topicKey)) {
      user.topics.push(topicKey);
    }
    writeUser(chatId, user);
    await send(chatId, `➕ Added *${displayLabel}* to your topics. You'll see it in tomorrow's digest.`);
  }

  function resolveSourceDomainFromItem(user, itemIndex) {
    const idx = Number(itemIndex || 0);
    if (!Number.isFinite(idx) || idx < 1) return null;
    const items = Array.isArray(user?.last_digest_items) ? user.last_digest_items : [];
    const item = items[idx - 1];
    return String(item?.source_domain || "").trim().toLowerCase().replace(/^www\./, "") || null;
  }

  async function handleSourceBlock(chatId, input) {
    const user = readUser(chatId);
    if (!user.source_preferences) user.source_preferences = { blocked_sources: [], trusted_sources: [] };
    const domain = /^\d+$/.test(String(input || "").trim())
      ? resolveSourceDomainFromItem(user, Number(input))
      : String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/\s]/)[0];
    if (!domain) {
      await send(chatId, "Tell me which source to block — for example: *block 3* (item number) or *block benzinga.com*.");
      return;
    }
    if (!Array.isArray(user.source_preferences.blocked_sources)) user.source_preferences.blocked_sources = [];
    if (user.source_preferences.blocked_sources.includes(domain)) {
      await send(chatId, `🚫 *${domain}* is already blocked.`);
      return;
    }
    user.source_preferences.blocked_sources.push(domain);
    // Remove from trusted if present
    if (Array.isArray(user.source_preferences.trusted_sources)) {
      user.source_preferences.trusted_sources = user.source_preferences.trusted_sources.filter((d) => d !== domain);
    }
    writeUser(chatId, user);
    await send(chatId, `🚫 Blocked *${domain}* — stories from this source will be heavily deprioritized.`);
  }

  async function handleSourceTrust(chatId, input) {
    const user = readUser(chatId);
    if (!user.source_preferences) user.source_preferences = { blocked_sources: [], trusted_sources: [] };
    const domain = /^\d+$/.test(String(input || "").trim())
      ? resolveSourceDomainFromItem(user, Number(input))
      : String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/\s]/)[0];
    if (!domain) {
      await send(chatId, "Tell me which source to trust — for example: *trust 2* (item number) or *trust reuters.com*.");
      return;
    }
    if (!Array.isArray(user.source_preferences.trusted_sources)) user.source_preferences.trusted_sources = [];
    if (user.source_preferences.trusted_sources.includes(domain)) {
      await send(chatId, `✅ *${domain}* is already trusted.`);
      return;
    }
    user.source_preferences.trusted_sources.push(domain);
    // Remove from blocked if present
    if (Array.isArray(user.source_preferences.blocked_sources)) {
      user.source_preferences.blocked_sources = user.source_preferences.blocked_sources.filter((d) => d !== domain);
    }
    writeUser(chatId, user);
    await send(chatId, `✅ Trusted *${domain}* — stories from this source will get a small boost.`);
  }

  async function handleSourceUnblock(chatId, input) {
    const user = readUser(chatId);
    if (!user.source_preferences) user.source_preferences = { blocked_sources: [], trusted_sources: [] };
    const domain = String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/\s]/)[0];
    if (!domain) {
      await send(chatId, "Tell me which source to unblock — for example: *unblock benzinga.com*.");
      return;
    }
    let removed = false;
    if (Array.isArray(user.source_preferences.blocked_sources)) {
      const before = user.source_preferences.blocked_sources.length;
      user.source_preferences.blocked_sources = user.source_preferences.blocked_sources.filter((d) => d !== domain);
      removed = user.source_preferences.blocked_sources.length < before;
    }
    if (Array.isArray(user.source_preferences.trusted_sources)) {
      const before = user.source_preferences.trusted_sources.length;
      user.source_preferences.trusted_sources = user.source_preferences.trusted_sources.filter((d) => d !== domain);
      if (user.source_preferences.trusted_sources.length < before) removed = true;
    }
    writeUser(chatId, user);
    await send(chatId, removed
      ? `↩️ Removed *${domain}* from your source preferences.`
      : `*${domain}* wasn't in your blocked or trusted list.`);
  }

  function parseInlineCallbackData(data) {
    const raw = String(data || "").trim();
    const parts = raw.split(":");
    if (parts.length < 3 || parts[0] !== "sb") return null;

    const action = parts[1];
    if (action === "save" || action === "more" || action === "less") {
      const item = Number(parts[2]);
      if (!Number.isFinite(item) || item < 1 || item > 10) return null;
      return { action, item };
    }
    if (action === "fb") {
      return { action, reaction: parts[2] || "" };
    }
    return null;
  }

  async function handleCallback(data, chatId) {
    const parsed = parseInlineCallbackData(data);
    if (!parsed) return { ok: false, notice: "Unsupported action" };

    if (parsed.action === "save") {
      await handleSave(chatId, [parsed.item]);
      return { ok: true, notice: `Saved #${parsed.item}` };
    }

    if (parsed.action === "more" || parsed.action === "less") {
      const user = readUser(chatId);
      const topic = getTopicFromLastDigestItem(user, parsed.item);
      if (!topic) {
        await send(chatId, `I couldn't resolve item #${parsed.item} from your last digest.`);
        return { ok: false, notice: "Item unavailable" };
      }
      if (parsed.action === "more") {
        await handleTopicMore(chatId, topic);
        return { ok: true, notice: `More ${topic}` };
      }
      await handleTopicLess(chatId, topic);
      return { ok: true, notice: `Less ${topic}` };
    }

    if (parsed.action === "fb") {
      const result = await handleDigestFeedback(chatId, parsed.reaction);
      return result || { ok: false, notice: "Feedback failed" };
    }

    return { ok: false, notice: "Unsupported action" };
  }

  return {
    handleSave,
    handleTopicMore,
    handleTopicLess,
    handleDigestFeedback,
    handleTopicAdd,
    handleSourceBlock,
    handleSourceTrust,
    handleSourceUnblock,
    handleCallback,
  };
}

module.exports = {
  createEngagementCommandHandlers,
};
