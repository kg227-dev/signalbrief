"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-formatting-telegram-content-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const { formatTelegram } = runtime;

assert.strictEqual(typeof formatTelegram, "function");

const digestText = formatTelegram(
  [
    {
      tag: "AI×TECH",
      headline: "Nvidia ships another enterprise model",
      wim: "<b>Enterprise buyers are moving faster than expected.</b> Longer context sentence that should be omitted.",
      source: "Reuters",
      url: "https://example.com/nvidia-story",
      why_shown: ["tracked_topic", "watchlist_hit"],
    },
    {
      tag: "M&A",
      headline: "KKR explores new transaction structure",
      wim: null,
      source: "FT",
      url: "#",
      why_shown: [],
    },
  ],
  "Mar 13, 2026",
  { digests_received: 2 },
  {
    digestQuality: { score: 83.6, band: "strong" },
    learningSummary: "Boosting AI based on your recent saves.",
    publicDigestUrl: "https://getsignalbrief.com/digest/2026-03-13",
  }
);

assert.ok(digestText.includes("☀️ *SignalBrief — Mar 13, 2026*"));
assert.ok(digestText.includes("🎯 Digest match: 84% · strong"));
assert.ok(digestText.includes("🧠 Boosting AI based on your recent saves."));
assert.ok(digestText.includes("🔗 [Share today's brief](https://getsignalbrief.com/digest/2026-03-13)"));
assert.ok(digestText.includes("1⃣ *[AI×TECH]* Nvidia ships another enterprise model"));
assert.ok(
  digestText.includes("_Enterprise buyers are moving faster than expected._"),
  "WIM should include only the first cleaned sentence"
);
assert.ok(digestText.includes("→ [Reuters](https://example.com/nvidia-story)"));
assert.ok(digestText.includes("· why shown: tracked topic, watchlist hit"));
assert.ok(digestText.includes("→ FT"), "source-only line should render when url is missing");
assert.ok(
  digestText.includes("💾 save 1,4,6 → bookmarks multiple"),
  "new-user command menu should include expanded save examples"
);

const veteranText = formatTelegram(
  [
    {
      tag: "AI×TECH",
      headline: "Veteran user digest item",
      wim: "Short context.",
      source: "Bloomberg",
      url: "https://example.com/veteran",
      why_shown: ["tracked_topic"],
    },
  ],
  "Mar 13, 2026",
  { digests_received: 12 },
  {}
);

assert.ok(
  veteranText.includes("💾 save [#] · 📊 more/less [topic] · ⚙️ settings"),
  "veteran command menu should use compact controls"
);
assert.ok(!veteranText.includes("save 1,4,6"), "veteran menu should not show onboarding-heavy commands");
