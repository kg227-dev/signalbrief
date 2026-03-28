"use strict";

const assert = require("assert");
const { createDigestOrchestratorDeliveryRuntime } = require("./digest-orchestrator-delivery-runtime");

async function main() {
  let autoLearningCalls = 0;
  let emailCalls = 0;
  let writeCalls = 0;

  const runtime = createDigestOrchestratorDeliveryRuntime({
    CONFIG: {
      digest: {
        scheduledFreshnessWindowDays: 5,
        perUserFreshnessDigests: 3,
        perUserFreshnessMinItems: 3,
        maxSignalsPerEntity: 1,
        minTopFitItems: 3,
        minStrategicValue: 0.34,
        maxRoutineScore: 0.65,
        minSignalScoreForFinal: 5,
        minDeliveryQualityScore: 25,
      },
    },
    log() {},
    applyAutoTopicLearning() {
      autoLearningCalls += 1;
      return { changed: true, adjustments: [], processed_events: 0, event_write_failures: 0 };
    },
    writeUser() {
      writeCalls += 1;
    },
    buildLearningSummary() {
      throw new Error("buildLearningSummary should not run in the email-only MVP path");
    },
    filterItemsByTopics(items) {
      return {
        items,
        wasFiltered: true,
        customKeywords: [],
        specialistMode: false,
        standardTopicsLower: ["technology"],
      };
    },
    applyTopicRelevanceScores(items) {
      return items.map((item) => ({
        ...item,
        relevanceScore: Number(item.baseScore || 0) + 1,
        topicMatch: 10,
        strategic_value: 0.95,
        routine_item_score: 0.05,
        source_policy: "preferred",
        source_authority: 0.9,
      }));
    },
    buildRecentEntityHistory() {
      return { entityCounts: {}, storylineKeys: new Set() };
    },
    suppressRecentlySentForUser(items) {
      return {
        items,
        removed: 0,
        storyline_suppressed: 0,
        freshness_suppressed: 0,
        semantic_suppressed: 0,
      };
    },
    isRecentRepeatItem() {
      return false;
    },
    parseSourceDomain(item) {
      return item.source_domain || "example.com";
    },
    applyEntityCoverageCap(items) {
      return items;
    },
    reserveCustomKeywordSlot(items) {
      return items;
    },
    applyDigestDepth(items) {
      return items.map((item) => ({ ...item }));
    },
    computeDigestQualityScore() {
      return { score: 55, band: "good", components: {} };
    },
    buildDigestId(dateKey, userId) {
      return `${dateKey}:${userId}`;
    },
    appendEngagementEventChecked() {
      return { ok: true };
    },
    beginDigestDeliveryRecord() {
      return { ok: true, skipped: false, version: 1, record: { version: 1 } };
    },
    updateDigestDeliveryRecord() {},
    loadRecentSentDigests() {
      return [];
    },
    loadAllCurrentRecords() {
      return [];
    },
    digestRetryStateRuntime: {
      upsertRetryState() {
        return null;
      },
      clearRetryState() {
        return true;
      },
    },
    generateLeadSubjectLine() {
      return Promise.resolve({ subject: "Test subject", usage: {} });
    },
    generateEditorialNote() {
      return Promise.resolve({ note: "", usage: {} });
    },
    buildEmail() {
      return "<html><body>Digest</body></html>";
    },
    buildOpenTrackingPixel() {
      return "";
    },
    getBaseUrl() {
      return "https://example.com";
    },
    sendEmail() {
      emailCalls += 1;
      return Promise.resolve();
    },
    normalizeUrlForDedup(url) {
      return url;
    },
    formatEtDateKey() {
      return "2026-03-25";
    },
    stripInlineHtml(value) {
      return String(value || "");
    },
    topicVisual() {
      return { icon: "", chipText: "#000000" };
    },
    escapeHtml(value) {
      return String(value || "");
    },
  });

  const dueUsers = [{
    chatId: "12345",
    email: "user@example.com",
    status: "active",
    welcome_email_sent: true,
    topics: ["TECHNOLOGY"],
    preferences: {
      depth: "headline_plus_why",
      email_enabled: true,
      telegram_enabled: true,
      delivery_time: "07:00",
    },
    source_preferences: {},
    digest_dates: [],
    quality_history: [],
  }];

  const enriched = Array.from({ length: 5 }, (_, index) => ({
    tag: "TECHNOLOGY",
    headline: `Headline ${index + 1}`,
    summary: `Summary ${index + 1}`,
    url: `https://example.com/${index + 1}`,
    source: "Example",
    source_domain: "example.com",
    baseScore: 8 - (index * 0.1),
    published_date: "2026-03-25T10:00:00.000Z",
  }));

  const result = await runtime.deliverDueUsers({
    dueUsers,
    enriched,
    now: new Date("2026-03-25T12:00:00.000Z"),
    shortDate: "Mar 25",
    dateStr: "March 25, 2026",
    digestDateKey: "2026-03-25",
    runId: "run-1",
    repeatIndex: null,
    repeatPenalty: 0,
    depthPolicy: {
      minFilteredItems: 1,
      defaultItemCount: 9,
    },
    rankingPolicy: {},
    publicDigestUrl: "https://example.com/digest/2026-03-25",
    suppressWelcome: false,
    targetChatId: null,
    deliveryMode: "scheduled",
    deliveryEventSource: "scheduled-job",
    claudeUsage: { input_tokens: 0, output_tokens: 0 },
    engagementEvents: [],
    repetitionNote: "Repeat handling active",
  });

  assert.strictEqual(autoLearningCalls, 0, "delivery runtime must not run deprecated auto-learning on the active path");
  assert.strictEqual(emailCalls, 1, "delivery runtime must still send the email digest");
  assert.strictEqual(writeCalls, 1, "delivery runtime should still persist successful delivery state");
  assert.strictEqual(result.deliveredUsers.length, 1, "delivery runtime should report one delivered user");

  console.log("delivery runtime uses email-only MVP path without auto-learning ✓");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
