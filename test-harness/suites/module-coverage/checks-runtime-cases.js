const fs = require("fs");
const os = require("os");
const path = require("path");
const engagementEvents = require("../../../src/runtime/engagement/engagement-events-runtime");
const { createDefaultUser, normalizeUserRecord } = require("../../../src/runtime/user-contract-runtime");

function buildDefaultUserCheck(check) {
  return check("default user record stays email-only and reduced-scope", () => {
    const user = createDefaultUser("user-1", "2026-03-01T00:00:00.000Z");
    return (
      user.chatId === "user-1"
      && user.preferences.email_enabled === true
      && Array.isArray(user.topics)
      && Object.prototype.hasOwnProperty.call(user, "reengagement_state") === false
      && Object.prototype.hasOwnProperty.call(user, "auto_learning") === false
    );
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

function buildNormalizeUserRecordCheck(check) {
  return check("normalizeUserRecord strips legacy Telegram and custom-topic fields", () => {
    const user = normalizeUserRecord({
      chatId: "user-1",
      email: "user@example.com",
      status: "active",
      topics: ["TECHNOLOGY", "custom_ai"],
      telegram: { chat_id: "12345" },
      bookmarks: ["https://example.com/a"],
      custom_topics: ["custom_ai"],
      preferences: {
        email_enabled: true,
        telegram_enabled: true,
        delivery_time: "07:00",
      },
    });

    return (
      JSON.stringify(user.topics) === JSON.stringify(["TECHNOLOGY"])
      && Object.prototype.hasOwnProperty.call(user, "telegram") === false
      && Object.prototype.hasOwnProperty.call(user, "bookmarks") === false
      && Object.prototype.hasOwnProperty.call(user, "custom_topics") === false
      && Object.prototype.hasOwnProperty.call(user.preferences, "telegram_enabled") === false
    );
  });
}

module.exports = {
  buildDefaultUserCheck,
  buildEngagementEventsCheck,
  buildNormalizeUserRecordCheck,
};
