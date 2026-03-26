"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "preferences-state-runtime.js"), "utf8");
const context = {
  window: {
    SignalBriefPrefsStateCoreRuntime: {},
    SignalBriefPrefsStateModelRuntime: {},
  },
};

vm.runInNewContext(source, context, { filename: "preferences-state-runtime.js" });

const { buildSignupPayload, buildSettingsPayload } = context.window.SignalBriefPrefsStateRuntime;
const fakeState = {
  snapshot() {
    return {
      topics: ["TECHNOLOGY", "ENERGY"],
      depth: "headline_plus_why",
      delivery_time: "07:00",
      frequency: "daily_weekday",
      days_of_week: [1, 2, 3, 4, 5],
      items_per_digest: 99,
    };
  },
};

const signupPayload = buildSignupPayload({
  state: fakeState,
  name: "Alice",
  email: "alice@example.com",
  telegram: "@alice",
  referralToken: "ref-token",
});
assert.ok(!("telegram" in signupPayload), "signup payload must not include deprecated telegram delivery");
assert.ok(!("items_per_digest" in signupPayload), "signup payload must not include deprecated item-count overrides");

const settingsPayload = buildSettingsPayload({
  state: fakeState,
  token: "tok",
  name: "Alice",
  telegram: "@alice",
  telegramEnabled: true,
});
assert.ok(!("telegram" in settingsPayload), "settings payload must not include deprecated telegram delivery");
assert.ok(
  !("items_per_digest" in settingsPayload.preferences),
  "settings preferences must not include deprecated item-count overrides"
);
assert.ok(
  !("telegram_enabled" in settingsPayload.preferences),
  "settings preferences must not include deprecated telegram toggles"
);

console.log("preferences state runtime omits deprecated payload fields ✓");
