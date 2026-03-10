const { runAnalysisQualitySuite } = require("./analysis-quality-runtime");

module.exports = {
  id: "03-analysis-quality",
  name: "Analysis Quality",

  async run(context) {
    return runAnalysisQualitySuite(context, {
      id: this.id,
      name: this.name,
    });
  },
};
