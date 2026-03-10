const { stableHash, sendHttpPostRequest, parseJsonArrayLenient, parseJsonObjectLenient } = require("./cache-common");
const { loadBudget, saveBudget, ensureBudget, recordBudgetCall, estimateClaudeCost } = require("./cache-budget");
const { fetchTopicNewsCached } = require("./cache-perplexity");
const { enrichItemsCached, judgeWithClaudeCached } = require("./cache-claude");
const { loadArchiveDigests } = require("./cache-archive");

module.exports = {
  stableHash,
  sendHttpPostRequest,
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
