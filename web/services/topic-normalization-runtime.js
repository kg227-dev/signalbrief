"use strict";

function canonicalizeTopicKey(rawTopic, defaultTopics = []) {
  const input = String(rawTopic || "").trim();
  if (!input) return "";

  const standard = defaultTopics.find((topic) => String(topic || "").toLowerCase() === input.toLowerCase());
  if (standard) return standard;

  const withoutPrefix = input.replace(/^custom_/i, "");
  const slug = withoutPrefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return `custom_${slug}`;
}

function normalizeTopicsForUserInput(rawTopics, opts = {}) {
  const defaultTopics = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
  const minRequired = Math.max(0, Number(opts.minRequired ?? 2));
  const maxCustomKeywords = Math.max(0, Number(opts.maxCustomKeywords ?? 3));

  if (!Array.isArray(rawTopics)) {
    return { ok: false, error: "topics must be an array" };
  }

  const seen = new Set();
  const topics = [];
  for (const rawTopic of rawTopics) {
    const topic = canonicalizeTopicKey(rawTopic, defaultTopics);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    topics.push(topic);
  }

  if (topics.length < minRequired) {
    return { ok: false, error: `select at least ${minRequired} topics` };
  }

  const customCount = topics.filter((topic) => !defaultTopics.includes(topic)).length;
  if (customCount > maxCustomKeywords) {
    return {
      ok: false,
      error: `You can track up to ${maxCustomKeywords} custom keywords. Remove one to add another.`,
    };
  }

  return { ok: true, topics, customCount };
}

module.exports = {
  canonicalizeTopicKey,
  normalizeTopicsForUserInput,
};
