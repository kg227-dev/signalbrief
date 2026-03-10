"use strict";

const { getTopicQueries, buildSearchRequest } = require("./digest-data-fetch-request-runtime");
const {
  enrichWithCitationUrls,
  collectUniqueItems,
  shouldStopAttempts,
  parsePerplexityItems,
} = require("./digest-data-fetch-items-runtime");

function createDigestDataFetchRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
    normalizeUrlForDedup,
  } = deps;

  async function fetchTopicNews(topic, opts = {}) {
    const searchModel = opts.searchModel || "sonar";
    log(`Fetching: ${topic.tag}`);
    const queries = getTopicQueries(topic);
    if (!queries.length) {
      return { items: [], apiCalls: 0 };
    }

    const maxAttempts = topic?.isCustom ? Math.min(3, queries.length) : 1;
    const collected = [];
    const seenUrl = new Set();
    const seenHeadline = new Set();
    let apiCalls = 0;

    for (let idx = 0; idx < maxAttempts; idx++) {
      const query = queries[idx];
      if (idx > 0) log(`↳ ${topic.tag} fallback query ${idx + 1}/${maxAttempts}`);

      let res;
      try {
        res = await httpsPostWithRetry(
          "api.perplexity.ai",
          "/chat/completions",
          {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CONFIG.keys.perplexity}`,
          },
          buildSearchRequest(topic.tag, query, searchModel)
        );
        apiCalls += 1;
      } catch (err) {
        log(`⚠️ Perplexity ${topic.tag} query failed (${idx + 1}/${maxAttempts}): ${String(err?.message || err).slice(0, 180)}`);
        continue;
      }

      if (res.status >= 400) {
        const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || `status ${res.status}`;
        log(`⚠️ Perplexity ${topic.tag} request returned ${res.status}: ${String(errDetail).slice(0, 180)}`);
        continue;
      }

      const citations = res.body?.citations || [];

      try {
        const content = res.body?.choices?.[0]?.message?.content || "[]";
        if (!res.body?.choices?.[0]?.message?.content) {
          const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || "no choices content";
          log(`⚠️ Perplexity returned empty payload for ${topic.tag}: ${String(errDetail).slice(0, 180)}`);
        }
        const parsed = parsePerplexityItems(content);
        if (!Array.isArray(parsed)) {
          log(`⚠️ Perplexity payload for ${topic.tag} was not an array`);
          continue;
        }

        const normalized = enrichWithCitationUrls(parsed, citations, topic.tag, log);
        collectUniqueItems(normalized, seenHeadline, seenUrl, collected, normalizeUrlForDedup);
      } catch (err) {
        log(`Parse error for ${topic.tag}: ${err.message}`);
      }

      if (shouldStopAttempts(topic, collected)) break;
    }

    return {
      items: collected.slice(0, 3),
      apiCalls,
    };
  }

  return {
    fetchTopicNews,
  };
}

module.exports = {
  createDigestDataFetchRuntime,
};
