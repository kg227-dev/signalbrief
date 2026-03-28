"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-source-registry-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { handleAdminSourceRegistryRoutes } = runtime;

function buildMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this.body = String(body || "");
      return this.body;
    },
  };
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
  return { status, data };
}

async function invoke(deps, { method, pathname, search = "", body = null }) {
  const req = {
    method,
    url: `${pathname}${search}`,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = buildMockRes();
  const url = new URL(`http://localhost${pathname}${search}`);
  const handled = await handleAdminSourceRegistryRoutes({ req, res, url, pathname }, {
    json,
    isAdminAuthed: () => true,
    requireJsonBody: async () => body,
    loadSourceRegistry: () => ({ version: 1, updated_at: null, domains: {}, identities: {} }),
    loadPreferredSourceRegistry: () => ({
      version: 1,
      global: { reported: [], official: [] },
      standard_topic_source: {
        source_of_truth: "standard_topic_broker",
        source_mode: "runtime",
        active_path: "/tmp/standard-topic-broker-sources.json",
        runtime_path: "/tmp/standard-topic-broker-sources.json",
        bundled_path: "/tmp/bundled-standard-topic-broker-sources.json",
        topic_count: 7,
        topic_keys: ["healthcare", "technology"],
      },
      topics: {},
    }),
    inspectStandardTopicBrokerConfig: () => ({
      source_mode: "runtime",
      active_path: "/tmp/standard-topic-broker-sources.json",
      runtime_path: "/tmp/standard-topic-broker-sources.json",
      bundled_path: "/tmp/bundled-standard-topic-broker-sources.json",
      config: {
        topics: {
          HEALTHCARE: {
            enabled: true,
            lanes: { publisher_feed: true, official: true },
          },
        },
        sources: [
          {
            id: "stat_rss",
            enabled: true,
            tier: 2,
            lane: "publisher_feed",
            topic_tags: ["HEALTHCARE"],
            domains: ["statnews.com"],
            source_kind: "reported_media",
            source_family: "specialist",
            endpoint: "https://feeds.example.com/stat.xml",
          },
        ],
      },
    }),
    buildSourceRegistryMap: (registry) => ({
      domains: new Map(Object.entries(registry.domains || {})),
      identities: new Map(Object.entries(registry.identities || {})),
    }),
    setAdminSourceRegistry: () => {},
    buildRecentDigestsExport: () => ({ rows: [] }),
    readJsonLineLog: () => [],
    ADMIN_ACTION_LOG: "/tmp/admin-action-log.json",
    sourceRegistryPath: "/tmp/source-registry.json",
    preferredSourcesPath: "/tmp/preferred-sources.json",
    upsertSourceRegistryEntry: () => ({
      registry: {
        version: 1,
        updated_at: "2026-03-20T12:00:00.000Z",
        domains: {
          "benzinga.com": {
            domain: "benzinga.com",
            tier_override: "weak",
            authority_override: 0.22,
            hard_block: true,
            note: "Too noisy",
          },
        },
        identities: {
          "youtube:@insideboardroom": {
            identity_key: "youtube:@insideboardroom",
            policy: "allowed",
            review_status: "reviewed",
            note: "Reviewed channel override",
          },
        },
      },
      before: null,
      after: {
        domain: "benzinga.com",
        tier_override: "weak",
        authority_override: 0.22,
        hard_block: true,
        note: "Too noisy",
      },
    }),
    resetSourceRegistryIdentityEntry: () => ({
      registry: { version: 1, updated_at: "2026-03-20T12:05:00.000Z", domains: {}, identities: {} },
      before: { identity_key: "youtube:@insideboardroom" },
      after: null,
    }),
    resetSourceRegistryEntry: () => ({
      registry: { version: 1, updated_at: "2026-03-20T12:05:00.000Z", domains: {}, identities: {} },
      before: { domain: "benzinga.com" },
      after: null,
    }),
    updateBrokerTopicConfig: () => ({
      before: {
        enabled: true,
        lanes: { publisher_feed: true, official: true },
      },
      after: {
        enabled: false,
        lanes: { publisher_feed: true, official: true },
      },
      snapshot: {
        source_mode: "runtime",
        active_path: "/tmp/standard-topic-broker-sources.json",
        runtime_path: "/tmp/standard-topic-broker-sources.json",
        bundled_path: "/tmp/bundled-standard-topic-broker-sources.json",
        config: { topics: {}, sources: [] },
      },
    }),
    updateBrokerSourceConfig: () => ({
      before: {
        id: "stat_rss",
        enabled: true,
        tier: 2,
      },
      after: {
        id: "stat_rss",
        enabled: false,
        tier: 3,
      },
      snapshot: {
        source_mode: "runtime",
        active_path: "/tmp/standard-topic-broker-sources.json",
        runtime_path: "/tmp/standard-topic-broker-sources.json",
        bundled_path: "/tmp/bundled-standard-topic-broker-sources.json",
        config: { topics: {}, sources: [] },
      },
    }),
    logAdminActionEvent: () => {},
    ...deps,
  });
  return { handled, res };
}

(async () => {
  {
    const { handled, res } = await invoke({}, {
      method: "GET",
      pathname: "/api/admin/source-registry",
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.source_registry_path, "/tmp/source-registry.json");
    assert.strictEqual(payload.preferred_sources.path, "/tmp/standard-topic-broker-sources.json");
    assert.strictEqual(payload.preferred_sources.standard_topic_source.source_of_truth, "standard_topic_broker");
    assert.strictEqual(payload.broker_config.topic_count, 1);
    assert.strictEqual(payload.broker_config.sources[0].id, "stat_rss");
  }

  {
    const { handled, res } = await invoke({}, {
      method: "POST",
      pathname: "/api/admin/source-registry/domain",
      body: {
        domain: "benzinga.com",
        tier_override: "weak",
        authority_override: 0.22,
        hard_block: true,
        note: "Too noisy",
      },
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.detail.domain, "benzinga.com");
  }

  {
    const { handled, res } = await invoke({}, {
      method: "POST",
      pathname: "/api/admin/source-registry/domain",
      body: {
        domain: "youtube.com",
        identity_key: "youtube:@insideboardroom",
        policy: "allowed",
        review_status: "reviewed",
        note: "Reviewed channel override",
      },
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.detail.domain, "youtube.com");
    assert.strictEqual(payload.detail.selected_identity_key, "youtube:@insideboardroom");
  }

  {
    const { handled, res } = await invoke({}, {
      method: "POST",
      pathname: "/api/admin/source-registry/broker/topic",
      body: {
        topic: "HEALTHCARE",
        enabled: false,
      },
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.topic, "HEALTHCARE");
    assert.strictEqual(payload.after.enabled, false);
  }

  {
    const { handled, res } = await invoke({}, {
      method: "POST",
      pathname: "/api/admin/source-registry/broker/source",
      body: {
        source_id: "stat_rss",
        enabled: false,
        tier: 3,
      },
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.source_id, "stat_rss");
    assert.strictEqual(payload.after.tier, 3);
  }

  {
    const { handled, res } = await invoke({}, {
      method: "POST",
      pathname: "/api/admin/source-registry/domain/reset",
      body: { domain: "benzinga.com" },
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.detail.domain, "benzinga.com");
  }

  {
    const { handled, res } = await invoke({}, {
      method: "POST",
      pathname: "/api/admin/source-registry/domain/reset",
      body: { domain: "youtube.com", identity_key: "youtube:@insideboardroom" },
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.detail.domain, "youtube.com");
    assert.strictEqual(payload.detail.selected_identity_key, "youtube:@insideboardroom");
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
