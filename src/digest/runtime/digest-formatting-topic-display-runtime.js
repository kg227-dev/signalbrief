"use strict";

function formatTopicDisplay(topic) {
  const raw = String(topic || "")
    .replace(/^custom_/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "topic";
  return raw.replace(/\b\w/g, (char) => char.toUpperCase());
}

module.exports = {
  formatTopicDisplay,
};
