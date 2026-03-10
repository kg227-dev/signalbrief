const { runCustomTopicsSuite } = require("./custom-topics-runtime");

module.exports = {
  id: "05-custom-topics",
  name: "Custom Topics",

  async run(context) {
    return runCustomTopicsSuite(context, {
      id: this.id,
      name: this.name,
    });
  },
};
