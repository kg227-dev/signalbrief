"use strict";

function canonicalizeTopicKey(rawTopic, defaultTopics = []) {
  const input = String(rawTopic || "").trim();
  if (!input) return "";

  const standard = defaultTopics.find((topic) => String(topic || "").toLowerCase() === input.toLowerCase());
  return standard || "";
}

function normalizeTopicsForUserInput(rawTopics, opts = {}) {
  const defaultTopics = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
  const minRequired = Math.max(0, Number(opts.minRequired ?? 1));
  const maxTopics = Math.max(minRequired, Number(opts.maxTopics ?? 3));

  if (!Array.isArray(rawTopics)) {
    return { ok: false, error: "topics must be an array" };
  }

  const seen = new Set();
  const topics = [];
  for (const rawTopic of rawTopics) {
    if (typeof rawTopic !== "string" || !rawTopic.trim()) {
      return { ok: false, error: "topics must contain non-empty strings" };
    }
    const topic = canonicalizeTopicKey(rawTopic, defaultTopics);
    if (!topic) {
      return { ok: false, error: "topics must match a supported topic" };
    }
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    topics.push(topic);
  }

  if (topics.length < minRequired) {
    return { ok: false, error: `select at least ${minRequired} topics` };
  }
  if (topics.length > maxTopics) {
    return { ok: false, error: `select no more than ${maxTopics} topics` };
  }

  return { ok: true, topics };
}

module.exports = {
  canonicalizeTopicKey,
  normalizeTopicsForUserInput,
};
