"use strict";

const assert = require("assert");

const { createDigestCommandHandler } = require("./reply-command-digest-runtime");

async function main() {
  let queueCalls = 0;
  const sent = [];

  const handler = createDigestCommandHandler({
    state: {
      digestInflight: new Set(),
    },
    send(chatId, text) {
      sent.push({ chatId, text });
      return Promise.resolve();
    },
    allUsers() {
      return [{
        chatId: "123",
        email: "user@example.com",
        status: "active",
        preferences: {
          email_enabled: true,
          delivery_time: "07:00",
        },
      }];
    },
    USER_STATUS: {
      ACTIVE: "active",
    },
    queueDigestTrigger() {
      queueCalls += 1;
      return Promise.resolve({ ok: true });
    },
  });

  await handler.handleDigest("123");

  assert.strictEqual(queueCalls, 0, "email-only MVP should not queue an on-demand Telegram digest");
  assert.strictEqual(sent.length, 1, "email-only MVP should send a single explanatory reply");
  assert.ok(
    sent[0].text.includes("Email-only MVP mode is active"),
    "reply should explain that Telegram on-demand digests are disabled"
  );

  console.log("telegram /digest command is disabled in email-only MVP mode ✓");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
