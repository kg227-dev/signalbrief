"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/reply-logging-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createReplyLogger,
  createReplyIntentTracer,
  redactIntentForLogs,
} = runtime;

function createSink() {
  const calls = [];
  return {
    calls,
    log: (...args) => calls.push(["log", ...args]),
    debug: (...args) => calls.push(["debug", ...args]),
    info: (...args) => calls.push(["info", ...args]),
    warn: (...args) => calls.push(["warn", ...args]),
    error: (...args) => calls.push(["error", ...args]),
  };
}

const quietSink = createSink();
const quietLogger = createReplyLogger({ level: "warn", sink: quietSink });
quietLogger.info("action=start message_len=8");
assert.strictEqual(quietSink.calls.length, 0, "warn-level logger should stay quiet for info events");
quietLogger.warn("slow dependency");
assert.strictEqual(quietSink.calls.length, 1, "warn-level logger should emit warnings");

const redacted = redactIntentForLogs({
  action: "start",
  topic: "AI×TECH",
  items: ["1", "2", "3"],
  email: "person@example.com",
  code: "123456",
  question: "What should I read today?",
});
assert.deepStrictEqual(redacted, {
  action: "start",
  topic: "AI×TECH",
  items_count: 3,
  email_present: true,
  code_present: true,
  question_present: true,
});

const traceSink = createSink();
const traceLogger = createReplyLogger({ level: "debug", sink: traceSink });
const tracer = createReplyIntentTracer({
  logger: traceLogger,
  enabled: true,
  sampleRate: 1,
  random: () => 0,
});
const traced = tracer.traceIntent(
  {
    action: "save",
    topic: "AI×TECH",
    items: [{ id: 1 }, { id: 2 }],
    email: "person@example.com",
    code: "999999",
    question: "sensitive freeform text",
  },
  { action: "save", messageLen: 42, chatId: "123456789" }
);
assert.strictEqual(traced, true, "tracer should emit when enabled and sampled");
assert.strictEqual(traceSink.calls.length, 1, "tracer should emit a single debug log");
const debugEvent = traceSink.calls[0];
assert.strictEqual(debugEvent[0], "debug");
assert.strictEqual(debugEvent[1], "[reply-handler] intent_trace");
assert.deepStrictEqual(debugEvent[2], {
  action: "save",
  message_len: 42,
  chat_id: "***6789",
  intent: {
    action: "save",
    topic: "AI×TECH",
    items_count: 2,
    email_present: true,
    code_present: true,
    question_present: true,
  },
});

