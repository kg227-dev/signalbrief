"use strict";

const assert = require("assert");

function assertExported(name, value) {
  assert.ok(value !== undefined && value !== null, `${name} should export a value`);
  const kind = typeof value;
  assert.ok(kind === "object" || kind === "function", `${name} should export object/function, got ${kind}`);
}

const digestEntrypoint = require("../../../src/entrypoints/digest.js");
const mailerLifecycleRuntime = require("../../../src/runtime/mailer-lifecycle-runtime.js");
const mailerLifecycleCommon = require("../../../src/runtime/mailer/lifecycle/common.js");
const mailerLifecycleSenders = require("../../../src/runtime/mailer/lifecycle/lifecycle-senders.js");
const mailerWelcomeContent = require("../../../src/runtime/mailer/lifecycle/welcome-content.js");
const mailerWelcomeSender = require("../../../src/runtime/mailer/lifecycle/welcome-sender.js");
const adminOpsAnalytics = require("../../../web/services/admin-ops-analytics.js");
const adminOpsScheduler = require("../../../web/services/admin-ops-scheduler.js");
const adminOpsUtils = require("../../../web/services/admin-ops-utils.js");

assertExported("src/entrypoints/digest.js", digestEntrypoint);
assertExported("src/runtime/mailer-lifecycle-runtime.js", mailerLifecycleRuntime);
assertExported("src/runtime/mailer/lifecycle/common.js", mailerLifecycleCommon);
assertExported("src/runtime/mailer/lifecycle/lifecycle-senders.js", mailerLifecycleSenders);
assertExported("src/runtime/mailer/lifecycle/welcome-content.js", mailerWelcomeContent);
assertExported("src/runtime/mailer/lifecycle/welcome-sender.js", mailerWelcomeSender);
assertExported("web/services/admin-ops-analytics.js", adminOpsAnalytics);
assertExported("web/services/admin-ops-scheduler.js", adminOpsScheduler);
assertExported("web/services/admin-ops-utils.js", adminOpsUtils);
