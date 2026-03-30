"use strict";

const fsDefault = require("fs");
const pathDefault = require("path");

const DEFAULT_RETENTION_HOURS = 72;
const DEFAULT_FRESHNESS_HOURS = 48;
const DEFAULT_MAX_ITEMS_PER_TOPIC = 160;
const INVENTORY_VERSION = 1;

function clampPositiveInt(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeTopicTag(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeUrlKey(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveItemKey(item = {}) {
  return normalizeUrlKey(item?.canonical_url || item?.url || "");
}

function resolveReferenceMs(item = {}) {
  const publishedMs = Date.parse(String(item?.published_date || "").trim());
  if (Number.isFinite(publishedMs)) return publishedMs;
  const retrievedMs = Date.parse(String(item?.retrieved_at || "").trim());
  if (Number.isFinite(retrievedMs)) return retrievedMs;
  return 0;
}

function resolveRetrievedMs(item = {}) {
  const retrievedMs = Date.parse(String(item?.retrieved_at || "").trim());
  return Number.isFinite(retrievedMs) ? retrievedMs : 0;
}

function sanitizeItem(item = {}) {
  if (!item || typeof item !== "object") return null;
  const tag = normalizeTopicTag(item.tag);
  const url = String(item.url || "").trim();
  const headline = String(item.headline || "").trim();
  const publishedDate = String(item.published_date || "").trim();
  const key = resolveItemKey(item);
  if (!tag || !url || !headline || !publishedDate || !key) return null;
  return {
    tag,
    headline,
    summary: String(item.summary || "").trim(),
    url,
    canonical_url: String(item.canonical_url || url).trim() || url,
    published_date: publishedDate,
    source: String(item.source || "").trim() || null,
    source_domain: String(item.source_domain || "").trim() || null,
    retrieved_at: String(item.retrieved_at || "").trim() || null,
    retrieval_pass: String(item.retrieval_pass || "").trim() || null,
    retrieval_lane: String(item.retrieval_lane || "").trim() || null,
    retrieval_origin: String(item.retrieval_origin || "").trim() || null,
    retrieval_source_family: String(item.retrieval_source_family || "").trim() || null,
    source_type: String(item.source_type || "").trim() || null,
    source_policy: String(item.source_policy || "").trim() || null,
    source_authority: Number.isFinite(Number(item.source_authority)) ? Number(item.source_authority) : null,
    source_tier: item.source_tier ?? null,
    content_kind: String(item.content_kind || "").trim() || null,
    broker_source_id: String(item.broker_source_id || "").trim() || null,
    broker_source_family: String(item.broker_source_family || "").trim() || null,
    broker_source_endpoint: String(item.broker_source_endpoint || "").trim() || null,
  };
}

function trimTopicItems(items = [], { nowMs, retentionHours, maxItemsPerTopic }) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const retentionMs = clampPositiveInt(retentionHours, DEFAULT_RETENTION_HOURS) * 60 * 60 * 1000;
  const maxItems = clampPositiveInt(maxItemsPerTopic, DEFAULT_MAX_ITEMS_PER_TOPIC);
  const deduped = new Map();
  for (const rawItem of (Array.isArray(items) ? items : [])) {
    const item = sanitizeItem(rawItem);
    if (!item) continue;
    const itemKey = resolveItemKey(item);
    const referenceMs = resolveReferenceMs(item);
    if (!Number.isFinite(referenceMs) || referenceMs <= 0) continue;
    if ((now - referenceMs) > retentionMs) continue;
    const existing = deduped.get(itemKey);
    if (!existing) {
      deduped.set(itemKey, item);
      continue;
    }
    const existingReferenceMs = resolveReferenceMs(existing);
    const referenceDelta = referenceMs - existingReferenceMs;
    if (referenceDelta > 0) {
      deduped.set(itemKey, item);
      continue;
    }
    if (referenceDelta === 0 && resolveRetrievedMs(item) > resolveRetrievedMs(existing)) {
      deduped.set(itemKey, item);
    }
  }
  return Array.from(deduped.values())
    .sort((left, right) => {
      const publishedDiff = resolveReferenceMs(right) - resolveReferenceMs(left);
      if (publishedDiff !== 0) return publishedDiff;
      return String(left.url || "").localeCompare(String(right.url || ""));
    })
    .slice(0, maxItems);
}

function readInventory(filePath, fs = fsDefault) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return {
        version: INVENTORY_VERSION,
        updated_at: null,
        topics: {},
      };
    }
    const parsed = safeJsonParse(fs.readFileSync(filePath, "utf8"));
    const topics = parsed?.topics && typeof parsed.topics === "object" ? parsed.topics : {};
    return {
      version: Number(parsed?.version || INVENTORY_VERSION) || INVENTORY_VERSION,
      updated_at: String(parsed?.updated_at || "").trim() || null,
      topics,
    };
  } catch {
    return {
      version: INVENTORY_VERSION,
      updated_at: null,
      topics: {},
    };
  }
}

function writeInventory(filePath, payload, { fs = fsDefault, path = pathDefault } = {}) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function createBrokerCandidateInventoryRuntime(options = {}) {
  const fs = options.fs || fsDefault;
  const path = options.path || pathDefault;
  const inventoryPath = String(options.inventoryPath || "").trim();
  const log = typeof options.log === "function" ? options.log : () => {};

  function inspectInventory() {
    return readInventory(inventoryPath, fs);
  }

  function loadRecentTopicItems(topicTag, opts = {}) {
    const tag = normalizeTopicTag(topicTag);
    if (!tag) return [];
    const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
    const freshnessHours = clampPositiveInt(opts.maxAgeHours, DEFAULT_FRESHNESS_HOURS);
    const freshnessMs = freshnessHours * 60 * 60 * 1000;
    const snapshot = inspectInventory();
    const topicItems = Array.isArray(snapshot.topics?.[tag]?.items) ? snapshot.topics[tag].items : [];
    return trimTopicItems(topicItems, {
      nowMs,
      retentionHours: opts.retentionHours || DEFAULT_RETENTION_HOURS,
      maxItemsPerTopic: opts.maxItemsPerTopic || DEFAULT_MAX_ITEMS_PER_TOPIC,
    }).filter((item) => {
      const publishedMs = resolveReferenceMs(item);
      return Number.isFinite(publishedMs) && publishedMs > 0 && (nowMs - publishedMs) <= freshnessMs;
    });
  }

  function persistBrokerTopicItems(topicItems = {}, opts = {}) {
    if (!inventoryPath) return null;
    const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
    const retentionHours = clampPositiveInt(opts.retentionHours, DEFAULT_RETENTION_HOURS);
    const maxItemsPerTopic = clampPositiveInt(opts.maxItemsPerTopic, DEFAULT_MAX_ITEMS_PER_TOPIC);
    const snapshot = inspectInventory();
    const nextTopics = { ...(snapshot.topics || {}) };
    let changedTopics = 0;

    for (const [rawTag, rawItems] of Object.entries(topicItems && typeof topicItems === "object" ? topicItems : {})) {
      const tag = normalizeTopicTag(rawTag);
      if (!tag) continue;
      const existingItems = Array.isArray(nextTopics?.[tag]?.items) ? nextTopics[tag].items : [];
      const mergedItems = trimTopicItems(existingItems.concat(Array.isArray(rawItems) ? rawItems : []), {
        nowMs,
        retentionHours,
        maxItemsPerTopic,
      });
      nextTopics[tag] = {
        updated_at: new Date(nowMs).toISOString(),
        items: mergedItems,
      };
      changedTopics += 1;
    }

    const trimmedTopics = {};
    for (const [tag, topicState] of Object.entries(nextTopics)) {
      const trimmedItems = trimTopicItems(topicState?.items || [], {
        nowMs,
        retentionHours,
        maxItemsPerTopic,
      });
      if (trimmedItems.length <= 0) continue;
      trimmedTopics[tag] = {
        updated_at: String(topicState?.updated_at || "").trim() || new Date(nowMs).toISOString(),
        items: trimmedItems,
      };
    }

    const payload = {
      version: INVENTORY_VERSION,
      updated_at: new Date(nowMs).toISOString(),
      topics: trimmedTopics,
    };
    writeInventory(inventoryPath, payload, { fs, path });
    log(`[broker-inventory] stored ${changedTopics} topic(s) at ${inventoryPath}`);
    return payload;
  }

  return {
    inspectInventory,
    loadRecentTopicItems,
    persistBrokerTopicItems,
  };
}

module.exports = {
  DEFAULT_FRESHNESS_HOURS,
  DEFAULT_MAX_ITEMS_PER_TOPIC,
  DEFAULT_RETENTION_HOURS,
  createBrokerCandidateInventoryRuntime,
};
