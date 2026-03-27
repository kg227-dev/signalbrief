// Static dependency-links map for analysis tools.
// This file is not executed in production; it enumerates module relationships explicitly.

import "../src/jobs/digest-runner-runtime.js";
import "../src/digest/domain/digest-policy-domain-runtime.js";
import "../src/digest/domain/repeat-dedup-domain-runtime.js";
import "../src/digest/domain/selection-domain-runtime.js";
import "../src/digest/domain/source-domain-runtime.js";
import "../src/digest/domain/topic-domain-runtime.js";
import "../src/digest/application/digest-service-runtime.js";
import "../src/digest/runtime/archive-history-runtime.js";
import "../src/digest/runtime/archive-persistence-runtime.js";
import "../src/digest/runtime/archive-user-suppression-runtime.js";
import "../src/digest/runtime/digest-archive-runtime.js";
import "../src/digest/runtime/digest-data-fetch-runtime.js";
import "../src/digest/runtime/digest-data-enrich-runtime.js";
import "../src/digest/runtime/digest-data-runtime.js";
import "../src/digest/runtime/digest-formatting-ai-generation-runtime.js";
import "../src/digest/runtime/digest-formatting-ai-runtime.js";
import "../src/digest/runtime/digest-formatting-email-style-runtime.js";
import "../src/digest/runtime/digest-formatting-email-sections-runtime.js";
import "../src/digest/runtime/digest-formatting-email-items-runtime.js";
import "../src/digest/runtime/digest-formatting-email-template-runtime.js";
import "../src/digest/runtime/digest-formatting-email-runtime.js";
import "../src/digest/runtime/digest-item-ordering-runtime.js";
import "../src/digest/runtime/digest-formatting-topic-runtime.js";
import "../src/dependency-links.mjs";
import "../src/entrypoints/digest.js";
import "../src/entrypoints/digest-orchestrator-archive-runtime.js";
import "../src/entrypoints/digest-orchestrator-bootstrap-runtime.js";
import "../src/entrypoints/digest-orchestrator-cost-runtime.js";
import "../src/entrypoints/digest-orchestrator-incident-runtime.js";
import "../src/entrypoints/digest-orchestrator-lock-runtime.js";
import "../src/entrypoints/digest-orchestrator-transport-runtime.js";
import "../src/entrypoints/scheduler-worker.js";
import "../src/module-coverage-runtime.js";
import "../src/module-coverage.test.js";
import "../src/runtime/config-provider.js";
import "../src/runtime/engagement/engagement-events-runtime.js";
import "../src/runtime/mailer-lifecycle-runtime.js";
import "../src/runtime/mailer/lifecycle/common.js";
import "../src/runtime/mailer/lifecycle/lifecycle-senders.js";
import "../src/runtime/mailer/lifecycle/welcome-content.js";
import "../src/runtime/mailer/lifecycle/welcome-sender.js";
import "../src/runtime/mailer/mailer-runtime.js";
import "../src/runtime/quality-score.js";
import "../src/runtime/url-normalization-runtime.js";
import "../src/runtime/store.js";
import "../src/sandbox-pipeline-runtime.js";
import "../test-harness/cache/index.js";
import "../test-harness/cache/cache-archive.js";
import "../test-harness/cache/cache-budget.js";
import "../test-harness/cache/cache-claude-enrichment.js";
import "../test-harness/cache/cache-claude.js";
import "../test-harness/cache/cache-common.js";
import "../test-harness/cache/cache-perplexity.js";
import "../test-harness/cache/cache-perplexity-parser.js";
import "../test-harness/config/index.js";
import "../test-harness/config/config-args.js";
import "../test-harness/config/config-constants.js";
import "../test-harness/config/config-io.js";
import "../test-harness/runtime/evaluator.js";
import "../test-harness/runtime/harness-runtime.js";
import "../test-harness/runtime/matrix-runtime.js";
import "../test-harness/matrix/config.js";
import "../test-harness/matrix/guardrails.js";
import "../test-harness/runtime/personas.js";
import "../test-harness/personas/persona-factory.js";
import "../test-harness/personas/persona-topics.js";
import "../test-harness/personas/personas-canonical.js";
import "../test-harness/personas/personas-canonical-defs.js";
import "../test-harness/personas/personas-stress.js";
import "../test-harness/personas/personas-stress-defs.js";
import "../test-harness/runtime/pipeline.js";
import "../test-harness/reporters/console.js";
import "../test-harness/reporters/json.js";
import "../test-harness/run-matrix.js";
import "../test-harness/run-tests.js";
import "../test-harness/stages/analytics.js";
import "../test-harness/stages/dataset.js";
import "../test-harness/stages/dataset/live.js";
import "../test-harness/stages/dataset/offline.js";
import "../test-harness/stages/dataset/shared.js";
import "../test-harness/stages/reporting.js";
import "../test-harness/stages/suite-runner.js";
import "../test-harness/suites/01-topic-matching.js";
import "../test-harness/suites/02-relevance-scoring.js";
import "../test-harness/suites/03-analysis-quality.js";
import "../test-harness/suites/04-diversity.js";
import "../test-harness/suites/06-depth-control.js";
import "../test-harness/suites/07-item-count.js";
import "../test-harness/suites/08-cross-day-freshness.js";
import "../test-harness/suites/09-end-to-end.js";
import "../test-harness/suites/10-module-coverage.js";
import "../test-harness/suites/module-coverage/checks-runtime.js";
import "../test-harness/suites/module-coverage/checks-topic.js";
import "../test-harness/suites/module-coverage/common.js";
import "../test-harness/suites/module-coverage/suite.js";
import "../test-harness/suites/analysis-quality-runtime.js";
import "../test-harness/suites/cross-day-freshness-runtime.js";
import "../test-harness/suites/depth-control-runtime.js";
import "../test-harness/suites/end-to-end-runtime.js";
import "../test-harness/suites/relevance-scoring-runtime.js";
import "../test-harness/utils/topic-utils.js";
import "../web/admin-auth.js";
import "../web/index.js";
import "../web/preferences-runtime.js";
import "../web/preferences-state-runtime.js";
import "../web/preferences-shared.js";
import "../web/routes/admin-api.js";
import "../web/routes/core-api.js";
import "../web/routes/public-static.js";
import "../web/server.js";
import "../web/services/admin-ops.js";
import "../web/services/admin-ops-analytics.js";
import "../web/services/admin-ops-scheduler.js";
import "../web/services/admin-ops-utils.js";
import "../web/services/archive-scoring.js";
import "../web/services/delivery-schedule.js";
import "../web/services/request-metadata.js";
import "../web/services/web-rate-limit.js";
import "../web/settings-runtime.js";
import "../web/settings-ui-runtime.js";
import "../web/settings.js";

export const dependencyLinks = [
  "src/jobs/digest-runner-runtime.js",
  "src/digest/domain/digest-policy-domain-runtime.js",
  "src/digest/domain/repeat-dedup-domain-runtime.js",
  "src/digest/domain/selection-domain-runtime.js",
  "src/digest/domain/source-domain-runtime.js",
  "src/digest/domain/topic-domain-runtime.js",
  "src/digest/application/digest-service-runtime.js",
  "src/digest/runtime/archive-history-runtime.js",
  "src/digest/runtime/archive-persistence-runtime.js",
  "src/digest/runtime/archive-user-suppression-runtime.js",
  "src/digest/runtime/digest-archive-runtime.js",
  "src/digest/runtime/digest-data-fetch-runtime.js",
  "src/digest/runtime/digest-data-enrich-runtime.js",
  "src/digest/runtime/digest-data-runtime.js",
  "src/digest/runtime/digest-formatting-ai-generation-runtime.js",
  "src/digest/runtime/digest-formatting-ai-runtime.js",
  "src/digest/runtime/digest-formatting-email-style-runtime.js",
  "src/digest/runtime/digest-formatting-email-sections-runtime.js",
  "src/digest/runtime/digest-formatting-email-items-runtime.js",
  "src/digest/runtime/digest-formatting-email-template-runtime.js",
  "src/digest/runtime/digest-formatting-email-runtime.js",
  "src/digest/runtime/digest-item-ordering-runtime.js",
  "src/digest/runtime/digest-formatting-topic-runtime.js",
  "src/dependency-links.mjs",
  "src/entrypoints/digest.js",
  "src/entrypoints/digest-orchestrator-archive-runtime.js",
  "src/entrypoints/digest-orchestrator-bootstrap-runtime.js",
  "src/entrypoints/digest-orchestrator-cost-runtime.js",
  "src/entrypoints/digest-orchestrator-incident-runtime.js",
  "src/entrypoints/digest-orchestrator-lock-runtime.js",
  "src/entrypoints/digest-orchestrator-transport-runtime.js",
  "src/entrypoints/scheduler-worker.js",
  "src/module-coverage-runtime.js",
  "src/module-coverage.test.js",
  "src/runtime/config-provider.js",
  "src/runtime/engagement/engagement-events-runtime.js",
  "src/runtime/mailer-lifecycle-runtime.js",
  "src/runtime/mailer/lifecycle/common.js",
  "src/runtime/mailer/lifecycle/lifecycle-senders.js",
  "src/runtime/mailer/lifecycle/welcome-content.js",
  "src/runtime/mailer/lifecycle/welcome-sender.js",
  "src/runtime/mailer/mailer-runtime.js",
  "src/runtime/quality-score.js",
  "src/runtime/url-normalization-runtime.js",
  "src/runtime/store.js",
  "src/sandbox-pipeline-runtime.js",
  "test-harness/cache/index.js",
  "test-harness/cache/cache-archive.js",
  "test-harness/cache/cache-budget.js",
  "test-harness/cache/cache-claude-enrichment.js",
  "test-harness/cache/cache-claude.js",
  "test-harness/cache/cache-common.js",
  "test-harness/cache/cache-perplexity.js",
  "test-harness/cache/cache-perplexity-parser.js",
  "test-harness/config/index.js",
  "test-harness/config/config-args.js",
  "test-harness/config/config-constants.js",
  "test-harness/config/config-io.js",
  "test-harness/runtime/evaluator.js",
  "test-harness/runtime/harness-runtime.js",
  "test-harness/runtime/matrix-runtime.js",
  "test-harness/matrix/config.js",
  "test-harness/matrix/guardrails.js",
  "test-harness/runtime/personas.js",
  "test-harness/personas/persona-factory.js",
  "test-harness/personas/persona-topics.js",
  "test-harness/personas/personas-canonical.js",
  "test-harness/personas/personas-canonical-defs.js",
  "test-harness/personas/personas-stress.js",
  "test-harness/personas/personas-stress-defs.js",
  "test-harness/runtime/pipeline.js",
  "test-harness/reporters/console.js",
  "test-harness/reporters/json.js",
  "test-harness/run-matrix.js",
  "test-harness/run-tests.js",
  "test-harness/stages/analytics.js",
  "test-harness/stages/dataset.js",
  "test-harness/stages/dataset/live.js",
  "test-harness/stages/dataset/offline.js",
  "test-harness/stages/dataset/shared.js",
  "test-harness/stages/reporting.js",
  "test-harness/stages/suite-runner.js",
  "test-harness/suites/01-topic-matching.js",
  "test-harness/suites/02-relevance-scoring.js",
  "test-harness/suites/03-analysis-quality.js",
  "test-harness/suites/04-diversity.js",
  "test-harness/suites/06-depth-control.js",
  "test-harness/suites/07-item-count.js",
  "test-harness/suites/08-cross-day-freshness.js",
  "test-harness/suites/09-end-to-end.js",
  "test-harness/suites/10-module-coverage.js",
  "test-harness/suites/module-coverage/checks-runtime.js",
  "test-harness/suites/module-coverage/checks-topic.js",
  "test-harness/suites/module-coverage/common.js",
  "test-harness/suites/module-coverage/suite.js",
  "test-harness/suites/analysis-quality-runtime.js",
  "test-harness/suites/cross-day-freshness-runtime.js",
  "test-harness/suites/depth-control-runtime.js",
  "test-harness/suites/end-to-end-runtime.js",
  "test-harness/suites/relevance-scoring-runtime.js",
  "test-harness/utils/topic-utils.js",
  "web/admin-auth.js",
  "web/index.js",
  "web/preferences-runtime.js",
  "web/preferences-state-runtime.js",
  "web/preferences-shared.js",
  "web/routes/admin-api.js",
  "web/routes/core-api.js",
  "web/routes/public-static.js",
  "web/server.js",
  "web/services/admin-ops.js",
  "web/services/admin-ops-analytics.js",
  "web/services/admin-ops-scheduler.js",
  "web/services/admin-ops-utils.js",
  "web/services/archive-scoring.js",
  "web/services/delivery-schedule.js",
  "web/services/request-metadata.js",
  "web/services/web-rate-limit.js",
  "web/settings-runtime.js",
  "web/settings-ui-runtime.js",
  "web/settings.js"
];

// Backward-compatible alias for older tooling imports.
export const linkedModules = dependencyLinks;
