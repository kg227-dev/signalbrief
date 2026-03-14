"use strict";

const path = require("path");
const fs = require("fs");

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const adminSource = read("web/admin.html");
const adminUserSource = read("web/admin-user.html");

const adminSnippets = [
  'title: "Resubscribe subscriber"',
  'confirmLabel: "Resubscribe"',
  '>resume</button>',
  '>resubscribe</button>',
];

for (const snippet of adminSnippets) {
  if (!adminSource.includes(snippet)) {
    throw new Error(`admin subscriber actions UI is missing required snippet: ${snippet}`);
  }
}

const adminUserSnippets = [
  "btn.textContent = 'Resubscribe';",
  "const actionLabel = newStatus === 'paused'",
  "? 'Resubscribe'",
  "fetch('/api/admin/set-user-status'",
];

for (const snippet of adminUserSnippets) {
  if (!adminUserSource.includes(snippet)) {
    throw new Error(`admin user page is missing required resubscribe snippet: ${snippet}`);
  }
}
