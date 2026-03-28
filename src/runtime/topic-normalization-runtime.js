"use strict";

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTopicToken(value) {
  return normalizeMatchText(String(value || "").replace(/^custom_/i, "").replace(/×/g, " "));
}

const RELATED_TOPIC_GROUPS = Object.freeze([
  Object.freeze(["healthcare", "life sciences"]),
  Object.freeze(["ai tech", "technology", "digital"]),
  Object.freeze(["pe m a", "m a advisory", "financial services"]),
  Object.freeze(["public sector", "policy regulatory"]),
  Object.freeze(["energy", "sustainability"]),
]);

function topicsRelated(a, b) {
  const left = normalizeTopicToken(a);
  const right = normalizeTopicToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return RELATED_TOPIC_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

module.exports = {
  RELATED_TOPIC_GROUPS,
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
};
