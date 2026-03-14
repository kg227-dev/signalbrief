"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const templatePath = path.join(process.cwd(), "templates", "email.html");
const html = fs.readFileSync(templatePath, "utf8");

assert.ok(
  html.includes(".card { background: #FFFFFF; max-width: 640px;"),
  "email template should use a wider 640px card"
);
assert.ok(
  html.includes("<div class=\"card\" style=\"background:#FFFFFF;max-width:640px;"),
  "email template inline styles should match the wider 640px card"
);
assert.ok(
  html.includes(".wrapper { padding: 28px 12px; }"),
  "email template should trim wrapper side padding"
);
