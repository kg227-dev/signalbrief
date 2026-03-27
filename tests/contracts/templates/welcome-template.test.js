"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const templatePath = path.join(process.cwd(), "templates", "welcome.html");
const html = fs.readFileSync(templatePath, "utf8");

assert.ok(
  html.includes("Daily sector briefings by email"),
  "welcome template should use the reduced-scope email tagline"
);
assert.ok(
  html.includes("SignalBrief &middot; Daily sector briefings by email"),
  "welcome template footer should match the reduced-scope product copy"
);
assert.ok(
  !html.includes("Daily intelligence for strategy professionals"),
  "welcome template should not keep the legacy strategy-professional footer copy"
);
assert.ok(
  !html.includes("🎉"),
  "welcome template hero should avoid celebratory emoji in the active product mail path"
);

process.stdout.write("[welcome-template] all assertions passed\n");
