"use strict";

const assert = require("assert");
const https = require("https");
const { EventEmitter } = require("events");
const path = require("path");

const TARGET_REL = "src/runtime/mailer/mailer-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

const ORIGINAL_ENV = {
  SIGNALBRIEF_RESEND_API_KEY: process.env.SIGNALBRIEF_RESEND_API_KEY,
  SIGNALBRIEF_FROM_EMAIL: process.env.SIGNALBRIEF_FROM_EMAIL,
  SIGNALBRIEF_MAILER_MAX_ATTEMPTS: process.env.SIGNALBRIEF_MAILER_MAX_ATTEMPTS,
  SIGNALBRIEF_MAILER_RETRY_BASE_DELAY_MS: process.env.SIGNALBRIEF_MAILER_RETRY_BASE_DELAY_MS,
  SIGNALBRIEF_MAILER_RETRY_MAX_DELAY_MS: process.env.SIGNALBRIEF_MAILER_RETRY_MAX_DELAY_MS,
};
const ORIGINAL_REQUEST = https.request;

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

function loadMailerRuntimeWithEnv() {
  delete require.cache[TARGET_PATH];
  return require(TARGET_PATH);
}

function makeResponse(statusCode, body, headers = {}) {
  return (callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.headers = headers;
    process.nextTick(() => {
      callback(res);
      if (body != null) res.emit("data", String(body));
      res.emit("end");
    });
  };
}

function installRequestStub(sequence, callCounter) {
  https.request = (options, callback) => {
    const step = sequence.shift();
    callCounter.count += 1;
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      if (!step) {
        req.emit("error", new Error("unexpected extra request"));
        return;
      }
      if (step.type === "response") {
        makeResponse(step.statusCode, step.body, step.headers)(callback);
        return;
      }
      if (step.type === "error") {
        process.nextTick(() => req.emit("error", new Error(step.message)));
      }
    };
    req.destroy = (error) => {
      process.nextTick(() => req.emit("error", error instanceof Error ? error : new Error(String(error))));
    };
    return req;
  };
}

async function testRetriesTransientStatusFailures() {
  process.env.SIGNALBRIEF_RESEND_API_KEY = "re_test";
  process.env.SIGNALBRIEF_FROM_EMAIL = "digest@getsignalbrief.com";
  process.env.SIGNALBRIEF_MAILER_MAX_ATTEMPTS = "3";
  process.env.SIGNALBRIEF_MAILER_RETRY_BASE_DELAY_MS = "1";
  process.env.SIGNALBRIEF_MAILER_RETRY_MAX_DELAY_MS = "5";

  const calls = { count: 0 };
  installRequestStub([
    { type: "response", statusCode: 502, body: JSON.stringify({ error: "temporary upstream failure" }) },
    { type: "response", statusCode: 201, body: JSON.stringify({ id: "msg-123" }) },
  ], calls);

  const { sendEmail } = loadMailerRuntimeWithEnv();
  const result = await sendEmail("retry@example.com", "subject", "<p>body</p>");
  assert.strictEqual(result.ok, true, "5xx failure should be retried");
  assert.strictEqual(result.message_id, "msg-123");
  assert.strictEqual(calls.count, 2, "retryable 5xx should trigger a second request");
}

async function testRetriesTransportErrors() {
  process.env.SIGNALBRIEF_RESEND_API_KEY = "re_test";
  process.env.SIGNALBRIEF_FROM_EMAIL = "digest@getsignalbrief.com";
  process.env.SIGNALBRIEF_MAILER_MAX_ATTEMPTS = "3";
  process.env.SIGNALBRIEF_MAILER_RETRY_BASE_DELAY_MS = "1";
  process.env.SIGNALBRIEF_MAILER_RETRY_MAX_DELAY_MS = "5";

  const calls = { count: 0 };
  installRequestStub([
    { type: "error", message: "socket hang up" },
    { type: "response", statusCode: 201, body: JSON.stringify({ id: "msg-456" }) },
  ], calls);

  const { sendEmail } = loadMailerRuntimeWithEnv();
  const result = await sendEmail("retry@example.com", "subject", "<p>body</p>");
  assert.strictEqual(result.ok, true, "transport failures should be retried");
  assert.strictEqual(result.message_id, "msg-456");
  assert.strictEqual(calls.count, 2, "retryable transport error should trigger a second request");
}

async function testStopsOnPermanentFailures() {
  process.env.SIGNALBRIEF_RESEND_API_KEY = "re_test";
  process.env.SIGNALBRIEF_FROM_EMAIL = "digest@getsignalbrief.com";
  process.env.SIGNALBRIEF_MAILER_MAX_ATTEMPTS = "3";
  process.env.SIGNALBRIEF_MAILER_RETRY_BASE_DELAY_MS = "1";
  process.env.SIGNALBRIEF_MAILER_RETRY_MAX_DELAY_MS = "5";

  const calls = { count: 0 };
  installRequestStub([
    { type: "response", statusCode: 403, body: JSON.stringify({ error: "sender domain is not verified" }) },
  ], calls);

  const { sendEmail } = loadMailerRuntimeWithEnv();
  const result = await sendEmail("retry@example.com", "subject", "<p>body</p>");
  assert.strictEqual(result.ok, false, "permanent failures should bubble without retry");
  assert.strictEqual(calls.count, 1, "non-retryable 4xx should not retry");
}

(async () => {
  try {
    await testRetriesTransientStatusFailures();
    await testRetriesTransportErrors();
    await testStopsOnPermanentFailures();
    console.log("mailer retry runtime tests passed ✓");
  } finally {
    https.request = ORIGINAL_REQUEST;
    restoreEnv();
    delete require.cache[TARGET_PATH];
  }
})().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
