"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

const settingsRuntime = read("settings-runtime.js");
assert.ok(!settingsRuntime.includes('byId("telegram")'), "settings runtime must not read a removed telegram field");
assert.ok(!settingsRuntime.includes("items_per_digest"), "settings runtime must not send deprecated item-count fields");
assert.ok(!settingsRuntime.includes("telegram_enabled"), "settings runtime must not send deprecated telegram toggles");

const indexFormSubmitRuntime = read("index-form-submit-runtime.js");
assert.ok(!indexFormSubmitRuntime.includes("items_per_digest"), "signup fallback runtime must not send deprecated item-count fields");
assert.ok(!indexFormSubmitRuntime.includes('byId("telegram")'), "signup fallback runtime must not read a removed telegram field");

const indexRuntime = read("index.js");
assert.ok(!indexRuntime.includes("setItemsPerDigest"), "landing runtime must not carry removed items-per-digest state");
assert.ok(!indexRuntime.includes("getItemsPerDigest"), "landing runtime must not carry removed items-per-digest state");

const signupFlow = read("signup-flow.js");
assert.ok(!signupFlow.includes("items_per_digest"), "signup flow must not send deprecated item-count fields");
assert.ok(!signupFlow.includes("telegram: null"), "signup flow must not carry removed telegram signup state");

console.log("active web payload runtimes dropped deprecated fields ✓");
