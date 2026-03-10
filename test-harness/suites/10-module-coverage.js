const { runModuleCoverageSuite } = require("./module-coverage/suite");

module.exports = {
  id: "10-module-coverage",
  name: "Module Coverage",

  async run() {
    return runModuleCoverageSuite({
      id: this.id,
      name: this.name,
    });
  },
};
