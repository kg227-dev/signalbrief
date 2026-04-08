"use strict";

function validateDigestRunOptions(runOptions) {
  const {
    inventoryRefreshOnly,
    auditOnly,
    auditTopicRerun,
    auditDateKey,
    todayEt,
  } = runOptions || {};
  if (inventoryRefreshOnly && auditOnly) {
    throw new Error("Inventory refresh runs cannot be combined with --auditOnly");
  }
  if (auditOnly && !auditTopicRerun) {
    throw new Error("Audit-only digest runs require --auditTopic=TOPIC");
  }
  if (auditTopicRerun && !auditDateKey) {
    throw new Error("Topic audit reruns require --auditDate=YYYY-MM-DD");
  }
  if (auditTopicRerun && auditDateKey !== todayEt) {
    throw new Error(`Topic audit reruns only support today ET (${todayEt}) to avoid fake historical backfills`);
  }
}

function createDigestOrchestratorRunContextRuntime(deps) {
  const {
    allUsers,
    USER_STATUS,
    standardMvpTopicTags,
    log,
    logEvent,
    resolveDueUsers,
    getEtNow,
    getEtNowParts,
    toEtDateString,
    CONFIG,
    filterAlreadySentScheduledDueUsers,
    getDigestDeliveryRecordRuntime,
    getDigestRetryStateRuntime,
    allowExampleEmails = false,
    createDigestOrchestratorAdmissionGateRuntime,
    getDigestOrchestratorSpendGuardRuntime,
    getDigestOrchestratorCircuitBreakerRuntime,
    rollingWindowCapUsd,
    rollingWindowHours,
    dailyCapUsd,
    recordRunCost,
    releaseDigestLock,
  } = deps;

  function prepareDigestRunContext({ runOptions, runId, now = new Date() }) {
    validateDigestRunOptions(runOptions);
    const {
      dryRun,
      auditOnly,
      runMode,
      inventoryRefreshOnly,
      auditTopicTag,
      auditDateKey,
      todayEt,
      auditTopicRerun,
    } = runOptions;

    let digestDateKey = auditTopicRerun ? auditDateKey : todayEt;
    let dueUsers = [];
    let fetchDueUsers = [];

    if (inventoryRefreshOnly) {
      fetchDueUsers = [{
        chatId: `inventory-refresh:${digestDateKey}`,
        email: "",
        status: USER_STATUS.ACTIVE,
        topics: standardMvpTopicTags.slice(),
        preferences: {
          email_enabled: false,
          depth: "headline_plus_why",
        },
      }];
      log(`=== SignalBrief inventory refresh starting — ${digestDateKey} (${standardMvpTopicTags.length} topic(s)) ===`);
    } else if (auditTopicRerun) {
      dueUsers = [{
        chatId: `audit:${auditTopicTag}:${digestDateKey}`,
        email: "",
        status: USER_STATUS.ACTIVE,
        topics: [auditTopicTag],
        preferences: {
          email_enabled: false,
          depth: "headline_plus_why",
        },
      }];
      fetchDueUsers = dueUsers.slice();
      log(`=== SignalBrief topic audit rerun starting — ${auditTopicTag} (${digestDateKey}) ===`);
    } else {
      const dueContext = resolveDueUsers({
        allUsers,
        USER_STATUS,
        getEtNow,
        getEtNowParts,
        toEtDateString,
        CONFIG,
        log,
        allowExampleEmails,
        retryStateRuntime: getDigestRetryStateRuntime(),
      });
      digestDateKey = String(dueContext?.todayET || "").trim() || todayEt;
      dueUsers = Array.isArray(dueContext?.dueUsers) ? dueContext.dueUsers.slice() : [];

      if (dueUsers.length > 0) {
        const digestDeliveryRecordRuntime = getDigestDeliveryRecordRuntime();
        const preflight = filterAlreadySentScheduledDueUsers(dueUsers, digestDateKey, digestDeliveryRecordRuntime);
        dueUsers = preflight.dueUsers;
        if (preflight.skippedUsers.length > 0) {
          const skippedList = preflight.skippedUsers
            .map((user) => user?.email || user?.chatId)
            .filter(Boolean)
            .join(", ");
          logEvent("info", "digest.run.skipped", {
            provider: "delivery-record",
            outcome: "already_sent_prefilter",
            skipped_users: preflight.skippedUsers.length,
            date_et: digestDateKey,
          });
          log(`⏭️ Prefiltered ${preflight.skippedUsers.length} user(s) already sent for ${digestDateKey}${skippedList ? ` -> ${skippedList}` : ""}`);
        }
      }

      if (dueUsers.length === 0) {
        logEvent("info", "digest.run.skipped", {
          provider: "scheduler",
          outcome: "no_due_users",
        });
        return {
          shouldExit: true,
          exitCode: 0,
          digestDateKey,
          dueUsers,
          fetchDueUsers,
        };
      }
      fetchDueUsers = dueUsers.slice();
    }

    if (!auditOnly && !inventoryRefreshOnly) {
      const spendGuard = getDigestOrchestratorSpendGuardRuntime();
      const circuitBreaker = getDigestOrchestratorCircuitBreakerRuntime();
      const admissionGate = createDigestOrchestratorAdmissionGateRuntime({
        circuitBreakerRuntime: circuitBreaker,
        spendGuardRuntime: spendGuard,
        rollingWindowCapUsd,
        rollingWindowHours,
        dailyCapUsd,
        log,
      });
      const gate = admissionGate.checkScheduledAdmission({
        dueUsers,
        dateEt: digestDateKey,
        retryStateRuntime: getDigestRetryStateRuntime(),
      });
      if (!gate.allowed) {
        logEvent("warn", "digest.run.blocked", {
          provider: "admission-gate",
          outcome: gate.runValueState,
          blocked_reason: gate.blockedReason,
          due_users: dueUsers.length,
          date_et: digestDateKey,
        });
        log(`⛔ Admission gate blocked: ${gate.blockedReason} (${dueUsers.length} due user(s), date=${digestDateKey})`);
        recordRunCost({
          now,
          runId,
          standardFetchCalls: 0,
          claudeUsage: {},
          dueUsers,
          deliveredUsers: [],
          failedUsers: [],
          publicDigestUrl: "",
          runValueState: gate.runValueState,
          blockedReason: gate.blockedReason,
        });
        releaseDigestLock(runMode);
        return {
          shouldExit: true,
          exitCode: 0,
          digestDateKey,
          dueUsers,
          fetchDueUsers,
        };
      }
      if (gate.eligibleUsers.length < dueUsers.length) {
        const filtered = dueUsers.length - gate.eligibleUsers.length;
        log(`[admission-gate] filtered ${filtered} user(s) already at zero-value cap`);
        dueUsers = gate.eligibleUsers;
      }
      fetchDueUsers = dueUsers.slice();
    }

    if (dryRun) {
      const dueList = dueUsers.map((user) => user.email || user.chatId).filter(Boolean);
      logEvent("info", "digest.run.skipped", {
        provider: "orchestrator",
        outcome: "dry_run",
        due_users: dueUsers.length,
      });
      log(`🧪 Dry run: ${dueUsers.length} user(s) due${dueList.length ? ` -> ${dueList.join(", ")}` : ""}`);
      return {
        shouldExit: true,
        exitCode: 0,
        digestDateKey,
        dueUsers,
        fetchDueUsers,
      };
    }

    return {
      shouldExit: false,
      digestDateKey,
      dueUsers,
      fetchDueUsers,
    };
  }

  return {
    prepareDigestRunContext,
  };
}

module.exports = {
  validateDigestRunOptions,
  createDigestOrchestratorRunContextRuntime,
};
