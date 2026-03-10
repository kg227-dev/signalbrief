"use strict";

const { appendEngagementEventChecked, buildDigestId } = require("../engagement/engagement-events-runtime");

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
    if (!topic) return;
    const user = readUser(chatId);
    const matchStandard = standardTopics.find((entry) => entry.toLowerCase() === topic.toLowerCase());
    const topicKey = matchStandard || (`custom_${topic.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`);
    const displayLabel = matchStandard || topic.replace(/[_]/g, " ");

    if (!matchStandard && !user.custom_topics.includes(topicKey)) {
      user.custom_topics.push(topicKey);
    }
    if (!user.topics) user.topics = [];
    if (!user.topics.includes(topicKey)) {
      user.topics.push(topicKey);
    }
    writeUser(chatId, user);
    await send(chatId, `➕ Added *${displayLabel}* to your topics. You'll see it in tomorrow's digest.`);
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
    handleCallback,
  };
}

module.exports = {
  createEngagementCommandHandlers,
};
