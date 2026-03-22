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
    "preferredSourcesPanelBody",
    "curationQueuesPanelBody",
    "sourceRegistrySuggestionsHeaderRow",
    "sourceRegistrySuggestionsBody",
    "suggestionsCount",
    "suggestionsSearch",
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
        const requestedDomain = new URL(href, "https://example.com").searchParams.get("domain");
        if (requestedDomain === "news.broadcom.com") {
          return jsonResponse({
            domain: "news.broadcom.com",
            effective_policy: {},
            admin_override: {},
            recent_metrics: {
              sample_items: [],
              recent_users: [],
              top_tags: [],
            },
            audit_entries: [
              {
                action: "source_policy_upsert",
                actor: "admin@example.com",
                at: "2026-03-20T14:00:00.000Z",
                note: "Official corporate newsroom",
              },
            ],
          });
        }
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
          preferred_sources: {
            path: "/app/config/preferred-sources.json",
            runtime_path: "/app/data/preferred-sources.json",
            bundled_path: "/app/config/preferred-sources.json",
            source_mode: "bundled_fallback",
            used_fallback: true,
            version: 1,
            total_unique_domains: 4,
            topic_count: 1,
            global: {
              reported: ["reuters.com"],
              official: ["sec.gov"],
            },
            topics: [
              {
                topic: "healthcare",
                reported: ["statnews.com"],
                official: ["fda.gov"],
              },
            ],
            raw_json: JSON.stringify({
              version: 1,
              global: {
                reported: ["reuters.com"],
                official: ["sec.gov"],
              },
              topics: {
                healthcare: {
                  reported: ["statnews.com"],
                  official: ["fda.gov"],
                },
              },
            }, null, 2),
          },
          suggestions: [],
          overrides: [],
          curation_queues: {
            specialist_candidates: [
              {
                domain: "pharmavoice.com",
                specialist_trade_win_count: 3,
                tracked_sends: 5,
                top_tags: [{ tag: "HEALTHCARE", count: 5 }],
                effective_policy: {
                  source_type: "trade_specialist",
                  source_tier: "strong",
                  source_policy: "preferred",
                },
                reason: "Repeatedly surfaced as a specialist best-fit winner over broader preferred coverage.",
              },
            ],
            derivative_winners: [
              {
                domain: "benzinga.com",
                derivative_winner_count: 2,
                tracked_sends: 2,
                top_tags: [{ tag: "TECHNOLOGY", count: 2 }],
                effective_policy: {
                  source_type: "aggregator_republisher",
                  source_tier: "weak",
                  source_policy: "review",
                },
                reason: "Won as the best available derivative-style representation; good candidate for tighter review or better-source expansion.",
              },
            ],
            platform_ambiguity: [
              {
                domain: "youtube.com",
                platform_identity_ambiguity_count: 4,
                tracked_sends: 4,
                top_tags: [{ tag: "TECHNOLOGY", count: 4 }],
                effective_policy: {
                  source_type: "platform_user_generated",
                  source_tier: "unknown",
                  source_policy: "review",
                },
                reason: "Platform-domain ambiguity still influenced selected items; identity-level review would improve precision.",
              },
            ],
            topic_coverage_gaps: [
              {
                topic: "HEALTHCARE",
                preferred_missing_count: 1,
                preferred_weaker_count: 2,
                broad_rescue_count: 1,
                example_domains: [
                  { domain: "pharmavoice.com", count: 2 },
                  { domain: "statnews.com", count: 1 },
                ],
                last_seen_at: "2026-03-21T11:00:00.000Z",
              },
            ],
          },
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
  assert.ok(
    elements.get("preferredSourcesPanelBody").innerHTML.includes("/app/config/preferred-sources.json"),
    "preferred sources config should render on the source governance page"
  );
  assert.ok(
    elements.get("preferredSourcesPanelBody").innerHTML.includes("statnews.com"),
    "preferred sources panel should render topic-specific domains"
  );
  assert.ok(
    elements.get("preferredSourcesPanelBody").innerHTML.includes("bundled fallback"),
    "preferred sources panel should explain when bundled fallback is active"
  );
  assert.ok(
    elements.get("curationQueuesPanelBody").innerHTML.includes("Specialist candidates"),
    "curation queues should render the specialist queue"
  );
  assert.ok(
    elements.get("curationQueuesPanelBody").innerHTML.includes("pharmavoice.com"),
    "curation queues should render specialist candidate domains"
  );
  assert.ok(
    elements.get("curationQueuesPanelBody").innerHTML.includes("HEALTHCARE"),
    "curation queues should render topic coverage gaps"
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
    overrides: [
      {
        domain: "news.broadcom.com",
        note: "Official corporate newsroom",
        updated_at: "2026-03-20T14:00:00.000Z",
        updated_by: "admin@example.com",
        effective_policy: {
          source_type: "corporate_pr",
          source_tier: "corporate",
          source_policy: "limited",
          review_status: "reviewed",
          topic_fit_map: {
            technology: "high",
          },
          policy_effects: {
            lead_eligible: false,
            exposure_cap: 1,
            requires_corroboration: false,
            score_multiplier: 0.88,
          },
        },
        recent_metrics: {
          send_count: 2,
          weak_source_item_count: 0,
          top_tags: [{ tag: "TECHNOLOGY", count: 2 }],
        },
      },
    ],
  });

  assert.deepStrictEqual(
    extractRenderedDomains(elements.get("sourceRegistrySuggestionsBody").innerHTML),
    ["pharmavoice.com", "youtube.com", "news.broadcom.com", "businessinsider.com"],
    "governance rows should default to tracked sends descending"
  );
  assert.strictEqual(
    elements.get("suggestionsCount").textContent,
    "4 sources",
    "suggestions count should reflect the rendered row count"
  );
  assert.ok(
    elements.get("sourceRegistrySuggestionsBody").innerHTML.includes("Audit history"),
    "rows with overrides should render an inline audit control"
  );

  context.toggleSuggestionsSort("domain");
  assert.deepStrictEqual(
    extractRenderedDomains(elements.get("sourceRegistrySuggestionsBody").innerHTML),
    ["businessinsider.com", "news.broadcom.com", "pharmavoice.com", "youtube.com"],
    "toggling a new column should use that column's default sort direction"
  );

  context.toggleSuggestionsSort("domain");
  assert.deepStrictEqual(
    extractRenderedDomains(elements.get("sourceRegistrySuggestionsBody").innerHTML),
    ["youtube.com", "pharmavoice.com", "news.broadcom.com", "businessinsider.com"],
    "toggling the same column again should reverse the sort direction"
  );

  const auditPanelId = "sourceRegistryAudit-news-broadcom-com";
  elements.set(auditPanelId, createElement(auditPanelId));
  fetchCalls.length = 0;
  await context.toggleSourceAudit("news.broadcom.com");
  await flushMicrotasks();

  assert.ok(
    fetchCalls.includes("/api/admin/source-registry/domain?domain=news.broadcom.com"),
    "expanding inline audit should fetch the domain detail once"
  );
  assert.ok(
    elements.get(auditPanelId).innerHTML.includes("Official corporate newsroom"),
    "inline audit should render the fetched audit note"
  );
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
