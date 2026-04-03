"use strict";

const assert = require("assert");
const { createDigestEmailFormattingRuntime } = require("./digest-formatting-email-runtime");

const runtime = createDigestEmailFormattingRuntime({
  BASE_URL: "https://getsignalbrief.com",
  EMAIL_TEMPLATE: `<!doctype html>
<html>
  <body>
    <div class="header">{{VIEW_ONLINE_LINK}}</div>
    <!-- Items -->
    <div class="items"></div>

    <!-- Footer -->
  </body>
</html>`,
  topicVisual() {
    return {
      icon: "•",
      chipText: "#111111",
      chipBg: "#EEEEEE",
    };
  },
  formatTopicDisplay(value) {
    return String(value || "");
  },
});

const html = runtime.buildEmail(
  [{
    tag: "TECHNOLOGY",
    headline: "Public digests now render online",
    wim: "Users can share the canonical digest URL directly from the email.",
    source: "example.com",
    url: "https://example.com/story",
    relevanceScore: 8.2,
  }],
  "Friday, March 13, 2026",
  "",
  "token-123",
  false,
  true,
  "headline_plus_why",
  null,
  "2026-03-13",
  "digest-123",
  {
    publicDigestUrl: "https://getsignalbrief.com/digest/2026-03-13",
  }
);

assert.ok(html.includes("View online"), "email should expose the public digest link");
assert.ok(html.includes("https://getsignalbrief.com/digest/2026-03-13"), "email should link to the canonical public digest URL");

const noLinkHtml = runtime.buildEmail(
  [],
  "Friday, March 13, 2026",
  "",
  "token-123",
  false,
  true,
  "headline_plus_why",
  null,
  "2026-03-13",
  "digest-123",
  {}
);

assert.ok(!noLinkHtml.includes("View online"), "email should omit the view-online link when no public URL is provided");

console.log("email formatter surfaces public digest links ✓");
