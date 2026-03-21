"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PAGE_REL = "web/admin-source-registry.html";
const PAGE_PATH = path.join(process.cwd(), PAGE_REL);
const pageSource = fs.readFileSync(PAGE_PATH, "utf8");
const scriptMatch = pageSource.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/i);

if (!scriptMatch) {
  throw new Error(`could not find inline script in ${PAGE_REL}`);
}

function createElement(id) {
  return {
    id,
    value: "",
    innerHTML: "",
    textContent: "",
    className: "",
    checked: false,
    style: {},
    children: [],
    addEventListener() {},
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      child.parentNode = null;
      return child;
    },
    contains(node) {
      return node === this || this.children.includes(node);
    },
  };
}

function extractRenderedDomains(html) {
  return Array.from(String(html || "").matchAll(/inspectSourceRegistryDomain\('([^']+)'\)/g), (match) => match[1]);
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

(async () => {
  const elementIds = [
    "darkToggle",
    "sourceRegistrySearch",
    "sourceRegistryInspector",
    "sourceRegistrySuggestionsHeaderRow",
    "sourceRegistrySuggestionsBody",
    "suggestionsCount",
    "suggestionsSearch",
    "sourceRegistryOverridesBody",
    "lastRefreshed",
    "toastWrap",
    "confirmModal",
    "confirmModalTitle",
    "confirmModalBody",
    "confirmModalAcceptBtn",
  ];
  const elements = new Map(elementIds.map((id) => [id, createElement(id)]));
  const location = new URL("https://example.com/admin/source-registry");
  const fetchCalls = [];

  const document = {
    body: {
      classList: {
        toggle() {},
        contains() {
          return false;
        },
      },
    },
    activeElement: null,
    hidden: false,
    visibilityState: "visible",
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return createElement(tagName);
    },
    addEventListener() {},
  };

  const context = {
    URL,
    URLSearchParams,
    document,
    history: {
      replaceState(_state, _title, url) {
        location.href = new URL(String(url), location.origin).href;
      },
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    fetch: async (url) => {
      const href = String(url);
      fetchCalls.push(href);
      if (href === "/api/admin/check") {
        return jsonResponse({ authenticated: true });
      }
      if (href.startsWith("/api/admin/source-registry/domain?")) {
        return jsonResponse({
          domain: "benzinga.com",
          effective_policy: {},
          admin_override: {},
          recent_metrics: {
            sample_items: [],
            recent_users: [],
            top_tags: [],
          },
          audit_entries: [],
        });
      }
      if (href.startsWith("/api/admin/source-registry?")) {
        return jsonResponse({
          suggestions: [],
          overrides: [],
        });
      }
      return jsonResponse({ error: `unexpected fetch: ${href}` }, 404);
    },
    window: {
      location,
      setInterval() {
        return 1;
      },
      clearInterval() {},
      setTimeout(fn) {
        if (typeof fn === "function") fn();
        return 1;
      },
      clearTimeout() {},
      addEventListener() {},
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout(fn) {
      if (typeof fn === "function") fn();
      return 1;
    },
    clearTimeout() {},
    console,
  };

  context.window.document = document;
  context.window.history = context.history;
  context.window.localStorage = context.localStorage;
  context.window.fetch = context.fetch;

  vm.runInNewContext(scriptMatch[1], context, { filename: PAGE_PATH });
  await flushMicrotasks();

  fetchCalls.length = 0;
  await context.inspectSourceRegistryDomain("benzinga.com", true);
  await flushMicrotasks();

  assert.ok(
    fetchCalls.includes("/api/admin/source-registry/domain?domain=benzinga.com"),
    "inspecting a row should still load the selected domain detail"
  );
  assert.strictEqual(
    elements.get("sourceRegistrySearch").value,
    "benzinga.com",
    "inspect field should reflect the selected domain"
  );

  fetchCalls.length = 0;
  await context.loadSourceRegistryOverview(true);
  await flushMicrotasks();

  const overviewCall = fetchCalls.find((href) => href.startsWith("/api/admin/source-registry?"));
  assert.ok(overviewCall, "overview reload should request the source registry list");
  assert.ok(
    !overviewCall.includes("query=benzinga.com"),
    "overview reload should not reuse the inspect-domain value as a table filter"
  );

  context.renderSourceRegistrySuggestions({
    suggestions: [
      {
        domain: "youtube.com",
        send_count: 3,
        weak_source_item_count: 3,
        suggested_reason: "Review-policy source showing weak exposure",
        effective_policy: {
          source_type: "platform_user_generated",
          source_tier: "unknown",
          source_policy: "review",
          review_status: "monitor",
          topic_fit_map: {},
          policy_effects: {
            lead_eligible: false,
            exposure_cap: 1,
            requires_corroboration: true,
            score_multiplier: 0.76,
          },
        },
      },
      {
        domain: "businessinsider.com",
        send_count: 1,
        weak_source_item_count: 0,
        suggested_reason: "Tracked source activity",
        effective_policy: {
          source_type: "reported_media",
          source_tier: "standard",
          source_policy: "allowed",
          review_status: "reviewed",
          topic_fit_map: {
            "strategy/business": "high",
          },
          policy_effects: {
            lead_eligible: true,
            exposure_cap: null,
            requires_corroboration: false,
            score_multiplier: 1,
          },
        },
      },
      {
        domain: "pharmavoice.com",
        send_count: 5,
        weak_source_item_count: 1,
        suggested_reason: "Frequent weak-source exposure",
        effective_policy: {
          source_type: "trade_specialist",
          source_tier: "strong",
          source_policy: "preferred",
          review_status: "reviewed",
          topic_fit_map: {
            healthcare: "high",
            "life sciences": "high",
          },
          policy_effects: {
            lead_eligible: true,
            exposure_cap: null,
            requires_corroboration: false,
            score_multiplier: 1.04,
          },
        },
      },
    ],
  });

  assert.deepStrictEqual(
    extractRenderedDomains(elements.get("sourceRegistrySuggestionsBody").innerHTML),
    ["pharmavoice.com", "youtube.com", "businessinsider.com"],
    "suggestions should default to tracked sends descending"
  );
  assert.strictEqual(
    elements.get("suggestionsCount").textContent,
    "3 sources",
    "suggestions count should reflect the rendered row count"
  );

  context.toggleSuggestionsSort("domain");
  assert.deepStrictEqual(
    extractRenderedDomains(elements.get("sourceRegistrySuggestionsBody").innerHTML),
    ["businessinsider.com", "pharmavoice.com", "youtube.com"],
    "toggling a new column should use that column's default sort direction"
  );

  context.toggleSuggestionsSort("domain");
  assert.deepStrictEqual(
    extractRenderedDomains(elements.get("sourceRegistrySuggestionsBody").innerHTML),
    ["youtube.com", "pharmavoice.com", "businessinsider.com"],
    "toggling the same column again should reverse the sort direction"
  );
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
