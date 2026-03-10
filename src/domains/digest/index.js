"use strict";

const digestPipeline = require("../../digest/application/digest-pipeline-seam-runtime");
const digestPolicy = require("../../digest/domain/digest-policy-domain-runtime");
const repeatDedup = require("../../digest/domain/repeat-dedup-domain-runtime");
const selection = require("../../digest/domain/selection-domain-runtime");
const source = require("../../digest/domain/source-domain-runtime");
const topic = require("../../digest/domain/topic-domain-runtime");
const formatting = require("../../digest/runtime/digest-formatting-runtime");
const dataRuntime = require("../../digest/runtime/digest-data-runtime");
const archiveRuntime = require("../../digest/runtime/digest-archive-runtime");
const quality = require("../../runtime/quality-score");

module.exports = {
  ...digestPipeline,
  ...digestPolicy,
  ...repeatDedup,
  ...selection,
  ...source,
  ...topic,
  ...formatting,
  ...dataRuntime,
  ...archiveRuntime,
  ...quality,
  digestPipeline,
  digestPolicy,
  repeatDedup,
  selection,
  source,
  topic,
  formatting,
  dataRuntime,
  archiveRuntime,
  quality,
};
