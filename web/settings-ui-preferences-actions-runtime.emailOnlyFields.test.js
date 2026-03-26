"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "settings-ui-preferences-actions-runtime.js"), "utf8");
const context = {
  window: {},
  document: {
    querySelectorAll() {
      return [];
    },
  },
};

vm.runInNewContext(source, context, { filename: "settings-ui-preferences-actions-runtime.js" });

const { renderInitialState } = context.window.SignalBriefSettingsUiPreferencesActionsRuntime;
const seenIds = [];
const elements = new Map([
  ["name", { value: "", addEventListener() {} }],
  ["email", { value: "", addEventListener() {} }],
  ["deliveryTime", { value: "07:00", addEventListener() {} }],
  ["preset-weekdays", { classList: { toggle() {} } }],
  ["preset-everyday", { classList: { toggle() {} } }],
]);

assert.doesNotThrow(() => {
  renderInitialState({
    user: {
      name: "Alice",
      email: "alice@example.com",
      topics: ["TECHNOLOGY"],
      preferences: {
        depth: "headline_plus_why",
        delivery_time: "07:00",
        frequency: "daily_weekday",
        days_of_week: [1, 2, 3, 4, 5],
      },
      source_preferences: {},
    },
    statusBanner: "",
    loadingEl: { style: {} },
    formEl: { style: {} },
    Prefs: {
      daysFromFrequency() {
        return [1, 2, 3, 4, 5];
      },
    },
    byId(id) {
      seenIds.push(id);
      return elements.get(id) || null;
    },
    showBanner() {},
    renderChips() {},
    prefState: {
      setDepth() {},
      getDepth() {
        return "headline_plus_why";
      },
      setDeliveryTime() {},
      getDays() {
        return [1, 2, 3, 4, 5];
      },
      setDays() {},
      getFrequency() {
        return "daily_weekday";
      },
    },
    sourceState: null,
  });
}, "settings UI bootstrap should not require removed telegram/items controls");

assert.ok(!seenIds.includes("telegram"), "settings UI must not read a removed telegram field");
assert.ok(!seenIds.includes("itemsPerDigest"), "settings UI must not read a removed items-per-digest field");

console.log("settings UI bootstrap avoids removed email-only fields ✓");
