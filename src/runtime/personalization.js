const { appendEngagementEvent, buildDigestId } = require("./engagement-events");

const RELATED_TOPIC_GROUPS = [
  ["healthcare", "life sciences"],
  ["ai tech", "technology", "digital"],
  ["pe m a", "m a advisory", "financial services"],
  ["public sector", "policy regulatory"],
  ["energy", "sustainability"],
];

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^custom_/i, "")
    .replace(/×/g, " ")
    .replace(/_/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topicsRelated(a, b) {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return RELATED_TOPIC_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

function clampWeight(value) {
  return Math.max(-5, Math.min(5, Number(value) || 0));
}

function getTopicForTag(tag, userTopics) {
  const topics = Array.isArray(userTopics) ? userTopics : [];
  const tagNorm = normalizeToken(tag);
  if (!tagNorm) return null;

  const exact = topics.find((t) => normalizeToken(t) === tagNorm);
  if (exact) return exact;

  let best = null;
  let bestLen = -1;
  for (const topic of topics) {
    const topicNorm = normalizeToken(topic);
    if (!topicNorm) continue;
    if (!topicsRelated(tagNorm, topicNorm)) continue;
    if (topicNorm.length > bestLen) {
      best = topic;
      bestLen = topicNorm.length;
    }
  }
  return best;
}

function parseTs(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : null;
}

function appendEngagementEventChecked(payload, context) {
  const outcome = appendEngagementEvent(payload);
  if (!outcome.ok) {
    const code = String(outcome.error_code || outcome.code || "unknown");
    const detail = outcome.detail ? ` (${outcome.detail})` : "";
    console.warn(`[personalization] engagement event write failed [${context}] code=${code}${detail}`);
  }
  return outcome;
}

function getEventTag(ev, digestIndexById) {
  const direct = String(ev?.item?.tag || "").trim();
  if (direct) return direct;

  const digestId = String(ev?.digest_id || "").trim();
  const itemIndex = Number(ev?.item?.index || 0);
  if (!digestId || itemIndex <= 0) return "";
  const digestItems = digestIndexById.get(digestId);
  if (!digestItems) return "";
  const row = digestItems.get(itemIndex);
  return String(row?.tag || "").trim();
}

function applyAutoTopicLearning(user, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dateKey = String(opts.date_key || now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  const runId = String(opts.run_id || "").trim() || null;
  const allEvents = Array.isArray(opts.events) ? opts.events : [];
  const userChatId = String(user?.chatId || "").trim();
  if (!userChatId) return { changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 };

  const userTopics = Array.isArray(user?.topics) ? user.topics : [];
  if (!userTopics.length) return { changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 };

  const maxTopicsPerRun = Math.max(1, Number(opts.max_topics_per_run || 5));
  const minSignalsPerTopic = Math.max(2, Number(opts.min_signals_per_topic || 4));
  const positiveNetThreshold = Math.max(2, Number(opts.positive_net_threshold || 4));
  const negativeNetThreshold = -Math.max(2, Number(opts.negative_net_threshold || 4));
  const lookbackDays = Math.max(7, Number(opts.lookback_days || 14));
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  const state = user.auto_learning && typeof user.auto_learning === "object" ? user.auto_learning : {};
  const cursorTs = parseTs(state.last_processed_ts);
  const minTs = now.getTime() - lookbackMs;
  const fromTs = cursorTs == null ? minTs : Math.max(minTs, cursorTs + 1);

  const userEvents = allEvents
    .filter((ev) => String(ev?.user_chat_id || "").trim() === userChatId)
    .sort((a, b) => (parseTs(a?.ts_utc) || 0) - (parseTs(b?.ts_utc) || 0));

  const digestIndexById = new Map();
  for (const ev of userEvents) {
    if (String(ev?.event_type || "") !== "digest_sent") continue;
    const digestId = String(ev?.digest_id || "").trim();
    if (!digestId) continue;
    const items = Array.isArray(ev?.metadata?.items) ? ev.metadata.items : [];
    const idxMap = new Map();
    for (const item of items) {
      const index = Number(item?.index || 0);
      if (index > 0) idxMap.set(index, item);
    }
    digestIndexById.set(digestId, idxMap);
  }

  const candidateEvents = userEvents.filter((ev) => {
    const type = String(ev?.event_type || "");
    if (type !== "item_saved" && type !== "item_clicked" && type !== "item_ignored_computed") return false;
    const ts = parseTs(ev?.ts_utc);
    if (ts == null) return false;
    return ts >= fromTs;
  });

  if (!candidateEvents.length) {
    user.auto_learning = {
      ...state,
      last_checked_at: now.toISOString(),
    };
    return { changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 };
  }

  const statsByTopic = new Map();
  let maxProcessedTs = fromTs;

  for (const ev of candidateEvents) {
    const ts = parseTs(ev.ts_utc);
    if (ts != null && ts > maxProcessedTs) maxProcessedTs = ts;

    const tag = getEventTag(ev, digestIndexById);
    const topic = getTopicForTag(tag, userTopics);
    if (!topic) continue;

    if (!statsByTopic.has(topic)) {
      statsByTopic.set(topic, {
        topic,
        net: 0,
        count: 0,
        clicked: 0,
        saved: 0,
        ignored: 0,
      });
    }
    const row = statsByTopic.get(topic);
    const type = String(ev.event_type || "");
    if (type === "item_saved") {
      row.net += 3;
      row.saved += 1;
    } else if (type === "item_clicked") {
      row.net += 2;
      row.clicked += 1;
    } else if (type === "item_ignored_computed") {
      row.net -= 1;
      row.ignored += 1;
    }
    row.count += 1;
  }

  const candidates = [];
  for (const row of statsByTopic.values()) {
    if (row.count < minSignalsPerTopic) continue;
    let delta = 0;
    if (row.net >= positiveNetThreshold) delta = 1;
    else if (row.net <= negativeNetThreshold) delta = -1;
    if (delta === 0) continue;
    candidates.push({ ...row, delta });
  }

  candidates.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const selected = candidates.slice(0, maxTopicsPerRun);

  if (!user.topic_weights || typeof user.topic_weights !== "object") user.topic_weights = {};
  const adjustments = [];
  let eventWriteFailures = 0;
  for (const row of selected) {
    const prev = Number(user.topic_weights[row.topic] || 0);
    const next = clampWeight(prev + row.delta);
    if (next === prev) continue;
    user.topic_weights[row.topic] = next;
    const digestId = buildDigestId(dateKey, userChatId);
    const eventKey = `weight:${dateKey}:${userChatId}:${row.topic}:auto:${next}:${runId || "na"}`;
    const eventOutcome = appendEngagementEventChecked({
      event_type: "topic_weight_adjusted",
      event_key: eventKey,
      date_et: dateKey,
      user_chat_id: userChatId,
      user_email: user.email || null,
      digest_id: digestId,
      run_id: runId,
      channel: "system",
      source: "derived-processor",
      topic: {
        key: row.topic,
        delta: next - prev,
        mode: "auto",
        reason: "engagement-signals",
      },
      metadata: {
        net: row.net,
        count: row.count,
        clicked: row.clicked,
        saved: row.saved,
        ignored: row.ignored,
      },
    }, `topic_weight_adjusted:auto:${userChatId}:${row.topic}`);
    if (!eventOutcome.ok) eventWriteFailures += 1;
    adjustments.push({
      topic: row.topic,
      prev,
      next,
      delta: next - prev,
      signals: {
        net: row.net,
        count: row.count,
        clicked: row.clicked,
        saved: row.saved,
        ignored: row.ignored,
      },
    });
  }

  user.auto_learning = {
    ...state,
    enabled: true,
    lookback_days: lookbackDays,
    min_signals_per_topic: minSignalsPerTopic,
    positive_net_threshold: positiveNetThreshold,
    negative_net_threshold: Math.abs(negativeNetThreshold),
    last_checked_at: now.toISOString(),
    last_processed_ts: new Date(maxProcessedTs).toISOString(),
    last_applied_at: adjustments.length ? now.toISOString() : state.last_applied_at || null,
    total_auto_adjustments: Number(state.total_auto_adjustments || 0) + adjustments.length,
  };

  return {
    changed: adjustments.length > 0,
    adjustments,
    processed_events: candidateEvents.length,
    cursor_ts: new Date(maxProcessedTs).toISOString(),
    event_write_failures: eventWriteFailures,
  };
}

module.exports = {
  applyAutoTopicLearning,
};
