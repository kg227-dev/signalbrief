const { appendEngagementEventChecked, buildDigestId } = require("../engagement/engagement-events-runtime");
const { normalizeTopicToken, topicsRelated } = require("../../digest/domain/topic-domain-runtime");

function clampWeight(value) {
  return Math.max(-5, Math.min(5, Number(value) || 0));
}

function getTopicForTag(tag, userTopics) {
  const topics = Array.isArray(userTopics) ? userTopics : [];
  const tagNorm = normalizeTopicToken(tag);
  if (!tagNorm) return null;

  const exact = topics.find((t) => normalizeTopicToken(t) === tagNorm);
  if (exact) return exact;

  let best = null;
  let bestLen = -1;
  for (const topic of topics) {
    const topicNorm = normalizeTopicToken(topic);
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

function buildLearningConfig(opts, now) {
  const lookbackDays = Math.max(7, Number(opts.lookback_days || 14));
  return {
    dateKey: String(opts.date_key || now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })),
    runId: String(opts.run_id || "").trim() || null,
    maxTopicsPerRun: Math.max(1, Number(opts.max_topics_per_run || 5)),
    minSignalsPerTopic: Math.max(2, Number(opts.min_signals_per_topic || 4)),
    positiveNetThreshold: Math.max(2, Number(opts.positive_net_threshold || 4)),
    negativeNetThreshold: -Math.max(2, Number(opts.negative_net_threshold || 4)),
    lookbackDays,
    lookbackMs: lookbackDays * 24 * 60 * 60 * 1000,
  };
}

function buildDigestEventIndex(userEvents) {
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
  return digestIndexById;
}

function filterCandidateLearningEvents(userEvents, fromTs) {
  return userEvents.filter((ev) => {
    const type = String(ev?.event_type || "");
    if (type !== "item_saved" && type !== "item_clicked" && type !== "item_ignored_computed") return false;
    const ts = parseTs(ev?.ts_utc);
    if (ts == null) return false;
    return ts >= fromTs;
  });
}

function incrementTopicStatsRow(row, eventType) {
  if (eventType === "item_saved") {
    row.net += 3;
    row.saved += 1;
  } else if (eventType === "item_clicked") {
    row.net += 2;
    row.clicked += 1;
  } else if (eventType === "item_ignored_computed") {
    row.net -= 1;
    row.ignored += 1;
  }
  row.count += 1;
}

function buildTopicStats(candidateEvents, digestIndexById, userTopics) {
  const statsByTopic = new Map();
  let maxProcessedTs = null;

  for (const ev of candidateEvents) {
    const ts = parseTs(ev.ts_utc);
    if (ts != null && (maxProcessedTs == null || ts > maxProcessedTs)) maxProcessedTs = ts;

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
    incrementTopicStatsRow(statsByTopic.get(topic), String(ev.event_type || ""));
  }

  return { statsByTopic, maxProcessedTs };
}

function selectTopicCandidates(statsByTopic, config) {
  const candidates = [];
  for (const row of statsByTopic.values()) {
    if (row.count < config.minSignalsPerTopic) continue;
    let delta = 0;
    if (row.net >= config.positiveNetThreshold) delta = 1;
    else if (row.net <= config.negativeNetThreshold) delta = -1;
    if (delta === 0) continue;
    candidates.push({ ...row, delta });
  }

  candidates.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return candidates.slice(0, config.maxTopicsPerRun);
}

function ensureTopicWeights(user) {
  if (!user.topic_weights || typeof user.topic_weights !== "object") {
    user.topic_weights = {};
  }
}

function applyTopicWeightAdjustments(user, selected, context) {
  const adjustments = [];
  let eventWriteFailures = 0;
  const {
    dateKey,
    runId,
    userChatId,
    userEmail,
  } = context;
  const digestId = buildDigestId(dateKey, userChatId);

  for (const row of selected) {
    const prev = Number(user.topic_weights[row.topic] || 0);
    const next = clampWeight(prev + row.delta);
    if (next === prev) continue;
    user.topic_weights[row.topic] = next;

    const eventKey = `weight:${dateKey}:${userChatId}:${row.topic}:auto:${next}:${runId || "na"}`;
    const eventOutcome = appendEngagementEventChecked({
      event_type: "topic_weight_adjusted",
      event_key: eventKey,
      date_et: dateKey,
      user_chat_id: userChatId,
      user_email: userEmail || null,
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
    }, { scope: "personalization", context: `topic_weight_adjusted:auto:${userChatId}:${row.topic}` });
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

  return { adjustments, eventWriteFailures };
}

function applyAutoTopicLearning(user, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const config = buildLearningConfig(opts, now);
  const allEvents = Array.isArray(opts.events) ? opts.events : [];
  const userChatId = String(user?.chatId || "").trim();
  if (!userChatId) return { changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 };

  const userTopics = Array.isArray(user?.topics) ? user.topics : [];
  if (!userTopics.length) return { changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 };

  const state = user.auto_learning && typeof user.auto_learning === "object" ? user.auto_learning : {};
  const cursorTs = parseTs(state.last_processed_ts);
  const minTs = now.getTime() - config.lookbackMs;
  const fromTs = cursorTs == null ? minTs : Math.max(minTs, cursorTs + 1);

  const userEvents = allEvents
    .filter((ev) => String(ev?.user_chat_id || "").trim() === userChatId)
    .sort((a, b) => (parseTs(a?.ts_utc) || 0) - (parseTs(b?.ts_utc) || 0));

  const digestIndexById = buildDigestEventIndex(userEvents);
  const candidateEvents = filterCandidateLearningEvents(userEvents, fromTs);

  if (!candidateEvents.length) {
    user.auto_learning = {
      ...state,
      last_checked_at: now.toISOString(),
    };
    return { changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 };
  }

  const { statsByTopic, maxProcessedTs } = buildTopicStats(candidateEvents, digestIndexById, userTopics);
  const selected = selectTopicCandidates(statsByTopic, config);
  ensureTopicWeights(user);
  const { adjustments, eventWriteFailures } = applyTopicWeightAdjustments(user, selected, {
    dateKey: config.dateKey,
    runId: config.runId,
    userChatId,
    userEmail: user.email,
  });

  user.auto_learning = {
    ...state,
    enabled: true,
    lookback_days: config.lookbackDays,
    min_signals_per_topic: config.minSignalsPerTopic,
    positive_net_threshold: config.positiveNetThreshold,
    negative_net_threshold: Math.abs(config.negativeNetThreshold),
    last_checked_at: now.toISOString(),
    last_processed_ts: new Date(maxProcessedTs == null ? fromTs : maxProcessedTs).toISOString(),
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
