"use strict";

function toPositiveIntOrDefault(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

module.exports = {
  toPositiveIntOrDefault,
  sleep,
};
