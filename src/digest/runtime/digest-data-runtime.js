"use strict";

const { createDigestDataFetchRuntime } = require("./digest-data-fetch-runtime");
const { createDigestDataEnrichRuntime } = require("./digest-data-enrich-runtime");

function createDigestDataRuntime(deps) {
  const fetchRuntime = createDigestDataFetchRuntime(deps);
  const enrichRuntime = createDigestDataEnrichRuntime(deps);

  return {
    fetchTopicNews: fetchRuntime.fetchTopicNews,
    enrichItems: enrichRuntime.enrichItems,
  };
}

module.exports = {
  createDigestDataRuntime,
};
