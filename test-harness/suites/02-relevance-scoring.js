const { runRelevanceScoringSuite } = require("./relevance-scoring-runtime");

module.exports = {
  id: "02-relevance-scoring",
  name: "Relevance Scoring",

  async run(context) {
    return runRelevanceScoringSuite(context, {
      id: this.id,
      name: this.name,
    });
  },
};
