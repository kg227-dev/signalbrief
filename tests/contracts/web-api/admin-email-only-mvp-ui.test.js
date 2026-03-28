"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

for (const snippet of [
  "Email-only MVP mode is active. This sends a direct email message, not a digest.",
  "email-only scheduled path",
  "Stored snapshot controls are available when the failed run already captured a complete 5-item digest.",
  "Regenerate summaries",
  "Resend stored digest",
]) {
  if (!source.includes(snippet)) {
    throw new Error(`admin email-only MVP UI is missing required snippet: ${snippet}`);
  }
}

for (const removedSnippet of [
  'id="resendAllFailedBtn"',
  "function resendFailedDelivery(",
  "function resendFailedDeliveries(",
  'id="sendModeDigestBtn"',
  'id="sendViaEmail"',
  "function runDigestForChat(",
  "function setSendMode(",
  "Digest now</button>",
]) {
  if (source.includes(removedSnippet)) {
    throw new Error(`admin email-only MVP UI still contains removed snippet: ${removedSnippet}`);
  }
}
