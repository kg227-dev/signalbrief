"use strict";

const fs = require("fs");
const path = require("path");

const adminPage = fs.readFileSync(path.join(process.cwd(), "web/admin.html"), "utf8");
const adminUserPage = fs.readFileSync(path.join(process.cwd(), "web/admin-user.html"), "utf8");

const requiredAdminSnippets = [
  "async function resendDigestSnapshotForUser(email, dateKey, triggerEl = null)",
  "/api/admin/resend-digest",
  "Resend stored digest",
  "Stored snapshot resend is available when the failed run already captured a complete 5-item digest.",
];

for (const snippet of requiredAdminSnippets) {
  if (!adminPage.includes(snippet)) {
    throw new Error(`admin digest resend UI is missing required snippet: ${snippet}`);
  }
}

if (adminPage.includes("Targeted resend disabled in the reduced-scope MVP.")) {
  throw new Error("admin failed-delivery panel should no longer claim targeted resend is disabled");
}

const requiredAdminUserSnippets = [
  'id="resendDigestBtn"',
  "async function resendStoredDigest(triggerEl = null, explicitDateKey = '')",
  "/api/admin/resend-digest",
  "Resend latest digest",
];

for (const snippet of requiredAdminUserSnippets) {
  if (!adminUserPage.includes(snippet)) {
    throw new Error(`admin user digest resend UI is missing required snippet: ${snippet}`);
  }
}
