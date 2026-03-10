"use strict";

const { selectItemsByPolicy } = require("../domain/selection-domain-runtime");
const { createSelectionPolicy, createDigestPolicies } = require("../domain/digest-policy-domain-runtime");

function selectDigestItems(allItems, opts = {}) {
  const policy = createSelectionPolicy({
    maxItems: opts.maxItems,
    perTagCap: opts.maxItemsPerTag,
    perSourceCap: opts.maxItemsPerSourceDomain,
    customTagOrder: opts.customTags || [],
    tagPriority: opts.tagPriority,
    maxCustomItems: opts.maxCustomItems,
  });
  return selectItemsByPolicy(allItems, policy, {
    normalizeUrl: opts.normalizeUrl,
    parseDomain: opts.parseDomain,
    normalizeTopicToken: opts.normalizeTopicToken,
    isCandidate: opts.isCandidate,
  });
}

module.exports = {
  selectDigestItems,
  createDigestPolicies,
};
