const { runDepthControlSuite } = require("./depth-control-runtime");

module.exports = {
  id: "06-depth-control",
  name: "Depth Control",

  async run(context) {
    return runDepthControlSuite(context, {
      id: this.id,
      name: this.name,
    });
  },
};
