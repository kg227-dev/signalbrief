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
const personalizationRuntime = require("../../../src/runtime/personalization/personalization-runtime.js");
const onboardingServiceRuntime = require("../../../src/runtime/reply/onboarding-service-runtime.js");
const onboardingKeys = require("../../../src/runtime/reply/onboarding/keys.js");
const onboardingLinkFlow = require("../../../src/runtime/reply/onboarding/link-verification-flow.js");
const onboardingMessages = require("../../../src/runtime/reply/onboarding/messages.js");
const sandboxPipelineRuntime = require("../../../src/sandbox-pipeline-runtime.js");
const adminOpsAnalytics = require("../../../web/services/admin-ops-analytics.js");
const adminOpsScheduler = require("../../../web/services/admin-ops-scheduler.js");
const adminOpsUtils = require("../../../web/services/admin-ops-utils.js");

assertExported("src/entrypoints/digest.js", digestEntrypoint);
assertExported("src/runtime/mailer-lifecycle-runtime.js", mailerLifecycleRuntime);
assertExported("src/runtime/mailer/lifecycle/common.js", mailerLifecycleCommon);
assertExported("src/runtime/mailer/lifecycle/lifecycle-senders.js", mailerLifecycleSenders);
assertExported("src/runtime/mailer/lifecycle/welcome-content.js", mailerWelcomeContent);
assertExported("src/runtime/mailer/lifecycle/welcome-sender.js", mailerWelcomeSender);
assertExported("src/runtime/personalization/personalization-runtime.js", personalizationRuntime);
assertExported("src/runtime/reply/onboarding-service-runtime.js", onboardingServiceRuntime);
assertExported("src/runtime/reply/onboarding/keys.js", onboardingKeys);
assertExported("src/runtime/reply/onboarding/link-verification-flow.js", onboardingLinkFlow);
assertExported("src/runtime/reply/onboarding/messages.js", onboardingMessages);
assertExported("src/sandbox-pipeline-runtime.js", sandboxPipelineRuntime);
assertExported("web/services/admin-ops-analytics.js", adminOpsAnalytics);
assertExported("web/services/admin-ops-scheduler.js", adminOpsScheduler);
assertExported("web/services/admin-ops-utils.js", adminOpsUtils);
