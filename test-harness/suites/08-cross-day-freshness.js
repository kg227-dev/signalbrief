const { runCrossDayFreshnessSuite } = require("./cross-day-freshness-runtime");

module.exports = {
  id: "08-cross-day-freshness",
  name: "Cross-Day Freshness",

  async run(context) {
    return runCrossDayFreshnessSuite(context, {
      id: this.id,
      name: this.name,
    });
  },
};
