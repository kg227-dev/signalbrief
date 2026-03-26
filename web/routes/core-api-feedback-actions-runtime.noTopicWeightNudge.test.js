"use strict";

const assert = require("assert");
const { handleCoreFeedbackRoute } = require("./core-api-feedback-actions-runtime");

async function runFeedback(feedbackType) {
  const user = {
    chatId: "user-1",
    email: "user@example.com",
    topic_weights: { TECHNOLOGY: 2 },
    last_digest_items: [{
      tag: "TECHNOLOGY",
      url: "https://example.com/story",
      storyline_key: "story-1",
      freshness_key: "fresh-1",
      source_domain: "example.com",
    }],
  };
  let writeCount = 0;
  let responseBody = null;
  let appendCount = 0;

  const handled = await handleCoreFeedbackRoute({
    req: { method: "POST" },
    res: {},
    pathname: "/api/feedback",
  }, {
    json: (_res, body) => {
      responseBody = body;
    },
    requireJsonBody: async () => ({
      token: "tok",
      digest_id: "2026-03-25",
      item_index: 1,
      feedback_type: feedbackType,
    }),
    findUserByToken: () => user,
    writeUser: () => {
      writeCount += 1;
    },
    appendEngagementEventChecked: () => {
      appendCount += 1;
      return { ok: true };
    },
    buildDigestId: (dateKey, chatId) => `${dateKey}:${chatId}`,
    toEtDateKey: () => "2026-03-25",
  });

  return { handled, user, writeCount, responseBody, appendCount };
}

(async () => {
  const positive = await runFeedback("positive");
  assert.strictEqual(positive.handled, true, "positive feedback route should handle the request");
  assert.deepStrictEqual(
    positive.user.topic_weights,
    { TECHNOLOGY: 2 },
    "positive feedback must not mutate deprecated topic weights"
  );
  assert.strictEqual(positive.writeCount, 0, "positive feedback must not persist a user mutation");
  assert.deepStrictEqual(positive.responseBody, { ok: true, effects: {} }, "positive feedback should still succeed");
  assert.strictEqual(positive.appendCount, 1, "positive feedback should still emit analytics");

  const negative = await runFeedback("negative");
  assert.deepStrictEqual(
    negative.user.topic_weights,
    { TECHNOLOGY: 2 },
    "negative feedback must not mutate deprecated topic weights"
  );
  assert.strictEqual(negative.writeCount, 0, "negative feedback must not persist a user mutation");

  const repetitive = await runFeedback("repetitive");
  assert.strictEqual(repetitive.writeCount, 1, "repetitive feedback should still persist suppression state");
  assert.strictEqual(repetitive.responseBody.effects.suppressed, true, "repetitive feedback should report suppression");

  const weakSource = await runFeedback("weak_source");
  assert.strictEqual(weakSource.writeCount, 1, "weak-source feedback should still persist source blocks");
  assert.strictEqual(weakSource.responseBody.effects.source_blocked, true, "weak-source feedback should report blocking");

  console.log("core-api feedback no longer nudges topic weights ✓");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
