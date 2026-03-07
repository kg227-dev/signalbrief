const fs = require("fs");
const os = require("os");
const path = require("path");
const topicUtils = require("../topic-utils");
const pipeline = require("../pipeline");
const topicDomain = require("../../topic-domain");
const marketing = require("../../scripts/marketing-weekly-report");
const reengagement = require("../../reengagement");
const engagementEvents = require("../../src/runtime/engagement-events");
const { normalizeIntentPayload } = require("../../src/runtime/reply/intent-service");

function check(name, fn) {
  try {
    return { name, ok: !!fn() };
  } catch (err) {
    return { name, ok: false, error: err.message };
  }
}

module.exports = {
  id: "10-module-coverage",
  name: "Module Coverage",

  async run() {
    const checks = [
      check("normalizeTopicToken strips custom_/symbol variants", () =>
        topicUtils.normalizeTopicToken("custom_AI×TECH") === "ai tech"
      ),
      check("normalizeCustomKeyword converts custom slug", () =>
        topicUtils.normalizeCustomKeyword("custom_glp_1") === "glp 1"
      ),
      check("topic alias map includes doge alias", () =>
        Array.isArray(topicUtils.CUSTOM_TOPIC_ALIASES.doge)
        && topicUtils.CUSTOM_TOPIC_ALIASES.doge.includes("dogecoin")
      ),
      check("pipeline relevance wrapper matches shared topic-domain scorer", () => {
        const sampleItems = [
          {
            tag: "AI×TECH",
            headline: "OpenAI launches enterprise agent platform",
            summary: "Large enterprises are piloting AI agents in core workflows.",
            source: "example.com",
            url: "https://example.com/news/openai-agents",
            baseScore: 8.1,
          },
        ];
        const topics = ["AI×TECH", "custom_agentic_ai"];
        const weights = { "AI×TECH": 2 };
        const shared = topicDomain.applyTopicRelevanceScores(sampleItems, topics, weights, {
          specialistMode: false,
          repeatPenalty: 0,
          isRecentRepeat: () => false,
          sourceDomainForItem: pipeline.parseItemDomain,
        });
        const wrapped = pipeline.applyRelevanceScores(sampleItems, topics, weights, {
          repeatPenalty: 0,
          repeatIndex: null,
        }, false);
        return JSON.stringify(shared) === JSON.stringify(wrapped);
      }),
      check("pipeline topic filter wrapper matches shared boundary", () => {
        const items = [
          { tag: "AI×TECH", headline: "Agentic AI wins budget", summary: "Enterprise pilots expanded." },
          { tag: "HEALTHCARE", headline: "Hospital staffing update", summary: "Regional systems report shortages." },
        ];
        const topics = ["AI×TECH"];
        const shared = topicDomain.filterItemsByTopics(items, topics, {
          minItems: 3,
          strictZeroFallback: "specialist",
        });
        const wrapped = pipeline.filterItemsForPersona(items, topics, { minFilteredItems: 3 }, "specialist");
        return wrapped.mode === shared.mode
          && wrapped.items.length === shared.items.length
          && wrapped.specialistMode === shared.specialistMode
          && Array.isArray(wrapped.standardTopicsLower)
          && wrapped.standardTopicsLower.includes("ai tech");
      }),
      check("startOfWeekMonday aligns to Monday", () => {
        const wed = new Date(2026, 2, 4, 12, 0, 0, 0); // Mar 4, 2026 (Wed, local)
        const monday = marketing.startOfWeekMonday(wed);
        return monday.getDay() === 1 && monday.getDate() === 2;
      }),
      check("computeDigest2OpenRate returns expected cohort math", () => {
        const users = [
          { chatId: "u1", joined_at: "2026-03-03T10:00:00.000Z" },
          { chatId: "u2", joined_at: "2026-03-04T10:00:00.000Z" },
        ];
        const events = [
          { event_type: "digest_sent", channel: "email", user_chat_id: "u1", digest_id: "2026-03-03:u1", ts_utc: "2026-03-03T12:00:00.000Z" },
          { event_type: "digest_sent", channel: "email", user_chat_id: "u1", digest_id: "2026-03-04:u1", ts_utc: "2026-03-04T12:00:00.000Z" },
          { event_type: "digest_sent", channel: "email", user_chat_id: "u2", digest_id: "2026-03-04:u2", ts_utc: "2026-03-04T12:00:00.000Z" },
          { event_type: "digest_sent", channel: "email", user_chat_id: "u2", digest_id: "2026-03-05:u2", ts_utc: "2026-03-05T12:00:00.000Z" },
          { event_type: "email_open", digest_id: "2026-03-04:u1", ts_utc: "2026-03-04T14:00:00.000Z" },
        ];
        const out = marketing.computeDigest2OpenRate(
          users,
          events,
          new Date("2026-03-02T00:00:00.000Z"),
          new Date("2026-03-08T23:59:59.999Z")
        );
        return out.eligible === 2 && out.opened === 1 && Math.abs(Number(out.rate || 0) - 50) < 0.001;
      }),
      check("reengagement state normalization fills missing fields", () => {
        const state = reengagement.normalizeReengagementState({ day4_sent_at: "2026-03-01T00:00:00.000Z" });
        return state.day4_sent_at && state.day8_sent_at === null && state.auto_paused_at === null && state.reactivated_at === null;
      }),
      check("daysSince handles invalid input and floored day math", () => {
        const invalid = reengagement.daysSince("bad-date", Date.parse("2026-03-06T12:00:00.000Z"));
        const valid = reengagement.daysSince("2026-03-01T00:00:00.000Z", Date.parse("2026-03-06T12:00:00.000Z"));
        return invalid === null && valid === 5;
      }),
      check("loadEngagementEvents drops invalid timestamps unless explicitly allowed", () => {
        const tempFile = path.join(
          os.tmpdir(),
          `sb-engagement-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`
        );
        const nowIso = new Date().toISOString();
        const oldIso = new Date(Date.now() - (70 * 24 * 60 * 60 * 1000)).toISOString();
        const rows = [
          { event_key: "valid-recent", ts_utc: nowIso },
          { event_key: "valid-old", ts_utc: oldIso },
          { event_key: "invalid-ts", ts_utc: "not-a-timestamp" },
        ];
        fs.writeFileSync(tempFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
        try {
          const filtered = engagementEvents.loadEngagementEvents({
            events_file: tempFile,
            max_age_days: 30,
            dedupe: false,
          });
          const withInvalid = engagementEvents.loadEngagementEvents({
            events_file: tempFile,
            max_age_days: 30,
            dedupe: false,
            include_invalid_timestamps: true,
          });
          const filteredKeys = filtered.map((row) => String(row.event_key || ""));
          const withInvalidKeys = withInvalid.map((row) => String(row.event_key || ""));
          return (
            filteredKeys.length === 1
            && filteredKeys[0] === "valid-recent"
            && withInvalidKeys.length === 2
            && withInvalidKeys.includes("valid-recent")
            && withInvalidKeys.includes("invalid-ts")
          );
        } finally {
          try {
            fs.unlinkSync(tempFile);
          } catch (err) {
            process.stderr.write(`[module-coverage] temp cleanup failed (${tempFile}): ${err.message}\n`);
          }
        }
      }),
      check("normalizeIntentPayload enforces action/items/topic/question shape", () => {
        const save = normalizeIntentPayload({
          action: "save",
          items: [1, "x", -2, 1, 99, 3],
          topic: { nope: true },
          question: 42,
        });
        const question = normalizeIntentPayload(
          { action: "question", question: { nested: true } },
          { fallbackQuestion: "what does this mean?" }
        );
        const badTopic = normalizeIntentPayload({ action: "topic_more", topic: "   " });

        return (
          save.action === "save"
          && JSON.stringify(save.items) === JSON.stringify([1, 3])
          && save.topic === null
          && save.question === null
          && question.action === "question"
          && question.question === "what does this mean?"
          && badTopic.action === "unknown"
        );
      }),
    ];

    const passed = checks.filter((c) => c.ok).length;
    const failedChecks = checks.filter((c) => !c.ok);
    const score = Number(((passed / checks.length) * 100).toFixed(2));
    const status = failedChecks.length ? "fail" : "pass";

    return {
      id: this.id,
      name: this.name,
      score,
      score_label: `${score.toFixed(1)}%`,
      status,
      per_persona: {
        module_coverage: {
          persona: "Module coverage checks",
          score,
          passed: failedChecks.length === 0,
          checks_total: checks.length,
          checks_passed: passed,
          checks_failed: failedChecks.length,
        },
      },
      failures: failedChecks.map((f) => ({
        persona: "module_coverage",
        issue: f.name,
        evidence: f.error || "assertion failed",
      })),
      suggestions: failedChecks.length
        ? ["Fix failing module coverage checks before shipping harness changes."]
        : [],
      details: {
        checks_total: checks.length,
        checks_passed: passed,
        checks_failed: failedChecks.length,
        failed_checks: failedChecks,
      },
      confidence: 0.95,
    };
  },
};
