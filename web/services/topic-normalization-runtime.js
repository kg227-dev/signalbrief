"use strict";

const MAX_CUSTOM_SLUG_LENGTH = 60;

function canonicalizeTopicKey(rawTopic, defaultTopics = [], opts = {}) {
  const input = String(rawTopic || "").trim();
  if (!input) return "";

  const standard = defaultTopics.find((topic) => String(topic || "").toLowerCase() === input.toLowerCase());
  if (standard) return standard;

  if (opts.allowCustomTopics !== true) return "";

  const withoutPrefix = input.replace(/^custom_/i, "");
  const slug = withoutPrefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return `custom_${slug.slice(0, MAX_CUSTOM_SLUG_LENGTH)}`;
}

function normalizeTopicsForUserInput(rawTopics, opts = {}) {
  const defaultTopics = Array.isArray(opts.defaultTopics) ? opts.defaultTopics : [];
  const minRequired = Math.max(0, Number(opts.minRequired ?? 1));
  const maxTopics = Math.max(minRequired, Number(opts.maxTopics ?? 3));
  const maxCustomKeywords = Math.max(0, Number(opts.maxCustomKeywords ?? 3));
  const allowCustomTopics = maxCustomKeywords > 0;

  if (!Array.isArray(rawTopics)) {
    return { ok: false, error: "topics must be an array" };
  }

  const seen = new Set();
  const topics = [];
  for (const rawTopic of rawTopics) {
    if (typeof rawTopic !== "string" || !rawTopic.trim()) {
      return { ok: false, error: "topics must contain non-empty strings" };
    }
    const topic = canonicalizeTopicKey(rawTopic, defaultTopics, { allowCustomTopics });
    if (!topic) {
      return {
        ok: false,
        error: allowCustomTopics
          ? "topics must match a supported topic or a valid custom keyword"
          : "custom topics are disabled in the reduced-scope MVP",
      };
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
  MAX_CUSTOM_SLUG_LENGTH,
};
