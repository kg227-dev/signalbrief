# web/

`web/` contains the HTTP server, all API routes, server-side services, and client-side JavaScript for the SignalBrief web application. It runs on port 3003 (default), serves HTML pages and static assets, exposes the core and admin JSON APIs, and handles digest rendering, user signup/settings, and engagement tracking.

---

## 1. Server Core

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `server.js` | Process entrypoint. Creates an `http.Server`, wires `handleWebRequest`, initializes the store, installs crash protection, and starts listening. | Running HTTP server on `PORT` (default 3003) | `node:http`, `./server-runtime`, `../src/runtime/structured-logger-runtime`, `PORT` env var |
| `server-runtime.js` | Central wiring module. Instantiates all service objects, rate limiters, source registries, and route handlers; exports `handleWebRequest`, `ensureStoreInitialized`, `installCrashProtection`, `getServerPort`. | Exports: `handleWebRequest`, `ensureStoreInitialized`, `installCrashProtection`, `getServerPort` | `node:https`, `node:fs`, `node:os`, `node:path`, `node:child_process`, `./server-request-runtime`, `./server-render-runtime`, `../src/platform/store`, `../src/platform/config`, `../src/platform/mailer`, `../src/domains/engagement`, `../src/domains/digest`, `../src/jobs/digest-runner-runtime`, `./server-runtime-*`, `./services/*`, `../src/runtime/*`, `BASE_URL`, `PORT`, `ALLOW_EXAMPLE_SIGNUPS`, `TRUSTED_CORS_ORIGINS` env vars |
| `server-request-runtime.js` | Low-level HTTP primitives. Provides `serveFile` (sync file read with MIME detection), `json` (JSON response writer with CORS header propagation), and `requireJsonBody` (streaming body parser with 1 MB limit). | Exports: `serveFile`, `json`, `requireJsonBody` | `node:fs`, `node:path` |
| `server-render-runtime.js` | Legacy digest-preview renderer wiring. Exposes helper functions plus the deprecated digest-page HTML renderers retained for compatibility tests and non-active tooling. | Exports: `normalizeReferralToken`, `escapeHtml`, `formatPublicDigestDateLabel`, `renderPublicDigestPage`, `renderPublicDigestMissingPage` | `./server-render-public-pages-runtime` |
| `server-render-public-pages-runtime.js` | Legacy digest preview renderer that can build self-contained digest HTML and missing-page HTML. The active MVP path now relies on authenticated archive browsing instead of standalone digest pages. | HTML strings via `renderPublicDigestPage`, `renderPublicDigestMissingPage` | No external dependencies (pure functions) |

---

## 2. Server Runtime Utilities

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `server-runtime-env-runtime.js` | Environment configuration. Exports `WEB_DIR`, `APP_ROOT`, `CANONICAL_HOST`, `PUBLIC_HOSTS`, `getServerPort`, `getBaseUrl`, `getTrustedCorsOrigins`, `getArchiveLegacyDeprecationDeadlineUtc`, `getSchedulerHeartbeatFile`, `getSchedulerControlFile`, `getWebAssetVersion`. | Named exports of env-derived constants and getter functions | `node:fs`, `node:path`, `../src/runtime/runtime-state-paths-runtime`, `PORT`, `BASE_URL`, `TRUSTED_CORS_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC`, `WEB_ASSET_VERSION`, `RELEASE_VERSION`, `SIGNALBRIEF_BUILD_ID` env vars |
| `server-runtime-deps-runtime.js` | Dependency composition root. Calls `createSharedRouteHandlers`, `createCoreRouteDependencies`, `createAdminRouteDependencies`, and `createPublicRouteDependencies`, then passes results to the three canonical route handlers. | Exports: `createServerRouteDependencies` (returns `{ handleCoreApiRoute, handleAdminApiRoute, handlePublicStaticRoute }`) | `./api/core`, `./api/admin`, `./api/public`, `./server-runtime-shared-handlers-runtime`, `./server-runtime-core-registry-runtime`, `./server-runtime-admin-registry-runtime`, `./server-runtime-public-registry-runtime` |
| `server-runtime-request-policy-runtime.js` | HTTP-level policies. Implements `applyCanonicalHostPolicy` (301 redirect non-canonical hosts to `getsignalbrief.com`), `applyResponseCorsPolicy` (sets `res.__corsOrigin`), `handleCorsPreflightPolicy` (OPTIONS 204/403), and `handleRequestErrorPolicy` (500 fallback). | Exports: `applyCanonicalHostPolicy`, `applyResponseCorsPolicy`, `handleCorsPreflightPolicy`, `handleRequestErrorPolicy`, `normalizeOrigin`, `resolveAllowedCorsOrigin` | No external dependencies |
| `server-runtime-auth-session-policy-runtime.js` | Thin façade over `admin-auth.js`. Wraps session functions in a factory so they can be injected into request pipelines. | Exports: `createAdminAuthSessionPolicy` | `./admin-auth` |
| `server-runtime-topic-config-runtime.js` | Static topic and settings constants. Exports `INDUSTRY_TOPICS`, `CAPABILITY_TOPICS`, `DEFAULT_TOPICS`, `MAX_CUSTOM_KEYWORDS` (0 for MVP), and `PROTECTED_FIELDS` (fields that must not be overwritten by `/api/settings`). | Named constant exports | No external dependencies |
| `server-runtime-utils-runtime.js` | Miscellaneous request utilities. `toEtDateKey` (ISO → ET date string), `decodeDigestIdParam` (base64url decode), `sendTransparentGif` (1×1 tracking pixel), `readArchiveFiles` / `getAllowedArchiveDates` (archive file list with index caching and legacy backfill), `normalizeBookmarkUrl`, `createSendMagicLinkEmail`. | Named utility exports | `node:path`, Resend API (via `sendEmail`) |
| `server-runtime-route-bootstrap-runtime.js` | Route dispatch. `createRouteBootstrapHandler` chains core → admin → public route handlers, returning the first truthy result. | Exports: `createRouteBootstrapHandler` | No external dependencies |
| `server-runtime-admin-registry-runtime.js` | Assembles the dependency object for admin route handlers by selecting the relevant subset of server-runtime deps plus `handleAdminRunDigest` from shared handlers. | Exports: `createAdminRouteDependencies` | No external dependencies (pure pass-through) |
| `server-runtime-core-registry-runtime.js` | Assembles the dependency object for core route handlers, injecting `handleSignup` and `handleSettings` from shared handlers. | Exports: `createCoreRouteDependencies` | No external dependencies (pure pass-through) |
| `server-runtime-public-registry-runtime.js` | Assembles the dependency object for the public/static route handler, including `renderPublicDigestPage`, `serveFile`, `WEB_DIR`, and asset version. | Exports: `createPublicRouteDependencies` | No external dependencies (pure pass-through) |
| `server-runtime-shared-handlers-runtime.js` | Bridges the global deps object to `createWebUserHandlers`, which returns `handleSignup`, `handleSettings`, and `handleAdminRunDigest` used by both core and admin routes. | Exports: `createSharedRouteHandlers` | `./services/web-user-handlers` |
| `server-runtime-scheduler-control-runtime.js` | Writes a JSON restart-request to the scheduler control file (`scheduler-control.json`) so the scheduler worker can detect and honor it. | Exports: `createSchedulerWorkerRestartRequester` (returns `requestSchedulerWorkerRestart`) | `node:fs`, `node:path`, `SCHEDULER_CONTROL_FILE` path |

---

## 3. Routes — Core API (`routes/core-api*.js`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `routes/core-api.js` | Core API route handler. Handles `GET /api/topics`, `GET /api/user`, `POST /api/signup`, `POST /api/settings`, `GET /api/health/scheduler`, and delegates to sub-route modules. Also exports `buildPublicUserRecord` (sanitizes user object for public consumption). | Exports: `createCoreApiRouteHandler`, `handleCoreApiRoutes`, `buildPublicUserRecord` | `./core-api-archive-runtime`, `./core-api-unsubscribe-runtime`, `./core-api-engagement-runtime`, `./core-api-link-runtime`, `./core-api-availability-runtime`, `./core-api-health-runtime` |
| `routes/core-api-archive-runtime.js` | Handles the authenticated archive API route (`GET /api/archive/all`). Loads per-user allowed dates, maps archive items with relevance scores, and returns a flat cross-digest archive payload. | JSON archive payload | `../services/archive-digest-stats-runtime`, `../../src/digest/runtime/digest-item-ordering-runtime` |
| `routes/core-api-unsubscribe-runtime.js` | Routes for `GET /api/unsubscribe/confirm`, `POST /api/unsubscribe/one-click`, `GET /api/pause`, `GET /api/reactivate`. | JSON / redirect | `./core-api-unsubscribe-actions-runtime` |
| `routes/core-api-unsubscribe-actions-runtime.js` | Action implementations for unsubscribe, one-click unsubscribe, pause, and reactivate: updates user status and email delivery state. | Updates user store; JSON/redirect responses | `../services/web-user-signup-actions-runtime` (indirectly via deps) |
| `routes/core-api-engagement-runtime.js` | Delegates to tracking-pixel and click-redirect sub-handlers. | Transparent GIF or 302 redirect | `./core-api-engagement-actions-runtime` |
| `routes/core-api-engagement-actions-runtime.js` | `GET /t/:digestId` tracking pixel (1×1 GIF, records email open), `GET /r/:digestId/:url` click redirect (302, records link click). | 200 GIF or 302 redirect; engagement event written | `../../src/domains/engagement` |
| `routes/core-api-link-runtime.js` | `POST /api/request-link` — looks up user by email, rate-limits by IP, sends a magic-link email. Returns generic success to prevent email enumeration. | JSON `{ success: true }`; email sent via Resend API | `../services/web-rate-limit` (via deps), Resend API |
| `routes/core-api-availability-runtime.js` | `POST /api/check-availability` — checks whether an email is already registered. | JSON `{ emailTaken }` | User store (via deps) |
| `routes/core-api-health-runtime.js` | `GET /api/health` — aggregates scheduler heartbeat, digest lock state, and runtime state into a single health probe. Auto-escalates to scheduler restart after 3 consecutive unhealthy checks, then forks a new worker after 6. | JSON health payload; 200 (healthy) or 503 | `../services/admin-ops-scheduler` (via deps), scheduler heartbeat file |

---

## 4. Routes — Admin API (`routes/admin-api*.js`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `routes/admin-api.js` | Admin API router. Chains auth, stats, runtime-state, source-registry, digest-audit, user, bulk, and message sub-handlers for the active email-first MVP admin surface. | Exports: `createAdminApiRouteHandler`, `handleAdminApiRoutes` | `./admin-api-*-runtime` modules |
| `routes/admin-api-auth-runtime.js` | `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/check`. Issues/clears session cookies; enforces login rate limits (5 attempts per 15 min per IP). | JSON auth response; `Set-Cookie` header | `./admin-auth` (via deps), `CONFIG` |
| `routes/admin-api-stats-runtime.js` | `GET /api/admin/stats` — builds the full admin dashboard payload: scheduler heartbeat, digest runs, user roster, delivery stats, costs, referrals, engagement trend, feedback trend, quality metrics, and incidents. | JSON stats payload | `./admin-api-stats-actions-runtime`, `./admin-api-stats-payload-runtime` |
| `routes/admin-api-stats-actions-runtime.js` | Helper actions for the stats route: `resolveSchedulerHeartbeatLoader`, `emitIgnoredBackfillSafe`, `buildAdminStatsPayload`. | Stats sub-payload builders | `../services/admin-stats-*`, `../services/admin-ops-scheduler` |
| `routes/admin-api-stats-payload-runtime.js` | Assembles the final stats response shape from sub-stats modules (roster, delivery, costs, runs, referrals, quality). | Stats payload object | `../services/admin-stats-*` |
| `routes/admin-api-runtime-state-runtime.js` | `GET /api/admin/runtime-state` — returns runtime diagnostics. `GET /api/admin/export/recent-digests?days=N` — exports recent digest snapshots across all users. | JSON diagnostics / export | `../services/runtime-state-runtime`, `../services/admin-recent-digests-export-runtime` (via deps) |
| `routes/admin-api-source-registry-runtime.js` | CRUD for the source policy registry: `GET /api/admin/source-registry` (list), `GET /api/admin/source-registry/:domain` (detail), `POST /api/admin/source-registry` (upsert), `POST /api/admin/source-registry/:domain/reset`. | JSON registry payloads; writes broker-embedded `governance` in the active standard-topic broker config | `../services/admin-source-registry-runtime`, `../../src/runtime/source-policy-registry-runtime` |
| `routes/admin-api-users-runtime.js` | User management routes: `GET /api/admin/user-by-email`, `GET /api/admin/audit`, `POST /api/admin/update-delivery-time`, `POST /api/admin/set-user-status`, `POST /api/admin/delete-user`, `POST /api/admin/run-digest`, `POST /api/admin/regenerate-digest`, `POST /api/admin/resend-digest`, `POST /api/admin/restart-scheduler-worker`. | JSON user/action responses | `./admin-api-users-actions-runtime` |
| `routes/admin-api-users-actions-runtime.js` | Action implementations for user management: update delivery time, set status (active/paused/unsubscribed), delete user, trigger digest run, restart scheduler worker. | Mutates user store; emits admin action log entries | `../services/web-user-admin-runtime` (via deps) |
| `routes/admin-api-bulk-runtime.js` | `POST /api/admin/bulk-action` — applies a bulk action (e.g., pause, send magic link) to a filtered list of users. | JSON `{ affected, skipped }` | `./admin-api-bulk-actions-runtime` |
| `routes/admin-api-bulk-actions-runtime.js` | Defines and applies bulk action types: validates emails, plans affected entries, applies mutations with audit logging. | Mutates user store; logs bulk admin actions | User store and `logAdminActionEvent` (via deps) |
| `routes/admin-api-message-runtime.js` | `POST /api/admin/message-user` — dispatches an admin email to a specific user. | JSON `{ ok }`; email sent | `./admin-api-message-actions-runtime` |
| `routes/admin-api-message-actions-runtime.js` | Processes the message request: resolves target user, sends email, and logs the admin message event. | Email via Resend API; admin message log entry | `../services/admin-ops-io` (via deps) |
---

## 5. Routes — Public Static

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `routes/public-static.js` | Serves all HTML pages and static assets. `GET /digest/:date` is now a compatibility shim only: tokenized legacy links redirect into the authenticated archive, admin access redirects into digest audit, and no standalone digest page is rendered. Also generates `GET /sitemap.xml`, enforces admin HTML auth redirects (302 → `/admin/login`), injects `__ASSET_VERSION__` into `index.html`/`settings.html`/`signup.html`, and maps all other static routes to files in `web/`. | HTML pages, JS/CSS/txt/xml file responses, or 302 compatibility redirects | `./server-render-runtime` (via deps), `node:fs`, `node:path` |

---

## 6. Services — Admin (`services/admin-*.js`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `services/admin-ops.js` | Factory for the admin operations service. Composes `createCostRunsReader`, `createLegacyArchiveUsageRecorder`, `createAdminAuditLoggers`, `createSchedulerHeartbeatAccessor`, and `computeFeedbackTrend` into a single service object. | Exports: `createAdminOpsService` — returns `{ loadCostRunsNewest, getCachedOrRefreshSchedulerHeartbeat, isLegacyArchiveEndpointEnabled, recordLegacyArchiveUsage, readJsonLineLog, parseIsoTs, computeFeedbackTrend, maskEmail, summarizeMessage, hashText, logAdminMessageEvent, logAdminActionEvent }` | `node:crypto`, `./admin-ops-utils`, `./admin-ops-io`, `./admin-ops-analytics`, `./admin-ops-scheduler`, cost log file, admin log files |
| `services/admin-ops-analytics.js` | Computes feedback trend (14-day vs prior 14-day window). | `computeFeedbackTrend` | User store and engagement events (via deps) |
| `services/admin-ops-scheduler.js` | Reads and caches the scheduler heartbeat file (5-second TTL). Determines scheduler health, blocked state, age, and in-flight count. | `createSchedulerHeartbeatAccessor` → `getCachedOrRefreshSchedulerHeartbeat` | `node:fs`, scheduler heartbeat file |
| `services/admin-ops-utils.js` | Pure utility functions: `appendJsonLineLog`, `readJsonLineTail` (tail-reads JSONL files with byte-range fallback), `parseIsoTs`, `toNumericOrNull`, `maskEmail`, `summarizeMessage`, `hashText`. | Named utility exports | `node:fs`, `node:path`, `node:crypto` (via caller) |
| `services/admin-ops-io.js` | File I/O factories: `createCostRunsReader` (stat-cached JSONL cost log reader), `createLegacyArchiveUsageRecorder`, `createAdminAuditLoggers` (message and action log appenders). | `loadCostRunsNewest`, `recordLegacyArchiveUsage`, `logAdminMessageEvent`, `logAdminActionEvent` | `node:fs`, `./admin-ops-utils`, cost log and admin log files |
| `services/admin-stats-costs.js` | Builds cost statistics from cost run log entries: totals, averages, and per-user breakdowns over a rolling window. | Cost stats object | Cost run log (via deps) |
| `services/admin-stats-delivery.js` | Computes delivery statistics: expected vs delivered scheduled sends, missed-send trend, countdown to next delivery, last successful run. | Delivery stats object | `./admin-stats-delivery-runtime`, `./delivery-schedule` |
| `services/admin-stats-delivery-runtime.js` | Core delivery-window computation functions: `buildWindow`, `expectedScheduledCount`, `deliveredScheduledCount`, `getLastSuccessfulScheduledRun`, `getNextExpectedActiveDelivery`, `minutesUntilEtKey`, `formatCountdown`, `formatMissedTrendLabel`. | Named function exports | No external dependencies |
| `services/admin-stats-quality.js` | Summarizes digest quality scores (DQS) across the roster: current average, 7-day average, improving/at-risk user counts. | `summarizeRosterQuality` | No external dependencies |
| `services/admin-stats-referrals.js` | Builds referral list and unique engagement key logic from user records and engagement events. | `buildReferrals`, `buildUniqueEngagementKey` | No external dependencies |
| `services/admin-stats-roster.js` | Builds the admin user roster: formats each user with delivery schedule, depth label, DQS, days-missed count, and status. | Roster array | `./delivery-schedule` |
| `services/admin-stats-runs.js` | Parses and summarizes digest run history from the cost log: run mode, timestamps, item counts, failure modes. | Run summary array | `./admin-digest-insights-runtime`, `../../src/digest/runtime/digest-item-ordering-runtime` |
| `services/admin-digest-insights-runtime.js` | Analyzes digest items for quality issues: detects repeat content, weak sources, thin topic pools. Exports `annotateHistoricalRepeatEvidence`, `resolveRowFailureMode`. | Named function exports | `../../src/digest/domain/storyline-domain-runtime` |
| `services/admin-recent-digests-export-runtime.js` | Builds a cross-user recent-digest export (for `GET /api/admin/export/recent-digests`): resolves snapshots, annotates with repeat evidence and failure modes. | `createRecentDigestsExporter` → `buildRecentDigestsExport` async function | `./admin-digest-insights-runtime`, `../../src/digest/runtime/digest-item-ordering-runtime` |
| `services/admin-source-registry-runtime.js` | Builds overview and domain-detail views of the source policy registry for admin display, with search/filter support and effective policy explanation. | `buildSourceRegistryOverview`, `buildSourceRegistryDomainDetail` | `../../src/digest/domain/storyline-domain-runtime`, `../../src/runtime/source-policy-registry-runtime` |

---

## 7. Services — Shared/User

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `services/archive-digest-stats-runtime.js` | Core archive data helpers: `sortArchiveDatesDescending`, `loadDeliveredSnapshotForDate`, `buildDeliveredItemsByDate`, `resolveAllowedArchiveDatesForUser`, `resolveDeliveredDigestItems`. Used by core archive API and admin stats. | Named function exports | `../../src/domains/digest` (via deps) |
| `services/archive-scoring.js` | Computes `archiveRelevanceScore(item, userTopics)` for archive item ranking. Uses topic match and base score only; deprecated user weight adjustments are ignored in the web archive path. | `archiveRelevanceScore` | `../../src/domains/digest`, `./topic-normalization-runtime` |
| `services/delivery-schedule.js` | ET-timezone delivery schedule helpers: `parseEtNowParts`, `formatTimeEt`, `normalizeDeliveryTimeInput`, `formatDaysLabel`, `computeNextDeliveryEt`. | Named function exports | `node:Intl` (built-in) |
| `services/request-metadata.js` | Extracts `getClientIp` (Cloudflare → X-Forwarded-For → socket), `getRequestHost`, and `getRequestScheme` (Cloudflare CF-Visitor → X-Forwarded-Proto → socket) from raw Node.js `IncomingMessage`. | Named function exports | No external dependencies |
| `services/runtime-state-runtime.js` | `createRuntimeStateInspector` — inspects runtime path targets (existence, size), store health, recent cost runs, and process info to produce health and diagnostic payloads. | `createRuntimeStateInspector` → `{ getRuntimeStateHealth, getRuntimeStateDiagnostics }` | `node:fs`, `../src/runtime/runtime-state-paths-runtime` |
| `services/topic-normalization-runtime.js` | `canonicalizeTopicKey` — normalizes a topic string to a supported MVP standard topic. `normalizeTopicsForUserInput` — filters and deduplicates topic selections and rejects non-MVP topics when custom topics are disabled. | Named function exports | No external dependencies |
| `services/web-rate-limit.js` | In-memory rate limiters: `createSignupRateLimiter` (5 signups per IP per 15 min; 10-min email cooldown), `createMagicLinkRateLimiter`, `createSettingsRateLimiter`. | Named factory exports | No external dependencies |
| `services/web-user-handlers.js` | Composes `createSignupHandler`, `createSettingsHandler`, and `createAdminRunDigestHandler` into a single `createWebUserHandlers` factory. | Exports: `createWebUserHandlers` → `{ handleSignup, handleSettings, handleAdminRunDigest }` | `./web-user-signup-runtime`, `./web-user-settings-runtime`, `./web-user-admin-runtime` |
| `services/web-user-signup-runtime.js` | `createSignupHandler` — orchestrates signup: validates input, checks conflicts, resolves referral context, creates user record, writes to store, and sends the welcome email. | JSON `{ success, chatId, token }` response; writes user to store; Resend API call | `./web-user-signup-actions-runtime`, `../src/platform/mailer`, `../src/platform/store` |
| `services/web-user-signup-actions-runtime.js` | Pure action functions for signup: `parseSignupInput`, `findSignupConflict`, `resolveReferralContext`, `buildSignupUser`, `runSignupSideEffects`, `buildSignupResponse`. | Named function exports | No external dependencies |
| `services/web-user-settings-runtime.js` | `createSettingsHandler` — validates token, applies reduced-scope MVP settings updates (topics + delivery preferences), rejects deprecated fields, and writes the user to store. Enforces `PROTECTED_FIELDS` and standard-topic-only input. | JSON `{ ok }` or error; writes user to store | `../../src/platform/store`, `./topic-normalization-runtime` |
| `services/web-user-admin-runtime.js` | `createAdminRunDigestHandler` — admin-only endpoint that triggers a full scheduled recovery run. | JSON run result; digest job started or rejected | `./web-user-admin-actions-runtime`, `../../src/jobs/digest-runner-runtime` |
| `services/web-user-admin-actions-runtime.js` | `handleFullDigestRun` — triggers a full scheduled recovery run and logs the admin action. | Digest run triggered or rejected; admin action log entry | `../../src/jobs/digest-runner-runtime` (via deps) |

---

## 8. Client-side JavaScript

All files in this section are served as static assets and execute in the browser. They are plain IIFE scripts (no bundler) that attach to `window.*` namespaces.

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `index.js` | Onboarding page orchestrator. Reads topic/preference state from `SignalBriefPrefs`, wires topic chip selection, form submission, dark-mode toggle, and referral token forwarding. | DOM mutations on `index.html` | `window.SignalBriefPrefs`, `window.SignalBriefIndexHelpersRuntime`, `window.SignalBriefIndexFormRuntime` |
| `signup-flow.js` | Typeform-style multi-step signup flow (5 steps). Manages step navigation, validation, topic chip selection, schedule choices, and final form submission. | DOM step transitions; `POST /api/signup` | `window.SignalBriefPrefs`, `window.SignalBriefIndexHelpersRuntime`, `window.SignalBriefIndexFormSubmitRuntime` |
| `index-form-runtime.js` | Onboarding form UI helpers. Wires progress dots, form-section visibility, and signup binding using `SignalBriefIndexFormContextRuntime` and `SignalBriefIndexFormSubmitRuntime`. | Exports via `window.SignalBriefIndexFormRuntime` | `window.SignalBriefIndexFormContextRuntime`, `window.SignalBriefIndexFormSubmitRuntime` |
| `index-form-submit-runtime.js` | Handles the actual form submission: builds signup payload, calls `/api/signup`, maps errors, updates UI on success/failure. | `POST /api/signup`; DOM success/error state | `window.SignalBriefIndexHelpersRuntime` (for `fetchJsonStrict`) |
| `index-form-context-runtime.js` | Onboarding UI context helpers: `createVisibilityHandlers` (show/hide onboarding vs hero), `createProgressHandlers` (progress dot updates), `createSignupBinding` (CTA button wiring), `switchPreview`. | Exports via `window.SignalBriefIndexFormContextRuntime` | No external dependencies |
| `index-helpers-runtime.js` | Topic chip rendering (`appendTopicGroup`), dark-mode helpers (`createDarkModeHelpers`), and `createRequestHelpers` (wraps `fetch` with strict JSON error handling). | Exports via `window.SignalBriefIndexHelpersRuntime` | No external dependencies |
| `preferences-runtime.js` | Shared preference runtime composer. Merges `SignalBriefPrefsRuntime` (topic/schedule sub-runtimes) and `SignalBriefPrefsStateRuntime` (state model) into `SignalBriefPrefs`. Exposes topic lists, `createPreferenceState`, `isCustomTopic`, `topicDisplayLabel`. | `window.SignalBriefPrefs` namespace | `window.SignalBriefPrefsRuntime`, `window.SignalBriefPrefsStateRuntime` |
| `preferences-shared.js` | Alternative shared preference entry point that wraps `SignalBriefPrefsRuntime` and `SignalBriefPrefsStateRuntime`. Used on pages that load these separately. | `window.SignalBriefPrefs` namespace | `window.SignalBriefPrefsRuntime`, `window.SignalBriefPrefsStateRuntime` |
| `preferences-state-runtime.js` | `createPreferenceState` factory. Composes `SignalBriefPrefsStateCoreRuntime` and `SignalBriefPrefsStateModelRuntime` to produce a state object with getters/setters for topics, depth, days-of-week, delivery time, items-per-digest, and payload builder. | Exports via `window.SignalBriefPrefsStateRuntime` | `window.SignalBriefPrefsStateCoreRuntime`, `window.SignalBriefPrefsStateModelRuntime` |
| `preferences-state-model-runtime.js` | `createPreferenceStateModel` — encapsulates mutable preference fields (depth, deliveryTime, daysOfWeek, itemsPerDigest) with typed getters/setters. | Exports via `window.SignalBriefPrefsStateModelRuntime` | No external dependencies |
| `preferences-state-core-runtime.js` | Core state helpers: `defaultNormalizeDay`, `buildNormalizeDays`, `defaultDaysFromFrequency`, `defaultFrequencyFromDays`, `toPositiveInteger`, `createTopicState`. | Exports via `window.SignalBriefPrefsStateCoreRuntime` | No external dependencies |
| `preferences-topic-runtime.js` | Topic catalog snapshot builder, `sanitizeTopicList`, `replaceArray`. Used to initialize and refresh topic chip state. | Exports via `window.SignalBriefPrefsTopicRuntime` | No external dependencies |
| `preferences-schedule-runtime.js` | Day normalization helpers (`normalizeDay`, `normalizeDays`, `daysFromFrequency`, `frequencyFromDays`) for schedule selection UI. | Exports via `window.SignalBriefPrefsScheduleRuntime` | No external dependencies |
| `settings-runtime.js` | Settings page orchestrator. Loads user data from `/api/user?token=...`, populates preference state, wires save/cancel/request-link/unsubscribe actions. | DOM updates on `settings.html`; `POST /api/settings` | `window.SignalBriefPrefs`, `window.SignalBriefSettingsUiRuntime` |
| `settings-ui-runtime.js` | Composes topic and preference UI contexts from `SignalBriefSettingsUiTopicRuntime` and `SignalBriefSettingsUiPreferencesRuntime` into a unified `createSettingsUiContext`. | Exports via `window.SignalBriefSettingsUiRuntime` | `window.SignalBriefSettingsUiTopicRuntime`, `window.SignalBriefSettingsUiPreferencesRuntime` |
| `settings-ui-preferences-runtime.js` | Preferences UI context: wires depth selector, days-of-week toggles, delivery time input, items-per-digest radio, and renders initial/unsubscribed states. | Exports via `window.SignalBriefSettingsUiPreferencesRuntime` | `window.SignalBriefSettingsUiPreferencesActionsRuntime` |
| `settings-ui-preferences-actions-runtime.js` | Preference action helpers: `setSelectedDepth`, `initDepthSelector`, `renderSettingsDays`, `toggleSettingsDay`, `setSettingsDays`, `getSettingsFrequency`, `renderInitialState`, `renderUnsubscribedState`. | Exports via `window.SignalBriefSettingsUiPreferencesActionsRuntime` | No external dependencies |
| `settings-ui-topic-actions-runtime.js` | Topic UI action helpers: `createTopicUiHandlers` — handles standard-topic chip selection and enforces the reduced-scope topic limits. | Exports via `window.SignalBriefSettingsUiTopicActionsRuntime` | `window.SignalBriefPrefs` (via caller) |
| `settings-ui-topic-runtime.js` | Composes `createTopicUiHandlers` into a `createTopicUiContext` with `renderChips` and `bindTopicHandlers`. | Exports via `window.SignalBriefSettingsUiTopicRuntime` | `window.SignalBriefSettingsUiTopicActionsRuntime` |
| `settings-ui-sources-runtime.js` | Source-preferences UI: domain normalization/validation, chip rendering for trusted/blocked source lists, add/remove handlers. | Exports via `window.SignalBriefSettingsUiSourcesRuntime` | No external dependencies |
| `settings.js` | Settings page bootstrap. Bridges global `window.*` functions (`setSettingsDays`, `toggleSettingsDay`, `requestSettingsLink`) to `SignalBriefSettingsRuntime` and calls `initSettingsPage()`. | Initializes settings page | `window.SignalBriefSettingsRuntime` |
| `admin-auth.js` | Server-side admin session management. `createAdminSession` (issues a crypto-random session cookie), `clearAdminSessionByRequest`, `isAdminAuthed`, `getAdminActor`, `verifyAdminPassword`, `checkLoginRate`. Non-production environments bypass auth for HTML routes. | Session state in memory (Map); `Set-Cookie` response header | `node:crypto`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` env vars (via `CONFIG`) |

---

## 9. HTML Pages & Static Assets

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `index.html` | Public landing and onboarding page. Contains the hero section, topic-chip grid, schedule selector, and onboarding form. Script tags load `index-helpers-runtime.js`, `index-form-*-runtime.js`, `preferences-*-runtime.js`, and `index.js`. `__ASSET_VERSION__` token is replaced at serve time. | Landing page HTML | `style.css`, client-side JS modules |
| `signup.html` | Dedicated multi-step signup page. Uses the Typeform-style step flow from `signup-flow.js`. | Signup wizard HTML | `style.css`, `preferences-*-runtime.js`, `signup-flow.js` |
| `settings.html` | Authenticated user settings page. Allows editing topics, schedule, and depth for the reduced-scope email MVP. Loads user data from `/api/user?token=`. | Settings page HTML | `style.css`, `preferences-*-runtime.js`, `settings-*-runtime.js`, `settings.js` |
| `admin.html` | Admin dashboard SPA. Displays roster, delivery stats, cost trends, engagement metrics, digest run history, incidents, and bulk actions. | Admin dashboard HTML | `style.css`, no bundled JS framework |
| `admin-login.html` | Admin login form. `POST /api/admin/login` with email/password. | Login page HTML | `style.css` |
| `admin-source-registry.html` | Source policy registry admin page. Lists all known domains, allows viewing and editing per-domain trust/policy settings. | Source registry UI HTML | `style.css` |
| `admin-user.html` | Per-user admin detail page. Shows user record, delivery schedule, digest history, engagement events, and audit log. | User detail UI HTML | `style.css` |
| `archive.html` | Authenticated archive page. Displays the user's delivered digest history with per-item relevance scores, search, and filters. | Archive page HTML | `style.css`, `preferences-shared.js`, `preferences-state-*.js` |
| `style.css` | Global stylesheet. Covers layout, typography, topic chips, progress indicators, admin tables, dark-mode variables, and responsive breakpoints. | CSS served at `/style.css` | None |
| `robots.txt` | Crawler policy. Disallows `/admin`, `/api/`, `/settings`, `/archive`. Points to sitemap. | `text/plain` served at `/robots.txt` | None |

---

## 10. Canonical API Surfaces (`api/`)

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `api/core/index.js` | Canonical re-export of `routes/core-api.js`. Preferred import point for core API handler creation. | Re-exports `createCoreApiRouteHandler`, `handleCoreApiRoutes`, `buildPublicUserRecord` | `../../routes/core-api` |
| `api/admin/index.js` | Canonical re-export of `routes/admin-api.js`. Preferred import point for admin API handler creation. | Re-exports `createAdminApiRouteHandler`, `handleAdminApiRoutes` | `../../routes/admin-api` |
| `api/public/index.js` | Canonical re-export of `routes/public-static.js`. Preferred import point for public/static handler creation. | Re-exports `createPublicStaticRouteHandler`, `handlePublicStaticRoutes` | `../../routes/public-static` |

---

## 11. Canonical Service Surfaces

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `services/` modules | Import service modules directly from their concrete files; unused admin/shared/user barrels were removed to keep the web service surface canonical. | Named exports of the targeted service module | Direct module path such as `./admin-ops`, `./delivery-schedule`, `./web-user-handlers` |
