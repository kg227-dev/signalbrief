const { runEndToEndSuite } = require("./end-to-end-runtime");

module.exports = {
  id: "09-end-to-end",
  name: "End-to-End Composite",

  async run(context) {
    return runEndToEndSuite(context, {
      id: this.id,
      name: this.name,
    });
  },
};
