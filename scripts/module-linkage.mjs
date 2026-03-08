// Static dependency-links map for analysis tools.
// This file is not executed in production; it enumerates module relationships explicitly.

import "../digest-pipeline-seam.js";
import "../digest-policy-domain.js";
import "../digest-runner.js";
import "../eslint.config.js";
import "../reengagement.js";
import "../repeat-dedup-domain.js";
import "../selection-domain.js";
import "../selection-domain-runtime.js";
import "../source-domain.js";
import "../src/entrypoints/bot-server.js";
import "../src/entrypoints/digest.js";
import "../src/entrypoints/digest-runtime.js";
import "../src/entrypoints/scheduler-worker.js";
import "../src/module-coverage-runtime.js";
import "../src/module-coverage.test.js";
import "../src/runtime/config-provider.js";
import "../src/runtime/engagement-events.js";
import "../src/runtime/engagement-events-runtime.js";
import "../src/runtime/mailer.js";
import "../src/runtime/mailer-lifecycle-runtime.js";
import "../src/runtime/mailer/lifecycle/common.js";
import "../src/runtime/mailer/lifecycle/lifecycle-senders.js";
import "../src/runtime/mailer/lifecycle/welcome-content.js";
import "../src/runtime/mailer/lifecycle/welcome-sender.js";
import "../src/runtime/mailer-runtime.js";
import "../src/runtime/personalization.js";
import "../src/runtime/personalization-runtime.js";
import "../src/runtime/quality-score.js";
import "../src/runtime/reply-handler.js";
import "../src/runtime/reply-handler-runtime.js";
import "../src/runtime/reply/command-router.js";
import "../src/runtime/reply/intent-service.js";
import "../src/runtime/reply/onboarding/keys.js";
import "../src/runtime/reply/onboarding/link-verification-flow.js";
import "../src/runtime/reply/onboarding/messages.js";
import "../src/runtime/reply/onboarding-service.js";
import "../src/runtime/reply/onboarding-service-runtime.js";
import "../src/runtime/reply/transport.js";
import "../src/runtime/store.js";
import "../src/sandbox-pipeline.js";
import "../src/sandbox-pipeline-runtime.js";
import "../test-harness/cache.js";
import "../test-harness/cache/cache-archive.js";
import "../test-harness/cache/cache-budget.js";
import "../test-harness/cache/cache-claude-enrichment.js";
import "../test-harness/cache/cache-claude.js";
import "../test-harness/cache/cache-common.js";
import "../test-harness/cache/cache-perplexity.js";
import "../test-harness/cache/cache-perplexity-parser.js";
import "../test-harness/config.js";
import "../test-harness/config/config-args.js";
import "../test-harness/config/config-constants.js";
import "../test-harness/config/config-io.js";
import "../test-harness/evaluator.js";
import "../test-harness/harness-runtime.js";
import "../test-harness/matrix-runtime.js";
import "../test-harness/matrix/config.js";
import "../test-harness/matrix/guardrails.js";
import "../test-harness/personas.js";
import "../test-harness/personas/persona-factory.js";
import "../test-harness/personas/persona-topics.js";
import "../test-harness/personas/personas-canonical.js";
import "../test-harness/personas/personas-canonical-defs.js";
import "../test-harness/personas/personas-stress.js";
import "../test-harness/personas/personas-stress-defs.js";
import "../test-harness/pipeline.js";
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
import "../test-harness/suites/05-custom-topics.js";
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
import "../test-harness/suites/custom-topics-runtime.js";
import "../test-harness/suites/depth-control-runtime.js";
import "../test-harness/suites/end-to-end-runtime.js";
import "../test-harness/suites/relevance-scoring-runtime.js";
import "../test-harness/topic-utils.js";
import "../topic-domain.js";
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
import "../web/services/reengagement-state.js";
import "../web/services/request-metadata.js";
import "../web/services/web-rate-limit.js";
import "../web/settings-runtime.js";
import "../web/settings-ui-runtime.js";
import "../web/settings.js";

export const dependencyLinks = [
  "digest-pipeline-seam.js",
  "digest-policy-domain.js",
  "digest-runner.js",
  "eslint.config.js",
  "reengagement.js",
  "repeat-dedup-domain.js",
  "selection-domain.js",
  "selection-domain-runtime.js",
  "source-domain.js",
  "src/entrypoints/bot-server.js",
  "src/entrypoints/digest.js",
  "src/entrypoints/digest-runtime.js",
  "src/entrypoints/scheduler-worker.js",
  "src/module-coverage-runtime.js",
  "src/module-coverage.test.js",
  "src/runtime/config-provider.js",
  "src/runtime/engagement-events.js",
  "src/runtime/engagement-events-runtime.js",
  "src/runtime/mailer.js",
  "src/runtime/mailer-lifecycle-runtime.js",
  "src/runtime/mailer/lifecycle/common.js",
  "src/runtime/mailer/lifecycle/lifecycle-senders.js",
  "src/runtime/mailer/lifecycle/welcome-content.js",
  "src/runtime/mailer/lifecycle/welcome-sender.js",
  "src/runtime/mailer-runtime.js",
  "src/runtime/personalization.js",
  "src/runtime/personalization-runtime.js",
  "src/runtime/quality-score.js",
  "src/runtime/reply-handler.js",
  "src/runtime/reply-handler-runtime.js",
  "src/runtime/reply/command-router.js",
  "src/runtime/reply/intent-service.js",
  "src/runtime/reply/onboarding/keys.js",
  "src/runtime/reply/onboarding/link-verification-flow.js",
  "src/runtime/reply/onboarding/messages.js",
  "src/runtime/reply/onboarding-service.js",
  "src/runtime/reply/onboarding-service-runtime.js",
  "src/runtime/reply/transport.js",
  "src/runtime/store.js",
  "src/sandbox-pipeline.js",
  "src/sandbox-pipeline-runtime.js",
  "test-harness/cache.js",
  "test-harness/cache/cache-archive.js",
  "test-harness/cache/cache-budget.js",
  "test-harness/cache/cache-claude-enrichment.js",
  "test-harness/cache/cache-claude.js",
  "test-harness/cache/cache-common.js",
  "test-harness/cache/cache-perplexity.js",
  "test-harness/cache/cache-perplexity-parser.js",
  "test-harness/config.js",
  "test-harness/config/config-args.js",
  "test-harness/config/config-constants.js",
  "test-harness/config/config-io.js",
  "test-harness/evaluator.js",
  "test-harness/harness-runtime.js",
  "test-harness/matrix-runtime.js",
  "test-harness/matrix/config.js",
  "test-harness/matrix/guardrails.js",
  "test-harness/personas.js",
  "test-harness/personas/persona-factory.js",
  "test-harness/personas/persona-topics.js",
  "test-harness/personas/personas-canonical.js",
  "test-harness/personas/personas-canonical-defs.js",
  "test-harness/personas/personas-stress.js",
  "test-harness/personas/personas-stress-defs.js",
  "test-harness/pipeline.js",
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
  "test-harness/suites/05-custom-topics.js",
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
  "test-harness/suites/custom-topics-runtime.js",
  "test-harness/suites/depth-control-runtime.js",
  "test-harness/suites/end-to-end-runtime.js",
  "test-harness/suites/relevance-scoring-runtime.js",
  "test-harness/topic-utils.js",
  "topic-domain.js",
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
  "web/services/reengagement-state.js",
  "web/services/request-metadata.js",
  "web/services/web-rate-limit.js",
  "web/settings-runtime.js",
  "web/settings-ui-runtime.js",
  "web/settings.js"
];

// Backward-compatible alias for older tooling imports.
export const linkedModules = dependencyLinks;
