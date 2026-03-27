"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_REL = "web/admin.html";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

for (const snippet of [
  "Targeted resend is removed in the email-only MVP;",
  "email-only scheduled path",
  "Targeted resend disabled in the reduced-scope MVP.",
  "Email-only MVP mode is active. This sends a direct email message, not a targeted digest.",
  "legacy manual",
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
