/**
 * @module src/runtime/store
 * Facade for the canonical store runtime at `./store-core-runtime`.
 * Import this module when legacy callers still expect the stable runtime path.
 */

module.exports = require("./store-core-runtime");
