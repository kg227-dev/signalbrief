# scripts

Operational and maintenance scripts for SignalBrief covering deployments, state management, store migration, monitoring, content validation, reporting, and module analysis. All scripts use Node.js stdlib only — no npm dependencies.

## 1. Deployment & Release

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `deploy-production.js` | Full SSH deploy: builds artifact, uploads to remote host, restarts services, runs public health checks, enforces release-window guard and staging promotion gate, and clears stale cached registry auth on the VM when the target image is anonymously pullable | Logs to stdout; exits non-zero on failure | `./release-window-guard-runtime`, `./deploy-promotion-gate-runtime`, `node:child_process`, `node:fs`, `node:http`, `node:https`, `node:os`, `node:path`, `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_REMOTE_DIR`, `DEPLOY_PUBLIC_URL` |
| `deploy-staging.js` | Thin CLI wrapper that resolves staging env vars and delegates to `deploy-production.js` with `--target-env staging` | Inherits deploy-production output | `./deploy-staging-runtime`, `node:child_process`, `DEPLOY_STAGING_SSH_HOST`, `DEPLOY_STAGING_PUBLIC_URL`, `DEPLOY_STAGING_SSH_USER`, `DEPLOY_STAGING_SSH_KEY`, `DEPLOY_STAGING_REMOTE_DIR`, `DEPLOY_STAGING_SERVICES` |
| `deploy-staging-runtime.js` | Pure library: resolves staging deploy config from env vars and builds the argv array passed to `deploy-production.js` | Exported functions (no side effects when required) | `node:os`, `node:path`, `DEPLOY_STAGING_SSH_HOST`, `DEPLOY_STAGING_PUBLIC_URL`, `DEPLOY_STAGING_SSH_USER`, `DEPLOY_STAGING_SSH_KEY`, `DEPLOY_STAGING_REMOTE_DIR`, `DEPLOY_PROMOTION_ARTIFACT_PATH` |
| `deploy-rollback-by-sha.js` | CLI entry point for one-command rollback to a commit SHA with mandatory post-rollback public health checks; optional restore SHA enables a full drill | Logs step results and artifact path; exits non-zero on failure | `./deploy-rollback-by-sha-runtime`, `node:child_process` |
| `deploy-rollback-by-sha-runtime.js` | Library: resolves rollback options, deploys a specific commit via archive SHA, runs public health checklist, writes JSON artifact to `artifacts/releases/` | JSON artifact file | `./migrate-store-file-to-sqlite`, `node:child_process`, `node:fs`, `node:http`, `node:https`, `node:path`, `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_REMOTE_DIR`, `DEPLOY_PUBLIC_URL`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |
| `deploy-promotion-gate-runtime.js` | Library: reads and validates the staging deploy artifact before allowing a production deploy (checks SHA match, age, public verification status) | Exported gate evaluation functions | `node:fs`, `node:path` |
| `release-window-guard.js` | CLI: evaluates whether the current time falls within a configured weekday release window (default Mon–Fri 11:00 and 16:00 ET ± 45 min); exits non-zero when blocked | Logs allowed/blocked status | `./release-window-guard-runtime`, `DEPLOY_RELEASE_WINDOWS_ET`, `DEPLOY_HOTFIX`, `DEPLOY_ALLOW_OUTSIDE_WINDOW` |
| `release-window-guard-runtime.js` | Library: parses window specs, computes ET time via `Intl.DateTimeFormat`, evaluates window membership, exports guard functions | Exported pure functions | `node:path`, `DEPLOY_RELEASE_WINDOWS_ET`, `DEPLOY_RELEASE_WINDOW_TOLERANCE_MINUTES`, `DEPLOY_HOTFIX`, `DEPLOY_ALLOW_OUTSIDE_WINDOW` |

## 2. State Management & Backup

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `backup-state.js` | Creates a timestamped `.tgz` archive of `data/` and `archive/` directories including a SHA-256 manifest; prunes old backups to keep the newest N | `.tgz` archive + `backup-manifest.json` inside the archive, under `artifacts/backups/` | `node:crypto`, `node:child_process`, `node:fs`, `node:os`, `node:path`, `SIGNALBRIEF_BACKUP_DIR`, `SIGNALBRIEF_BACKUP_KEEP` |
| `restore-state-drill.js` | Extracts a backup `.tgz` into a temp directory and verifies all file sizes and SHA-256 checksums against the embedded manifest | Logs verified file count and bytes; exits non-zero on mismatch | `node:crypto`, `node:child_process`, `node:fs`, `node:os`, `node:path`, `SIGNALBRIEF_BACKUP_DIR` |
| `migrate-runtime-state-root.js` | Copies user data and archive files from a legacy root directory to a new configured runtime root, using SHA-256 to detect conflicts | JSON copy summary to stdout | `../src/runtime/runtime-state-paths-runtime`, `node:crypto`, `node:fs`, `node:path` |
| `migrate-store-file-to-sqlite.js` | Migrates `data/user-*.json` records into SQLite via idempotent upserts; validates with a second-pass replay check; requires a fresh backup to proceed | JSON artifact in `artifacts/releases/`; exports utility functions used by other scripts | `../src/runtime/store-core-runtime`, `../src/runtime/user-contract-runtime`, `node:child_process`, `node:crypto`, `node:fs`, `node:os`, `node:path`, `SIGNALBRIEF_DATA_DIR`, `SIGNALBRIEF_SQLITE_PATH`, `SIGNALBRIEF_BACKUP_DIR`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |

## 3. Store Migration & Validation

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `store-dual-read-compare.js` | Compares every user record between file-store and SQLite, reporting missing, extra, and field-mismatched users; writes a compare artifact | JSON artifact in `artifacts/releases/`; exits non-zero if parity fails | `./migrate-store-file-to-sqlite`, `../src/runtime/store-core-runtime`, `../src/runtime/user-contract-runtime`, `node:crypto`, `node:fs`, `node:os`, `node:path`, `SIGNALBRIEF_DATA_DIR`, `SIGNALBRIEF_SQLITE_PATH`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |
| `store-canary-guard.js` | Runs a dual-read comparison and evaluates the result against configurable mismatch thresholds; signals a rollback when thresholds are breached | JSON guard artifact; exits non-zero on breach (unless `--warn-only`) | `./migrate-store-file-to-sqlite`, `./store-dual-read-compare`, `node:fs`, `node:path`, `SIGNALBRIEF_DATA_DIR`, `SIGNALBRIEF_SQLITE_PATH`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |
| `store-canary-cohort-update.js` | Prepares a canary cohort expansion by verifying local CI-equivalent gates and staging health checks are green before printing the env var export block | JSON artifact with exported env var block | `./migrate-store-file-to-sqlite`, `../src/runtime/store-core-runtime`, `node:child_process`, `node:fs`, `node:http`, `node:https`, `node:path`, `DEPLOY_STAGING_PUBLIC_URL`, `SIGNALBRIEF_SQLITE_PATH`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |
| `store-full-enable-validate.js` | Validates full SQLite cutover readiness: runs strict dual-read compare, samples token lookups across file/sqlite/canary backends, and confirms rollback switch is safe | JSON artifact with export block; exits non-zero on failure | `./migrate-store-file-to-sqlite`, `./store-dual-read-compare`, `../src/runtime/store-core-runtime`, `node:fs`, `node:path`, `SIGNALBRIEF_DATA_DIR`, `SIGNALBRIEF_SQLITE_PATH`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |
| `store-rollback-sqlite-to-file.js` | Rolls back from SQLite to file-store by replaying SQLite records into `data/user-*.json`; runs a post-rollback parity verify | JSON rollback artifact; exits non-zero on failure or idempotency breach | `./migrate-store-file-to-sqlite`, `./store-dual-read-compare`, `../src/runtime/store-core-runtime`, `../src/runtime/store-record-runtime`, `node:crypto`, `node:fs`, `node:os`, `node:path`, `SIGNALBRIEF_DATA_DIR`, `SIGNALBRIEF_SQLITE_PATH`, `SIGNALBRIEF_BACKUP_DIR`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |
| `store-rollback-verify.js` | Thin wrapper around `store-dual-read-compare` that enforces strict mode (no token bridging, no extra SQLite users, no diff allowed); used as a post-rollback safety gate | JSON compare artifact; exits non-zero if parity fails | `./store-dual-read-compare`, `node:path`, `SIGNALBRIEF_DATA_DIR`, `SIGNALBRIEF_SQLITE_PATH`, `SIGNALBRIEF_RELEASE_ARTIFACT_DIR` |

## 4. Monitoring & Health

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `verify-runtime.js` | Post-deploy verification: checks that `web`, `bot`, and `worker` Docker Compose services are running, polls the scheduler health endpoint until healthy, and runs an optional canary dry-run | Logs pass/fail with diagnostics; exits non-zero on failure | `node:child_process`, `node:http`, `node:https`, `SCHEDULER_HEALTH_URL`, `SCHEDULER_HEALTH_TIMEOUT_MS`, `SCHEDULER_HEALTH_RETRIES`, `EXPECTED_STORE_BACKEND`, `DIGEST_CANARY_CMD` |
| `watchdog-scheduler.js` | Periodic watchdog that probes the scheduler health endpoint and optionally restarts the worker container via a configurable shell command when unhealthy | Logs health status and restart outcome; exits with distinct codes (0=ok, 2=unhealthy, 3=restart failed, 4=still unhealthy after restart) | `node:child_process`, `node:http`, `node:https`, `SCHEDULER_HEALTH_URL`, `SCHEDULER_WATCHDOG_AUTO_RESTART`, `SCHEDULER_WATCHDOG_RESTART_CMD`, `SCHEDULER_WATCHDOG_POST_RESTART_WAIT_MS` |
| `smoke-worker.js` | Starts the scheduler worker in isolation with temp directories and `--dry-run`, waits for a heartbeat recording a completed run, then sends a restart control signal and confirms clean exit | Prints `[smoke-worker] ok` on success; exits non-zero on failure | `../src/entrypoints/scheduler-worker`, `node:child_process`, `node:fs`, `node:path`, `SB_SMOKE_DEBUG` |
| `smoke-admin-scheduler.js` | Starts the web server in isolation with a stale synthetic heartbeat, verifies the scheduler health endpoint reports `503 stale`, then updates the heartbeat to fresh and verifies the admin stats endpoint becomes healthy | Prints `[smoke-admin-scheduler] ok` on success; exits non-zero on failure | `../web/server`, `node:child_process`, `node:fs`, `node:http`, `node:path`, `SB_SMOKE_DEBUG` |

## 5. Content & Validation

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `export-live-recent-digests.js` | Authenticates to the admin API and exports recent digest records for a configurable number of days; optionally includes runtime state | JSON to stdout or a file | `node:fs`, `node:path`, `BASE_URL`, `SIGNALBRIEF_ADMIN_EMAIL`, `SIGNALBRIEF_ADMIN_PASSWORD` |
| `validate-source-scoring.js` | Verifies that source tier classification and authority score values for specific known domains are within expected ranges; also checks `annotateEditorialSignals` integration | Pass/fail lines to stdout; exits non-zero on any failure | `../src/digest/domain/storyline-domain-runtime` |
| `bootstrap-domain-stats.js` | Seeds `data/domain-stats.json` from existing digest JSON records so the domain-learning system starts with accumulated signal rather than a cold state | Writes `domain-stats.json`; logs domain count and top domains | `../src/runtime/runtime-state-paths-runtime`, `../src/digest/domain/domain-learning-runtime`, `node:fs`, `node:path` |
| `test-critical-paths.js` | Comprehensive integration test suite: exercises the digest-runner lock contract, core API routes, admin API auth regression, settings normalization, config schema, mailer contract, admin page guard, admin bypass contract, reply-handler command flow, module coverage, and all sidecar `.test.js` files | Logs `PASS` lines; exits non-zero on any assertion failure | `../src/jobs/digest-runner-runtime`, `../web/api/core`, `../web/api/public`, `../web/routes/admin-api`, `../web/services/web-user-admin-runtime`, `../web/services/web-user-handlers`, `../src/domains/digest`, `../src/platform/mailer`, `../src/platform/store`, `../src/runtime/config-provider`, `../web/admin-auth`, `node:assert`, `node:child_process`, `node:crypto`, `node:fs`, `node:os`, `node:path` |

## 6. Reporting

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `marketing-weekly-report.js` | Computes a weekly marketing snapshot (active subscribers, 7-day open rate, new signups, digest-2 open rate, churn estimate) from the local user store and engagement event log; renders as Markdown with a raw JSON section | Markdown to stdout | `../src/platform/store`, `../src/domains/engagement` |
| `report-marketing-weekly.js` | Thin entry-point shim that calls `main()` from `marketing-weekly-report.js` | Same as `marketing-weekly-report.js` | `./marketing-weekly-report` |

## 7. Module Analysis

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `dependency-links.mjs` | Static ESM import map of canonical source modules used by analysis tools for import-graph fidelity; not executed in production | No runtime output (static declarations only) | Relative imports to `../src/*`, `../web/*` source files |
| `check-module-linkage.mjs` | Parses the import declarations in `src/dependency-links.mjs` and `scripts/module-linkage.mjs`, verifies every import resolves to a real file inside the repo, and rejects banned path segments (e.g., worktree paths) | `[module-linkage] ok` on success; lists unresolved imports and exits non-zero on failure | `scripts/module-linkage.mjs`, `src/dependency-links.mjs`, `node:fs`, `node:path`, `node:url` |
