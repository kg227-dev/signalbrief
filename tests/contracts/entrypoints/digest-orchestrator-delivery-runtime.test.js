"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-delivery-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorDeliveryRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  const sentEmailOrders = [];
  const snapshotOrders = [];
  const qualityOrders = [];

  const deliveryRuntime = createDigestOrchestratorDeliveryRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessDigests: 3,
        perUserFreshnessMinItems: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 2,
      },
    },
    log: () => {},
    applyAutoTopicLearning: () => ({ changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 }),
    writeUser: () => {},
    buildLearningSummary: () => "",
    filterItemsByTopics: () => ({
      items: [
        {
          tag: "TECHNOLOGY",
          headline: "Lower scored item",
          summary: "Summary",
          url: "https://example.com/low",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 8,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 6.8,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "SUSTAINABILITY",
          headline: "Highest scored item",
          summary: "Summary",
          url: "https://example.com/high",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 10,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.6,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "ENERGY",
          headline: "Middle scored item",
          summary: "Summary",
          url: "https://example.com/mid",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 9,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.2,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "AI×TECH",
          headline: "Fourth scored item",
          summary: "Summary",
          url: "https://example.com/fourth",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 8,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.0,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "POLICY×REGULATORY",
          headline: "Fifth scored item",
          summary: "Summary",
          url: "https://example.com/fifth",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 7,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 6.5,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
      ],
      customKeywords: [],
      specialistMode: false,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: (items) => items.slice(),
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
    applyDigestDepth: (items) => items.slice().reverse(),
    computeDigestQualityScore: ({ items }) => {
      qualityOrders.push(items.map((item) => item.headline));
      return { score: 88.2, band: "strong", components: {} };
    },
    buildDigestId: (dateKey, userId) => `${dateKey}:${userId}`,
    appendEngagementEventChecked: () => ({ ok: true }),
    beginDigestDeliveryRecord: () => ({ ok: true, skipped: false, version: 1, record: { version: 1 } }),
    updateDigestDeliveryRecord: (payload) => {
      if (Array.isArray(payload?.items) && payload.items.length) {
        snapshotOrders.push(payload.items.map((item) => item.headline));
      }
      return { ok: true };
    },
    loadRecentSentDigests: () => [],
    loadAllCurrentRecords: () => [],
    digestRetryStateRuntime: {
      upsertRetryState: () => null,
      clearRetryState: () => true,
    },
    sendTelegram: async () => {},
    formatTelegram: () => "",
    buildDigestInlineKeyboard: () => ({}),
    generateLeadSubjectLine: async () => ({ subject: "Subject", usage: {} }),
    generateEditorialNote: async () => ({ note: "", usage: {} }),
    buildEmail: (items) => {
      sentEmailOrders.push(items.map((item) => item.headline));
      return "<html></html>";
    },
    buildOpenTrackingPixel: () => "",
    getBaseUrl: () => "https://getsignalbrief.com",
    sendEmail: async () => {},
    normalizeUrlForDedup: (value) => value,
    formatEtDateKey: () => "2026-03-14",
    stripInlineHtml: (value) => String(value || ""),
    topicVisual: () => ({ icon: "", chipText: "#000", chipBg: "#fff" }),
    escapeHtml: (value) => String(value || ""),
  });

  const result = await deliveryRuntime.deliverDueUsers({
    dueUsers: [{
      chatId: "email-user",
      email: "sorted@example.com",
      token: "tok-1",
      topics: ["TECHNOLOGY"],
      preferences: {
        depth: "headline_plus_why",
        email_enabled: true,
        telegram_enabled: false,
        items_per_digest: 5,
      },
      topic_weights: {},
      welcome_email_sent: true,
      last_digest_items: [],
    }],
    enriched: [
      {
        tag: "TECHNOLOGY",
        headline: "Lower scored item",
        summary: "Summary",
        url: "https://example.com/low",
        source: "Example",
        published_date: "2026-03-14T05:00:00.000Z",
        relevanceScore: 6.8,
      },
      {
        tag: "TECHNOLOGY",
        headline: "Highest scored item",
        summary: "Summary",
        url: "https://example.com/high",
        source: "Example",
        published_date: "2026-03-14T05:00:00.000Z",
        relevanceScore: 7.6,
      },
      {
        tag: "TECHNOLOGY",
        headline: "Middle scored item",
        summary: "Summary",
        url: "https://example.com/mid",
        source: "Example",
        published_date: "2026-03-14T05:00:00.000Z",
        relevanceScore: 7.2,
      },
      {
        tag: "TECHNOLOGY",
        headline: "Fourth scored item",
        summary: "Summary",
        url: "https://example.com/fourth",
        source: "Example",
        published_date: "2026-03-14T05:00:00.000Z",
        relevanceScore: 7.0,
      },
      {
        tag: "TECHNOLOGY",
        headline: "Fifth scored item",
        summary: "Summary",
        url: "https://example.com/fifth",
        source: "Example",
        published_date: "2026-03-14T05:00:00.000Z",
        relevanceScore: 6.5,
      },
    ],
    now: new Date("2026-03-14T10:00:00.000Z"),
    shortDate: "Mar 14",
    dateStr: "Saturday, March 14, 2026",
    digestDateKey: "2026-03-14",
    runId: "scheduled:2026-03-14T10-00-00-000Z",
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.5,
    depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    rankingPolicy: { minSignalScoreForFinal: 6.2 },
    publicDigestUrl: "https://getsignalbrief.com/digest/2026-03-14",
    suppressWelcome: false,
    targetChatId: "",
    claudeUsage: { input_tokens: 0, output_tokens: 0 },
    engagementEvents: [],
  });

  assert.strictEqual(result.failedUsers.length, 0);
  assert.strictEqual(result.deliveredUsers.length, 1);
  assert.deepStrictEqual(
    qualityOrders[0],
    ["Highest scored item", "Middle scored item", "Fourth scored item", "Lower scored item", "Fifth scored item"]
  );
  assert.deepStrictEqual(
    sentEmailOrders[0],
    ["Highest scored item", "Middle scored item", "Fourth scored item", "Lower scored item", "Fifth scored item"]
  );
  assert.ok(snapshotOrders.some((order) => (
    Array.isArray(order)
    && order.join("|") === "Highest scored item|Middle scored item|Fourth scored item|Lower scored item|Fifth scored item"
  )));
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

(async () => {
  const retryEntries = [];
  const deliveryRuntime = createDigestOrchestratorDeliveryRuntime({
    CONFIG: {
      digest: {
        catchupWindowMinutes: 60,
        perUserFreshnessDigests: 3,
        perUserFreshnessMinItems: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 2,
      },
    },
    log: () => {},
    applyAutoTopicLearning: () => ({ changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 }),
    writeUser: () => {},
    buildLearningSummary: () => "",
    filterItemsByTopics: () => ({
      items: [
        {
          tag: "TECHNOLOGY",
          headline: "Item one",
          summary: "Summary",
          url: "https://example.com/1",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 9,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.5,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "AI",
          headline: "Item two",
          summary: "Summary",
          url: "https://example.com/2",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 9,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.4,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "ENERGY",
          headline: "Item three",
          summary: "Summary",
          url: "https://example.com/3",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 9,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.3,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "POLICY",
          headline: "Item four",
          summary: "Summary",
          url: "https://example.com/4",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 8,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.2,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "FINANCE",
          headline: "Item five",
          summary: "Summary",
          url: "https://example.com/5",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 8,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.1,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
      ],
      customKeywords: [],
      specialistMode: false,
      wasFiltered: false,
    }),
    applyTopicRelevanceScores: (items) => items.slice(),
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
    applyDigestDepth: (items) => items,
    computeDigestQualityScore: () => ({ score: 86.4, band: "strong", components: {} }),
    buildDigestId: (dateKey, userId) => `${dateKey}:${userId}`,
    appendEngagementEventChecked: () => ({ ok: true }),
    beginDigestDeliveryRecord: () => ({ ok: true, skipped: false, version: 1, record: { version: 1 } }),
    updateDigestDeliveryRecord: () => ({ ok: true }),
    loadRecentSentDigests: () => [],
    loadAllCurrentRecords: () => [],
    digestRetryStateRuntime: {
      upsertRetryState: (entry) => {
        retryEntries.push({ ...entry });
        return entry;
      },
      clearRetryState: () => true,
    },
    sendTelegram: async () => {},
    formatTelegram: () => "",
    buildDigestInlineKeyboard: () => ({}),
    generateLeadSubjectLine: async () => ({ subject: "Subject", usage: {} }),
    generateEditorialNote: async () => ({ note: "", usage: {} }),
    buildEmail: () => "<html></html>",
    buildOpenTrackingPixel: () => "",
    getBaseUrl: () => "https://getsignalbrief.com",
    sendEmail: async () => {
      throw new Error("smtp offline");
    },
    normalizeUrlForDedup: (value) => value,
    formatEtDateKey: () => "2026-03-14",
    stripInlineHtml: (value) => String(value || ""),
    topicVisual: () => ({ icon: "", chipText: "#000", chipBg: "#fff" }),
    escapeHtml: (value) => String(value || ""),
  });

  const result = await deliveryRuntime.deliverDueUsers({
    dueUsers: [{
      chatId: "email-user",
      email: "retry@example.com",
      token: "tok-2",
      topics: ["TECHNOLOGY"],
      preferences: {
        depth: "full",
        email_enabled: true,
        telegram_enabled: false,
        items_per_digest: 5,
        delivery_time: "07:00",
      },
      topic_weights: {},
      welcome_email_sent: true,
      last_digest_items: [],
    }],
    enriched: [
      { tag: "TECHNOLOGY", headline: "Item one", summary: "Summary", url: "https://example.com/1", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.5 },
      { tag: "TECHNOLOGY", headline: "Item two", summary: "Summary", url: "https://example.com/2", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.4 },
      { tag: "TECHNOLOGY", headline: "Item three", summary: "Summary", url: "https://example.com/3", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.3 },
      { tag: "TECHNOLOGY", headline: "Item four", summary: "Summary", url: "https://example.com/4", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.2 },
      { tag: "TECHNOLOGY", headline: "Item five", summary: "Summary", url: "https://example.com/5", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.1 },
    ],
    now: new Date("2026-03-14T11:00:00.000Z"),
    shortDate: "Mar 14",
    dateStr: "Saturday, March 14, 2026",
    digestDateKey: "2026-03-14",
    runId: "scheduled:2026-03-14T11-00-00-000Z",
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.5,
    depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    rankingPolicy: { minSignalScoreForFinal: 6.2 },
    publicDigestUrl: "https://getsignalbrief.com/digest/2026-03-14",
    suppressWelcome: false,
    targetChatId: "",
    claudeUsage: { input_tokens: 0, output_tokens: 0 },
    engagementEvents: [],
  });

  assert.strictEqual(result.deliveredUsers.length, 0);
  assert.strictEqual(result.failedUsers.length, 1);
  assert.strictEqual(retryEntries.length, 1);
  assert.strictEqual(retryEntries[0].delivery_outcome, "delivery_failed_retry_pending");
  assert.strictEqual(retryEntries[0].retry_pending, true);
  assert.ok(retryEntries[0].next_retry_at, "first hard failure should schedule one bounded retry");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

(async () => {
  const retryEntries = [];
  const deliveryRuntime = createDigestOrchestratorDeliveryRuntime({
    CONFIG: {
      digest: {
        catchupWindowMinutes: 60,
        perUserFreshnessDigests: 3,
        perUserFreshnessMinItems: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 2,
      },
    },
    log: () => {},
    applyAutoTopicLearning: () => ({ changed: false, adjustments: [], processed_events: 0, event_write_failures: 0 }),
    writeUser: () => {},
    buildLearningSummary: () => "",
    filterItemsByTopics: () => ({
      items: [
        {
          tag: "TECHNOLOGY",
          headline: "Item one",
          summary: "Summary",
          url: "https://example.com/1",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 9,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.5,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "AI",
          headline: "Item two",
          summary: "Summary",
          url: "https://example.com/2",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 9,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.4,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "ENERGY",
          headline: "Item three",
          summary: "Summary",
          url: "https://example.com/3",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 9,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.3,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "POLICY",
          headline: "Item four",
          summary: "Summary",
          url: "https://example.com/4",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 8,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.2,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
        {
          tag: "FINANCE",
          headline: "Item five",
          summary: "Summary",
          url: "https://example.com/5",
          source: "Example",
          published_date: "2026-03-14T05:00:00.000Z",
          topicMatch: 8,
          source_policy: "preferred",
          source_type: "reported_media",
          source_authority: 0.9,
          relevanceScore: 7.1,
          strategic_value: 0.8,
          routine_item_score: 0.1,
        },
      ],
      customKeywords: [],
      specialistMode: false,
      wasFiltered: false,
    }),
    applyTopicRelevanceScores: (items) => items.slice(),
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
    applyDigestDepth: (items) => items,
    computeDigestQualityScore: () => ({ score: 86.4, band: "strong", components: {} }),
    buildDigestId: (dateKey, userId) => `${dateKey}:${userId}`,
    appendEngagementEventChecked: () => ({ ok: true }),
    beginDigestDeliveryRecord: () => ({ ok: true, skipped: false, version: 1, record: { version: 1 } }),
    updateDigestDeliveryRecord: () => ({ ok: true }),
    loadRecentSentDigests: () => [],
    loadAllCurrentRecords: () => [],
    digestRetryStateRuntime: {
      upsertRetryState: (entry) => {
        retryEntries.push({ ...entry });
        return entry;
      },
      clearRetryState: () => true,
    },
    sendTelegram: async () => {},
    formatTelegram: () => "",
    buildDigestInlineKeyboard: () => ({}),
    generateLeadSubjectLine: async () => ({ subject: "Subject", usage: {} }),
    generateEditorialNote: async () => ({ note: "", usage: {} }),
    buildEmail: () => "<html></html>",
    buildOpenTrackingPixel: () => "",
    getBaseUrl: () => "https://getsignalbrief.com",
    sendEmail: async () => {
      throw new Error("smtp offline");
    },
    normalizeUrlForDedup: (value) => value,
    formatEtDateKey: () => "2026-03-14",
    stripInlineHtml: (value) => String(value || ""),
    topicVisual: () => ({ icon: "", chipText: "#000", chipBg: "#fff" }),
    escapeHtml: (value) => String(value || ""),
  });

  const result = await deliveryRuntime.deliverDueUsers({
    dueUsers: [{
      chatId: "email-user",
      email: "retry2@example.com",
      token: "tok-3",
      topics: ["TECHNOLOGY"],
      preferences: {
        depth: "full",
        email_enabled: true,
        telegram_enabled: false,
        items_per_digest: 5,
        delivery_time: "07:00",
      },
      topic_weights: {},
      welcome_email_sent: true,
      last_digest_items: [],
      __digest_retry: {
        attempt_count: 1,
      },
    }],
    enriched: [
      { tag: "TECHNOLOGY", headline: "Item one", summary: "Summary", url: "https://example.com/1", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.5 },
      { tag: "TECHNOLOGY", headline: "Item two", summary: "Summary", url: "https://example.com/2", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.4 },
      { tag: "TECHNOLOGY", headline: "Item three", summary: "Summary", url: "https://example.com/3", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.3 },
      { tag: "TECHNOLOGY", headline: "Item four", summary: "Summary", url: "https://example.com/4", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.2 },
      { tag: "TECHNOLOGY", headline: "Item five", summary: "Summary", url: "https://example.com/5", source: "Example", published_date: "2026-03-14T05:00:00.000Z", relevanceScore: 7.1 },
    ],
    now: new Date("2026-03-14T11:12:00.000Z"),
    shortDate: "Mar 14",
    dateStr: "Saturday, March 14, 2026",
    digestDateKey: "2026-03-14",
    runId: "scheduled:2026-03-14T11-12-00-000Z",
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.5,
    depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    rankingPolicy: { minSignalScoreForFinal: 6.2 },
    publicDigestUrl: "https://getsignalbrief.com/digest/2026-03-14",
    suppressWelcome: false,
    targetChatId: "",
    claudeUsage: { input_tokens: 0, output_tokens: 0 },
    engagementEvents: [],
  });

  assert.strictEqual(result.deliveredUsers.length, 0);
  assert.strictEqual(result.failedUsers.length, 1);
  assert.strictEqual(retryEntries.length, 1);
  assert.strictEqual(retryEntries[0].delivery_outcome, "delivery_failed_after_retry");
  assert.strictEqual(retryEntries[0].retry_pending, false);
  assert.strictEqual(retryEntries[0].next_retry_at, null);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
