const fs = require("fs");
const os = require("os");
const path = require("path");
const reengagement = require("../../../reengagement");
const engagementEvents = require("../../../src/runtime/engagement/engagement-events-runtime");
const { normalizeIntentPayload } = require("../../../src/runtime/reply/intent-service");

function buildReengagementStateCheck(check) {
  return check("reengagement state normalization fills missing fields", () => {
    const state = reengagement.normalizeReengagementState({ day4_sent_at: "2026-03-01T00:00:00.000Z" });
    return state.day4_sent_at && state.day8_sent_at === null && state.auto_paused_at === null && state.reactivated_at === null;
  });
}

function buildDaysSinceCheck(check) {
  return check("daysSince handles invalid input and floored day math", () => {
    const invalid = reengagement.daysSince("bad-date", Date.parse("2026-03-06T12:00:00.000Z"));
    const valid = reengagement.daysSince("2026-03-01T00:00:00.000Z", Date.parse("2026-03-06T12:00:00.000Z"));
    return invalid === null && valid === 5;
  });
}

function buildEngagementEventsCheck(check) {
  return check("loadEngagementEvents drops invalid timestamps unless explicitly allowed", () => {
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
    fs.writeFileSync(tempFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n{"event_key":"bad-json"\n`);
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
      const withMeta = engagementEvents.loadEngagementEvents({
        events_file: tempFile,
        max_age_days: 30,
        dedupe: false,
        return_meta: true,
        capture_parse_error_lines: true,
      });
      const filteredKeys = filtered.map((row) => String(row.event_key || ""));
      const withInvalidKeys = withInvalid.map((row) => String(row.event_key || ""));
      return (
        filteredKeys.length === 1
        && filteredKeys[0] === "valid-recent"
        && withInvalidKeys.length === 2
        && withInvalidKeys.includes("valid-recent")
        && withInvalidKeys.includes("invalid-ts")
        && withMeta.parse_errors === 1
        && Array.isArray(withMeta.parse_error_lines)
        && withMeta.parse_error_lines.includes(4)
      );
    } finally {
      try {
        fs.unlinkSync(tempFile);
      } catch (err) {
        process.stderr.write(`[module-coverage] temp cleanup failed (${tempFile}): ${err.message}\n`);
      }
    }
  });
}

function buildNormalizeIntentPayloadCheck(check) {
  return check("normalizeIntentPayload enforces action/items/topic/question shape", () => {
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
  });
}

module.exports = {
  buildReengagementStateCheck,
  buildDaysSinceCheck,
  buildEngagementEventsCheck,
  buildNormalizeIntentPayloadCheck,
};
