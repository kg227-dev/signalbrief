"use strict";

const { selectItemsByPolicy, selectItemsByPolicyDetailed } = require("../domain/selection-domain-runtime");
const { createSelectionPolicy, createDigestPolicies } = require("../domain/digest-policy-domain-runtime");

function selectDigestItems(allItems, opts = {}) {
  const policy = createSelectionPolicy({
    maxItems: opts.maxItems,
    perTagCap: opts.maxItemsPerTag,
    perSourceCap: opts.maxItemsPerSourceDomain,
    tagPriority: opts.tagPriority,
  });
  return selectItemsByPolicy(allItems, policy, {
    normalizeUrl: opts.normalizeUrl,
    parseDomain: opts.parseDomain,
    normalizeTopicToken: opts.normalizeTopicToken,
    isCandidate: opts.isCandidate,
  });
}

function selectDigestItemsDetailed(allItems, opts = {}) {
  const policy = createSelectionPolicy({
    maxItems: opts.maxItems,
    perTagCap: opts.maxItemsPerTag,
    perSourceCap: opts.maxItemsPerSourceDomain,
    tagPriority: opts.tagPriority,
  });
  return selectItemsByPolicyDetailed(allItems, policy, {
    normalizeUrl: opts.normalizeUrl,
    parseDomain: opts.parseDomain,
    normalizeTopicToken: opts.normalizeTopicToken,
    isCandidate: opts.isCandidate,
  });
}

module.exports = {
  selectDigestItems,
  selectDigestItemsDetailed,
  createDigestPolicies,
};
