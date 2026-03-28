"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const actionsSrc = fs.readFileSync(
  path.resolve(__dirname, "settings-ui-topic-actions-runtime.js"),
  "utf8"
);
const prefsActionsSrc = fs.readFileSync(
  path.resolve(__dirname, "settings-ui-preferences-actions-runtime.js"),
  "utf8"
);
const styleSrc = fs.readFileSync(
  path.resolve(__dirname, "style.css"),
  "utf8"
);

assert.ok(!actionsSrc.includes("topic_weights"), "settings topic actions must not write deprecated topic_weights");
assert.ok(!actionsSrc.includes("weight-badge"), "settings topic actions must not render weight badges");
assert.ok(
  !prefsActionsSrc.includes("renderChips(user.topics || [], user.topic_weights || {})"),
  "settings preference bootstrap must not pass deprecated topic_weights to renderChips"
);
assert.ok(!styleSrc.includes(".weight-badge"), "global style.css must not carry dead weight-badge styles");

console.log("settings topic-weight UI removed ✓");
