const { judgeWithClaudeCached: judgeWithClaudeCachedCore } = require("./cache-claude-judge-core");

async function judgeWithClaudeCached(args) {
  return judgeWithClaudeCachedCore(args || {});
}

module.exports = {
  judgeWithClaudeCached,
};
