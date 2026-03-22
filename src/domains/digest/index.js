"use strict";

const digestPipeline = require("../../digest/application/digest-pipeline-seam-runtime");
const digestPolicy = require("../../digest/domain/digest-policy-domain-runtime");
const repeatDedup = require("../../digest/domain/repeat-dedup-domain-runtime");
const repeatHistory = require("../../digest/domain/repeat-history-domain-runtime");
const selection = require("../../digest/domain/selection-domain-runtime");
const source = require("../../digest/domain/source-domain-runtime");
const storyline = require("../../digest/domain/storyline-domain-runtime");
const topic = require("../../digest/domain/topic-domain-runtime");
const formatting = require("../../digest/runtime/digest-formatting-runtime");
const dataRuntime = require("../../digest/runtime/digest-data-runtime");
const archiveRuntime = require("../../digest/runtime/digest-archive-runtime");
const deliveryRecordRuntime = require("../../digest/runtime/digest-delivery-record-runtime");
const quality = require("../../runtime/quality-score");

module.exports = {
  ...digestPipeline,
  ...digestPolicy,
  ...repeatDedup,
  ...repeatHistory,
  ...selection,
  ...source,
  ...storyline,
  ...topic,
  ...formatting,
  ...dataRuntime,
  ...archiveRuntime,
  ...deliveryRecordRuntime,
  ...quality,
  digestPipeline,
  digestPolicy,
  repeatDedup,
  repeatHistory,
  selection,
  source,
  storyline,
  topic,
  formatting,
  dataRuntime,
  archiveRuntime,
  deliveryRecordRuntime,
  quality,
};
