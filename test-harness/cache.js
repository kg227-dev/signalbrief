const { stableHash, httpsPost, parseJsonArrayLenient, parseJsonObjectLenient } = require("./cache/cache-common");
const { loadBudget, saveBudget, ensureBudget, recordBudgetCall, estimateClaudeCost } = require("./cache/cache-budget");
const { fetchTopicNewsCached } = require("./cache/cache-perplexity");
const { enrichItemsCached, judgeWithClaudeCached } = require("./cache/cache-claude");
const { loadArchiveDigests } = require("./cache/cache-archive");

module.exports = {
  stableHash,
  httpsPost,
  loadBudget,
  saveBudget,
  ensureBudget,
  recordBudgetCall,
  estimateClaudeCost,
  parseJsonArrayLenient,
  parseJsonObjectLenient,
  fetchTopicNewsCached,
  enrichItemsCached,
  judgeWithClaudeCached,
  loadArchiveDigests,
};
